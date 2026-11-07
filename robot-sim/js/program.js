/* =====================================================================
 * program.js — 実機と同じ言語のプログラム（安川 INFORM／ファナック TP）
 *
 * プログラムは「実機と同じ書き方の命令文（1行ずつ）」と「位置データ」で持ちます。
 *   prog = { name, sys:'yaskawa'|'fanuc', tool, comment, lines:[文字列], pos:{ 位置名: 位置 } }
 *   位置 = { k:'j', q:[6] }                                  関節（度）
 *        | { k:'c', p:{X,Y,Z,rx,ry,rz}, cfg, uf, ut, q? }    直交（mm, 度）。q は IK の参考値
 *   位置名：安川 'C00000'、ファナック 'P[1]'
 *
 * RS.parseLine(sys, 文字列) で 1 行を命令オブジェクトにし、interp.js が実行します。
 * 対応していない命令は { op:'UNKNOWN' } になり、実行時に飛ばす（設定で停止も可）。
 * ===================================================================== */
(function (RS) {
  'use strict';

  const pad = (n, w, c) => String(n).padStart(w, c || '0');
  const f = (v, d) => { let x = +(+v).toFixed(d); if (Object.is(x, -0)) x = 0; return x.toFixed(d); };
  const ONOFF = s => String(s).toUpperCase() === 'ON';

  /* ================= 1行の解析 ================= */
  const CMP = '(<>|<=|>=|=|<|>)';

  function parseValue(s) {
    s = s.trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) return { num: +s };
    return { ref: s.toUpperCase() };
  }

  /* --- 安川 INFORM --- */
  function yVarRef(s) { const m = String(s).trim().toUpperCase().match(/^([BIDR])(\d{3})$/); return m ? m[1] + m[2] : null; }
  function yCond(s) {
    s = s.trim();
    let m;
    if ((m = s.match(/^IN#\((\d+)\)\s*=\s*(ON|OFF)$/i))) return { t: 'io', kind: 'IN', n: +m[1], val: ONOFF(m[2]) };
    if ((m = s.match(/^OT#\((\d+)\)\s*=\s*(ON|OFF)$/i))) return { t: 'io', kind: 'OT', n: +m[1], val: ONOFF(m[2]) };
    if ((m = s.match(new RegExp(`^([BIDR]\\d{3})\\s*${CMP}\\s*(\\S+)$`, 'i')))) return { t: 'cmp', lhs: m[1].toUpperCase(), op: m[2], rhs: parseValue(m[3]) };
    return null;
  }
  function parseY(raw) {
    const s = raw.trim();
    if (!s) return { op: 'NOP' };
    if (s.startsWith("'")) return { op: 'COMMENT', text: s.slice(1) };
    const U = s.toUpperCase();
    let m;
    if ((m = s.match(/^\*(\S+)/))) return { op: 'LABEL', label: m[1].toUpperCase() };
    if (U === 'NOP') return { op: 'NOP' };
    if (U === 'END') return { op: 'END' };
    if (U === 'RET') return { op: 'RET' };
    if (U === 'PAUSE') return { op: 'PAUSE' };
    if ((m = s.match(/^MOV([JLC])\s+(C\d{5}|P\d{3})\s+(.*)$/i))) {
      const rest = m[3];
      const ins = { op: 'MOVE', mode: m[1].toUpperCase() === 'J' ? 'J' : 'L', ref: m[2].toUpperCase(), extra: [] };
      if (m[1].toUpperCase() === 'C') ins.warn = 'MOVC（円弧）は直線で近似します';
      for (const tok of rest.split(/\s+/).filter(Boolean)) {
        let t;
        if ((t = tok.match(/^VJ=([\d.]+)$/i))) ins.speed = { v: +t[1], unit: '%' };
        else if ((t = tok.match(/^V=([\d.]+)$/i))) ins.speed = { v: +t[1], unit: 'mm/s' };
        else if ((t = tok.match(/^VR=([\d.]+)$/i))) ins.speed = { v: +t[1], unit: 'deg/s' };
        else if ((t = tok.match(/^PL=(\d)$/i))) ins.term = { pl: +t[1] };
        else ins.extra.push(tok);
      }
      if (!ins.speed) return { op: 'ERR', msg: '速度（VJ= / V=）がありません' };
      if (ins.mode === 'J' && ins.speed.unit !== '%') return { op: 'ERR', msg: 'MOVJ の速度は VJ= で指定します' };
      if (ins.mode === 'L' && ins.speed.unit === '%') return { op: 'ERR', msg: 'MOVL の速度は V= で指定します' };
      return ins;
    }
    if ((m = s.match(/^IMOV\s+(P\d{3})\s+(.*)$/i))) {
      const ins = { op: 'IMOV', ref: m[1].toUpperCase(), extra: [] };
      for (const tok of m[2].split(/\s+/).filter(Boolean)) {
        let t;
        if ((t = tok.match(/^V=([\d.]+)$/i))) ins.speed = { v: +t[1], unit: 'mm/s' };
        else if ((t = tok.match(/^(BF|RF|TF)$/i))) ins.frame = t[1].toUpperCase();
        else ins.extra.push(tok);
      }
      if (!ins.speed) return { op: 'ERR', msg: '速度（V=）がありません' };
      return ins;
    }
    if ((m = s.match(/^DOUT\s+OT#\((\d+)\)\s+(ON|OFF)$/i))) return { op: 'DOUT', kind: 'OT', n: +m[1], val: ONOFF(m[2]) };
    if ((m = s.match(/^PULSE\s+OT#\((\d+)\)(?:\s+T=([\d.]+))?$/i))) return { op: 'PULSE', kind: 'OT', n: +m[1], t: m[2] ? +m[2] : 0.3 };
    if ((m = s.match(/^WAIT\s+IN#\((\d+)\)\s*=\s*(ON|OFF)(?:\s+T=([\d.]+))?$/i))) return { op: 'WAITIN', kind: 'IN', n: +m[1], val: ONOFF(m[2]), timeout: m[3] ? +m[3] : null };
    if ((m = s.match(/^TIMER\s+T=([\d.]+)$/i))) return { op: 'TIMER', t: +m[1] };
    if ((m = s.match(/^JUMP\s+\*(\S+)(?:\s+IF\s+(.+))?$/i))) {
      const cond = m[2] ? yCond(m[2]) : null;
      if (m[2] && !cond) return { op: 'ERR', msg: '条件の書き方が分かりません：' + m[2] };
      return { op: 'JUMP', label: m[1].toUpperCase(), cond };
    }
    if ((m = s.match(/^(JUMP|CALL)\s+JOB:(\S+)(?:\s+IF\s+(.+))?$/i))) {
      const cond = m[3] ? yCond(m[3]) : null;
      if (m[3] && !cond) return { op: 'ERR', msg: '条件の書き方が分かりません：' + m[3] };
      return { op: m[1].toUpperCase() === 'CALL' ? 'CALL' : 'JUMPJOB', name: m[2].toUpperCase(), cond };
    }
    if ((m = s.match(/^SET\s+([BIDR]\d{3})\s+(\S+)$/i))) return { op: 'CALC', dst: m[1].toUpperCase(), fn: 'SET', arg: parseValue(m[2]) };
    if ((m = s.match(/^(ADD|SUB|MUL|DIV)\s+([BIDR]\d{3})\s+(\S+)$/i))) return { op: 'CALC', dst: m[2].toUpperCase(), fn: m[1].toUpperCase(), arg: parseValue(m[3]) };
    if ((m = s.match(/^(INC|DEC)\s+([BIDR]\d{3})$/i))) return { op: 'CALC', dst: m[2].toUpperCase(), fn: m[1].toUpperCase(), arg: { num: 1 } };
    if ((m = s.match(/^SFTON\s+(P\d{3})(?:\s+(BF|RF|TF))?$/i))) return { op: 'SFTON', ref: m[1].toUpperCase(), frame: (m[2] || 'BF').toUpperCase() };
    if (U === 'SFTOF') return { op: 'SFTOF' };
    if ((m = s.match(/^SPEED\s+/i))) return { op: 'IGNORE', msg: 'SPEED 命令は無視します' };
    return { op: 'UNKNOWN', text: s };
  }

  /* --- ファナック TP --- */
  function fCond(s) {
    s = s.trim().replace(/^\((.*)\)$/, '$1').trim();
    let m;
    if ((m = s.match(/^(DI|RI|DO|RO)\[(\d+)(?::[^\]]*)?\]\s*=\s*(ON|OFF)$/i))) return { t: 'io', kind: m[1].toUpperCase(), n: +m[2], val: ONOFF(m[3]) };
    if ((m = s.match(new RegExp(`^R\\[(\\d+)(?::[^\\]]*)?\\]\\s*${CMP}\\s*(.+)$`, 'i')))) {
      const rhs = m[3].trim().match(/^R\[(\d+)(?::[^\]]*)?\]$/i) ? { ref: 'R' + m[3].match(/\d+/)[0] } : parseValue(m[3]);
      return { t: 'cmp', lhs: 'R' + m[1], op: m[2], rhs };
    }
    return null;
  }
  function fExpr(s) {
    // 数値・R[n] と + - * / （かっこ可）の式を、評価用のトークン列にする
    const toks = [];
    const re = /\s*(R\[\d+(?::[^\]]*)?\]|-?\d+(?:\.\d+)?|[()+\-*/])\s*/giy;
    let m, pos = 0;
    while (pos < s.length) {
      re.lastIndex = pos;
      m = re.exec(s);
      if (!m) return null;
      const t = m[1];
      if (/^R\[/i.test(t)) toks.push({ ref: 'R' + t.match(/\d+/)[0] });
      else if (/^-?\d/.test(t) && !(t.startsWith('-') && toks.length && (toks[toks.length - 1].ref || toks[toks.length - 1].num != null || toks[toks.length - 1] === ')'))) toks.push({ num: +t });
      else if (t.startsWith('-') && t.length > 1) { toks.push('-'); toks.push({ num: +t.slice(1) }); }
      else toks.push(t);
      pos = re.lastIndex;
    }
    return toks;
  }
  const PR = '(?:PR\\[(\\d+)(?::[^\\]]*)?\\])';
  function parseF(raw) {
    let s = raw.trim().replace(/^\d+\s*:\s*/, '').replace(/;\s*$/, '').trim();
    if (!s) return { op: 'NOP' };
    if (s.startsWith('!')) return { op: 'COMMENT', text: s.slice(1) };
    if (s.startsWith('//')) return { op: 'NOP', disabled: true };
    let m;
    if ((m = s.match(/^LBL\[(\d+)(?::[^\]]*)?\]$/i))) return { op: 'LABEL', label: m[1] };
    if ((m = s.match(/^JMP\s+LBL\[(\d+)(?::[^\]]*)?\]$/i))) return { op: 'JUMP', label: m[1], cond: null };
    if ((m = s.match(/^IF\s+(.+?)\s*,\s*(JMP\s+LBL\[(\d+)(?::[^\]]*)?\]|CALL\s+(\S+))$/i))) {
      const parts = m[1].split(/\s+(AND|OR)\s+/i);
      const conds = [], ops = [];
      for (let i = 0; i < parts.length; i++) {
        if (i % 2) { ops.push(parts[i].toUpperCase()); continue; }
        const c = fCond(parts[i]); if (!c) return { op: 'ERR', msg: '条件の書き方が分かりません：' + parts[i] };
        conds.push(c);
      }
      const cond = conds.length === 1 ? conds[0] : { t: 'multi', conds, ops };
      if (m[3]) return { op: 'JUMP', label: m[3], cond };
      return { op: 'CALL', name: m[4].toUpperCase(), cond };
    }
    if ((m = s.match(/^CALL\s+(\S+?)(?:\(.*\))?$/i))) return { op: 'CALL', name: m[1].toUpperCase(), cond: null };
    if (/^END$/i.test(s)) return { op: 'END' };
    if (/^ABORT$/i.test(s)) return { op: 'END', abort: true };
    if (/^PAUSE$/i.test(s)) return { op: 'PAUSE' };
    if ((m = s.match(/^([JLC])\s+(P\[\d+(?::[^\]]*)?\]|PR\[\d+(?::[^\]]*)?\])\s+(.*)$/i))) {
      const ref = m[2].replace(/:[^\]]*\]/, ']').toUpperCase();
      const ins = { op: 'MOVE', mode: m[1].toUpperCase() === 'J' ? 'J' : 'L', ref, extra: [] };
      if (m[1].toUpperCase() === 'C') return { op: 'UNKNOWN', text: s, msg: '円弧（C）命令には対応していません' };
      const sp = m[3].match(/^([\d.]+)\s*(%|mm\/sec|cm\/min|inch\/min|deg\/sec|sec|msec)\s*(.*)$/i);
      if (!sp) return { op: 'ERR', msg: '速度の書き方が分かりません' };
      const unit = sp[2].toLowerCase();
      ins.speed = { v: +sp[1], unit: unit === 'mm/sec' ? 'mm/s' : unit === 'cm/min' ? 'cm/min' : unit === 'inch/min' ? 'inch/min' : unit === 'deg/sec' ? 'deg/s' : unit };
      let rest = sp[3].trim();
      const tm = rest.match(/^(FINE|CNT\s*\d+|CD\s*\d+|CR\s*\d+)\s*(.*)$/i);
      if (!tm) return { op: 'ERR', msg: '位置決め（FINE / CNT）がありません' };
      ins.term = /^FINE/i.test(tm[1]) ? { fine: true } : { cnt: +tm[1].match(/\d+/)[0] };
      rest = tm[2];
      for (const tok of rest.split(/\s+/).filter(Boolean)) {
        let t;
        if ((t = tok.match(new RegExp(`^Offset,${PR}$`, 'i')))) ins.offset = { type: 'user', pr: +t[1] };
        else if ((t = tok.match(new RegExp(`^Tool_Offset,${PR}$`, 'i')))) ins.offset = { type: 'tool', pr: +t[1] };
        else if (/^Offset$/i.test(tok)) ins.offset = { type: 'user', pr: null };
        else ins.extra.push(tok);
      }
      if (ins.mode === 'J' && !/^(%|sec|msec)$/.test(ins.speed.unit)) return { op: 'ERR', msg: 'J の速度は % で指定します' };
      if (ins.mode === 'L' && ins.speed.unit === '%') return { op: 'ERR', msg: 'L の速度は mm/sec で指定します' };
      return ins;
    }
    if ((m = s.match(/^(DO|RO)\[(\d+)(?::[^\]]*)?\]\s*=\s*(ON|OFF|PULSE)(?:\s*,\s*([\d.]+)\s*sec)?$/i))) {
      if (/PULSE/i.test(m[3])) return { op: 'PULSE', kind: m[1].toUpperCase(), n: +m[2], t: m[4] ? +m[4] : 0.3 };
      return { op: 'DOUT', kind: m[1].toUpperCase(), n: +m[2], val: ONOFF(m[3]) };
    }
    if ((m = s.match(/^WAIT\s+(DI|RI|DO|RO)\[(\d+)(?::[^\]]*)?\]\s*=\s*(ON|OFF)(?:\s+TIMEOUT\s*,\s*LBL\[(\d+)\])?$/i)))
      return { op: 'WAITIN', kind: m[1].toUpperCase(), n: +m[2], val: ONOFF(m[3]), timeoutLbl: m[4] || null };
    if ((m = s.match(/^WAIT\s+([\d.]+)\s*\(sec\)$/i))) return { op: 'TIMER', t: +m[1] };
    if ((m = s.match(/^R\[(\d+)(?::[^\]]*)?\]\s*=\s*(.+)$/i))) {
      const e = fExpr(m[2]); if (!e) return { op: 'ERR', msg: '式の書き方が分かりません：' + m[2] };
      return { op: 'CALC', dst: 'R' + m[1], fn: 'EXPR', expr: e };
    }
    if ((m = s.match(new RegExp(`^${PR}\\s*=\\s*(LPOS|JPOS)$`, 'i')))) return { op: 'PRSET', pr: +m[1], src: m[2].toUpperCase() };
    if ((m = s.match(new RegExp(`^${PR}\\s*=\\s*${PR}$`, 'i')))) return { op: 'PRSET', pr: +m[1], src: 'PR', a: +m[2] };
    if ((m = s.match(new RegExp(`^${PR}\\s*=\\s*${PR}\\s*([+-])\\s*${PR}$`, 'i')))) return { op: 'PRSET', pr: +m[1], src: 'PR', a: +m[2], sign: m[3], b: +m[4] };
    if ((m = s.match(/^PR\[(\d+)\s*,\s*(\d+)(?::[^\]]*)?\]\s*=\s*(.+)$/i))) {
      const e = fExpr(m[3]); if (!e) return { op: 'ERR', msg: '式の書き方が分かりません：' + m[3] };
      return { op: 'PRELEM', pr: +m[1], i: +m[2], expr: e };
    }
    if ((m = s.match(/^OVERRIDE\s*=\s*(\d+)\s*%$/i))) return { op: 'OVERRIDE', v: +m[1] };
    if ((m = s.match(/^(UFRAME_NUM|UTOOL_NUM)\s*=\s*(\d+)$/i))) return { op: 'FRAME', which: m[1].toUpperCase() === 'UFRAME_NUM' ? 'uf' : 'ut', n: +m[2] };
    if ((m = s.match(/^MESSAGE\[(.*)\]$/i))) return { op: 'MESSAGE', text: m[1] };
    if (/^(PAYLOAD\[|TIMER\[|UALM\[|JOINT_MAX_SPEED|LINEAR_MAX_SPEED|RSR|TOOL_OFFSET_CONDITION|OFFSET CONDITION|SKIP CONDITION)/i.test(s)) return { op: 'IGNORE', msg: s.split(/[\[=\s]/)[0] + ' は無視します' };
    return { op: 'UNKNOWN', text: s };
  }

  RS.parseLine = function (sys, text) { return sys === 'yaskawa' ? parseY(text) : parseF(text); };

  /* 移動命令を文字列に戻す（速度・位置決めの編集用） */
  RS.formatMove = function (sys, ins) {
    const extra = (ins.extra || []).join(' ');
    if (sys === 'yaskawa') {
      const sp = ins.mode === 'J' ? `VJ=${f(ins.speed.v, 2)}` : (ins.speed.unit === 'deg/s' ? `VR=${f(ins.speed.v, 1)}` : `V=${f(ins.speed.v, 1)}`);
      const pl = ins.term && ins.term.pl != null ? ` PL=${ins.term.pl}` : '';
      return `MOV${ins.mode} ${ins.ref} ${sp}${pl}${extra ? ' ' + extra : ''}`;
    }
    const u = { '%': '%', 'mm/s': 'mm/sec', 'cm/min': 'cm/min', 'inch/min': 'inch/min', 'deg/s': 'deg/sec', sec: 'sec', msec: 'msec' }[ins.speed.unit] || '%';
    const v = ins.speed.unit === 'sec' ? f(ins.speed.v, 1) : Math.round(ins.speed.v);
    const term = ins.term && ins.term.cnt != null ? `CNT${ins.term.cnt}` : 'FINE';
    const off = ins.offset ? (ins.offset.type === 'tool' ? ` Tool_Offset,PR[${ins.offset.pr}]` : (ins.offset.pr ? ` Offset,PR[${ins.offset.pr}]` : ' Offset')) : '';
    return `${ins.mode} ${ins.ref} ${v}${u} ${term}${off}${extra ? ' ' + extra : ''}`;
  };

  /* 教示で作る命令の文字列 */
  RS.lineMove = (sys, mode, ref, v) => RS.formatMove(sys, { mode, ref, speed: { v, unit: mode === 'J' ? '%' : 'mm/s' }, term: sys === 'yaskawa' ? null : { fine: true } });
  RS.lineOut = (sys, io, on) => sys === 'yaskawa' ? `DOUT OT#(${io.n}) ${on ? 'ON' : 'OFF'}` : `${io.kind}[${io.n}]=${on ? 'ON' : 'OFF'}`;
  RS.lineWait = (sys, io, on) => sys === 'yaskawa' ? `WAIT IN#(${io.n})=${on ? 'ON' : 'OFF'}` : `WAIT ${io.kind}[${io.n}]=${on ? 'ON' : 'OFF'}`;
  RS.lineTimer = (sys, t) => sys === 'yaskawa' ? `TIMER T=${f(t, 2)}` : `WAIT ${f(t, 2)}(sec)`;
  RS.lineComment = (sys, t) => (sys === 'yaskawa' ? "'" : '!') + t;

  RS.nextPosId = function (sys, prog) {
    let mx = -1;
    for (const k of Object.keys(prog.pos)) {
      const m = sys === 'yaskawa' ? k.match(/^C(\d{5})$/) : k.match(/^P\[(\d+)\]$/);
      if (m) mx = Math.max(mx, +m[1]);
    }
    // 命令文中で使われているが位置が無い番号も避ける
    for (const l of prog.lines) {
      const m = sys === 'yaskawa' ? l.match(/C(\d{5})/) : l.match(/P\[(\d+)/);
      if (m) mx = Math.max(mx, +m[1]);
    }
    return sys === 'yaskawa' ? 'C' + pad(mx + 1, 5) : `P[${Math.max(1, mx + 1)}]`;
  };

  RS.emptyProgram = (sys, name, tool) => ({ name: name || 'MAIN', sys, tool: tool || RS.DEFAULT_TOOL, comment: '', lines: [], pos: {} });

  RS.cleanName = s => String(s || '').toUpperCase().replace(/[^A-Z0-9_\-]/g, '').slice(0, 32) || 'MAIN';

  /* 保存データの検査（壊れたデータを読まない） */
  RS.validateProgram = function (p, sys) {
    if (!p || typeof p !== 'object') return null;
    // v2（構造化命令）からの移行
    if (Array.isArray(p.lines) && p.lines.length && typeof p.lines[0] === 'object') return migrateV2(p, sys);
    if (!Array.isArray(p.lines)) return null;
    const out = RS.emptyProgram(p.sys === 'fanuc' || p.sys === 'yaskawa' ? p.sys : sys, RS.cleanName(p.name), p.tool);
    out.comment = String(p.comment || '').slice(0, 64);
    out.lines = p.lines.filter(l => typeof l === 'string').map(l => l.replace(/[\r\n]/g, ' ').slice(0, 200));
    const pos = p.pos && typeof p.pos === 'object' ? p.pos : {};
    for (const [k, v] of Object.entries(pos)) {
      if (!v) continue;
      if (v.k === 'j' && Array.isArray(v.q) && v.q.length === 6 && v.q.every(isFinite)) out.pos[k] = { k: 'j', q: v.q.map(Number) };
      else if (v.k === 'c' && v.p && ['X', 'Y', 'Z', 'rx', 'ry', 'rz'].every(a => isFinite(v.p[a]))) {
        const r = { k: 'c', p: {}, cfg: String(v.cfg || 'N U T, 0, 0, 0'), uf: +v.uf || 0, ut: v.ut == null ? 1 : +v.ut };
        ['X', 'Y', 'Z', 'rx', 'ry', 'rz'].forEach(a => { r.p[a] = +v.p[a]; });
        if (Array.isArray(v.q) && v.q.length === 6 && v.q.every(isFinite)) r.q = v.q.map(Number);
        out.pos[k] = r;
      }
    }
    return out;
  };
  function migrateV2(p, sys) {
    const out = RS.emptyProgram(sys, RS.cleanName(p.name), p.tool);
    const io = sys === 'yaskawa' ? { kind: 'OT', n: 1 } : { kind: 'RO', n: 1 };
    const ii = sys === 'yaskawa' ? { kind: 'IN', n: 1 } : { kind: 'RI', n: 1 };
    for (const l of p.lines) {
      if (!l) continue;
      if (l.op === 'MOVJ' || l.op === 'MOVL') {
        const id = RS.nextPosId(sys, out);
        out.pos[id] = { k: 'j', q: l.q.map(Number) };
        out.lines.push(RS.lineMove(sys, l.op === 'MOVJ' ? 'J' : 'L', id, +l.v || 50));
      } else if (l.op === 'OUT') out.lines.push(RS.lineOut(sys, io, !!l.on));
      else if (l.op === 'WAITIN') out.lines.push(RS.lineWait(sys, ii, !!l.on));
      else if (l.op === 'TIMER') out.lines.push(RS.lineTimer(sys, +l.t || 0));
    }
    return out;
  }

  /* プログラム全体の文法チェック */
  RS.checkProgram = function (prog, lib) {
    const errs = [];
    const labels = new Set();
    const ins = prog.lines.map(l => RS.parseLine(prog.sys, l));
    ins.forEach(i => { if (i.op === 'LABEL') labels.add(i.label); });
    ins.forEach((i, n) => {
      const at = n + 1;
      if (i.op === 'ERR') errs.push({ line: at, lv: 'err', msg: i.msg });
      else if (i.op === 'UNKNOWN') errs.push({ line: at, lv: 'warn', msg: (i.msg || '未対応の命令（実行時は飛ばします）') });
      else if (i.op === 'MOVE' && /^(C\d{5}|P\[\d+\])$/.test(i.ref) && !prog.pos[i.ref]) errs.push({ line: at, lv: 'err', msg: `位置 ${i.ref} がありません` });
      else if (i.op === 'JUMP' && !labels.has(i.label)) errs.push({ line: at, lv: 'err', msg: `ラベル ${prog.sys === 'yaskawa' ? '*' + i.label : 'LBL[' + i.label + ']'} がありません` });
      else if ((i.op === 'CALL' || i.op === 'JUMPJOB') && lib && !lib[i.name]) errs.push({ line: at, lv: 'warn', msg: `呼び出し先 ${i.name} がありません` });
      if (i.warn) errs.push({ line: at, lv: 'warn', msg: i.warn });
    });
    return errs;
  };

  /* ================= 書き出し ================= */
  function now() {
    const d = new Date();
    return { y: d.getFullYear(), mo: pad(d.getMonth() + 1, 2), d: pad(d.getDate(), 2), h: pad(d.getHours(), 2), mi: pad(d.getMinutes(), 2), s: pad(d.getSeconds(), 2) };
  }
  const isAscii = s => /^[\x20-\x7e]*$/.test(s);

  /* 実機に入れる前の注意点 */
  RS.exportWarnings = function (prog, ctx) {
    const w = [];
    const ins = prog.lines.map(l => RS.parseLine(prog.sys, l));
    if (ins.some(i => i.op === 'UNKNOWN' || i.op === 'ERR')) w.push('シミュレーターが解釈できない行があります（実機でも確認してください）');
    if (prog.lines.some(l => !isAscii(l)) || !isAscii(prog.comment || '')) w.push('全角文字（日本語のコメント等）があります。DX200 では「設定」の Shift_JIS 書き出しを使ってください（言語設定によっては表示できません）');
    if (prog.sys === 'yaskawa' && !ctx.pulse && Object.values(prog.pos).some(p => p.k === 'j')) w.push('パルス係数が未設定のため、関節位置を直交（RECTAN）で書き出します');
    if (Object.values(prog.pos).some(p => p.k === 'c' && p.uf)) w.push('ユーザ座標の位置があります。実機のユーザ座標番号・値が同じか確認してください');
    if (ins.some(i => i.op === 'MOVE' && ((i.speed.unit === 'mm/s' && i.speed.v > 1000) || (i.speed.unit === '%' && i.speed.v > 80)))) w.push('高速の移動命令があります。初回は必ず低速（オーバーライドを下げる）で確認してください');
    w.push('寸法・ツール（TCP）・ユーザ座標が実機と合っているか、教示モード・低速で1行ずつ確認してから自動運転してください');
    return w;
  };

  /* 安川 JBI
   * ctx = { pulse:[6]|null, poseOf(q)→{X..rz}, robotName } */
  RS.exportJBI = function (prog, ctx) {
    const t = now();
    const ids = Object.keys(prog.pos).filter(k => /^C\d{5}$/.test(k)).sort();
    const pulseLines = [], rect = {};
    for (const id of ids) {
      const p = prog.pos[id];
      if (p.k === 'j' && ctx.pulse) pulseLines.push(`${id}=${p.q.map((v, i) => Math.round(v * ctx.pulse[i])).join(',')}`);
      else {
        const P = p.k === 'c' ? p.p : ctx.poseOf(p.q);
        const uf = p.k === 'c' ? (p.uf || 0) : 0;
        (rect[uf] = rect[uf] || []).push(`${id}=${f(P.X, 3)},${f(P.Y, 3)},${f(P.Z, 3)},${f(P.rx, 4)},${f(P.ry, 4)},${f(P.rz, 4)}`);
      }
    }
    const out = ['/JOB', `//NAME ${prog.name}`, '//POS', `///NPOS ${ids.length},0,0,0,0,0`, '///TOOL 0'];
    if (pulseLines.length) out.push('///POSTYPE PULSE', '///PULSE', ...pulseLines);
    for (const [uf, arr] of Object.entries(rect)) {
      if (+uf) out.push(`///USER ${uf}`, '///POSTYPE USER'); else out.push('///POSTYPE ROBOT');
      out.push('///RECTAN', '///RCONF 0,0,0,0,0,0,0,0', ...arr);
    }
    out.push('//INST', `///DATE ${t.y}/${t.mo}/${t.d} ${t.h}:${t.mi}`);
    if (prog.comment) out.push(`///COMM ${prog.comment}`);
    out.push('///ATTR SC,RW', '///GROUP1 RB1', 'NOP', ...prog.lines.filter(l => !/^\s*(NOP|END)\s*$/i.test(l)), 'END');
    return out.join('\r\n') + '\r\n';
  };

  /* ファナック LS */
  RS.exportLS = function (prog, ctx) {
    const t = now();
    const yy = String(t.y).slice(2);
    const mn = prog.lines.map((l, i) => `${pad(i + 1, 4, ' ')}:  ${l.trim()}${l.trim() ? '    ' : ''};`);
    const pos = [];
    const ids = Object.keys(prog.pos).filter(k => /^P\[\d+\]$/.test(k)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    for (const id of ids) {
      const p = prog.pos[id];
      pos.push(`${id}{`, '   GP1:');
      if (p.k === 'j') {
        const q = p.q.map(v => f(v, 3).padStart(10, ' '));
        pos.push('\tUF : 0, UT : 1,', `\tJ1=${q[0]} deg,\tJ2=${q[1]} deg,\tJ3=${q[2]} deg,`, `\tJ4=${q[3]} deg,\tJ5=${q[4]} deg,\tJ6=${q[5]} deg`);
      } else {
        const P = p.p, v = x => f(x, 3).padStart(10, ' ');
        pos.push(`\tUF : ${p.uf || 0}, UT : ${p.ut == null ? 1 : p.ut},\t\tCONFIG : '${p.cfg || 'N U T, 0, 0, 0'}',`,
          `\tX = ${v(P.X)}  mm,\tY = ${v(P.Y)}  mm,\tZ = ${v(P.Z)}  mm,`,
          `\tW = ${v(P.rx)} deg,\tP = ${v(P.ry)} deg,\tR = ${v(P.rz)} deg`);
      }
      pos.push('};');
    }
    const date = `DATE ${yy}-${t.mo}-${t.d}  TIME ${t.h}:${t.mi}:${t.s}`;
    return [
      `/PROG  ${prog.name}`, '/ATTR', 'OWNER\t\t= MNEDITOR;', `COMMENT\t\t= "${(prog.comment || '').replace(/"/g, '')}";`,
      'PROG_SIZE\t= 0;', `CREATE\t\t= ${date};`, `MODIFIED\t= ${date};`, 'FILE_NAME\t= ;', 'VERSION\t\t= 0;',
      `LINE_COUNT\t= ${prog.lines.length};`, 'MEMORY_SIZE\t= 0;', 'PROTECT\t\t= READ_WRITE;',
      'TCD:  STACK_SIZE\t= 0,', '      TASK_PRIORITY\t= 50,', '      TIME_SLICE\t= 0,', '      BUSY_LAMP_OFF\t= 0,',
      '      ABORT_REQUEST\t= 0,', '      PAUSE_REQUEST\t= 0;', 'DEFAULT_GROUP\t= 1,*,*,*,*;', 'CONTROL_CODE\t= 00000000 00000000;',
      '/APPL', '/MN', ...mn, '/POS', ...pos, '/END'
    ].join('\r\n') + '\r\n';
  };

  /* Shift_JIS への変換（DX200 など日本語コントローラ向け）。ブラウザの Shift_JIS デコーダから逆引き表を作る */
  let sjisMap = null;
  RS.encodeSJIS = function (text) {
    if (!sjisMap) {
      sjisMap = new Map();
      const dec = new TextDecoder('shift_jis');
      const lead = [];
      for (let b = 0x81; b <= 0x9f; b++) lead.push(b);
      for (let b = 0xe0; b <= 0xfc; b++) lead.push(b);
      for (const a of lead) for (let b = 0x40; b <= 0xfc; b++) {
        if (b === 0x7f) continue;
        const ch = dec.decode(new Uint8Array([a, b]));
        if (ch.length === 1 && ch !== '\uFFFD' && !sjisMap.has(ch)) sjisMap.set(ch, [a, b]);
      }
      for (let b = 0xa1; b <= 0xdf; b++) sjisMap.set(dec.decode(new Uint8Array([b])), [b]);   // 半角カナ
    }
    const out = [];
    let bad = 0;
    for (const ch of text) {
      const c = ch.codePointAt(0);
      if (c < 0x80) { out.push(c); continue; }
      const m = sjisMap.get(ch);
      if (m) out.push(...m); else { out.push(0x3f); bad++; }
    }
    return { bytes: new Uint8Array(out), bad };
  };

  RS.exportJSON = function (progs) {
    return JSON.stringify({ format: 'robot-sim-programs', version: 3, programs: progs }, null, 2);
  };

  /* ================= 読み込み =================
   * 戻り値 { progs:[...], warns:[...] } もしくは { err }
   * ctx = { pulse:{yaskawa:[6]|null} } */
  RS.importText = function (text, ctx) {
    text = String(text || '').replace(/^﻿/, '');
    const t = text.trim();
    if (t.startsWith('{')) {
      try {
        const o = JSON.parse(t);
        const arr = Array.isArray(o.programs) ? o.programs : [o];
        const progs = arr.map(p => RS.validateProgram(p, p.sys || p.system || 'yaskawa')).filter(Boolean);
        if (!progs.length) return { err: 'プログラムの形式ではありません' };
        return { progs, warns: [] };
      } catch (e) { return { err: 'JSON を読めません：' + e.message }; }
    }
    if (/^\/JOB/m.test(t)) return importJBI(t, ctx || {});
    if (/^\/PROG/m.test(t)) return importLS(t);
    return { err: '対応していない形式です（JSON / JBI / LS）' };
  };

  function importJBI(t, ctx) {
    const warns = [];
    const lines = t.split(/\r?\n/);
    const name = RS.cleanName((t.match(/^\/\/NAME\s+(\S+)/m) || [])[1] || 'IMPORT');
    const prog = RS.emptyProgram('yaskawa', name);
    let sec = '', postype = 'PULSE', user = 0, inInst = false, started = false;
    const pulse = ctx.pulse && ctx.pulse.yaskawa;
    for (const raw of lines) {
      const s = raw.trim();
      if (s === '//POS') { sec = 'pos'; continue; }
      if (s === '//INST') { sec = 'inst'; continue; }
      if (sec === 'pos') {
        let m;
        if ((m = s.match(/^\/\/\/POSTYPE\s+(\S+)/))) { postype = m[1].toUpperCase(); continue; }
        if (s === '///PULSE') { postype = 'PULSE'; continue; }
        if ((m = s.match(/^\/\/\/USER\s+(\d+)/))) { user = +m[1]; continue; }
        if (s.startsWith('///')) continue;
        if ((m = s.match(/^(C\d{5})=(.+)$/))) {
          const v = m[2].split(',').map(Number);
          if (v.length < 6 || v.slice(0, 6).some(x => !isFinite(x))) { warns.push(`${m[1]} の値を読めません`); continue; }
          if (postype === 'PULSE') {
            if (!pulse) return { err: 'このJBIはパルス形式です。「設定」タブの機種パラメータで「1度あたりのパルス数」を入れてから読み込んでください' };
            prog.pos[m[1]] = { k: 'j', q: v.slice(0, 6).map((x, i) => +(x / pulse[i]).toFixed(4)) };
          } else {
            if (postype === 'TOOL' || postype === 'MTOOL') warns.push(`${m[1]} は POSTYPE ${postype} です。ロボット座標として扱います`);
            prog.pos[m[1]] = { k: 'c', p: { X: v[0], Y: v[1], Z: v[2], rx: v[3], ry: v[4], rz: v[5] }, cfg: 'N U T, 0, 0, 0', uf: postype === 'USER' ? user : 0, ut: 1 };
          }
        } else if (/^(BC|EC)\d{5}=/.test(s)) warns.push('ベース軸・ステーション軸の位置は読み込みません');
      } else if (sec === 'inst') {
        if (s.startsWith('///')) { const m = s.match(/^\/\/\/COMM\s+(.*)$/); if (m) prog.comment = m[1]; continue; }
        if (!inInst) { if (/^NOP$/i.test(s)) { inInst = true; started = true; } continue; }
        if (/^END$/i.test(s)) { inInst = false; continue; }
        prog.lines.push(s);
      }
    }
    if (!started) return { err: 'JBI の命令部（NOP〜END）が見つかりません' };
    return { progs: [prog], warns };
  }

  function importLS(t) {
    const warns = [];
    const name = RS.cleanName((t.match(/^\/PROG\s+(\S+)/m) || [])[1] || 'IMPORT');
    const prog = RS.emptyProgram('fanuc', name);
    const cm = t.match(/^COMMENT\s*=\s*"([^"]*)"/m); if (cm) prog.comment = cm[1];
    const mnPart = (t.split(/^\/MN\s*$/m)[1] || '').split(/^\/(POS|END)\s*$/m)[0];
    for (const raw of mnPart.split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const m = raw.match(/^\s*(\d+)?\s*:\s?(.*)$/);
      if (!m) continue;
      let body = m[2].replace(/;\s*$/, '').trim();
      if (!m[1] && prog.lines.length) prog.lines[prog.lines.length - 1] += ' ' + body;  // 継続行
      else prog.lines.push(body);
    }
    const posPart = (t.split(/^\/POS\s*$/m)[1] || '').split(/^\/END\s*$/m)[0];
    for (const m of posPart.matchAll(/P\[(\d+)(?::"?[^\]]*"?)?\]\s*\{([\s\S]*?)\};/g)) {
      const id = `P[${+m[1]}]`, body = m[2];
      const gp = body.split(/GP\d+:/)[1] || body;
      if (/GP[2-9]:/.test(body)) warns.push(`${id} の付加軸（GP2以降）は読み込みません`);
      const num = re => { const x = gp.match(re); return x ? +x[1] : null; };
      const uf = num(/UF\s*:\s*(\d+)/), ut = num(/UT\s*:\s*(\d+)/);
      if (/J1\s*=/.test(gp)) {
        const q = [1, 2, 3, 4, 5, 6].map(i => num(new RegExp(`J${i}\\s*=\\s*(-?[\\d.]+)`)));
        if (q.some(v => v == null)) { warns.push(`${id} を読めません`); continue; }
        prog.pos[id] = { k: 'j', q };
      } else {
        const g = a => num(new RegExp(`\\b${a}\\s*=\\s*(-?[\\d.]+)`));
        const p = { X: g('X'), Y: g('Y'), Z: g('Z'), rx: g('W'), ry: g('P'), rz: g('R') };
        if (Object.values(p).some(v => v == null)) { warns.push(`${id} を読めません`); continue; }
        const cfg = (gp.match(/CONFIG\s*:\s*'([^']*)'/) || [])[1] || 'N U T, 0, 0, 0';
        prog.pos[id] = { k: 'c', p, cfg, uf: uf || 0, ut: ut == null ? 1 : ut };
      }
    }
    return { progs: [prog], warns };
  }
})(window.RS = window.RS || {});
