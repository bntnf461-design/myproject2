/* =====================================================================
 * interp.js — プログラムの実行（インタプリタ）
 *
 * 移動・待ち以外の命令（ラベル、ジャンプ、CALL、変数計算、出力など）はここで即時に実行し、
 * 時間のかかる「移動」は app.js に依頼します。
 *
 * host（app.js が渡す）:
 *   lib()                 → { 名前: prog }（同じシステムのプログラム一覧）
 *   getIn(kind, n)        → true/false   入力（IN / DI / RI）
 *   getOut(kind, n)       → true/false   出力（OT / DO / RO）
 *   setOut(kind, n, val)
 *   vars                  → { num:{I000:0, R1:0,...}, pos:{P001:位置, PR1:位置} }
 *   curPose() / curQ()    → 現在の TCP 姿勢 / 関節角
 *   setOverride(%)        → 速度オーバーライド
 *   log(msg, lv)
 *   opts                  → { skipUnknown:true, waitTimeout:秒(0=無制限) }
 * ===================================================================== */
(function (RS) {
  'use strict';

  class Interp {
    constructor(host) {
      this.host = host;
      this.stack = [];
      this.wait = null;
      this.shift = null;
      this.warned = new Set();
    }
    get frame() { return this.stack[this.stack.length - 1]; }
    get pc() { return this.frame ? this.frame.pc : -1; }
    get progName() { return this.frame ? this.frame.prog.name : ''; }

    start(name, pc) {
      const prog = this.host.lib()[name];
      if (!prog) return 'プログラム ' + name + ' がありません';
      this.stack = [this.mkFrame(prog, pc || 0)];
      this.wait = null; this.shift = null;
      return '';
    }
    mkFrame(prog, pc) {
      const ins = prog.lines.map(l => RS.parseLine(prog.sys, l));
      const labels = {};
      ins.forEach((i, k) => { if (i.op === 'LABEL') labels[i.label] = k; });
      return { prog, ins, labels, pc };
    }
    warnOnce(key, msg) { if (!this.warned.has(key)) { this.warned.add(key); this.host.log(msg, 'warn'); } }

    num(ref) {
      if (ref.num != null) return ref.num;
      const v = this.host.vars.num[ref.ref];
      return v == null ? 0 : v;
    }
    cond(c) {
      if (!c) return true;
      if (c.t === 'multi') {
        let r = this.cond(c.conds[0]);
        for (let i = 1; i < c.conds.length; i++) r = c.ops[i - 1] === 'AND' ? r && this.cond(c.conds[i]) : r || this.cond(c.conds[i]);
        return r;
      }
      if (c.t === 'io') {
        const v = /^(IN|DI|RI)$/.test(c.kind) ? this.host.getIn(c.kind, c.n) : this.host.getOut(c.kind, c.n);
        return v === c.val;
      }
      const a = this.num({ ref: c.lhs }), b = this.num(c.rhs);
      switch (c.op) {
        case '=': return Math.abs(a - b) < 1e-9;
        case '<>': return Math.abs(a - b) >= 1e-9;
        case '<': return a < b; case '>': return a > b;
        case '<=': return a <= b; case '>=': return a >= b;
      }
      return false;
    }
    evalExpr(toks) { return RS.evalExpr(toks, ref => this.num({ ref })); }

    /* 1フレームごとに呼ぶ。戻り値：
     *   null                     待ち中・計算のみ（次のフレームでまた呼ぶ）
     *   {t:'move', ...}          移動を依頼（終わったら done() を呼ぶ）
     *   {t:'end'} {t:'pause'} {t:'alarm', key, msg} */
    tick(dt, single) {
      const H = this.host;
      if (this.wait) {
        const hadWait = true;
        const w = this.wait;
        if (w.kind === 'timer') { w.t -= dt; if (w.t > 0) return null; this.wait = null; }
        else if (w.kind === 'in') {
          const v = /^(IN|DI|RI)$/.test(w.io.kind) ? H.getIn(w.io.kind, w.io.n) : H.getOut(w.io.kind, w.io.n);
          if (v === w.io.val) { this.wait = null; }
          else {
            w.t += dt;
            if (w.timeout != null && w.t >= w.timeout) { this.wait = null; }                      // 安川 T=：時間で先へ進む
            else if (w.timeoutLbl != null && w.t >= (H.opts.fanucTmout || 30)) {   // ファナック $WAITTMOUT 相当
              this.wait = null;
              if (!this.jump(w.timeoutLbl)) return { t: 'alarm', key: 'prog', msg: `TIMEOUT の飛び先 LBL[${w.timeoutLbl}] がありません` };
            }
            else if (H.opts.waitTimeout && w.t >= H.opts.waitTimeout && w.timeout == null && w.timeoutLbl == null)
              return { t: 'alarm', key: 'wait', msg: `${w.text} が ${H.opts.waitTimeout} 秒来ません` };
            else return null;
          }
        } else if (w.kind === 'pulse') { w.t -= dt; if (w.t > 0) return null; H.setOut(w.io.kind, w.io.n, false); this.wait = null; }
        if (hadWait && single) return { t: 'stepped' };
      }
      let budget = 3000;
      while (budget-- > 0) {
        const F = this.frame;
        if (!F) return { t: 'end' };
        if (F.pc >= F.ins.length) {
          if (this.stack.length > 1) { this.stack.pop(); this.frame.pc++; continue; }
          return { t: 'end' };
        }
        const i = F.ins[F.pc];
        const text = F.prog.lines[F.pc];
        switch (i.op) {
          case 'NOP': case 'COMMENT': case 'LABEL': F.pc++; break;
          case 'IGNORE': this.warnOnce('ig' + i.msg, i.msg); F.pc++; break;
          case 'ERR': return { t: 'alarm', key: 'prog', msg: `${F.prog.name} ${F.pc + 1}行目：${i.msg}` };
          case 'UNKNOWN':
            if (H.opts.skipUnknown) { this.warnOnce(F.prog.name + F.pc, `${F.prog.name} ${F.pc + 1}行目 未対応のため飛ばしました：${i.text}`); F.pc++; break; }
            return { t: 'alarm', key: 'prog', msg: `${F.prog.name} ${F.pc + 1}行目 未対応の命令：${i.text}` };
          case 'END':
            if (this.stack.length > 1 && !i.abort) { this.stack.pop(); this.frame.pc++; break; }
            return { t: 'end' };
          case 'RET':
            if (this.stack.length > 1) { this.stack.pop(); this.frame.pc++; break; }
            return { t: 'end' };
          case 'PAUSE': F.pc++; return { t: 'pause' };
          case 'MESSAGE': H.log(i.text, 'info'); F.pc++; break;
          case 'JUMP':
            if (this.cond(i.cond)) { if (!this.jump(i.label)) return { t: 'alarm', key: 'prog', msg: `ラベル ${i.label} がありません` }; }
            else F.pc++;
            break;
          case 'CALL': case 'JUMPJOB': {
            if (!this.cond(i.cond)) { F.pc++; break; }
            const p = H.lib()[i.name];
            if (!p) return { t: 'alarm', key: 'prog', msg: `呼び出し先 ${i.name} がありません` };
            if (i.op === 'JUMPJOB') { this.stack[this.stack.length - 1] = this.mkFrame(p, 0); break; }
            if (this.stack.length >= 16) return { t: 'alarm', key: 'prog', msg: 'CALL の入れ子が深すぎます' };
            this.stack.push(this.mkFrame(p, 0));
            break;
          }
          case 'CALC': {
            const N = H.vars.num;
            const cur = N[i.dst] || 0;
            let v;
            switch (i.fn) {
              case 'SET': v = this.num(i.arg); break;
              case 'ADD': case 'INC': v = cur + this.num(i.arg); break;
              case 'SUB': case 'DEC': v = cur - this.num(i.arg); break;
              case 'MUL': v = cur * this.num(i.arg); break;
              case 'DIV': { const d = this.num(i.arg); if (!d) return { t: 'alarm', key: 'prog', msg: '0 で割りました' }; v = cur / d; break; }
              case 'EXPR': try { v = this.evalExpr(i.expr); } catch (e) { return { t: 'alarm', key: 'prog', msg: '式を計算できません：' + text }; } break;
            }
            if (!isFinite(v)) return { t: 'alarm', key: 'prog', msg: `${F.prog.name} ${F.pc + 1}行目：計算結果が数値になりません（0 で割った可能性）` };
            if (/^[BID]/.test(i.dst)) v = Math.trunc(v);
            const rng = { B: [0, 255], I: [-32768, 32767], D: [-2147483648, 2147483647] }[i.dst[0]];
            if (rng && /^[BID]\d{3}$/.test(i.dst) && (v < rng[0] || v > rng[1])) return { t: 'alarm', key: 'prog', msg: `${F.prog.name} ${F.pc + 1}行目：${i.dst} の範囲（${rng[0]}〜${rng[1]}）を超えます（${v}）` };
            N[i.dst] = v;
            F.pc++; break;
          }
          case 'PRSET': {
            const P = H.vars.pos;
            if (i.src === 'LPOS') P['PR' + i.pr] = { k: 'c', p: H.curPose(), cfg: RS.configOf(H.curQ()), uf: 0, ut: 1 };
            else if (i.src === 'JPOS') P['PR' + i.pr] = { k: 'j', q: H.curQ() };
            else {
              const zero = () => ({ k: 'c', p: { X: 0, Y: 0, Z: 0, rx: 0, ry: 0, rz: 0 }, cfg: 'N U T, 0, 0, 0', uf: 0, ut: 1 });
              // 未設定の PR は使えない（実機でも未初期化データのアラーム）。ただし PR[n]=PR[n]-PR[n]（クリア）は許す
              const clearIdiom = i.b != null && i.a === i.pr && i.b === i.pr && i.sign === '-';
              if (!P['PR' + i.a] && !clearIdiom) return { t: 'alarm', key: 'prog', msg: `PR[${i.a}] が未設定です` };
              if (i.b != null && !P['PR' + i.b] && !clearIdiom) return { t: 'alarm', key: 'prog', msg: `PR[${i.b}] が未設定です` };
              const a = P['PR' + i.a] || zero();
              if (i.b != null && !P['PR' + i.b]) P['PR' + i.b] = zero();
              if (i.b == null) P['PR' + i.pr] = JSON.parse(JSON.stringify(a));
              else {
                const b = P['PR' + i.b];
                if (b.k !== a.k) return { t: 'alarm', key: 'prog', msg: `PR[${i.a}] と PR[${i.b}] の形式（直交／関節）が違います` };
                const s = i.sign === '-' ? -1 : 1;
                if (a.k === 'j') P['PR' + i.pr] = { k: 'j', q: a.q.map((v, k) => v + s * b.q[k]) };
                else { const p = {}; for (const k of ['X', 'Y', 'Z', 'rx', 'ry', 'rz']) p[k] = a.p[k] + s * b.p[k]; P['PR' + i.pr] = { k: 'c', p, cfg: a.cfg, uf: a.uf, ut: a.ut }; }
              }
            }
            F.pc++; break;
          }
          case 'PRELEM': {
            const P = H.vars.pos, key = 'PR' + i.pr;
            if (!P[key]) P[key] = { k: 'c', p: { X: 0, Y: 0, Z: 0, rx: 0, ry: 0, rz: 0 }, cfg: 'N U T, 0, 0, 0', uf: 0, ut: 1 };
            let v; try { v = this.evalExpr(i.expr); } catch (e) { return { t: 'alarm', key: 'prog', msg: '式を計算できません：' + text }; }
            if (i.i < 1 || i.i > 6) return { t: 'alarm', key: 'prog', msg: 'PR の要素番号は 1〜6 です' };
            if (P[key].k === 'j') P[key].q[i.i - 1] = v; else P[key].p[['X', 'Y', 'Z', 'rx', 'ry', 'rz'][i.i - 1]] = v;
            F.pc++; break;
          }
          case 'DOUT': H.setOut(i.kind, i.n, i.val); F.pc++; break;
          case 'PULSE': H.setOut(i.kind, i.n, true); F.pc++; this.wait = { kind: 'pulse', io: i, t: i.t }; return null;
          case 'WAITIN':
            F.pc++;
            this.wait = { kind: 'in', io: i, t: 0, timeout: i.timeout, timeoutLbl: i.timeoutLbl, text };
            return null;
          case 'TIMER': F.pc++; this.wait = { kind: 'timer', t: i.t }; return null;
          case 'OVERRIDE': H.setOverride(i.v); F.pc++; break;
          case 'FRAME': this.warnOnce('fr' + i.which + i.n, `${i.which === 'uf' ? 'UFRAME_NUM' : 'UTOOL_NUM'}=${i.n}：位置データに書かれた番号を使います`); F.pc++; break;
          case 'SFTON': {
            const p = H.vars.pos[i.ref];
            if (!p || p.k !== 'c') return { t: 'alarm', key: 'prog', msg: `シフト量 ${i.ref} が未設定です（「変数」で直交値を入れてください）` };
            this.shift = { p: p.p, frame: i.frame }; F.pc++; break;
          }
          case 'SFTOF': this.shift = null; F.pc++; break;
          case 'MOVE': {
            let pos;
            if (/^(C\d{5}|P\[\d+\])$/.test(i.ref)) pos = F.prog.pos[i.ref];
            else pos = H.vars.pos[i.ref.replace(/\[|\]/g, '')];          // P001 / PR[1] → PR1
            if (!pos) return { t: 'alarm', key: 'prog', msg: `${F.prog.name} ${F.pc + 1}行目：位置 ${i.ref} がありません` };
            let offset = null;
            if (i.offset) {
              const o = i.offset.pr != null ? H.vars.pos['PR' + i.offset.pr] : null;
              if (!o) return { t: 'alarm', key: 'prog', msg: `オフセット PR[${i.offset.pr}] が未設定です` };
              offset = { type: i.offset.type, pos: o };
            }
            if (i.warn) this.warnOnce('mv' + F.pc, i.warn);
            if ((i.term && (i.term.cnt > 0 || i.term.pl > 0))) this.warnOnce('cnt', 'CNT／PL（通過動作）は FINE（位置決め）として動かします');
            return { t: 'move', mode: i.mode, pos, offset, shift: this.shift, speed: i.speed, line: F.pc, prog: F.prog.name };
          }
          case 'IMOV': {
            const p = H.vars.pos[i.ref];
            if (!p || p.k !== 'c') return { t: 'alarm', key: 'prog', msg: `移動量 ${i.ref} が未設定です` };
            return { t: 'move', mode: 'L', rel: { p: p.p, frame: i.frame || 'BF' }, speed: i.speed, line: F.pc, prog: F.prog.name };
          }
          default:
            F.pc++;
        }
        if (single) return this.wait ? null : { t: 'stepped' };
      }
      return { t: 'alarm', key: 'prog', msg: '移動や待ちのない繰り返しが続いています（無限ループの可能性）' };
    }
    jump(label) {
      const F = this.frame;
      if (F.labels[label] == null) return false;
      F.pc = F.labels[label] + 1;
      return true;
    }
    done() { if (this.frame) this.frame.pc++; }
    status() {
      const w = this.wait;
      if (!w) return '';
      if (w.kind === 'timer') return `タイマ ${Math.max(0, w.t).toFixed(1)} 秒`;
      if (w.kind === 'in') return `入力待ち ${w.text}（${w.t.toFixed(1)} 秒）`;
      return '';
    }
  }
  RS.Interp = Interp;
})(window.RS = window.RS || {});
