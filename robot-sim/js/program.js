/* =====================================================================
 * program.js — ロボットプログラム（教示データ）の形式・表示・書き出し／読み込み
 *
 * プログラム = { name, tool, lines:[命令...] }
 *   { op:'MOVJ', q:[6], v:% }          関節補間      安川 MOVJ VJ= ／ ファナック J P[n] %
 *   { op:'MOVL', q:[6], v:mm/s }       直線補間      安川 MOVL V=  ／ ファナック L P[n] mm/sec
 *   { op:'OUT',  on:bool }             ハンド出力    安川 DOUT OT#(1) ／ ファナック RO[1]
 *   { op:'WAITIN', on:bool }           ハンド確認待ち 安川 WAIT IN#(1) ／ ファナック WAIT RI[1]
 *   { op:'TIMER', t:秒 }               待ち時間      安川 TIMER T= ／ ファナック WAIT (sec)
 * 位置はすべて「そのシステムの関節角（度）」で持ちます（ファナック J3 は水平基準）。
 * ===================================================================== */
(function (RS) {
  'use strict';

  const pad = (n, w, c) => String(n).padStart(w, c || '0');
  const f = (v, d) => (+v).toFixed(d);

  RS.isMove = l => l.op === 'MOVJ' || l.op === 'MOVL';

  /* 各行の位置番号（移動命令の通し番号 0,1,2…。移動以外は -1） */
  RS.pointIndex = function (prog) {
    let n = 0;
    return prog.lines.map(l => (RS.isMove(l) ? n++ : -1));
  };

  /* 1行を各社の表記で文字列にする */
  RS.formatLine = function (sys, l, pi) {
    if (sys === 'yaskawa') {
      switch (l.op) {
        case 'MOVJ': return `MOVJ C${pad(pi, 5)} VJ=${f(l.v, 2)}`;
        case 'MOVL': return `MOVL C${pad(pi, 5)} V=${f(l.v, 1)}`;
        case 'OUT': return `DOUT OT#(1) ${l.on ? 'ON' : 'OFF'}`;
        case 'WAITIN': return `WAIT IN#(1)=${l.on ? 'ON' : 'OFF'}`;
        case 'TIMER': return `TIMER T=${f(l.t, 2)}`;
      }
    } else {
      switch (l.op) {
        case 'MOVJ': return `J P[${pi + 1}] ${Math.round(l.v)}% FINE`;
        case 'MOVL': return `L P[${pi + 1}] ${Math.round(l.v)}mm/sec FINE`;
        case 'OUT': return `RO[1]=${l.on ? 'ON' : 'OFF'}`;
        case 'WAITIN': return `WAIT RI[1]=${l.on ? 'ON' : 'OFF'}`;
        case 'TIMER': return `WAIT ${f(l.t, 2)}(sec)`;
      }
    }
    return '?';
  };

  RS.validateProgram = function (p) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.lines)) return null;
    const lines = [];
    for (const l of p.lines) {
      if (!l || typeof l.op !== 'string') continue;
      if (RS.isMove(l)) {
        if (!Array.isArray(l.q) || l.q.length !== 6 || l.q.some(v => !isFinite(+v))) continue;
        const v = +l.v;
        lines.push({ op: l.op, q: l.q.map(Number), v: isFinite(v) && v > 0 ? v : (l.op === 'MOVJ' ? 50 : 300) });
      } else if (l.op === 'OUT' || l.op === 'WAITIN') lines.push({ op: l.op, on: !!l.on });
      else if (l.op === 'TIMER') lines.push({ op: 'TIMER', t: Math.max(0, +l.t || 0) });
    }
    return { name: String(p.name || 'SAMPLE').toUpperCase().replace(/[^A-Z0-9_\-]/g, '').slice(0, 16) || 'SAMPLE', tool: p.tool || RS.DEFAULT_TOOL, lines };
  };

  /* ---------- 書き出し ---------- */
  function today() {
    const d = new Date();
    return `${d.getFullYear()}/${pad(d.getMonth() + 1, 2)}/${pad(d.getDate(), 2)} ${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`;
  }

  /* 安川 JBI（位置は直交 RECTAN。TCP 座標 mm/度）
   * poseOf(q) → {X,Y,Z,rx,ry,rz} を渡す */
  RS.exportJBI = function (prog, poseOf) {
    const pi = RS.pointIndex(prog);
    const pos = [];
    prog.lines.forEach((l, i) => {
      if (pi[i] < 0) return;
      const P = poseOf(l.q);
      pos.push(`C${pad(pi[i], 5)}=${f(P.X, 3)},${f(P.Y, 3)},${f(P.Z, 3)},${f(P.rx, 4)},${f(P.ry, 4)},${f(P.rz, 4)}`);
    });
    const out = ['/JOB', `//NAME ${prog.name}`, '//POS', `///NPOS ${pos.length},0,0,0,0,0`, '///TOOL 0', '///POSTYPE ROBOT', '///RECTAN', '///RCONF 0,0,0,0,0,0,0,0'];
    out.push(...pos);
    out.push('//INST', `///DATE ${today()}`, `///COMM ROBOT-SIM ${prog.tool}`, '///ATTR SC,RW', '///GROUP1 RB1', 'NOP');
    prog.lines.forEach((l, i) => out.push(RS.formatLine('yaskawa', l, pi[i])));
    out.push('END');
    return out.join('\r\n') + '\r\n';
  };

  /* ファナック LS（位置は関節角） */
  RS.exportLS = function (prog) {
    const pi = RS.pointIndex(prog);
    const mn = prog.lines.map((l, i) => `${pad(i + 1, 4, ' ')}:  ${RS.formatLine('fanuc', l, pi[i])}    ;`);
    const pos = [];
    prog.lines.forEach((l, i) => {
      if (pi[i] < 0) return;
      const q = l.q.map(v => f(v, 3).padStart(9, ' '));
      pos.push(`P[${pi[i] + 1}]{`, '   GP1:', '\tUF : 0, UT : 1,',
        `\tJ1=${q[0]} deg,\tJ2=${q[1]} deg,\tJ3=${q[2]} deg,`,
        `\tJ4=${q[3]} deg,\tJ5=${q[4]} deg,\tJ6=${q[5]} deg`, '};');
    });
    return [
      `/PROG  ${prog.name}`, '/ATTR', 'OWNER\t\t= MNEDITOR;', `COMMENT\t\t= "ROBOT-SIM ${prog.tool}";`,
      `LINE_COUNT\t= ${prog.lines.length};`, 'PROTECT\t\t= READ_WRITE;', 'DEFAULT_GROUP\t= 1,*,*,*,*;',
      '/MN', ...mn, '/POS', ...pos, '/END'
    ].join('\r\n') + '\r\n';
  };

  RS.exportJSON = function (prog, sys) {
    return JSON.stringify({ format: 'robot-sim-program', version: 2, system: sys, ...prog }, null, 2);
  };

  /* ---------- 読み込み ----------
   * 戻り値 { prog, system } もしくは { err }
   * ikOf(pose, ref) → q|null（JBI の直交位置を関節角に変換する） */
  RS.importText = function (text, ikOf) {
    text = String(text || '').replace(/^﻿/, '');
    const t = text.trim();
    if (t.startsWith('{')) {
      try {
        const o = JSON.parse(t);
        const p = RS.validateProgram(o);
        if (!p) return { err: 'プログラムの形式ではありません' };
        return { prog: p, system: o.system === 'fanuc' ? 'fanuc' : (o.system === 'yaskawa' ? 'yaskawa' : null) };
      } catch (e) { return { err: 'JSON を読めません：' + e.message }; }
    }
    if (/^\/JOB/m.test(t)) return importJBI(t, ikOf);
    if (/^\/PROG/m.test(t)) return importLS(t);
    return { err: '対応していない形式です（JSON / JBI / LS）' };
  };

  function importJBI(t, ikOf) {
    const name = (t.match(/^\/\/NAME\s+(\S+)/m) || [])[1] || 'IMPORT';
    if (!/^\/\/\/RECTAN/m.test(t)) return { err: 'JBI は直交形式（RECTAN）の位置のみ読み込めます' };
    const C = {};
    for (const m of t.matchAll(/^C(\d{5})=([^\r\n]+)/gm)) C[+m[1]] = m[2].split(',').map(Number);
    const inst = t.split(/^NOP\s*$/m)[1] || '';
    const lines = [];
    let ref = null;
    for (const raw of inst.split(/\r?\n/)) {
      const s = raw.trim();
      let m;
      if ((m = s.match(/^MOV([JL])\s+C(\d+)\s+(?:VJ|V)=([\d.]+)/))) {
        const c = C[+m[2]];
        if (!c) return { err: `位置 C${m[2]} がありません` };
        const q = ikOf({ X: c[0], Y: c[1], Z: c[2], rx: c[3], ry: c[4], rz: c[5] }, ref);
        if (!q) return { err: `位置 C${m[2]} に届きません（ツール・機種を確認してください）` };
        ref = q;
        lines.push({ op: 'MOV' + m[1], q, v: +m[3] });
      } else if ((m = s.match(/^DOUT\s+OT#\(1\)\s+(ON|OFF)/))) lines.push({ op: 'OUT', on: m[1] === 'ON' });
      else if ((m = s.match(/^WAIT\s+IN#\(1\)=(ON|OFF)/))) lines.push({ op: 'WAITIN', on: m[1] === 'ON' });
      else if ((m = s.match(/^TIMER\s+T=([\d.]+)/))) lines.push({ op: 'TIMER', t: +m[1] });
    }
    const tool = (t.match(/^\/\/\/COMM\s+ROBOT-SIM\s+(\S+)/m) || [])[1];
    return { prog: RS.validateProgram({ name, tool, lines }), system: 'yaskawa' };
  }

  function importLS(t) {
    const name = (t.match(/^\/PROG\s+(\S+)/m) || [])[1] || 'IMPORT';
    const P = {};
    for (const m of t.matchAll(/P\[(\d+)\][^{]*\{([\s\S]*?)\};/g)) {
      const js = [];
      for (let i = 1; i <= 6; i++) {
        const mm = m[2].match(new RegExp(`J${i}\\s*=\\s*(-?[\\d.]+)`));
        if (!mm) return { err: `P[${m[1]}] は関節形式ではありません（関節形式のみ読み込めます）` };
        js.push(+mm[1]);
      }
      P[+m[1]] = js;
    }
    const mn = (t.split(/^\/MN\s*$/m)[1] || '').split(/^\/POS\s*$/m)[0];
    const lines = [];
    for (const raw of mn.split(/\r?\n/)) {
      const s = raw.replace(/^\s*\d+:\s*/, '').replace(/;\s*$/, '').trim();
      let m;
      if ((m = s.match(/^([JL])\s+P\[(\d+)\]\s+([\d.]+)(%|mm\/sec)/))) {
        const q = P[+m[2]];
        if (!q) return { err: `P[${m[2]}] がありません` };
        lines.push({ op: m[1] === 'J' ? 'MOVJ' : 'MOVL', q: q.slice(), v: +m[3] });
      } else if ((m = s.match(/^RO\[1\]=(ON|OFF)/))) lines.push({ op: 'OUT', on: m[1] === 'ON' });
      else if ((m = s.match(/^WAIT\s+RI\[1\]=(ON|OFF)/))) lines.push({ op: 'WAITIN', on: m[1] === 'ON' });
      else if ((m = s.match(/^WAIT\s+([\d.]+)\(sec\)/))) lines.push({ op: 'TIMER', t: +m[1] });
    }
    const tool = (t.match(/COMMENT\s*=\s*"ROBOT-SIM\s+(\S+)"/) || [])[1];
    return { prog: RS.validateProgram({ name, tool, lines }), system: 'fanuc' };
  }
})(window.RS = window.RS || {});
