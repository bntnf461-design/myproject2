// node tests/kin.test.js : 運動学の往復テスト
global.window = global;
global.THREE = require('../vendor/three.min.js');
require('../js/robots.js'); require('../js/kinematics.js');
const RS = window.RS;
let fail = 0, n = 0, nf = 0;
function rnd(a, b) { return a + Math.random() * (b - a); }
for (const id of ['yaskawa', 'fanuc']) {
  const rb = RS.ROBOTS[id], tcp = [0.01, -0.02, 0.17];
  // フリップ指定の確認
  { const q=[10,30,10,20,-40,30]; const M=RS.fk(rb,q,tcp); const c=RS.parseConfig(RS.configOf(q)); const r=RS.ik(rb,M,tcp,rb.home,c); if(!r.q||Math.abs(r.q[4]-q[4])>1e-3||Math.abs(r.q[3]-q[3])>1e-3){fail++;console.log('config',r.q,q);} }
  for (let t = 0; t < 3000; t++) {
    const q = rb.lim.map(([a, b], i) => i === 5 ? rnd(-170, 170) : i===3? rnd(-170,170): rnd(a * 0.9, b * 0.9));
    if (Math.abs(q[4]) < 3) continue;
    const M = RS.fk(rb, q, tcp);
    const r = RS.ik(rb, M, tcp, q);
    n++;
    if (!r.q) { nf++;
      continue;
    }
    const d = RS.poseDelta(M, RS.fk(rb, r.q, tcp));
    if (d.dist > 1e-6 || d.ang > 1e-4) { fail++; if (fail < 5) console.log('mismatch', id, q, r.q, d); }
  }
  // 姿勢 ↔ 行列
  const q = [10, 20, 5, 15, -60, 30];
  const M = RS.fk(rb, q, tcp), P = RS.poseFromMatrix(M), M2 = RS.matrixFromPose(P);
  const d = RS.poseDelta(M, M2);
  if (d.dist > 1e-9 || d.ang > 1e-4) { fail++; console.log('pose roundtrip', d); }
  // 下向き姿勢 W=180,P=0,R=0 で IK が解けること
  const down = RS.matrixFromPose({ X: 900, Y: 0, Z: 500, rx: 180, ry: 0, rz: 0 });
  const r = RS.ik(rb, down, tcp, rb.home);
  if (!r.q) { fail++; console.log('down fail', id, r); } else console.log(id, 'down', r.q.map(v => v.toFixed(1)).join(','));
  console.log(id, 'home pose', JSON.stringify(RS.poseFromMatrix(RS.fk(rb, rb.home, tcp))));
}
console.log(`checked ${n}, no-solution(elbow-down etc) ${nf}, fail ${fail}`);
process.exit(fail ? 1 : 0);
