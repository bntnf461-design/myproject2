/* =====================================================================
 * robots.js — ロボット機種（システム）定義
 *
 * 安川（YASKAWA）／ファナック（FANUC）の2システムを定義します。
 * 寸法・可動範囲は「汎用の20kg級6軸」を想定した値で、実機の仕様ではありません。
 * 実機に合わせる場合は、このファイルの数値だけを書き換えてください。
 *
 * 寸法の意味（単位 m、ロボット座標：Z上向き）
 *   pivR : 旋回中心(S/J1)から L(J2)軸までの水平距離
 *   pivY : 床から L(J2)軸までの高さ
 *   la   : 下腕長さ（L→U）
 *   a3   : U軸から上腕中心線までのオフセット（上方向）
 *   ua   : 上腕長さ（U軸から手首中心まで、上腕方向。R/B/T 3軸の交点）
 *   fl   : 手首中心からフランジ面までの距離
 *
 * 関節角の符号（両システム共通の向き）
 *   S/J1 + : 上から見て反時計回り
 *   L/J2 + : 下腕が前へ倒れる
 *   U/J3 + : 上腕が上がる
 *   B/J5 + : 手首が下を向く
 *   原点（全軸0）は「下腕が垂直、上腕・ツールが前方水平」。
 *
 * ファナックの J3 は実機と同様に「水平からの角度」（J2/J3 連動）で表します。
 *   内部の相対角 U = J3 + J2
 * ===================================================================== */
(function (RS) {
  'use strict';

  RS.ROBOTS = {
    yaskawa: {
      id: 'yaskawa',
      brand: 'YASKAWA',
      label: '安川電機',
      model: 'MOTOMAN 汎用 20kg級（DX200 想定・寸法はシミュレーション用）',
      controller: 'DX200',
      axes: ['S', 'L', 'U', 'R', 'B', 'T'],
      axisJa: ['旋回', '下腕', '上腕', '手首回転', '手首振り', 'フランジ回転'],
      lim: [[-180, 180], [-90, 150], [-85, 160], [-200, 200], [-130, 130], [-360, 360]],
      vmax: [180, 160, 170, 400, 400, 600],           // 各軸最高速度 deg/s
      dims: { pivR: 0.15, pivY: 0.505, la: 0.76, a3: 0.20, ua: 0.795, fl: 0.10 },
      pulse: null,                                     // 1度あたりのパルス数 [S,L,U,R,B,T]（JBI の PULSE 形式に必要。機種の取扱説明書の値）
      vlMax: 2000,                                     // 直線最高速度 mm/s
      colors: { main: 0x1d5fbf, sub: 0xe9edf2, dark: 0x2b323b },
      home: [0, 0, 0, 0, 90, 0],
      j3abs: false,
      cart: ['X', 'Y', 'Z', 'Rx', 'Ry', 'Rz'],
      coordNames: { joint: '関節', base: '直交', tool: 'ツール' }
    },
    fanuc: {
      id: 'fanuc',
      brand: 'FANUC',
      label: 'ファナック',
      model: 'Mシリーズ 汎用 20kg級（シミュレーション用）',
      axes: ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'],
      axisJa: ['旋回', '下腕', '上腕', '手首回転', '手首振り', 'フランジ回転'],
      lim: [[-170, 170], [-100, 145], [-80, 200], [-200, 200], [-140, 140], [-450, 450]],
      vmax: [195, 175, 180, 360, 360, 550],
      dims: { pivR: 0.15, pivY: 0.525, la: 0.79, a3: 0.15, ua: 0.86, fl: 0.10 },
      vlMax: 2000,
      colors: { main: 0xf2c200, sub: 0xf2c200, dark: 0x2b2b2b },
      home: [0, 0, 0, 0, 90, 0],
      j3abs: true,
      cart: ['X', 'Y', 'Z', 'W', 'P', 'R'],
      coordNames: { joint: 'JOINT', base: 'WORLD', tool: 'TOOL' }
    }
  };

  /* 画面の「機種パラメータ」で変更した値を反映（localStorage に保存） */
  RS.applyRobotOverrides = function (ov) {
    if (!ov) return;
    for (const id of Object.keys(RS.ROBOTS)) {
      const o = ov[id]; if (!o) continue;
      const r = RS.ROBOTS[id];
      if (o.dims) for (const k of Object.keys(r.dims)) if (isFinite(o.dims[k]) && o.dims[k] >= 0) r.dims[k] = +o.dims[k];
      if (Array.isArray(o.lim) && o.lim.length === 6) r.lim = o.lim.map((a, i) => (Array.isArray(a) && a.length === 2 && a.every(isFinite) && a[0] < a[1]) ? [+a[0], +a[1]] : r.lim[i]);
      if (Array.isArray(o.pulse) && o.pulse.length === 6 && o.pulse.every(v => isFinite(v) && v !== 0)) r.pulse = o.pulse.map(Number);
      if (typeof o.model === 'string' && o.model.trim()) r.model = o.model.trim().slice(0, 60);
    }
  };
  RS.ROBOT_DEFAULTS = JSON.parse(JSON.stringify(RS.ROBOTS));

  /* ブランド関節角 → 内部（相対）関節角 */
  RS.toKin = function (robot, q) {
    const k = q.slice();
    if (robot.j3abs) k[2] = q[2] + q[1];
    return k;
  };
  /* 内部（相対）関節角 → ブランド関節角 */
  RS.fromKin = function (robot, k) {
    const q = k.slice();
    if (robot.j3abs) q[2] = k[2] - k[1];
    return q;
  };
  /* 可動範囲チェック：範囲外の軸番号を返す（範囲内なら -1） */
  RS.limitViolation = function (robot, q, tol) {
    tol = tol || 1e-6;
    for (let i = 0; i < 6; i++) {
      if (q[i] < robot.lim[i][0] - tol || q[i] > robot.lim[i][1] + tol) return i;
    }
    return -1;
  };
})(window.RS = window.RS || {});
