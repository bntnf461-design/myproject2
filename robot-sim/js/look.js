/* =====================================================================
 * look.js — 実写に近づける描画（色管理・質感テクスチャ・工場の建屋・後処理）
 *
 * RS.makeLook(T, renderer, scene, camera) → {
 *   hall, tex, linearize(root), render(now), setSize(w,h), setQuality(q), quality(), mode(), onAutoDrop, onChange
 * }
 * - 色はすべて sRGB の 16 進で書いてよい（描画前に linearize() が線形に直す）。
 *   すでに線形の値を入れたマテリアルは userData.linear = true にしておく。
 * - 画質 'high'：環境遮蔽（SSAO）＋MSAA（または FXAA）＋周辺減光・粒子感。'std'：直接描画。
 *   'low'：直接描画・画素を粗く・影を小さく（app.js の onChange で設定）。
 *   'auto'：high で始め、描画が重い PC では std → low と自動で落とす。
 * - テクスチャはすべてプログラムで生成（外部ファイルなし、file:// で動く）。
 * 依存：vendor/three.min.js（r128）、vendor/three-addons.js（EffectComposer・SSAOPass など）
 * ===================================================================== */
(function (RS) {
  'use strict';

  /* ---------- 乱数・ノイズ ---------- */
  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
  const sm = t => t * t * (3 - 2 * t);
  /* 繰り返し可能な fBm ノイズ（n×n、0..1） */
  function fbm(n, oct, seed, base, gain) {
    const r = rng(seed), out = new Float32Array(n * n);
    let amp = 1, sum = 0;
    for (let o = 0; o < oct; o++) {
      const g = (base || 4) << o; if (g > n) break;
      const v = new Float32Array(g * g); for (let i = 0; i < v.length; i++) v[i] = r();
      const s = n / g;
      for (let y = 0; y < n; y++) {
        const fy = y / s, iy = Math.floor(fy), y0 = iy % g, y1 = (iy + 1) % g, ty = sm(fy - iy);
        for (let x = 0; x < n; x++) {
          const fx = x / s, ix = Math.floor(fx), x0 = ix % g, x1 = (ix + 1) % g, tx = sm(fx - ix);
          const a = v[y0 * g + x0] + (v[y0 * g + x1] - v[y0 * g + x0]) * tx;
          const b = v[y1 * g + x0] + (v[y1 * g + x1] - v[y1 * g + x0]) * tx;
          out[y * n + x] += amp * (a + (b - a) * ty);
        }
      }
      sum += amp; amp *= gain || 0.55;
    }
    for (let i = 0; i < out.length; i++) out[i] /= sum;
    return out;
  }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }
  function putGray(c, f) {
    const ctx = c.getContext('2d'), n = c.width, img = ctx.createImageData(n, c.height);
    for (let i = 0; i < n * c.height; i++) { const v = Math.max(0, Math.min(255, f(i) * 255)); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0); return c;
  }
  /* 高さ（0..1）から法線マップを作る */
  function normalCanvas(h, n, k) {
    const c = canvas(n), ctx = c.getContext('2d'), img = ctx.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const l = h[y * n + (x + n - 1) % n], r = h[y * n + (x + 1) % n], u = h[((y + n - 1) % n) * n + x], d = h[((y + 1) % n) * n + x];
      let nx = (l - r) * k, ny = (u - d) * k, nz = 1; const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
      const i = (y * n + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0); return c;
  }

  /* ---------- 質感テクスチャ ---------- */
  function makeTextures(T, renderer) {
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const tex = (c, srgb, rx, ry) => {
      const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx || 1, ry || rx || 1);
      t.anisotropy = aniso; if (srgb) t.encoding = T.sRGBEncoding; return t;
    };
    const out = {};

    /* 床：緑の塗り床（エポキシ）。色むら・擦れ・タイヤ痕。1 枚 = 4m 角 */
    {
      const n = 1024, big = fbm(n, 5, 11, 3, 0.6), fine = fbm(n, 3, 12, 128, 0.5);
      const c = canvas(n), ctx = c.getContext('2d'), img = ctx.createImageData(n, n);
      const rough = new Float32Array(n * n);
      for (let i = 0; i < n * n; i++) {
        const v = 0.92 + (big[i] - 0.5) * 0.22 + (fine[i] - 0.5) * 0.08;
        img.data[i * 4] = 70 * v; img.data[i * 4 + 1] = 112 * v; img.data[i * 4 + 2] = 86 * v; img.data[i * 4 + 3] = 255;
        rough[i] = 0.55 + (big[i] - 0.5) * 0.3 + (fine[i] - 0.5) * 0.14;
      }
      ctx.putImageData(img, 0, 0);
      const r = rng(5);
      const rc = putGray(canvas(n), i => rough[i]), rctx = rc.getContext('2d');
      // タイヤ痕・擦れ（色は暗く、ツヤは落ちる）
      for (let k = 0; k < 26; k++) {
        const x = r() * n, y = r() * n, R = 150 + r() * 500, a0 = r() * 6.28, a1 = a0 + 0.4 + r() * 1.2, w = 4 + r() * 14;
        ctx.strokeStyle = `rgba(30,40,34,${0.05 + r() * 0.08})`; ctx.lineWidth = w;
        ctx.beginPath(); ctx.arc(x, y, R, a0, a1); ctx.stroke();
        rctx.strokeStyle = 'rgba(220,220,220,0.25)'; rctx.lineWidth = w * 1.5; rctx.beginPath(); rctx.arc(x, y, R, a0, a1); rctx.stroke();
      }
      // 小さなはがれ・汚れ
      for (let k = 0; k < 260; k++) {
        const x = r() * n, y = r() * n, s = 0.6 + r() * 2;
        ctx.fillStyle = r() < 0.4 ? `rgba(170,180,170,${0.08 + r() * 0.15})` : `rgba(20,25,22,${0.08 + r() * 0.2})`;
        ctx.beginPath(); ctx.ellipse(x, y, s, s * (0.4 + r()), r() * 3, 0, 6.28); ctx.fill();
      }
      out.floor = tex(c, true); out.floorR = tex(rc, false);
    }

    /* 塗装の肌（ゆず肌）：法線マップ */
    { const n = 256; out.paintN = tex(normalCanvas(fbm(n, 4, 21, 16, 0.5), n, 1.2), false); }
    /* 鋳物の地肌：法線マップ（粗め） */
    { const n = 256; out.castN = tex(normalCanvas(fbm(n, 4, 23, 8, 0.6), n, 3.0), false); }
    /* ヘアライン（磨いた金属）：粗さマップ */
    {
      const n = 256, r = rng(31), c = canvas(n), ctx = c.getContext('2d');
      ctx.fillStyle = '#5a5a5a'; ctx.fillRect(0, 0, n, n);
      for (let k = 0; k < 900; k++) { const y = r() * n, g = 60 + r() * 90; ctx.fillStyle = `rgba(${g},${g},${g},0.35)`; ctx.fillRect(0, y, n, 0.6 + r()); }
      out.brushR = tex(c, false, 2, 2);
    }
    /* 金網（50mm 目）：アルファマップ。1 枚 = 2×2 目 */
    {
      const n = 128, c = canvas(n), ctx = c.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, n, n); ctx.fillStyle = '#fff';
      for (const p of [0, n / 2]) { ctx.fillRect(p, 0, 2, n); ctx.fillRect(0, p, n, 2); }
      out.mesh = tex(c, false);
    }
    /* トラテープ（黄・黒の斜め縞） */
    {
      const w = 256, h = 64, c = canvas(w, h), ctx = c.getContext('2d');
      ctx.fillStyle = '#e8b400'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#1b1b1b';
      for (let x = -h; x < w + h; x += 64) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 32, h); ctx.lineTo(x + 32 + h, 0); ctx.lineTo(x + h, 0); ctx.fill(); }
      const d = ctx.getImageData(0, 0, w, h), r = rng(41);
      for (let i = 0; i < w * h; i++) { const k = 0.85 + r() * 0.15; d.data[i * 4] *= k; d.data[i * 4 + 1] *= k; d.data[i * 4 + 2] *= k; }
      ctx.putImageData(d, 0, 0);
      out.hazard = tex(c, true);
    }
    /* 作業台の天板（黒いベークライト板、細かい傷） */
    {
      const n = 512, f = fbm(n, 4, 51, 8, 0.5), c = putGray(canvas(n), i => 0.16 + (f[i] - 0.5) * 0.05), ctx = c.getContext('2d'), r = rng(52);
      for (let k = 0; k < 160; k++) { const x = r() * n, y = r() * n, a = r() * 6.28, L = 10 + r() * 90; ctx.strokeStyle = `rgba(150,150,150,${0.05 + r() * 0.12})`; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); ctx.stroke(); }
      out.top = tex(c, true);
    }
    /* 建屋の壁（折板の縦リブ。1 枚 = 幅 4m）と腰壁（ブロック） */
    {
      const w = 512, h = 512, c = canvas(w, h), ctx = c.getContext('2d'), f = fbm(256, 4, 61, 4, 0.6);
      for (let x = 0; x < w; x++) { const p = (x % 32) / 32, s = p < 0.18 ? 0.86 : p < 0.25 ? 0.95 : 1; const g = 205 * s; ctx.fillStyle = `rgb(${g},${g * 1.0},${g * 0.97})`; ctx.fillRect(x, 0, 1, h); }
      const d = ctx.getImageData(0, 0, w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = 0.9 + 0.12 * f[(y >> 1) * 256 + (x >> 1)] + 0.06 * (y / h); const i = (y * w + x) * 4; d.data[i] *= k; d.data[i + 1] *= k; d.data[i + 2] *= k; }
      ctx.putImageData(d, 0, 0);
      out.wall = tex(c, true);
      const b = canvas(256), bx = b.getContext('2d'), r = rng(62);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const g = 150 + r() * 25; bx.fillStyle = `rgb(${g},${g},${g - 4})`; bx.fillRect((x + (y % 2) * 0.5) * 64 - 32, y * 64, 64, 64); bx.fillRect((x + (y % 2) * 0.5) * 64 + 32, y * 64, 64, 64); }
      bx.strokeStyle = 'rgba(70,70,70,0.6)'; bx.lineWidth = 3;
      for (let y = 0; y <= 4; y++) { bx.beginPath(); bx.moveTo(0, y * 64); bx.lineTo(256, y * 64); bx.stroke(); }
      for (let y = 0; y < 4; y++) for (let x = 0; x <= 4; x++) { const xx = x * 64 + (y % 2) * 32; bx.beginPath(); bx.moveTo(xx, y * 64); bx.lineTo(xx, y * 64 + 64); bx.stroke(); }
      out.block = tex(b, true);
    }
    /* 注意ラベル（汎用の警告表示。メーカーのマークではない） */
    {
      const c = canvas(128), ctx = c.getContext('2d');
      ctx.fillStyle = '#f2c400'; ctx.beginPath(); ctx.moveTo(64, 8); ctx.lineTo(122, 116); ctx.lineTo(6, 116); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 9; ctx.strokeStyle = '#151515'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(64, 18); ctx.lineTo(113, 110); ctx.lineTo(15, 110); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = '#151515'; ctx.fillRect(58, 44, 12, 40); ctx.fillRect(58, 90, 12, 12);
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = aniso; out.caution = t;
    }
    return out;
  }

  /* ---------- 工場の建屋（背景） ----------
   * Three 座標（x＝ロボット前、z＝−Y、y＝上）。セル（柵の中）から十分離して置く。 */
  function buildHall(T, tx) {
    const g = new T.Group(); g.name = 'hall';
    const r = rng(77);
    const X0 = -15, X1 = 19, Z0 = -17, Z1 = 17, H = 9;
    const lam = (color, extra) => new T.MeshLambertMaterial(Object.assign({ color }, extra || {}));
    const hdr = (r_, g_, b_) => { const m = new T.MeshBasicMaterial({ color: new T.Color(r_, g_, b_) }); m.userData.linear = true; return m; };
    const add = (geo, mat, x, y, z, ry) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); if (ry) m.rotation.y = ry; m.matrixAutoUpdate = false; m.updateMatrix(); g.add(m); return m; };
    const recv = m => { m.receiveShadow = true; return m; };

    /* 床（ロボットの影も受ける） */
    const fl = tx.floor.clone(); fl.needsUpdate = true; fl.repeat.set((X1 - X0) / 4, (Z1 - Z0) / 4);
    const flR = tx.floorR.clone(); flR.needsUpdate = true; flR.repeat.copy(fl.repeat);
    const floorM = new T.MeshStandardMaterial({ map: fl, roughnessMap: flR, roughness: 1, metalness: 0, envMapIntensity: 0.55 });
    const floor = recv(new T.Mesh(new T.PlaneGeometry(X1 - X0, Z1 - Z0), floorM));
    floor.rotation.x = -Math.PI / 2; floor.position.set((X0 + X1) / 2, 0, (Z0 + Z1) / 2); floor.name = 'floor';
    g.add(floor);

    /* 通路の白線・黄線 */
    const lineY = lam(0xd9b62a), lineW = lam(0xe6e8e2);
    const strip = (x0, z0, x1, z1, w, m) => { const L = Math.hypot(x1 - x0, z1 - z0); const s = add(new T.PlaneGeometry(L, w), m, (x0 + x1) / 2, 0.002, (z0 + z1) / 2); s.rotation.set(-Math.PI / 2, 0, -Math.atan2(z1 - z0, x1 - x0)); s.updateMatrix(); recv(s); };
    for (const z of [-3.6, 3.6]) strip(-12, z, 16, z, 0.1, lineY);
    for (const z of [-4.6, 4.6]) strip(-12, z, 16, z, 0.08, lineW);
    strip(-3.0, -3.6, -3.0, 3.6, 0.1, lineY); strip(3.4, -3.6, 3.4, 3.6, 0.1, lineY);

    /* 壁：折板（上）とブロック（腰壁） */
    const wallTex = (len) => { const t = tx.wall.clone(); t.needsUpdate = true; t.repeat.set(len / 4, 1); return t; };
    const blockTex = (len) => { const t = tx.block.clone(); t.needsUpdate = true; t.repeat.set(len / 1.6, 1); return t; };
    const walls = [[X0, 0, Z1 - Z0, Math.PI / 2], [X1, 0, Z1 - Z0, -Math.PI / 2], [(X0 + X1) / 2, Z0, X1 - X0, 0], [(X0 + X1) / 2, Z1, X1 - X0, Math.PI]];
    for (const [x, z, len, ry] of walls) {
      const wx = x, wz = z;
      add(new T.PlaneGeometry(len, H - 1.6), lam(0xffffff, { map: wallTex(len) }), wx, 1.6 + (H - 1.6) / 2, wz, ry);
      add(new T.PlaneGeometry(len, 1.6), lam(0xffffff, { map: blockTex(len) }), wx, 0.8, wz, ry);
      // 高窓（明るい）
      const win = add(new T.PlaneGeometry(len * 0.9, 1.1), hdr(2.2, 2.35, 2.6), wx, 6.9, wz, ry);
      win.translateZ(0.02); win.updateMatrix();
      // 窓の縦桟
      for (let k = -len * 0.45; k <= len * 0.45; k += 1.5) { const m = add(new T.BoxGeometry(0.08, 1.15, 0.05), lam(0x6d7177), wx, 6.9, wz, ry); m.translateX(k); m.translateZ(0.03); m.updateMatrix(); }
    }
    /* 天井・梁 */
    const ceil = add(new T.PlaneGeometry(X1 - X0, Z1 - Z0), lam(0x6a6f76), (X0 + X1) / 2, H, (Z0 + Z1) / 2); ceil.rotation.x = Math.PI / 2; ceil.updateMatrix();
    const beamM = lam(0x8a929c);
    for (let x = X0 + 2; x < X1; x += 6) add(new T.BoxGeometry(0.25, 0.6, Z1 - Z0), beamM, x, H - 0.4, 0);
    for (const z of [-9, 0, 9]) add(new T.BoxGeometry(X1 - X0, 0.3, 0.15), beamM, (X0 + X1) / 2, H - 0.85, z);
    /* 照明（吊り下げの LED ライン照明） */
    const lampGeo = new T.BoxGeometry(1.4, 0.06, 0.22), lampM = hdr(9, 8.8, 8.2), housingM = lam(0x9aa0a6);
    for (let z = -12; z <= 12; z += 6) for (let x = X0 + 2.5; x < X1 - 1; x += 3.4) {
      add(new T.BoxGeometry(1.5, 0.08, 0.3), housingM, x, 7.64, z);
      add(lampGeo, lampM, x, 7.58, z);
    }
    /* 柱（H 鋼）＋下部のトラ巻き */
    const colM = lam(0x7f8b97), hzT = tx.hazard.clone(); hzT.needsUpdate = true; hzT.repeat.set(1, 4); hzT.rotation = Math.PI / 2;
    const guardM = lam(0xffffff, { map: hzT });
    const col = (x, z) => { add(new T.BoxGeometry(0.35, H, 0.35), colM, x, H / 2, z); add(new T.BoxGeometry(0.42, 1.2, 0.42), guardM, x, 0.6, z); };
    for (let x = X0 + 2; x < X1; x += 6) { col(x, Z0 + 0.4); col(x, Z1 - 0.4); }
    for (let x = X0 + 2; x < X1; x += 12) { col(x, -9); col(x, 9); }

    /* 設備（セルから離れた場所だけ。半径 4.5m 以内には置かない） */
    const pal = [0xe7e3d6, 0xbfc4c9, 0xa9c2ab, 0xd8d1bd, 0x9ea9b4];
    const free = (x, z, w, d) => Math.abs(z) - d / 2 > 4.8 || x - w / 2 > 6.5 || x + w / 2 < -5;
    const machine = (x, z, w, d, h, ry) => {
      const c = pal[Math.floor(r() * pal.length)];
      add(new T.BoxGeometry(w, h, d), lam(c), x, h / 2, z, ry);
      add(new T.BoxGeometry(w * 1.01, 0.12, d * 1.01), lam(0x4a4f55), x, 0.06, z, ry);                      // 台座
      const p = add(new T.BoxGeometry(w * 0.4, h * 0.35, 0.02), lam(0x2c3036), x, h * 0.6, z, ry); p.translateZ(d / 2 + 0.01); p.updateMatrix(); // 操作盤
      const lt = [0xd02a20, 0xe0a800, 0x1f9a3e];
      lt.forEach((cc, i) => { const s = add(new T.CylinderGeometry(0.05, 0.05, 0.09, 12), i === 2 ? hdr(0.4, 2.4, 0.6) : lam(cc), x, h + 0.25 + i * 0.1, z, ry); s.translateX(w * 0.35); s.updateMatrix(); });
      const pole = add(new T.CylinderGeometry(0.015, 0.015, 0.2, 8), lam(0x777777), x, h + 0.1, z, ry); pole.translateX(w * 0.35); pole.updateMatrix();
    };
    const cabinet = (x, z, ry) => { add(new T.BoxGeometry(0.8, 2.0, 0.6), lam(0xe4e1d6), x, 1.0, z, ry); const h = add(new T.BoxGeometry(0.03, 0.25, 0.03), lam(0x555555), x, 1.1, z, ry); h.translateZ(0.31); h.translateX(0.3); h.updateMatrix(); };
    const pallet = (x, z) => {
      add(new T.BoxGeometry(1.1, 0.14, 1.1), lam(0xa98c62), x, 0.07, z);
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) add(new T.BoxGeometry(1.0, 0.35, 1.0), lam(0xb99566), x, 0.14 + 0.175 + i * 0.36, z);
    };
    const glassRack = (x, z, ry) => {   // 板ガラスを立てかける A 型ラック
      const m = lam(0x3b5f8a), gm = new T.MeshLambertMaterial({ color: 0x9fc6b8, transparent: true, opacity: 0.35, depthWrite: false });
      add(new T.BoxGeometry(2.0, 0.12, 1.2), m, x, 0.06, z, ry);
      for (const s of [-1, 1]) { const a = add(new T.BoxGeometry(2.0, 1.6, 0.06), m, x, 0.9, z, ry); a.translateZ(s * 0.18); a.rotateX(s * 0.18); a.updateMatrix(); }
      for (let i = 0; i < 6; i++) { const p = add(new T.BoxGeometry(1.8, 1.3, 0.006), gm, x, 0.8, z, ry); p.translateZ(0.24 + i * 0.03); p.rotateX(0.18); p.updateMatrix(); }
    };
    const conveyor = (x0, x1, z) => {
      const L = x1 - x0, cx = (x0 + x1) / 2;
      add(new T.BoxGeometry(L, 0.08, 0.7), lam(0x50565d), cx, 0.82, z);
      add(new T.BoxGeometry(L, 0.02, 0.62), lam(0x26292d), cx, 0.87, z);
      for (let x = x0 + 0.3; x < x1; x += 1.2) for (const s of [-1, 1]) add(new T.BoxGeometry(0.06, 0.8, 0.06), lam(0x9aa3ad), x, 0.4, z + s * 0.3);
    };
    // 奥（ロボットの正面側）
    let x = X1 - 1.6;
    for (let z = -13; z <= 13; z += 3.2 + r() * 1.5) { const w = 1.6 + r() * 1.4, d = 1.2 + r() * 0.8, h = 1.5 + r() * 1.0; if (free(x, z, w, d)) machine(x - r() * 0.5, z, d, w, h, Math.PI / 2); }
    conveyor(6.5, 15.5, -6.2); conveyor(6.5, 15.5, 6.6);
    // 両側
    for (let x2 = -11; x2 < 15; x2 += 2.6 + r() * 1.8) {
      for (const s of [-1, 1]) {
        const z = s * (Z1 - 1.4 - r() * 0.6), k = r();
        if (k < 0.35) cabinet(x2, z, s < 0 ? 0 : Math.PI); else if (k < 0.6) pallet(x2, z); else if (k < 0.75) glassRack(x2, z, s < 0 ? 0 : Math.PI); else machine(x2, z, 1.6 + r(), 1.1 + r() * 0.5, 1.3 + r() * 0.9, s < 0 ? 0 : Math.PI);
      }
    }
    // 後ろ（ロボットの背中側）
    for (let z = -12; z <= 12; z += 2.4 + r() * 1.6) { const k = r(); if (k < 0.4) cabinet(X0 + 0.8, z, Math.PI / 2); else if (k < 0.7) pallet(X0 + 1.4, z); else machine(X0 + 1.5, z, 1.6, 1.2, 1.4 + r() * 0.8, Math.PI / 2); }
    glassRack(-7.5, -6.0, 0); glassRack(-7.5, 6.2, Math.PI);
    // 隣のセルの柵（遠景）
    const fm = lam(0xc9a51a);
    const fence2 = (x0, z0, x1, z1) => {
      const L = Math.hypot(x1 - x0, z1 - z0), ry = -Math.atan2(z1 - z0, x1 - x0);
      const t = tx.mesh.clone(); t.needsUpdate = true; t.repeat.set(L / 0.1, 1.6 / 0.1);
      add(new T.PlaneGeometry(L, 1.6), new T.MeshLambertMaterial({ color: 0x2b2e33, alphaMap: t, alphaTest: 0.02, alphaToCoverage: true, side: T.DoubleSide }), (x0 + x1) / 2, 0.95, (z0 + z1) / 2, ry);
      add(new T.BoxGeometry(L, 0.04, 0.04), fm, (x0 + x1) / 2, 1.75, (z0 + z1) / 2, ry);
      for (let k = 0; k <= L; k += 1.6) add(new T.BoxGeometry(0.06, 1.8, 0.06), fm, x0 + (x1 - x0) * k / L, 0.9, z0 + (z1 - z0) * k / L);
    };
    fence2(-11, -12.5, -4, -12.5); fence2(-4, -12.5, -4, -8.5); fence2(5, 12.2, 11, 12.2); fence2(5, 12.2, 5, 9);
    return mergeStatic(T, g);
  }

  /* 動かない物を、見た目（マテリアル）ごとに 1 つの形状へまとめる（描画の回数を減らして軽くする） */
  function mergeStatic(T, g) {
    const key = m => [m.type, m.color ? m.color.getHexString() : '', m.map ? m.map.uuid : '', m.alphaMap ? m.alphaMap.uuid : '', m.transparent, m.opacity, m.alphaTest, m.side].join('|');
    const groups = new Map(), keep = [];
    g.updateMatrixWorld(true);
    for (const o of g.children.slice()) {
      if (!o.isMesh || o.name === 'floor') { keep.push(o); continue; }
      const k = key(o.material);
      if (!groups.has(k)) groups.set(k, { mat: o.material, list: [] });
      groups.get(k).list.push(o);
    }
    const out = new T.Group(); out.name = 'hall';
    keep.forEach(o => out.add(o));
    for (const { mat, list } of groups.values()) {
      const parts = list.map(o => { const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()); geo.applyMatrix4(o.matrix); return geo; });
      const n = parts.reduce((a, p) => a + p.attributes.position.count, 0);
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      let i = 0;
      for (const p of parts) {
        pos.set(p.attributes.position.array, i * 3); nor.set(p.attributes.normal.array, i * 3);
        if (p.attributes.uv) uv.set(p.attributes.uv.array, i * 2);
        i += p.attributes.position.count; p.dispose();
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
      geo.computeBoundingSphere();
      const m = new T.Mesh(geo, mat); m.receiveShadow = true; m.matrixAutoUpdate = false;
      out.add(m);
    }
    return out;
  }

  /* ---------- 後処理シェーダ：周辺減光・粒子感 ---------- */
  const GradeShader = {
    uniforms: { tDiffuse: { value: null }, time: { value: 0 }, vig: { value: 0.32 }, grain: { value: 0.018 }, res: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: [
      'uniform sampler2D tDiffuse; uniform float time, vig, grain; uniform vec2 res; varying vec2 vUv;',
      'float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }',
      'void main(){',
      '  vec4 c = texture2D(tDiffuse, vUv);',
      '  vec2 d = vUv - 0.5; d.x *= res.x / res.y;',
      '  c.rgb *= 1.0 - vig * smoothstep(0.15, 0.9, dot(d, d) * 1.4);',
      '  float n = h(floor(vUv * res) + fract(time) * 91.7) - 0.5;',
      '  c.rgb += n * grain * (1.0 - 0.5 * c.rgb);',
      '  gl_FragColor = vec4(c.rgb, 1.0);',
      '}'
    ].join('\n')
  };

  RS.makeLook = function (T, renderer, scene, camera) {
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const tx = makeTextures(T, renderer);
    RS.lookTex = tx;

    /* sRGB で書いた色を線形に（1 回だけ） */
    const done = new WeakSet();
    function fixMat(m) {
      if (!m || done.has(m)) return; done.add(m);
      if (m.userData && m.userData.linear) return;
      if (m.color) m.color.convertSRGBToLinear();
      if (m.emissive) m.emissive.convertSRGBToLinear();
      if (m.map && m.map.encoding !== T.sRGBEncoding) { m.map.encoding = T.sRGBEncoding; m.needsUpdate = true; }
    }
    function linearize(root) {
      root.traverse(o => { const m = o.material; if (Array.isArray(m)) m.forEach(fixMat); else if (m) fixMat(m); });
    }
    RS.srgbColor = (c, hex) => { c.setHex(hex); c.convertSRGBToLinear(); return c; };

    /* 建屋 */
    const hall = buildHall(T, tx);
    linearize(hall);
    scene.add(hall);
    scene.fog = new T.FogExp2(0xb9bdbf, 0.012);

    /* 映り込み用の環境マップ：同じ建屋を、ロボットの高さから見たもの */
    try {
      const envScene = new T.Scene();
      envScene.background = new T.Color(0x3a3d40);
      const h2 = hall.clone(true); h2.position.y = -1.2; envScene.add(h2);
      // r128 の PMREM は RGBE（アルファに指数）で保存するため、半透明の物を入れると壊れる
      h2.traverse(o => { if (o.material && o.material.transparent) o.visible = false; });
      envScene.add(new T.HemisphereLight(0xffffff, 0x6f7f72, 1.0));
      envScene.add(new T.AmbientLight(0xffffff, 0.25));
      const pm = new T.PMREMGenerator(renderer);
      scene.environment = pm.fromScene(envScene, 0.02, 0.1, 100).texture;
      pm.dispose();
    } catch (e) { /* 環境マップなしでも動く */ }

    /* 後処理 */
    let quality = 'high', composer = null, ssao = null, grade = null, fxaa = null, size = [1, 1];
    const hasPost = !!(T.EffectComposer && T.SSAOPass && T.ShaderPass);
    function buildPost() {
      if (!hasPost) return;
      const pr = renderer.getPixelRatio(), W = Math.max(1, Math.round(size[0] * pr)), Hh = Math.max(1, Math.round(size[1] * pr));
      composer = new T.EffectComposer(renderer);
      composer.setPixelRatio(pr); composer.setSize(size[0], size[1]);
      ssao = new T.SSAOPass(scene, camera, W, Hh);
      ssao.kernelRadius = 0.3; ssao.minDistance = 0.00002; ssao.maxDistance = 0.01;
      let msaa = false;
      if (renderer.capabilities.isWebGL2 && T.WebGLMultisampleRenderTarget) {
        const ms = new T.WebGLMultisampleRenderTarget(W, Hh, { minFilter: T.LinearFilter, magFilter: T.LinearFilter, format: T.RGBAFormat });
        ms.samples = 4;
        ssao.beautyRenderTarget.dispose(); ssao.beautyRenderTarget = ms;
        ssao.ssaoMaterial.uniforms.tDiffuse.value = ms.texture;
        msaa = true;
      }
      ssao.beautyRenderTarget.texture.encoding = T.sRGBEncoding;   // 8bit に sRGB で保存（暗部の段差を防ぐ）
      // 透けるもの（金網・ガラス）は陰りの計算から外す
      const ov = ssao.overrideVisibility.bind(ssao);
      ssao.overrideVisibility = function () {
        ov();
        scene.traverse(o => { if (o.visible && (o.userData.noAO || (o.material && o.material.transparent) || (o.material && o.material.alphaTest > 0))) o.visible = false; });
      };
      composer.addPass(ssao);
      if (!msaa && T.FXAAShader) {
        fxaa = new T.ShaderPass(T.FXAAShader);
        fxaa.uniforms.resolution.value.set(1 / W, 1 / Hh);
        composer.addPass(fxaa);
      }
      grade = new T.ShaderPass(GradeShader);
      grade.uniforms.res.value = new T.Vector2(W, Hh);
      composer.addPass(grade);
    }
    function disposePost() {
      if (!composer) return;
      ssao.dispose(); composer.renderTarget1.dispose(); composer.renderTarget2.dispose();
      composer = ssao = grade = fxaa = null;
    }
    function setSize(w, h) {
      size = [w, h];
      if (!composer) return;
      const pr = renderer.getPixelRatio(), W = Math.round(w * pr), Hh = Math.round(h * pr);
      composer.setPixelRatio(pr); composer.setSize(w, h);
      if (fxaa) fxaa.uniforms.resolution.value.set(1 / W, 1 / Hh);
      grade.uniforms.res.value.set(W, Hh);
    }
    let mode = 'auto', slow = 0, slowN = 0, t0 = 0, lastT = 0;
    const look = {
      hall, tex: tx, linearize, setSize,
      onAutoDrop: null,      // 自動で画質を下げたとき
      onChange: null,        // 画質が変わったとき（画素密度・影の解像度を app 側で合わせる）
      quality: () => quality,
      mode: () => mode,
      /* q: 'auto' | 'high'（実写風）| 'std'（標準）| 'low'（軽量） */
      setQuality(q, keepMode) {
        if (!keepMode) mode = q;
        const want = q === 'auto' || q === 'high' ? (hasPost ? 'high' : 'std') : q === 'low' ? 'low' : 'std';
        slow = 0; slowN = 0; t0 = 0; lastT = 0;
        if (want === quality && (want !== 'high' || composer)) return;
        quality = want;
        if (quality === 'high') buildPost(); else disposePost();
        if (look.onChange) look.onChange(quality);
      },
      render(now) {
        linearize(scene);
        if (quality === 'high' && composer) {
          grade.uniforms.time.value = (now || 0) / 1000;
          composer.render();
        } else {
          renderer.render(scene, camera);
        }
        // 自動：重い PC では 1 段ずつ画質を下げる（1 フレーム 70ms 超えが 8 フレーム以上・2 秒続いたら）
        if (mode === 'auto' && quality !== 'low') {
          if (!t0) t0 = now;
          if (lastT) {
            const dt = now - lastT;
            if (now - t0 > 1500) {   // 切り替え直後（シェーダの準備中）は数えない
              if (dt > 70) { slow += dt; slowN++; } else { slow = 0; slowN = 0; }
              // 一時的な引っかかりでは下げない
              if (slow > 2000 && slowN >= 8) { look.setQuality(quality === 'high' ? 'std' : 'low', true); if (look.onAutoDrop) look.onAutoDrop(); }
            }
          }
          lastT = now;
        }
      }
    };
    return look;
  };
})(window.RS = window.RS || {});
