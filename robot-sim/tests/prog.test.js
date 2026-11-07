// node tests/prog.test.js : 命令の解析・書き出し／読み込み・インタプリタのテスト
global.window = global;
global.THREE = require('../vendor/three.min.js');
['robots', 'tools', 'kinematics', 'program', 'interp'].forEach(f => require('../js/' + f + '.js'));
const RS = window.RS;
let fail = 0;
const ok = (name, c, info) => { if (!c) { fail++; console.log('NG', name, info === undefined ? '' : JSON.stringify(info)); } };

// --- 解析（安川） ---
const Y = s => RS.parseLine('yaskawa', s);
ok('MOVJ', Y('MOVJ C00001 VJ=50.00 PL=3').op === 'MOVE' && Y('MOVJ C00001 VJ=50.00 PL=3').term.pl === 3);
ok('MOVL', Y('MOVL C00002 V=500.0').speed.v === 500);
ok('DOUT', Y('DOUT OT#(3) ON').n === 3);
ok('WAIT T', Y('WAIT IN#(2)=ON T=3.00').timeout === 3);
ok('JUMP IF', Y('JUMP *LOOP IF I000<5').cond.op === '<');
ok('CALL', Y('CALL JOB:SUB1').name === 'SUB1');
ok('INC', Y('INC I001').fn === 'INC');
ok('SFTON', Y('SFTON P001 BF').ref === 'P001');
ok('unknown', Y('ARCON ASF#(1)').op === 'UNKNOWN');
ok('comment', Y("'pick glass").op === 'COMMENT');
// --- 解析（ファナック） ---
const F = s => RS.parseLine('fanuc', s);
ok('J', F('J P[1:HOME] 100% FINE').ref === 'P[1]');
ok('L CNT offset', (x => x.term.cnt === 50 && x.offset.pr === 3 && x.speed.unit === 'mm/s')(F('L P[2] 500mm/sec CNT50 Offset,PR[3]')));
ok('L PR', F('L PR[5] 200mm/sec FINE').ref === 'PR[5]');
ok('IF', F('IF R[1]<3,JMP LBL[10]').cond.op === '<');
ok('IF AND', F('IF (DI[1]=ON) AND (R[2]=0),JMP LBL[1]').cond.t === 'multi');
ok('R expr', F('R[1]=R[1]+1').op === 'CALC');
ok('PR elem', F('PR[3,3]=R[1]*5').op === 'PRELEM');
ok('PR clear', F('PR[3]=PR[3]-PR[3]').sign === '-');
ok('WAIT DI', F('WAIT DI[2]=ON TIMEOUT,LBL[99]').timeoutLbl === '99');
ok('RO pulse', F('RO[2]=PULSE,0.5sec').op === 'PULSE');
ok('UFRAME', F('UFRAME_NUM=1').op === 'FRAME');
ok('err speed', F('J P[1] FINE').op === 'ERR');

// --- LS 読み込み（実機の書式） ---
const LS = `/PROG  TEST1
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "glass";
/MN
   1:  UFRAME_NUM=0 ;
   2:  LBL[1] ;
   3:J P[1] 100% FINE    ;
   4:L P[2:APPROACH] 500mm/sec CNT50    ;
   5:  RO[1]=ON ;
   6:  WAIT RI[1]=ON    ;
   7:L P[2] 200mm/sec FINE    ;
    :  Offset,PR[1]    ;
   8:  R[1]=R[1]+1    ;
   9:  IF R[1]<3,JMP LBL[1] ;
/POS
P[1]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   900.000  mm,	Y =     0.000  mm,	Z =   800.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
P[2:"APPROACH"]{
   GP1:
	UF : 0, UT : 1,	
	J1=     0.000 deg,	J2=    10.000 deg,	J3=   -20.000 deg,
	J4=     0.000 deg,	J5=   -60.000 deg,	J6=     0.000 deg
};
/END
`;
const r = RS.importText(LS);
ok('LS import', r.progs && r.progs[0].lines.length === 9 && r.progs[0].pos['P[1]'].k === 'c' && r.progs[0].pos['P[2]'].k === 'j', r);
ok('LS continuation', r.progs[0].lines[6].includes('Offset,PR[1]'), r.progs[0].lines);
ok('LS check', RS.checkProgram(r.progs[0]).filter(e => e.lv === 'err').length === 0, RS.checkProgram(r.progs[0]));
const ls2 = RS.exportLS(r.progs[0]);
const r2 = RS.importText(ls2);
ok('LS roundtrip', JSON.stringify(r2.progs[0].lines) === JSON.stringify(r.progs[0].lines) && JSON.stringify(r2.progs[0].pos) === JSON.stringify(r.progs[0].pos), [r2.progs[0].lines]);

