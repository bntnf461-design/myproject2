/* =====================================================================
 * cell.js — セル（ロボットの周り）の形。
 *
 * RS.buildCell(T, id, LT) → {
 *   id, name, group,            シーンに足すグループ
 *   FLOOR_Y,                    床の高さ（Three の y。ロボットのベース面＝0）
 *   FENCE {x:[..], z:[..]},     安全柵（Three 座標の内側の範囲）
 *   TABLES [...],               ワークを置ける面（X,Y＝中心 m、w＝X 方向、d＝Y 方向、h＝上面の y、y0＝下端）
 *   OBST [{name, test(p)}],     干渉する物（p は Three ワールド座標）
 *   racks [...], conveyor,      実機ライン用（ラック・コンベア）
 *   view {target, r}            初期の視点
 * }
 *
 * 'line'  実機ライン（利用者の写真から推定）：架台上のロボット、ターンテーブル上の A 型ラック 2 台
 *         （直進・曲進）にガラスが立てかけてあり、吸盤で 1 枚ずつ取ってコンベアに平置き → ライン搬送。
 *         寸法はすべて写真からの推定値（実測値をもらったら RS.LINE の数値を直す）。
 * 'table' 標準：平置きの供給台 → 排出台。
 * 座標：Three（x＝ロボット X、y＝上、z＝−ロボット Y）。単位 m。
 * ===================================================================== */
