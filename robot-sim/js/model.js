/* =====================================================================
 * model.js — ロボットの 3D 形状（鋳物風の腕・モーター・ケーブル）
 *
 * RS.buildRobotModel(T, robot) → { root, sG,lG,uG,rG,bG,tG, mount, update() }
 * 関節の階層・回転軸は kinematics.js の fkKin と同じです（ここを変えるときは両方そろえること）。
 *   sG: Y軸回転（S/J1）  lG: Z軸（L/J2、位置 pivR,pivY）  uG: Z軸（U/J3、位置 0,la）
 *   rG: X軸（R/J4、位置 0,a3）  bG: Z軸（B/J5、位置 ua,0）  tG: X軸（T/J6）  mount: フランジ（fl,0,0）
 * ===================================================================== */
(function (RS) {
  'use strict';

  RS.buildRobotModel = function (T, robot) {
    const d = robot.dims, c = robot.colors, Y = robot.id === 'yaskawa';
    const a3 = d.a3 || 0;
    const LT = RS.lookTex || {};
    // 塗装（ゆず肌の細かい凹凸＋クリア層）、鋳物、金属は look.js のテクスチャで質感を付ける
    const pN = LT.paintN || null, nS = new T.Vector2(0.22, 0.22);
    const paint = new T.MeshPhysicalMaterial({ color: c.main, roughness: 0.42, metalness: 0.0, clearcoat: 0.65, clearcoatRoughness: 0.28, normalMap: pN, normalScale: nS });
    const paint2 = new T.MeshPhysicalMaterial({ color: c.sub, roughness: 0.46, metalness: 0.0, clearcoat: 0.5, clearcoatRoughness: 0.32, normalMap: pN, normalScale: nS });
    const motorM = new T.MeshStandardMaterial({ color: c.dark, roughness: 0.58, metalness: 0.35, normalMap: LT.castN || null, normalScale: new T.Vector2(0.3, 0.3) });
    const blackM = new T.MeshStandardMaterial({ color: 0x15171a, roughness: 0.72, metalness: 0.15 });
    const steel = new T.MeshStandardMaterial({ color: 0xc4c9cf, roughness: 0.32, metalness: 0.95, roughnessMap: LT.brushR || null });
    const boltM = new T.MeshStandardMaterial({ color: 0x3a3d41, roughness: 0.45, metalness: 0.85 });
    const cableM = new T.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.62, metalness: 0.05 });
    const labelM = LT.caution ? new T.MeshStandardMaterial({ map: LT.caution, transparent: true, alphaTest: 0.3, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }) : null;
    const mats = [paint, paint2, motorM, blackM, steel, boltM, cableM];

    const sh = m => { m.castShadow = true; m.receiveShadow = true; return m; };
    const at = (m, x, y, z) => { m.position.set(x || 0, y || 0, z || 0); return m; };

    /* 回転体（Y軸まわり）。pts = [[半径, 高さ], ...] */
    function lathe(pts, mat, seg) {
      return sh(new T.Mesh(new T.LatheGeometry(pts.map(p => new T.Vector2(p[0], p[1])), seg || 56), mat));
    }
    /* 回転体を任意の軸に向ける */
    function latheAx(pts, mat, axis, seg) {
      const g = new T.LatheGeometry(pts.map(p => new T.Vector2(p[0], p[1])), seg || 56);
      if (axis === 'x') g.rotateZ(-Math.PI / 2);
      if (axis === 'z') g.rotateX(Math.PI / 2);
      return sh(new T.Mesh(g, mat));
    }
    /* 面取りした円柱（ハブ・キャップ） */
    function hub(r, len, mat, axis, ch, seg) {
      ch = ch == null ? Math.min(r * 0.18, len * 0.25) : ch;
      return latheAx([[0, -len / 2], [r - ch, -len / 2], [r, -len / 2 + ch], [r, len / 2 - ch], [r - ch, len / 2], [0, len / 2]], mat, axis, seg);
    }
    /* 2つの円を接線でつないだ板（鋳物の腕）。c1=(0,0) 半径 r1、c2=(0,L) 半径 r2。厚み th（Z方向、中心0） */
    function link(r1, r2, L, th, mat, bevel) {
      bevel = bevel == null ? Math.min(0.025, th * 0.18) : bevel;
      const phi = Math.asin(Math.max(-0.95, Math.min(0.95, (r1 - r2) / L)));
      const s = new T.Shape();
      s.moveTo(r1 * Math.cos(phi), r1 * Math.sin(phi));
      s.lineTo(r2 * Math.cos(phi), L + r2 * Math.sin(phi));
      s.absarc(0, L, r2, phi, Math.PI - phi, false);
      s.lineTo(-r1 * Math.cos(phi), r1 * Math.sin(phi));
      s.absarc(0, 0, r1, Math.PI - phi, 2 * Math.PI + phi, false);
      const g = new T.ExtrudeGeometry(s, { depth: th - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 6, curveSegments: 56 });
      g.translate(0, 0, -(th - 2 * bevel) / 2);
      return sh(new T.Mesh(g, mat));
    }
    /* 角を丸めた箱 */
    function rbox(w, h, dp, r, mat) {
      const s = new T.Shape();
      const x = -w / 2 + r, y = -h / 2 + r;
      s.moveTo(x, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.absarc(w / 2 - r, y, r, -Math.PI / 2, 0, false);
      s.lineTo(w / 2, h / 2 - r); s.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2, false);
      s.lineTo(x, h / 2); s.absarc(x, h / 2 - r, r, Math.PI / 2, Math.PI, false);
      s.lineTo(-w / 2, y); s.absarc(x, y, r, Math.PI, Math.PI * 1.5, false);
      const b = Math.min(0.02, dp * 0.15);
      const g = new T.ExtrudeGeometry(s, { depth: dp - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b * 0.9, bevelSegments: 5, curveSegments: 14 });
      g.translate(0, 0, -(dp - 2 * b) / 2);
      return sh(new T.Mesh(g, mat));
    }
    /* サーボモーター（axis 方向に伸びる） */
    function motor(r, len, axis) {
      const g = new T.Group();
      const body = [[0, 0], [r * 0.92, 0], [r, r * 0.08], [r, len * 0.82], [r * 0.9, len * 0.86], [r * 0.9, len * 0.96], [r * 0.75, len], [0, len]];
      g.add(latheAx(body, motorM, 'y'));
      for (let i = 1; i <= 4; i++) g.add(at(latheAx([[r * 1.0, 0], [r * 1.06, 0], [r * 1.06, 0.006], [r * 1.0, 0.006]], motorM, 'y'), 0, len * (0.15 + i * 0.13), 0));
      g.add(at(sh(new T.Mesh(new T.BoxGeometry(r * 0.7, r * 0.5, r * 0.55), blackM)), 0, len * 0.55, r * 1.05));
      if (axis === 'x') g.rotation.z = -Math.PI / 2;
      if (axis === 'z') g.rotation.x = Math.PI / 2;
      if (axis === '-x') g.rotation.z = Math.PI / 2;
      if (axis === '-z') g.rotation.x = -Math.PI / 2;
      return g;
    }

    /* 六角ボルトを円周に並べる（axis 方向に面が向く） */
    function bolts(parent, R, n, x, y, z, axis, size, a0) {
      // 六角（6 分割）の頭を 1 つの形状にまとめる（描画を軽くするため）
      const s = size || 0.009, parts = [];
      for (let i = 0; i < n; i++) {
        const a = (a0 || 0) + i / n * Math.PI * 2, u = Math.cos(a) * R, v = Math.sin(a) * R;
        const g = hub(s, s * 0.9, boltM, axis, s * 0.15, 6).geometry.toNonIndexed();
        if (axis === 'z') g.translate(x + u, y + v, z);
        else if (axis === 'x') g.translate(x, y + u, z + v);
        else g.translate(x + u, y, z + v);
        parts.push(g);
      }
      const cnt = parts.reduce((t, g) => t + g.attributes.position.count, 0);
      const pos = new Float32Array(cnt * 3), nor = new Float32Array(cnt * 3);
      let k = 0;
      for (const g of parts) { pos.set(g.attributes.position.array, k * 3); nor.set(g.attributes.normal.array, k * 3); k += g.attributes.position.count; g.dispose(); }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
      geo.computeBoundingSphere();
      const m = new T.Mesh(geo, boltM); m.receiveShadow = true;   // 小さいので影は落とさない
      parent.add(m);
    }
    /* 注意ラベル（面の法線 = +Z のローカル面に貼る） */
    function label(parent, x, y, z, size, ry) {
      if (!labelM) return;
      const m = new T.Mesh(new T.PlaneGeometry(size, size), labelM);
      m.position.set(x, y, z); if (ry) m.rotation.y = ry; parent.add(m);
    }

    const root = new T.Group();
    /* ベース（床固定） */
    root.add(lathe([[0, 0], [0.33, 0], [0.33, 0.025], [0.3, 0.03], [0.28, 0.05], [0.27, 0.16], [0.25, 0.18], [0, 0.18]], Y ? motorM : paint));
    bolts(root, 0.305, 6, 0, 0.035, 0, 'y', 0.014, 0.3);

    /* S 旋回部 */
    const sG = new T.Group(); root.add(sG);
    sG.add(lathe([[0, 0.18], [0.255, 0.18], [0.255, 0.2], [0.24, 0.215], [0.235, 0.31], [0.2, 0.33], [0, 0.33]], paint));
    bolts(sG, 0.215, 12, 0, 0.334, 0, 'y', 0.007);
    // 肩（L 軸の支え）：下腕は Z+ 側、L モーターは Z− 側
    const shoulderH = d.pivY - 0.3;
    const sh1 = link(0.16, 0.15, shoulderH, 0.12, paint); sh1.position.set(d.pivR, 0.3, 0.13); sG.add(sh1);
    const sh2 = link(0.15, 0.135, shoulderH, 0.1, paint); sh2.position.set(d.pivR, 0.3, -0.12); sG.add(sh2);
    sG.add(at(rbox(0.3, 0.12, 0.34, 0.04, paint), d.pivR * 0.6, 0.34, 0));
    const sMot = motor(0.065, 0.2, 'y'); sMot.position.set(-0.17, 0.3, -0.05); sG.add(sMot);
    const lMot = motor(0.07, 0.17, '-z'); lMot.position.set(d.pivR, d.pivY, -0.17); sG.add(lMot);

    /* L 下腕 */
    const lG = new T.Group(); lG.position.set(d.pivR, d.pivY, 0); sG.add(lG);
    lG.add(at(hub(0.135, 0.06, paint2, 'z'), 0, 0, 0.215));
    const lower = link(0.13, 0.105, d.la, 0.14, paint); lower.position.z = 0.15; lG.add(lower);
    lG.add(at(hub(0.11, 0.05, paint2, 'z'), 0, d.la, 0.235));
    bolts(lG, 0.105, 10, 0, 0, 0.248, 'z', 0.008);
    bolts(lG, 0.085, 8, 0, d.la, 0.263, 'z', 0.007);
    label(lG, 0, d.la * 0.45, 0.2215, 0.06);

    /* U 上腕付け根（肘） */
    const uG = new T.Group(); uG.position.set(0, d.la, 0); lG.add(uG);
    const elbow = link(0.125, 0.115, Math.max(0.05, a3), 0.2, paint); elbow.position.z = 0.0; uG.add(elbow);
    uG.add(at(rbox(0.34, 0.2, 0.22, 0.06, paint), -0.03, a3, 0));
    label(uG, 0.02, a3 + 0.02, -0.1115, 0.05, Math.PI);
    const uMot = motor(0.06, 0.16, '-z'); uMot.position.set(0, 0, -0.1); uG.add(uMot);
    // 手首用モーター（後ろ側）
    const wMot = motor(0.055, 0.2, '-x'); wMot.position.set(-0.19, a3 + 0.03, 0.05); uG.add(wMot);
    const wMot2 = motor(0.05, 0.18, '-x'); wMot2.position.set(-0.19, a3 - 0.06, -0.06); uG.add(wMot2);

    /* R 前腕 */
    const rG = new T.Group(); rG.position.set(0, a3, 0); uG.add(rG);
    const L1 = d.ua - 0.13;
    rG.add(latheAx([[0, 0.14], [0.095, 0.14], [0.098, 0.16], [0.085, 0.22], [0.072, L1 - 0.02], [0.075, L1], [0, L1]], paint, 'x'));
    rG.add(at(hub(0.1, 0.03, paint2, 'x'), 0.155, 0, 0));
    bolts(rG, 0.082, 8, 0.172, 0, 0, 'x', 0.006);
    // 手首フォーク
    for (const z of [0.07, -0.07]) {
      const fk = link(0.06, 0.07, 0.11, 0.028, paint);
      fk.rotation.z = -Math.PI / 2; fk.position.set(d.ua - 0.11, 0, z); rG.add(fk);
    }

    /* B 手首 */
    const bG = new T.Group(); bG.position.set(d.ua, 0, 0); rG.add(bG);
    bG.add(hub(0.068, 0.17, paint2, 'z'));
    bG.add(at(hub(0.04, 0.19, motorM, 'z', 0.008), 0, 0, 0));

    /* T フランジ */
    const tG = new T.Group(); bG.add(tG);
    tG.add(latheAx([[0, 0], [0.058, 0], [0.058, d.fl * 0.55], [0.052, d.fl * 0.62], [0.05, d.fl - 0.012], [0, d.fl - 0.012]], paint, 'x'));
    tG.add(latheAx([[0, d.fl - 0.012], [0.05, d.fl - 0.012], [0.05, d.fl - 0.002], [0.048, d.fl], [0, d.fl]], steel, 'x'));
    bolts(tG, 0.054, 6, d.fl * 0.58, 0, 0, 'x', 0.005);
    const pin = hub(0.004, 0.012, steel, 'x'); pin.position.set(d.fl + 0.004, 0.03, 0); tG.add(pin);

    const mount = new T.Group();
    mount.position.set(d.fl, 0, 0);
    mount.quaternion.setFromRotationMatrix(RS.TOOL_BASIS);
    tG.add(mount);

    /* ケーブル（姿勢に合わせて形を変える）：旋回部 → 下腕の側面 → 肘の側面 */
    let cable = null;
    const cz = 0.27;
    const anchors = [
      [sG, new T.Vector3(-0.16, 0.34, 0.12)],
      [sG, new T.Vector3(-0.1, d.pivY - 0.02, cz)],
      [lG, new T.Vector3(-0.1, d.la * 0.35, cz)],
      [lG, new T.Vector3(-0.09, d.la * 0.75, cz)],
      [uG, new T.Vector3(-0.14, 0.04, cz - 0.02)],
      [uG, new T.Vector3(-0.2, a3 + 0.02, 0.14)]
    ];
    const tmp = new T.Vector3(), inv = new T.Matrix4();
    let lastL = null, lastU = null;
    function update() {
      // ケーブルは旋回部の座標で作るので、形が変わるのは L・U が動いたときだけ
      if (lastL !== null && Math.abs(lG.rotation.z - lastL) < 0.004 && Math.abs(uG.rotation.z - lastU) < 0.004) return;
      lastL = lG.rotation.z; lastU = uG.rotation.z;
      root.updateMatrixWorld(true);
      inv.copy(sG.matrixWorld).invert();
      const pts = anchors.map(([g, p]) => (g === sG ? p.clone() : g.localToWorld(tmp.copy(p)).applyMatrix4(inv).clone()));
      const g = new T.TubeGeometry(new T.CatmullRomCurve3(pts), 64, 0.02, 14, false);
      if (cable) { cable.geometry.dispose(); cable.geometry = g; }
      else { cable = sh(new T.Mesh(g, cableM)); sG.add(cable); }
    }

    return { root, sG, lG, uG, rG, bG, tG, mount, update, mats };
  };

})(window.RS = window.RS || {});
