/* =====================================================================
 * kinematics.js — 順運動学／逆運動学（6軸・球面手首）
 *
 * 内部計算は Three.js のワールド座標（Y上向き）で行います。
 *   ロボット座標 (X, Y, Z)  ⇔  Three.js (x, y, z) = (X, Z, -Y)
 * ツール座標系（Z＝フランジから外向き）は、手首フレーム(tG)のローカルで
 *   Xt=(0,1,0)  Yt=(0,0,1)  Zt=(1,0,0)
 * に対応します。ツール定義（tools.js）は「Z がフランジから外向き」で書きます。
 * ===================================================================== */
(function (RS) {
  'use strict';
  const T = window.THREE;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  /* ツール座標系 → 手首フレームの回転 */
  const TOOL_BASIS = new T.Matrix4().makeBasis(
    new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1), new T.Vector3(1, 0, 0));
  /* ロボット座標 → Three.js の回転 */
  const C = new T.Matrix4().makeBasis(
    new T.Vector3(1, 0, 0), new T.Vector3(0, 0, -1), new T.Vector3(0, 1, 0));
  const Ci = C.clone().transpose();
  RS.TOOL_BASIS = TOOL_BASIS;

  const rx = a => new T.Matrix4().makeRotationX(a);
  const ry = a => new T.Matrix4().makeRotationY(a);
  const rz = a => new T.Matrix4().makeRotationZ(a);
  const tr = (x, y, z) => new T.Matrix4().makeTranslation(x, y, z);

  /* 手首フレーム → TCP の変換（tcp はツール座標 [x,y,z] m） */
  RS.wristToTcp = function (dims, tcp) {
    return tr(dims.fl, 0, 0).multiply(TOOL_BASIS).multiply(tr(tcp[0], tcp[1], tcp[2]));
  };

  /* 内部関節角(度) → 各フレームのワールド行列 */
  RS.fkKin = function (dims, k) {
    const s = ry(k[0] * D2R);
    const l = s.clone().multiply(tr(dims.pivR, dims.pivY, 0)).multiply(rz(-k[1] * D2R));
    const u = l.clone().multiply(tr(0, dims.la, 0)).multiply(rz(k[2] * D2R));
    const r = u.clone().multiply(tr(0, dims.a3 || 0, 0)).multiply(rx(k[3] * D2R));
    const b = r.clone().multiply(tr(dims.ua, 0, 0)).multiply(rz(-k[4] * D2R));
    const t = b.clone().multiply(rx(k[5] * D2R));
    return { s, l, u, r, b, t };
  };

  /* ブランド関節角 → TCP のワールド行列（ツール座標系の向き） */
  RS.fk = function (robot, q, tcp) {
    const f = RS.fkKin(robot.dims, RS.toKin(robot, q));
    return f.t.multiply(RS.wristToTcp(robot.dims, tcp));
  };

  /* Three ワールド行列 → ロボット座標の姿勢 {X,Y,Z(mm), rx,ry,rz(度)}
   * 回転は R = Rz(rz)·Ry(ry)·Rx(rx)（固定軸 X→Y→Z。安川 Rx/Ry/Rz、ファナック W/P/R） */
  RS.poseFromMatrix = function (M) {
    const p = new T.Vector3().setFromMatrixPosition(M);
    const R = Ci.clone().multiply(new T.Matrix4().extractRotation(M));
    const e = R.elements; // 列優先
    const r00 = e[0], r10 = e[1], r20 = e[2], r21 = e[6], r22 = e[10];
    const r01 = e[4], r11 = e[5];
    let ryv = Math.asin(Math.max(-1, Math.min(1, -r20)));
    let rxv, rzv;
    if (Math.abs(r20) < 0.999999) {
      rxv = Math.atan2(r21, r22);
      rzv = Math.atan2(r10, r00);
    } else { // ジンバルロック
      rxv = 0;
      rzv = Math.atan2(-r01, r11);
    }
    return { X: p.x * 1000, Y: -p.z * 1000, Z: p.y * 1000, rx: rxv * R2D, ry: ryv * R2D, rz: rzv * R2D };
  };

  /* ロボット座標の姿勢 → Three ワールド行列 */
  RS.matrixFromPose = function (P) {
    const R = rz(P.rz * D2R).multiply(ry(P.ry * D2R)).multiply(rx(P.rx * D2R));
    const M = C.clone().multiply(R);
    M.setPosition(P.X / 1000, P.Z / 1000, -P.Y / 1000);
    return M;
  };

  RS.robotToThree = (X, Y, Z) => new T.Vector3(X, Z, -Y);
  RS.threeToRobot = v => ({ X: v.x, Y: -v.z, Z: v.y });

  function wrapNear(a, ref, lo, hi) {
    // a を ±360 して ref に最も近い値（可動範囲内を優先）にする
    let best = null, bd = Infinity;
    for (let n = -2; n <= 2; n++) {
      const v = a + 360 * n;
      if (v < lo - 1e-6 || v > hi + 1e-6) continue;
      const d = Math.abs(v - ref);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  /* 逆運動学
   *   robot : RS.ROBOTS の機種
   *   M     : 目標 TCP のワールド行列（ツール座標系の向き）
   *   tcp   : ツールの TCP [x,y,z] m
   *   ref   : 参照関節角（ブランド角。最も近い解を選ぶ）
   * 戻り値 : { q:[6] } もしくは { err:'reach'|'limit'|'singular' } */
  RS.ik = function (robot, M, tcp, ref, pref) {
    const d = robot.dims;
    const refK = RS.toKin(robot, ref || robot.home);
    const W = M.clone().multiply(new T.Matrix4().copy(RS.wristToTcp(d, tcp)).invert());
    const wc = new T.Vector3().setFromMatrixPosition(W);
    const Rt = new T.Matrix4().extractRotation(W);

    // S
    const rh = Math.hypot(wc.x, wc.z);
    let S;
    if (rh < 1e-5) S = refK[0];
    else S = Math.atan2(-wc.z, wc.x) * R2D;
    S = wrapNear(S, refK[0], robot.lim[0][0], robot.lim[0][1]);
    if (S === null) return { err: 'limit', axis: 0 };

    // L, U（肘上解）。上腕は U 軸から (ua, a3) の位置に手首中心がある
    const a3 = d.a3 || 0, L2 = Math.hypot(d.ua, a3), phi = Math.atan2(a3, d.ua);
    const r = rh - d.pivR, h = wc.y - d.pivY;
    const dist = Math.hypot(r, h);
    if (dist > d.la + L2 - 1e-6 || dist < Math.abs(d.la - L2) + 1e-6) return { err: 'reach' };
    const delta = Math.atan2(r, h);
    const a = Math.acos(Math.max(-1, Math.min(1, (d.la * d.la + dist * dist - L2 * L2) / (2 * d.la * dist))));
    const L = delta - a;
    const ex = d.la * Math.sin(L), ey = d.la * Math.cos(L);
    const e = Math.atan2(h - ey, r - ex);
    const U = e + L - phi;
    const Ld = L * R2D, Ud = U * R2D;

    // 手首 R,B,T : Rrel = Rx(R)·Rz(-B)·Rx(T)
    const R03 = ry(S * D2R).multiply(rz(U - L));
    const Rrel = R03.clone().transpose().multiply(Rt);
    const m = Rrel.elements;
    const m00 = m[0], m10 = m[1], m20 = m[2], m01 = m[4], m02 = m[8], m21 = m[6], m22 = m[10];
    const cands = [];
    const b = Math.acos(Math.max(-1, Math.min(1, m00)));
    if (Math.sin(b) < 1e-5) {
      // 特異点（B≒0）：R は参照値を保つ
      const sum = Math.atan2(m21, m22) * R2D;
      cands.push([refK[3], (b < 1 ? 0 : 180), sum - refK[3]]);
    } else {
      const a1 = Math.atan2(m20, m10) * R2D, c1 = Math.atan2(m02, -m01) * R2D, b1 = b * R2D;
      cands.push([a1, -b1, c1]);
      cands.push([a1 + 180, b1, c1 + 180]);
    }
    let best = null, bestD = Infinity, why = 'limit';
    for (const c of cands) {
      const k = [S, Ld, Ud, c[0], c[1], c[2]];
      const q = RS.fromKin(robot, k);
      // 手首回転系は ±360 で最も近い値に
      for (const i of [3, 5]) {
        const v = wrapNear(q[i], ref ? ref[i] : 0, robot.lim[i][0], robot.lim[i][1]);
        if (v === null) { q[i] = NaN; } else q[i] = v;
      }
      if (q.some(Number.isNaN)) continue;
      if (pref && pref.turn) {
        // ファナックの回転数指定（J1,J4,J6）: 角度を (-180+360t, 180+360t] に入れる
        [[0, pref.turn[0]], [3, pref.turn[1]], [5, pref.turn[2]]].forEach(([i, t]) => {
          if (t == null) return;
          let v = q[i]; while (v > 180 + 360 * t) v -= 360; while (v <= -180 + 360 * t) v += 360;
          if (v >= robot.lim[i][0] && v <= robot.lim[i][1]) q[i] = v;
        });
      }
      if (RS.limitViolation(robot, q) >= 0) continue;
      let dd = 0;
      const rf = ref || robot.home;
      for (let i = 0; i < 6; i++) dd += Math.abs(q[i] - rf[i]) * (i < 3 ? 2 : 1);
      if (pref && pref.flip != null && (q[4] < 0) !== pref.flip) dd += 1e5;  // 手首フリップ指定に合わない解は後回し
      if (dd < bestD) { bestD = dd; best = q; }
    }
    if (!best) return { err: why };
    return { q: best };
  };

  /* ファナック形式の形態 'N U T, 0, 0, 0' ⇔ {flip, turn} （このシミュレーターの規約：J5<0 を Flip とする） */
  RS.configOf = function (q) {
    const turn = i => Math.round((q[i] - (q[i] > 0 ? 1e-9 : 0)) / 360);
    return `${q[4] < 0 ? 'F' : 'N'} U T, ${turn(0)}, ${turn(3)}, ${turn(5)}`;
  };
  RS.parseConfig = function (s) {
    const m = String(s || '').match(/([NF])\s*([UD])?\s*([TB])?\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/i);
    if (!m) return null;
    return { flip: m[1].toUpperCase() === 'F', up: (m[2] || 'U').toUpperCase() === 'U', front: (m[3] || 'T').toUpperCase() === 'T', turn: [+m[4], +m[5], +m[6]] };
  };

  /* 2つの行列の位置距離(m)と回転角(度) */
  RS.poseDelta = function (A, B) {
    const pa = new T.Vector3().setFromMatrixPosition(A), pb = new T.Vector3().setFromMatrixPosition(B);
    const qa = new T.Quaternion().setFromRotationMatrix(A), qb = new T.Quaternion().setFromRotationMatrix(B);
    return { dist: pa.distanceTo(pb), ang: qa.angleTo(qb) * R2D };
  };

  /* 直線補間の経路を作る（各サンプルを IK で解く）
   * 戻り値 { ok, qs:[[6]...], dist(m), ang(度), err, at } */
  RS.planLinear = function (robot, q0, M1, tcp, stepM, stepDeg) {
    stepM = stepM || 0.004; stepDeg = stepDeg || 1.5;
    const M0 = RS.fk(robot, q0, tcp);
    const p0 = new T.Vector3().setFromMatrixPosition(M0), p1 = new T.Vector3().setFromMatrixPosition(M1);
    const o0 = new T.Quaternion().setFromRotationMatrix(M0), o1 = new T.Quaternion().setFromRotationMatrix(M1);
    const dist = p0.distanceTo(p1), ang = o0.angleTo(o1) * R2D;
    const n = Math.max(1, Math.ceil(Math.max(dist / stepM, ang / stepDeg)));
    const qs = [q0.slice()];
    let prev = q0.slice();
    for (let i = 1; i <= n; i++) {
      const s = i / n;
      const p = p0.clone().lerp(p1, s), o = o0.clone().slerp(o1, s);
      const M = new T.Matrix4().makeRotationFromQuaternion(o); M.setPosition(p);
      const r = RS.ik(robot, M, tcp, prev);
      if (!r.q) return { ok: false, err: r.err, at: s, dist, ang };
      // 急激な関節変化 = 特異点付近
      for (let j = 0; j < 6; j++) {
        if (Math.abs(r.q[j] - prev[j]) > 20) return { ok: false, err: 'singular', at: s, dist, ang };
      }
      qs.push(r.q); prev = r.q;
    }
    return { ok: true, qs, dist, ang };
  };

  RS.D2R = D2R; RS.R2D = R2D;
})(window.RS = window.RS || {});