(function (RS) {
  'use strict';

  /* 実機ラインの配置。ロボット座標（X 前・Y 左、m）。利用者の手書きの配置図による：
   *   ・ロボットの正面（初期の向き X+）にコンベア。ロボットから約 80cm 離れて始まり、ロボットから遠ざかる向き（X+）へ流れる
   *   ・ロボットの左（Y+）に曲進ラック、後ろ（X−）に直進ラック。どちらもロボットから約 80cm（「80cm?」は要確認）
   *   ・ラックの形は写真から：曲進＝A 型（両面）、直進＝パレット型（推定）
   * 円と円の間隔 80cm を、ロボットの架台（半径約 0.4m）とターンテーブル（半径約 0.95m）の縁の間として中心距離にしている。 */
  RS.LINE = {
    floor: -0.6,               // 架台の高さ 600mm（ロボットのベース面から床まで、推定）
    glass: { w: 1.0, h: 0.75, t: 0.004, count: 20 },   // 板ガラス 1000×750×4mm、1 面 20 枚（シミュレーション用）
    racks: [
      { id: 'S', name: '直進ラック（パレット型）', type: 'pallet', X: -2.1, Y: 0, lean: 8, ledge: 0.8 },
      { id: 'C', name: '曲進ラック（A型）', type: 'aframe', X: 0, Y: 2.15, lean: 15, ledge: 0.35 }
    ],
    // コンベア：上流端 (X0,Y0) → 下流端 (X1,Y1) へ流れる（X か Y に平行）。place＝上流端からガラスの中心までの距離。top は床から
    conveyor: { X0: 1.2, Y0: 0, X1: 6.0, Y1: 0, w: 0.95, top: 0.85, place: 0.5 },
    fence: null
  };
  function fenceOf(L) {
    const c = L.conveyor, xs = L.racks.map(r => r.X), ys = L.racks.map(r => r.Y);
    const len = Math.hypot(c.X1 - c.X0, c.Y1 - c.Y0) || 1, px = c.X0 + (c.X1 - c.X0) / len * c.place, py = c.Y0 + (c.Y1 - c.Y0) / len * c.place;
    return { x: [Math.min(-1.3, ...xs), Math.max(1.3, ...xs, px + 0.9)], y: [Math.min(-1.9, ...ys, py - 0.9), Math.max(1.3, ...ys, py + 0.9)] };
  }
  RS.LINE.fence = fenceOf(RS.LINE);

  RS.LINE_DEFAULT = JSON.parse(JSON.stringify(RS.LINE));
  /* 利用者が入れた実測値（mm）で配置を上書きする。{ 'racks.0.X': 0, ... } */
  RS.LINE_FIELDS = [
    ['racks.0.X', '直進ラック 中心 X'], ['racks.0.Y', '直進ラック 中心 Y'],
    ['racks.1.X', '曲進ラック 中心 X'], ['racks.1.Y', '曲進ラック 中心 Y'],
    ['conveyor.X0', 'コンベア 上流端 X'], ['conveyor.Y0', 'コンベア 上流端 Y'], ['conveyor.X1', 'コンベア 下流端 X'], ['conveyor.Y1', 'コンベア 下流端 Y'],
    ['conveyor.place', 'ガラスを置く位置（上流端から）'], ['conveyor.top', 'コンベア上面（床から）'], ['floor', 'ロボットのベース面（床から、マイナス）']
  ];
  const getp = (o, k) => k.split('.').reduce((a, p) => a && a[p], o);
  const setp = (o, k, v) => { const ks = k.split('.'); const last = ks.pop(); const t = ks.reduce((a, p) => a[p], o); t[last] = v; };
  RS.lineValues = () => Object.fromEntries(RS.LINE_FIELDS.map(([k]) => [k, Math.round(getp(RS.LINE, k) * 1000)]));
  RS.setLine = function (vals) {
    const L = RS.LINE;
    for (const [k] of RS.LINE_FIELDS) {
      const v = vals && vals[k];
      if (typeof v !== 'number' || !isFinite(v) || Math.abs(v) > 8000) continue;
      setp(L, k, v / 1000);
    }
    const c = L.conveyor;
    // X か Y に平行にそろえる（長い方の向き）。長さは 1m 以上
    if (Math.abs(c.X1 - c.X0) >= Math.abs(c.Y1 - c.Y0)) c.Y1 = c.Y0; else c.X1 = c.X0;
    let len = Math.hypot(c.X1 - c.X0, c.Y1 - c.Y0);
    if (len < 1) { if (c.X1 !== c.X0 || c.Y1 === c.Y0) c.X1 = c.X0 + (c.X1 >= c.X0 ? 1 : -1); else c.Y1 = c.Y0 + (c.Y1 >= c.Y0 ? 1 : -1); len = 1; }
    c.place = Math.min(Math.max(c.place, 0.5), len - 0.5);
    if (L.floor > -0.1) L.floor = -0.1;
    L.fence = fenceOf(L);   // 柵は配置に合わせて広げる
  };
  RS.resetLine = function () { Object.assign(RS.LINE, JSON.parse(JSON.stringify(RS.LINE_DEFAULT))); };

  function helpers(T, group) {
    const sh = m => { m.castShadow = true; m.receiveShadow = true; return m; };
    const box = (w, h, d, mat, x, y, z, parent) => { const m = sh(new T.Mesh(new T.BoxGeometry(w, h, d), mat)); m.position.set(x, y, z); (parent || group).add(m); return m; };
    const cyl = (r, h, mat, x, y, z, parent, seg) => { const m = sh(new T.Mesh(new T.CylinderGeometry(r, r, h, seg || 24), mat)); m.position.set(x, y, z); (parent || group).add(m); return m; };
    return { sh, box, cyl };
  }
  /* 2 点を結ぶ角材 */
  function beam(T, mat, a, b, s, parent) {
    const d = new T.Vector3().subVectors(b, a), L = d.length();
    const m = new T.Mesh(new T.BoxGeometry(s, L, s), mat);
    m.castShadow = m.receiveShadow = true;
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
    parent.add(m); return m;
  }
  function canvasTex(T, w, h, draw, rx, ry, srgb) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx || 1, ry || 1); t.anisotropy = 4;
    if (srgb) t.encoding = T.sRGBEncoding;
    return t;
  }
  /* 看板（文字入り） */
  function sign(T, text, w, h, bg, fg, size) {
    const t = canvasTex(T, 512, Math.round(512 * h / w), (c, W, H) => {
      c.fillStyle = bg; c.fillRect(0, 0, W, H); c.strokeStyle = fg; c.lineWidth = 6; c.strokeRect(8, 8, W - 16, H - 16);
      c.fillStyle = fg; c.font = `bold ${size || 64}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      const lines = text.split('\n'); lines.forEach((l, i) => c.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * (size || 64) * 1.25));
    }, 1, 1, true);
    t.wrapS = t.wrapT = T.ClampToEdgeWrapping;
    return new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshStandardMaterial({ map: t, roughness: 0.5 }));
  }

  /* ---------------- 標準セル（平置きの台 2 つ） ---------------- */
  function buildTable(T, LT) {
    const group = new T.Group(); group.name = 'cell-table';
    const { box, cyl } = helpers(T, group);
    const TABLES = [
      { id: 'A', name: '供給台', X: 0.95, Y: 0.75, w: 0.8, d: 0.6, h: 0.45, y0: 0 },
      { id: 'B', name: '排出台', X: 0.95, Y: -0.75, w: 0.8, d: 0.6, h: 0.45, y0: 0 }
    ];
    const FENCE = { x: [-1.1, 2.0], z: [-1.6, 1.6] };
    const mFrame = new T.MeshStandardMaterial({ color: 0xc4c9cf, roughness: 0.4, metalness: 0.85, roughnessMap: LT.brushR || null });
    const mTop = new T.MeshStandardMaterial({ color: 0xffffff, map: LT.top || null, roughness: 0.55, metalness: 0.05 });
    const mFoot = new T.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.8, metalness: 0.2 });
    const mMark = { A: new T.MeshBasicMaterial({ color: 0x1d9a5b }), B: new T.MeshBasicMaterial({ color: 0xd2691e }) };
    for (const t of TABLES) {
      const g = new T.Group(); g.position.set(t.X, 0, -t.Y); group.add(g);
      box(t.w, 0.025, t.d, mTop, 0, t.h - 0.0125, 0, g);
      box(t.w - 0.04, 0.05, t.d - 0.04, mFrame, 0, t.h - 0.05, 0, g);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        box(0.04, t.h - 0.05, 0.04, mFrame, sx * (t.w / 2 - 0.04), (t.h - 0.05) / 2, sz * (t.d / 2 - 0.04), g);
        cyl(0.031, 0.014, mFoot, sx * (t.w / 2 - 0.04), 0.007, sz * (t.d / 2 - 0.04), g);
        cyl(0.008, 0.03, mFrame, sx * (t.w / 2 - 0.04), 0.028, sz * (t.d / 2 - 0.04), g, 12);
      }
      box(t.w - 0.1, 0.03, 0.03, mFrame, 0, 0.12, t.d / 2 - 0.04, g);
      box(t.w - 0.1, 0.03, 0.03, mFrame, 0, 0.12, -t.d / 2 + 0.04, g);
      const mk = new T.Mesh(new T.PlaneGeometry(t.w, 0.03), mMark[t.id]);
      mk.rotation.x = -Math.PI / 2; mk.position.set(0, t.h + 0.0005, t.d / 2 - 0.015); g.add(mk);
    }
    /* 安全柵（金網） */
    const mPost = new T.MeshPhysicalMaterial({ color: 0xe8b80e, roughness: 0.42, metalness: 0.1, clearcoat: 0.4, clearcoatRoughness: 0.4 });
    const H = 1.4, xs = FENCE.x, zs = FENCE.z;
    const netMat = len => {
      const t = LT.mesh ? LT.mesh.clone() : null;
      if (t) { t.needsUpdate = true; t.repeat.set(len / 0.1, (H - 0.2) / 0.1); }
      return t ? new T.MeshStandardMaterial({ color: 0x45494e, alphaMap: t, alphaTest: 0.02, alphaToCoverage: true, side: T.DoubleSide, roughness: 0.5, metalness: 0.6 })
        : new T.MeshBasicMaterial({ color: 0x9aa4b0, transparent: true, opacity: 0.12, side: T.DoubleSide, depthWrite: false });
    };
    [[xs[0], zs[0]], [xs[1], zs[0]], [xs[1], zs[1]], [xs[0], zs[1]]].forEach(([x, z]) => {
      box(0.06, H, 0.06, mPost, x, H / 2, z);
      box(0.16, 0.008, 0.16, mPost, x, 0.004, z);
    });
    // ロボットの据付板（アンカーボルト付き）
    box(0.86, 0.02, 0.86, new T.MeshStandardMaterial({ color: 0x4a4e53, roughness: 0.55, metalness: 0.75, roughnessMap: LT.brushR || null }), 0, 0.01, 0);
    for (const dx of [-0.37, 0.37]) for (const dz of [-0.37, 0.37]) cyl(0.016, 0.03, mFrame, dx, 0.02, dz, null, 6);
    [[xs[0], 0, true, zs[1] - zs[0]], [xs[1], 0, true, zs[1] - zs[0]], [(xs[0] + xs[1]) / 2, zs[0], false, xs[1] - xs[0]], [(xs[0] + xs[1]) / 2, zs[1], false, xs[1] - xs[0]]].forEach(([x, z, side, len]) => {
      const nm = netMat(len);
      const p = new T.Mesh(new T.PlaneGeometry(len, H - 0.2), nm);
      p.position.set(x, 0.1 + (H - 0.2) / 2, z);
      if (side) p.rotation.y = Math.PI / 2;
      if (nm.alphaMap) { p.castShadow = true; p.customDepthMaterial = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, alphaMap: nm.alphaMap, alphaTest: 0.5 }); }
      p.userData.noAO = true;
      group.add(p);
      box(side ? 0.03 : len, 0.03, side ? len : 0.03, mPost, x, 0.1, z);
      box(side ? 0.03 : len, 0.03, side ? len : 0.03, mPost, x, H - 0.05, z);
      if (LT.hazard) {
        const ht = LT.hazard.clone(); ht.needsUpdate = true; ht.repeat.set(len / 0.4, 1);
        const tp = new T.Mesh(new T.PlaneGeometry(len, 0.05), new T.MeshStandardMaterial({ map: ht, roughness: 0.6 }));
        tp.rotation.set(-Math.PI / 2, 0, side ? Math.PI / 2 : 0);
        const out = side ? (x < 0.5 ? -0.12 : 0.12) : (z < 0 ? -0.12 : 0.12);
        tp.position.set(side ? x + out : x, 0.0025, side ? z : z + out); tp.receiveShadow = true;
        group.add(tp);
      }
    });
    return { id: 'table', name: '標準（平置きの台 → 台）', group, FLOOR_Y: 0, FENCE, TABLES, OBST: [], racks: [], conveyor: null, view: { target: [0.5, 0.6, 0], r: 4.3 } };
  }

  /* ---------------- 実機ライン（ラック → コンベア） ---------------- */
  function buildLine(T, LT) {
    const L = RS.LINE, F = L.floor;
    const group = new T.Group(); group.name = 'cell-line';
    const { box, cyl } = helpers(T, group);
    const OBST = [];

    /* マテリアル（色は写真から） */
    const blue = new T.MeshStandardMaterial({ color: 0x2c66b8, roughness: 0.5, metalness: 0.25 });
    const lightBlue = new T.MeshStandardMaterial({ color: 0x8fc3d6, roughness: 0.55, metalness: 0.2 });
    const green = new T.MeshStandardMaterial({ color: 0x2f8a6b, roughness: 0.75, metalness: 0.05 });
    const yellowAlu = new T.MeshStandardMaterial({ color: 0xf0c21a, roughness: 0.4, metalness: 0.35 });
    const yellowP = new T.MeshStandardMaterial({ color: 0xe9c21c, roughness: 0.5, metalness: 0.2 });
    const steel = new T.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.45, metalness: 0.8, roughnessMap: LT.brushR || null });
    const dark = new T.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6, metalness: 0.5 });
    const gray = new T.MeshStandardMaterial({ color: 0xc9c6bd, roughness: 0.6, metalness: 0.1 });
    const wood = new T.MeshStandardMaterial({ color: 0x5b4a36, roughness: 0.85 });
    const poly = new T.MeshPhysicalMaterial({ color: 0xe6eef2, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false, side: T.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.4 });
    poly.userData.noAO = true;
    const curtainM = new T.MeshBasicMaterial({ color: new T.Color(0.25, 2.6, 0.55) }); curtainM.userData.linear = true;
    const lensOff = c => new T.MeshStandardMaterial({ color: c, roughness: 0.3, transparent: true, opacity: 0.85 });
    const floorRed = new T.MeshStandardMaterial({ color: 0xc8412b, roughness: 0.45, metalness: 0 });
    const floorBlue = new T.MeshStandardMaterial({ color: 0x2a6fc0, roughness: 0.45, metalness: 0 });
    const greenFloor = new T.MeshStandardMaterial({ color: 0x3e7a5f, roughness: 0.45 });
    const whiteM = new T.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.5 });
    const plane = (w, d, mat, x, z, y) => { const m = new T.Mesh(new T.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, F + (y || 0.001), z); m.receiveShadow = true; group.add(m); return m; };

    const Fx = L.fence.x, Fz = [-L.fence.y[1], -L.fence.y[0]], H = 2.0;
    const FENCE = { x: Fx, z: Fz, open: [] };

    /* 床：ラックの外側（作業者がラックを入れ替える側）は赤、ロボットの右側（Y−、柵の外）は青の通路 */
    for (const r of L.racks) {
      const ox = r.X, oz = -r.Y, nx = Math.abs(ox) >= Math.abs(oz) ? Math.sign(ox) : 0, nz = nx ? 0 : Math.sign(oz);
      plane(nx ? 2.4 : 3.2, nx ? 3.2 : 2.4, floorRed, ox + nx * 1.3, oz + nz * 1.3);
    }
    plane(Fx[1] - Fx[0] + 1.0, 1.6, floorBlue, (Fx[0] + Fx[1]) / 2, Fz[1] + 0.9);

    /* ロボットの架台と点検床（グレーチング、縁は黄色の滑り止め） */
    const grate = canvasTex(T, 128, 128, (c, w, h) => {
      c.fillStyle = '#7d8590'; c.fillRect(0, 0, w, h); c.fillStyle = '#2b2f35';
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) c.fillRect(x * 32 + 8, y * 32 + 6, 16, 20);
    }, 14, 14, true);
    const deckM = new T.MeshStandardMaterial({ map: grate, roughness: 0.6, metalness: 0.6 });
    const dx0 = -1.0, dx1 = Math.min(1.0, Math.max(L.conveyor.X0, 0.6) - 0.05), dz0 = -1.0, dz1 = 1.0;
    box(dx1 - dx0, 0.12, dz1 - dz0, deckM, (dx0 + dx1) / 2, F + 0.06, (dz0 + dz1) / 2);
    const edge = canvasTex(T, 128, 32, (c, w, h) => { c.fillStyle = '#d8b21c'; c.fillRect(0, 0, w, h); c.fillStyle = '#5a4a10'; for (let x = 0; x < w; x += 16) c.fillRect(x + 4, 8, 8, 16); }, 20, 1, true);
    const edgeM = new T.MeshStandardMaterial({ map: edge, roughness: 0.6, metalness: 0.4 });
    box(0.08, 0.005, dz1 - dz0, edgeM, dx0 + 0.04, F + 0.123, (dz0 + dz1) / 2);
    box(0.08, 0.005, dz1 - dz0, edgeM, dx1 - 0.04, F + 0.123, (dz0 + dz1) / 2);
    box(dx1 - dx0, 0.005, 0.08, edgeM, (dx0 + dx1) / 2, F + 0.123, dz0 + 0.04);
    box(dx1 - dx0, 0.005, 0.08, edgeM, (dx0 + dx1) / 2, F + 0.123, dz1 - 0.04);
    // 架台（水色の箱）＋接続箱
    box(0.9, -F - 0.12, 0.9, lightBlue, 0, (F + 0.12) / 2, 0);
    box(1.0, 0.03, 1.0, lightBlue, 0, -0.015, 0);
    box(0.32, 0.28, 0.12, gray, -0.1, F + 0.35, 0.51);
    for (const dx of [-0.17, -0.03]) cyl(0.03, 0.06, dark, dx, F + 0.35, 0.6, null, 16).rotation.x = Math.PI / 2;
    OBST.push({ name: '架台', test: p => Math.abs(p.x) < 0.5 && Math.abs(p.z) < 0.5 && p.y < -0.005 && p.y > F });

    /* ターンテーブル＋ラック（A 型・パレット型。どちらも両面で、半回転して外で補充した面をロボット側へ） */
    const G = L.glass, racks = [];
    for (const def of L.racks) {
      const a = (def.lean != null ? def.lean : 15) * Math.PI / 180, h0 = def.ledge != null ? def.ledge : 0.35;
      const pallet = def.type === 'pallet', b0 = pallet ? 0.15 : 0.26;
      const tt = new T.Group();
      const dx = -def.X, dz = def.Y, len = Math.hypot(dx, dz) || 1;
      tt.position.set(def.X, F, -def.Y);
      const yaw = Math.atan2(-dz / len, dx / len);
      tt.rotation.y = yaw;
      group.add(tt);
      // 床：緑の円と白い破線
      const disc = new T.Mesh(new T.CircleGeometry(1.15, 64), greenFloor); disc.rotation.x = -Math.PI / 2; disc.position.set(def.X, F + 0.002, -def.Y); disc.receiveShadow = true; group.add(disc);
      for (let k = 0; k < 28; k++) { const th = k / 28 * Math.PI * 2; const m = new T.Mesh(new T.PlaneGeometry(0.16, 0.05), whiteM); m.rotation.set(-Math.PI / 2, 0, th + Math.PI / 2); m.position.set(def.X + Math.cos(th) * 1.15, F + 0.003, -def.Y + Math.sin(th) * 1.15); group.add(m); }
      const rot = new T.Group(); tt.add(rot);
      cyl(0.95, 0.05, dark, 0, 0.025, 0, rot, 64);
      box(0.3, 0.06, 1.9, blue, 0, 0.08, 0, rot); box(1.9, 0.06, 0.3, blue, 0, 0.08, 0, rot);
      const faces = [];
      if (pallet) {
        // パレット型：高い青の架台の上にパレット、ガラスは背もたれにほぼ垂直に立てかける
        box(1.2, 0.08, 1.5, blue, 0, 0.16, 0, rot);
        for (const sx of [-0.55, 0.55]) for (const sz of [-0.7, 0.7]) box(0.07, h0 - 0.2, 0.07, blue, sx, 0.2 + (h0 - 0.2) / 2 - 0.06, sz, rot);
        box(1.2, 0.06, 1.5, blue, 0, h0 - 0.15, 0, rot);
        for (const s of [1, -1]) { box(0.5, 0.1, 1.3, wood, s * (b0 + 0.25), h0 - 0.06, 0, rot); for (const z of [-0.5, 0, 0.5]) box(0.5, 0.06, 0.1, green, s * (b0 + 0.25), h0 - 0.13, z, rot); }
      } else {
        box(1.2, 0.1, 1.5, blue, 0, 0.16, 0, rot);
      }
      for (const s of [1, -1]) {
        const n = new T.Vector3(s * Math.cos(a), Math.sin(a), 0);          // 面の法線（ロボット側＝+x が s=1）
        const d = new T.Vector3(-s * Math.sin(a), Math.cos(a), 0);         // 面に沿って上向き
        const B = new T.Vector3(s * b0, h0, 0);                            // ガラス下辺の奥（受けの付け根）
        if (!pallet) {
          box(0.26, 0.05, 1.3, green, s * (b0 + 0.13), h0 - 0.025, 0, rot);
          box(0.06, h0 - 0.21, 0.06, blue, s * (b0 + 0.23), (h0 + 0.21) / 2 - 0.025, 0.6, rot); box(0.06, h0 - 0.21, 0.06, blue, s * (b0 + 0.23), (h0 + 0.21) / 2 - 0.025, -0.6, rot);
        }
        // 背もたれ（青い柱＋緑の当て板）
        const back = pallet ? 0.95 : 1.0;
        for (const z of [-0.55, 0.55, 0]) {
          const p0 = B.clone().add(new T.Vector3(0, 0, z)).addScaledVector(n, -0.04), p1 = p0.clone().addScaledVector(d, back);
          beam(T, z ? blue : green, p0, p1, z ? 0.07 : 0.05, rot);
        }
        for (const t of [0.2, 0.62]) { const p = B.clone().addScaledVector(d, t).addScaledVector(n, -0.01); const m = box(0.02, 0.08, 1.25, green, p.x, p.y, 0, rot); m.rotation.z = s * a; }
        faces.push({ s, n, d, B, count: 0, front: null, stack: null });
      }
      // 上の梁と表示
      const topY = h0 + (pallet ? 1.0 : 0.95);
      for (const z of [-0.65, 0.65]) box(0.08, topY - 0.16, 0.08, blue, 0, 0.16 + (topY - 0.16) / 2, z, rot);
      box(pallet ? 0.6 : 0.08, 0.08, 1.4, blue, 0, topY, 0, rot);
      if (!pallet) for (const z of [-0.65, 0.65]) box(0.085, 0.25, 0.085, yellowP, 0, h0 + 0.4, z, rot);
      for (const s of [1, -1]) { const lb = sign(T, s > 0 ? 'A' : 'B', 0.16, 0.12, '#2f6fc0', '#ffffff', 80); lb.position.set(s * (pallet ? 0.31 : 0.045), topY - 0.15, 0); lb.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2; rot.add(lb); }
      // 「テーブル回転中 立入禁止」の床表示（外側）
      const st = sign(T, 'テーブル回転中\n立入禁止', 0.5, 0.3, '#f2d21a', '#c0201a', 54); st.rotation.x = -Math.PI / 2; st.rotation.z = -yaw - Math.PI / 2;
      st.position.set(def.X - dx / len * 1.35, F + 0.004, -def.Y - dz / len * 1.35); group.add(st);
      const rack = { id: def.id, name: def.name, def, tt, rot, faces, inside: 0, rotating: 0, rotFrom: 0, lean: a, ledge: h0 };
      // 干渉：両面の背もたれの奥（ラックの中）と、受けより下
      rack.test = p => {
        const q = rot.worldToLocal(p.clone());
        if (Math.abs(q.z) > 0.72 || q.y < 0 || q.y > topY + 0.05) return false;
        if (q.y < h0 && Math.abs(q.x) < b0 + 0.3) return true;
        return faces.every(f => q.clone().sub(f.B).dot(f.n) < -0.006);
      };
      OBST.push({ name: def.name, test: p => rack.test(p) });
      racks.push(rack);
    }

    /* コンベア（黄色の枠＋ローラー。上流端 → 下流端の向きへ流す） */
    const C = L.conveyor, cTop = F + C.top;
    const p0 = new T.Vector3(C.X0, 0, -C.Y0), p1 = new T.Vector3(C.X1, 0, -C.Y1);
    const cl = p0.distanceTo(p1), u = p1.clone().sub(p0).normalize(), mid = p0.clone().add(p1).multiplyScalar(0.5);
    const cg = new T.Group(); cg.position.set(mid.x, 0, mid.z); cg.rotation.y = Math.atan2(u.x, u.z); group.add(cg);   // ローカル +z ＝ 流れの向き
    const rollT = canvasTex(T, 64, 64, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#3b3f44'); g.addColorStop(0.5, '#b9bec4'); g.addColorStop(0.85, '#6c7178'); g.addColorStop(1, '#1d1f22');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }, 1, cl / 0.1, true);
    const beltM = new T.MeshStandardMaterial({ map: rollT, roughness: 0.4, metalness: 0.7 });
    const belt = new T.Mesh(new T.PlaneGeometry(C.w - 0.08, cl), beltM); belt.rotation.x = -Math.PI / 2; belt.position.set(0, cTop - 0.004, 0); belt.receiveShadow = true; cg.add(belt);
    for (const s2 of [-1, 1]) box(0.05, 0.12, cl, yellowP, s2 * C.w / 2, cTop - 0.05, 0, cg);
    for (let z = -cl / 2 + 0.2; z < cl / 2; z += 1.0) { for (const s2 of [-1, 1]) box(0.07, C.top - 0.1, 0.07, lightBlue, s2 * (C.w / 2 - 0.05), F + (C.top - 0.1) / 2, z, cg); box(C.w, 0.06, 0.06, lightBlue, 0, F + 0.15, z, cg); }
    box(0.25, 0.25, 0.3, dark, C.w / 2 + 0.12, cTop - 0.3, cl / 2 - 0.4, cg);   // 駆動モーター（下流側）
    // 柵を出る所の黄色いカバー（「安全柵内に手を入れないで下さい」）
    const exitT = (() => {   // 下流側で柵の線を越える位置（上流端からの距離）
      const xs = [Fx[0], Fx[1]], zs = [Fz[0], Fz[1]]; let best = null;
      for (let k = 0; k < 2; k++) {
        if (Math.abs(u.x) > 1e-6) { const t = (xs[k] - p0.x) / u.x; if (t > 0 && t < cl && (best == null || t < best)) best = t; }
        if (Math.abs(u.z) > 1e-6) { const t = (zs[k] - p0.z) / u.z; if (t > 0 && t < cl && (best == null || t < best)) best = t; }
      }
      return best;
    })();
    if (exitT != null) {
      const zc = -cl / 2 + exitT + 0.35;
      box(C.w + 0.1, 0.35, 0.6, yellowP, 0, cTop + 0.12, zc, cg);
      const lb = sign(T, '安全柵内に\n手を入れないで下さい', 0.5, 0.18, '#f2d21a', '#c0201a', 40); lb.position.set(C.w / 2 + 0.056, cTop + 0.12, zc); lb.rotation.y = Math.PI / 2; cg.add(lb);
    }
    const place = p0.clone().addScaledVector(u, C.place);
    const conveyor = { p0, p1, u, len: cl, w: C.w, h: cTop, place, placeD: C.place, axis: Math.abs(u.x) > 0.5 ? 'x' : 'y', tex: rollT, running: 0 };
    const TABLES = [{ id: 'C', name: 'コンベア', X: mid.x, Y: -mid.z, w: conveyor.axis === 'x' ? cl : C.w, d: conveyor.axis === 'x' ? C.w : cl, h: cTop, y0: F, conveyor: true }];

    /* 安全柵：黄色のアルミフレーム＋透明の樹脂板。ラック・コンベアの出入口は開口（ライトカーテン） */
    // 開口：各辺ごとの区間を集める。辺 x0/x1 は z の区間、辺 z0/z1 は x の区間
    const opens = { x0: [], x1: [], z0: [], z1: [] };
    const sideOf = (x, z) => {
      const ds = [['x0', Math.abs(x - Fx[0])], ['x1', Math.abs(x - Fx[1])], ['z0', Math.abs(z - Fz[0])], ['z1', Math.abs(z - Fz[1])]];
      ds.sort((p, q) => p[1] - q[1]); return ds[0][0];
    };
    const addOpen = (side, a0, a1, outward, curtainOn) => {
      opens[side].push([a0, a1, curtainOn]);
      const k = side[0], v = side === 'x0' ? Fx[0] : side === 'x1' ? Fx[1] : side === 'z0' ? Fz[0] : Fz[1], sgn = side.endsWith('0') ? -1 : 1;
      const span = [Math.min(v - sgn * 0.1, v + sgn * outward), Math.max(v - sgn * 0.1, v + sgn * outward)];
      FENCE.open.push(k === 'x' ? { x: span, z: [a0, a1] } : { x: [a0, a1], z: span });
    };
    for (const r of racks) { const x = r.def.X, z = -r.def.Y, sd = sideOf(x, z); if (sd[0] === 'x') addOpen(sd, z - 1.0, z + 1.0, 0.8, true); else addOpen(sd, x - 1.0, x + 1.0, 0.8, true); }
    for (const pe of [p0, p1]) {
      const hw = C.w / 2 + 0.05;
      if (conveyor.axis === 'x') {
        if (pe.x > Fx[1] + 0.01) addOpen('x1', pe.z - hw, pe.z + hw, pe.x - Fx[1] + 0.2, false);
        if (pe.x < Fx[0] - 0.01) addOpen('x0', pe.z - hw, pe.z + hw, Fx[0] - pe.x + 0.2, false);
      } else {
        if (pe.z > Fz[1] + 0.01) addOpen('z1', pe.x - hw, pe.x + hw, pe.z - Fz[1] + 0.2, false);
        if (pe.z < Fz[0] - 0.01) addOpen('z0', pe.x - hw, pe.x + hw, Fz[0] - pe.z + 0.2, false);
      }
    }
    const panelRun = (q0, q1) => {
      const d = new T.Vector3().subVectors(q1, q0), Lx = d.length(); if (Lx < 0.08) return;
      const n = Math.max(1, Math.round(Lx / 1.0)), step = Lx / n, uu = d.clone().normalize();
      const yaw = Math.atan2(-uu.z, uu.x);
      for (let i = 0; i <= n; i++) { const p = q0.clone().addScaledVector(uu, i * step); box(0.045, H, 0.045, yellowAlu, p.x, F + H / 2, p.z); box(0.12, 0.01, 0.12, steel, p.x, F + 0.005, p.z); }
      for (const y of [0.1, 1.0, H - 0.03]) { const m = box(Lx, 0.04, 0.04, yellowAlu, (q0.x + q1.x) / 2, F + y, (q0.z + q1.z) / 2); m.rotation.y = yaw; }
      for (const [y0, y1] of [[0.12, 0.98], [1.02, H - 0.05]]) {
        const m = new T.Mesh(new T.PlaneGeometry(Lx - 0.02, y1 - y0), poly);
        m.position.set((q0.x + q1.x) / 2, F + (y0 + y1) / 2, (q0.z + q1.z) / 2); m.rotation.y = yaw; group.add(m);
      }
    };
    const curtain = (x, z) => { box(0.05, 1.7, 0.05, dark, x, F + 0.95, z); const m = new T.Mesh(new T.BoxGeometry(0.012, 1.55, 0.012), curtainM); m.position.set(x, F + 0.95, z); group.add(m); };
    const V = (x, z) => new T.Vector3(x, 0, z);
    for (const side of ['x0', 'x1', 'z0', 'z1']) {
      const along = side[0] === 'x' ? Fz : Fx, fixed = side === 'x0' ? Fx[0] : side === 'x1' ? Fx[1] : side === 'z0' ? Fz[0] : Fz[1];
      const P = t => side[0] === 'x' ? V(fixed, t) : V(t, fixed);
      const ivs = opens[side].map(([a0, a1, c]) => [Math.max(along[0], a0), Math.min(along[1], a1), c]).filter(v => v[1] > v[0]).sort((p, q) => p[0] - q[0]);
      let t = along[0];
      for (const [a0, a1, c] of ivs) {
        if (a0 > t) panelRun(P(t), P(a0));
        if (c) { const q0 = P(a0), q1 = P(a1); curtain(q0.x, q0.z); curtain(q1.x, q1.z); const m = box(side[0] === 'x' ? 0.04 : a1 - a0, 0.04, side[0] === 'x' ? a1 - a0 : 0.04, yellowAlu, (q0.x + q1.x) / 2, F + H - 0.03, (q0.z + q1.z) / 2); void m; }
        t = Math.max(t, a1);
      }
      if (t < along[1]) panelRun(P(t), P(along[1]));
    }

    /* 信号灯（赤・黄・緑）と操作箱、ペンダント掛け、看板 */
    const tower = new T.Group(); tower.position.set(Fx[0] - 0.3, F, Fz[1] + 0.3); group.add(tower);
    cyl(0.025, 2.3, steel, 0, 1.15, 0, tower, 12);
    const towerLamps = {};
    [['red', 0xc0302a], ['yellow', 0xe0a020], ['green', 0x2e9a4a]].forEach(([k, c], i) => { towerLamps[k] = cyl(0.05, 0.11, lensOff(c), 0, 2.62 - i * 0.12, 0, tower, 20); });
    cyl(0.05, 0.08, new T.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4 }), 0, 2.33, 0, tower, 20);
    const opBox = (x, z, ry) => {
      const g = new T.Group(); g.position.set(x, F + 1.15, z); g.rotation.y = ry; group.add(g);
      box(0.11, 0.42, 0.08, new T.MeshStandardMaterial({ color: 0xe2ded2, roughness: 0.5 }), 0, 0, 0, g);
      [[0xf2f2f2, 0.13], [0x2ea05a, 0.04], [0xe0a020, -0.05]].forEach(([c, y]) => { const m = cyl(0.022, 0.02, new T.MeshStandardMaterial({ color: c, roughness: 0.3, emissive: c, emissiveIntensity: 0.25 }), 0, y, 0.05, g, 16); m.rotation.x = Math.PI / 2; });
      const es = cyl(0.03, 0.03, new T.MeshStandardMaterial({ color: 0xc0201a, roughness: 0.4 }), 0, -0.14, 0.055, g, 20); es.rotation.x = Math.PI / 2;
      const ring = cyl(0.042, 0.006, new T.MeshStandardMaterial({ color: 0xf0c21a, roughness: 0.5 }), 0, -0.14, 0.042, g, 24); ring.rotation.x = Math.PI / 2;
    };
    for (const r of racks) {
      const x = r.def.X, z = -r.def.Y, sd = sideOf(x, z);
      if (sd[0] === 'x') { const out = sd === 'x0' ? -1 : 1; opBox((sd === 'x0' ? Fx[0] : Fx[1]) + out * 0.06, z + 1.15, out < 0 ? -Math.PI / 2 : Math.PI / 2); }
      else { const out = sd === 'z0' ? -1 : 1; opBox(x + 1.15, (sd === 'z0' ? Fz[0] : Fz[1]) + out * 0.06, out < 0 ? Math.PI : 0); }
    }
    // 右側（Y−、青い通路側）の柵に掛けてあるペンダントと看板
    { const g = new T.Group(); g.position.set(-0.35, F + 1.15, Fz[1] + 0.05); group.add(g);
      box(0.2, 0.3, 0.06, new T.MeshStandardMaterial({ color: 0x9c9fa3, roughness: 0.55 }), 0, 0, 0, g);
      box(0.13, 0.09, 0.005, new T.MeshStandardMaterial({ color: 0x6f8fb0, roughness: 0.2, emissive: 0x203040 }), 0, 0.07, 0.032, g);
      const es = cyl(0.018, 0.02, new T.MeshStandardMaterial({ color: 0xc0201a }), 0.07, 0.13, 0.03, g, 16); es.rotation.x = Math.PI / 2; }
    { const sg = sign(T, '選任者以外\n立入禁止', 0.3, 0.24, '#f2d21a', '#c0201a', 72); sg.position.set(0.3, F + 1.6, Fz[1] + 0.03); group.add(sg); }
    { const sg = sign(T, '段差有り\n足元注意', 0.36, 0.2, '#f2d21a', '#c0201a', 60); sg.rotation.x = -Math.PI / 2; sg.position.set(0, F + 0.004, Fz[1] + 0.45); group.add(sg); }

    group.traverse(o => { if (o.isMesh && o.material === poly) o.castShadow = false; });
    const update = (dt, st) => {
      // 信号灯：赤＝アラーム、黄＝停止中・待ち、緑＝自動運転中
      const on = { red: st.alarm, yellow: !st.alarm && !st.running, green: st.running && !st.alarm };
      for (const k in towerLamps) {
        const m = towerLamps[k].material;
        if (!m.userData.base) m.userData.base = m.color.clone();
        if (on[k]) { m.emissive = m.userData.base.clone().multiplyScalar(3); m.opacity = 1; } else { m.emissive = new T.Color(0, 0, 0); m.opacity = 0.75; }
      }
    };
    return {
      id: 'line', name: '実機ライン（縦置きラック → コンベア）', group, FLOOR_Y: F, FENCE, TABLES, OBST, racks, conveyor, update,
      glassDef: { w: G.w, h: G.h, t: G.t, count: G.count },
      view: { target: [0.3, -0.1, -0.3], r: 6.8, theta: 0.25 }   // 右側（Y−、青い通路）からセル全体を見る
    };
  }

  RS.CELLS = [['line', '実機ライン（縦置きラック → コンベア）'], ['table', '標準（平置きの台 → 台）']];
  RS.buildCell = function (T, id, LT) { return id === 'table' ? buildTable(T, LT || {}) : buildLine(T, LT || {}); };
})(window.RS = window.RS || {});