// --- JBI（PULSE / RECTAN） ---
const JBI = `/JOB
//NAME TEST2
//POS
///NPOS 2,0,0,0,0,0
///TOOL 0
///POSTYPE PULSE
///PULSE
C00000=0,0,0,0,-1000,0
///POSTYPE BASE
///RECTAN
///RCONF 0,0,0,0,0,0,0,0
C00001=900.000,0.000,700.000,180.0000,0.0000,0.0000
//INST
///DATE 2026/11/07 10:00
///ATTR SC,RW
///GROUP1 RB1
NOP
*LOOP
MOVJ C00000 VJ=50.00
MOVL C00001 V=300.0 PL=0
INC I000
JUMP *LOOP IF I000<2
END
`;
ok('JBI pulse needs factors', !!RS.importText(JBI, {}).err);
const j = RS.importText(JBI, { pulse: { yaskawa: [100, 100, 100, 100, 100, 100] } });
ok('JBI import', j.progs && j.progs[0].pos.C00000.q[4] === -10 && j.progs[0].pos.C00001.k === 'c' && j.progs[0].lines.length === 5, j);
const jb = RS.exportJBI(j.progs[0], { pulse: [100, 100, 100, 100, 100, 100], poseOf: () => null });
ok('JBI export pulse', jb.includes('C00000=0,0,0,0,-1000,0') && jb.includes('C00001=900.000') && jb.includes('*LOOP'), jb);

// --- インタプリタ ---
function host(lib, ins) {
  const io = { out: {}, in: ins || {} };
  return {
    lib: () => lib, getIn: (k, n) => !!io.in[k + n], getOut: (k, n) => !!io.out[k + n], setOut: (k, n, v) => { io.out[k + n] = v; },
    vars: { num: {}, pos: {} }, curPose: () => ({ X: 1, Y: 2, Z: 3, rx: 0, ry: 0, rz: 0 }), curQ: () => [0, 0, 0, 0, 0, 0],
    setOverride() {}, log() {}, opts: { skipUnknown: true, waitTimeout: 10 }, io
  };
}
{
  const lib = { TEST1: r.progs[0] };
  const H = host(lib, { RI1: true });
  H.vars.pos.PR1 = { k: 'c', p: { X: 0, Y: 0, Z: 50, rx: 0, ry: 0, rz: 0 } };
  const it = new RS.Interp(H); it.start('TEST1', 0);
  let moves = 0, a, n = 0;
  while (n++ < 200) { a = it.tick(0.1); if (!a) continue; if (a.t === 'move') { moves++; it.done(); continue; } break; }
  ok('interp loop 3x', a.t === 'end' && moves === 9 && H.vars.num.R1 === 3 && H.io.out.RO1 === true, { a, moves, R1: H.vars.num.R1 });
}
{
  const sub = RS.emptyProgram('yaskawa', 'SUB'); sub.lines = ['INC I005', 'RET'];
  const main = RS.emptyProgram('yaskawa', 'MAIN'); main.lines = ['SET I005 0', '*A', 'CALL JOB:SUB', 'JUMP *A IF I005<4', 'TIMER T=0.20', 'DOUT OT#(2) ON'];
  const H = host({ SUB: sub, MAIN: main });
  const it = new RS.Interp(H); it.start('MAIN', 0);
  let a, n = 0; while (n++ < 50) { a = it.tick(0.1); if (a) break; }
  ok('CALL/RET/TIMER', a.t === 'end' && H.vars.num.I005 === 4 && H.io.out.OT2 === true, { a, v: H.vars.num });
}
{
  const m = RS.emptyProgram('fanuc', 'W'); m.lines = ['WAIT DI[3]=ON'];
  const H = host({ W: m }); H.opts.waitTimeout = 1;
  const it = new RS.Interp(H); it.start('W', 0);
  let a, n = 0; while (n++ < 50) { a = it.tick(0.1); if (a) break; }
  ok('wait timeout alarm', a && a.t === 'alarm' && a.key === 'wait', a);
}
{
  const m = RS.emptyProgram('fanuc', 'L'); m.lines = ['LBL[1]', 'JMP LBL[1]'];
  const it = new RS.Interp(host({ L: m })); it.start('L', 0);
  const a = it.tick(0.1);
  ok('infinite loop guard', a && a.t === 'alarm', a);
}
// --- Shift_JIS（DX200 の日本語コメント） ---
{
  const txt = "'ガラス取出し ｶﾅ ①\r\nMOVJ C00000 VJ=50.00";
  const e = RS.encodeSJIS(txt);
  const back = new TextDecoder('shift_jis').decode(e.bytes);
  ok('Shift_JIS 往復', back === txt && e.bad === 0, [back, e.bad]);
}
// --- programs/ のサンプルファイルが読めて誤りがない ---
const fs = require('fs'), path = require('path');
for (const f of fs.readdirSync(path.join(__dirname, '../programs'))) {
  const r = RS.importText(fs.readFileSync(path.join(__dirname, '../programs', f), 'utf8'), {});
  ok('programs/' + f, r.progs && RS.checkProgram(r.progs[0]).length === 0, r.err || RS.checkProgram(r.progs[0]));
}
console.log(fail ? `NG ${fail}` : 'all OK');
process.exit(fail ? 1 : 0);
