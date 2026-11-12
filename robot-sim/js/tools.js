/* =====================================================================
 * tools.js — ハンド（エンドエフェクタ）とワークの定義
 *
 * ★ 用途に合わせてハンドを増やす・変える場合は、このファイルだけを編集します。
 *   （AI に「○○用のハンドを追加して」と依頼すると、ここに定義が追加されます）
 *
 * ハンド定義の項目
 *   id      : 識別子（英数字）
 *   name    : 画面に出す名前
 *   desc    : 説明
 *   kind    : 'vacuum'（吸着）か 'gripper'（つかむ）
 *   tcp     : ツール先端（TCP）の位置 [x, y, z]（m）。フランジ中心が原点、Z がフランジから外向き
 *   cups    : 吸着パッドの位置 [[x, y], ...]（kind が vacuum のとき）。パッド面は Z = tcp[2]
 *   cupR    : 吸着パッドの半径（m）
 *   grip    : { open: 開いたときの爪の間隔(m), depth: 爪の長さ(m) }（kind が gripper のとき）
 *   work    : このハンドで扱う標準のワーク（下の RS.WORKS のキー）
 *   approach: サンプルプログラムで使う、ワーク上方の待機高さ（m）
 *   probes  : 干渉チェックに使う点 [[x, y, z], ...]（ツール座標）
 *   build(K): 形状を作る関数。K は下の部品ヘルパー。{ group, update(st) } を返す
 *             st = { on: 出力ON/OFF, holding: ワーク保持中か, k: 0〜1 の開閉量 }
 *
 * 形状はすべて「ツール座標（Z がフランジから外向き）」で作ります。
 * ===================================================================== */
(function (RS) {
  'use strict';

  /* ---------- ワーク ---------- */
  RS.WORKS = {
    glass: {
      name: '板ガラス 600×400×5mm',
      size: [0.60, 0.40, 0.005],          // ロボット座標 X, Y, Z 方向の寸法 (m)
      color: 0x9ad7d0, opacity: 0.38, edge: 0x3f8f87,
      stack: 3                             // 供給台に積む枚数の初期値
    },
    glassDark: {
      name: '色付き板ガラス 1200×750×4mm（実機ライン・推定）',
      size: [1.0, 0.75, 0.004],
      color: 0x15191b, opacity: 0.9, edge: 0x2e6b55, dark: true,
      stack: 1
    },
    box: {
      name: '段ボール箱 200×150×150mm',
      size: [0.20, 0.15, 0.15],
      color: 0xc99a5b, opacity: 1, edge: 0x7a5a2e,
      stack: 1
    },
    part: {
      name: '小物部品 80×80×40mm',
      size: [0.08, 0.08, 0.04],
      color: 0xe08a1e, opacity: 1, edge: 0x8a4f0a,
      stack: 3
    }
  };

  /* ---------- 部品ヘルパー（ツール座標で配置） ---------- */
  RS.makeToolKit = function (T) {
    const mats = {
      alu: new T.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.38, metalness: 0.85, roughnessMap: (RS.lookTex && RS.lookTex.brushR) || null }),
      dark: new T.MeshStandardMaterial({ color: 0x30363e, roughness: 0.55, metalness: 0.5 }),
      rubber: new T.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.85, metalness: 0 }),
      hose: new T.MeshStandardMaterial({ color: 0x2f74c8, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.85 }),
      blue: new T.MeshStandardMaterial({ color: 0x2f6fd0, roughness: 0.5, metalness: 0.2 }),
      white: new T.MeshStandardMaterial({ color: 0xe6eaef, roughness: 0.5, metalness: 0.1 }),
      led: new T.MeshStandardMaterial({ color: 0x777777, emissive: 0x000000, roughness: 0.4 })
    };
    mats.led.userData.linear = true;   // 色は setLed が毎回変換して入れる
    mats.hose.userData.noAO = true;
    function shadow(m) { m.castShadow = true; m.receiveShadow = true; return m; }
    return {
      T, mats,
      /* Z 方向の円柱（z0 から長さ len）。r1=フランジ側半径, r2=先端側半径 */
      cylZ(r1, r2, len, mat, x, y, z0) {
        const g = new T.CylinderGeometry(r2, r1, len, 28);
        g.rotateX(Math.PI / 2);
        const m = shadow(new T.Mesh(g, mat));
        m.position.set(x || 0, y || 0, (z0 || 0) + len / 2);
        return m;
      },
      /* 直方体（中心座標で配置） */
      box(sx, sy, sz, mat, x, y, z) {
        const m = shadow(new T.Mesh(new T.BoxGeometry(sx, sy, sz), mat));
        m.position.set(x || 0, y || 0, z || 0);
        return m;
      },
      /* 曲がったホース（点列はツール座標） */
      hose(pts, r, mat) {
        const m = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(p => new T.Vector3(p[0], p[1], p[2]))), 24, r, 8, false), mat);
        m.castShadow = true; return m;
      },
      group() { return new T.Group(); }
    };
  };

  /* LED（状態表示）共通 */
  function setLed(mat, st) {
    const set = (c, h) => { c.setHex(h); if (RS.srgbColor) c.convertSRGBToLinear(); };
    if (!st.on) { set(mat.color, 0x666666); set(mat.emissive, 0x000000); }
    else if (st.holding) { set(mat.color, 0x22c55e); set(mat.emissive, 0x1fbf5a); }
    else { set(mat.color, 0xf59e0b); set(mat.emissive, 0xd08400); }
  }

  /* ---------- ハンド ---------- */
  RS.TOOLS = [
    {
      id: 'glass4',
      name: 'ガラス用 4吸盤ハンド',
      desc: '板ガラスを4つの吸盤で水平に保持します。4つすべてが吸着したときだけ保持します。',
      kind: 'vacuum',
      tcp: [0, 0, 0.17],
      cups: [[0.20, 0.12], [0.20, -0.12], [-0.20, 0.12], [-0.20, -0.12]],
      cupR: 0.032,
      work: 'glass',
      approach: 0.15,
      probes: [[0.2, 0.12, 0.17], [0.2, -0.12, 0.17], [-0.2, 0.12, 0.17], [-0.2, -0.12, 0.17],
               [0.24, 0, 0.09], [-0.24, 0, 0.09], [0, 0.16, 0.09], [0, -0.16, 0.09]],
      build(K) {
        const g = K.group(), M = K.mats;
        const led = M.led.clone();
        g.add(K.cylZ(0.063, 0.063, 0.018, M.dark, 0, 0, 0));          // フランジアダプタ
        g.add(K.box(0.09, 0.09, 0.05, M.alu, 0, 0, 0.043));           // 中央ブロック
        g.add(K.box(0.50, 0.04, 0.03, M.alu, 0, 0, 0.083));           // フレーム（X方向）
        for (const y of [0.12, -0.12]) g.add(K.box(0.50, 0.03, 0.025, M.alu, 0, y, 0.083)); // 平行フレーム
        g.add(K.box(0.04, 0.27, 0.03, M.alu, 0, 0, 0.083));           // フレーム（Y方向）
        const ledM = K.box(0.02, 0.02, 0.01, led, 0.045, 0, 0.03); g.add(ledM);
        for (const [x, y] of this.cups) {
          g.add(K.cylZ(0.008, 0.008, 0.035, M.dark, x, y, 0.096));    // 支柱
          g.add(K.cylZ(0.016, 0.016, 0.012, M.dark, x, y, 0.128));    // バネ部
          g.add(K.cylZ(0.018, this.cupR, 0.03, M.rubber, x, y, 0.14)); // ベローズ吸盤
          g.add(K.cylZ(0.006, 0.006, 0.012, M.alu, x * 0.98, y * 0.98, 0.084)); // 継手
          // 真空ホース（中央のエジェクタから各吸盤へ）
          g.add(K.hose([[Math.sign(x) * 0.03, Math.sign(y) * 0.03, 0.06], [x * 0.45, y * 0.55, 0.05], [x * 0.85, y * 0.95, 0.06], [x, y, 0.078]], 0.004, M.hose));
        }
        g.add(K.box(0.06, 0.03, 0.025, M.dark, 0, 0.06, 0.04));          // 真空エジェクタ
        return { group: g, update(st) { setLed(led, st); } };
      }
    },
    {
      id: 'glassM',
      name: '硝子ハンド（実機 ツール0）',
      desc: 'フランジの真下に取付板があり、左右に伸びた腕の先に 4 つのベローズ吸盤（バネ付き）が付いています。TCP は実機のツールデータ（ツール0：X−190 / Y−90 / Z120 mm）で、吸盤の枠の中心からずれた位置にあります。吸盤の間隔は写真からの推定です。',
      kind: 'vacuum',
      tcp: [-0.19, -0.09, 0.12],
      cups: [[0.25, 0.12], [0.25, -0.12], [-0.25, 0.12], [-0.25, -0.12]],   // フランジ中心を真ん中に ±250 × ±120 mm（写真からの推定）
      cupR: 0.045,
      stroke: 0.02,
      work: 'glassDark',
      approach: 0.2,
      probes: [[0.25, 0.12, 0.12], [0.25, -0.12, 0.12], [-0.25, 0.12, 0.12], [-0.25, -0.12, 0.12],
               [0.28, 0.15, 0.06], [0.28, -0.15, 0.06], [-0.28, 0.15, 0.06], [-0.28, -0.15, 0.06]],
      build(K) {
        const g = K.group(), M = K.mats;
        const led = M.led.clone();
        const hx = Math.max(...this.cups.map(c => Math.abs(c[0]))), hy = Math.max(...this.cups.map(c => Math.abs(c[1])));
        g.add(K.cylZ(0.063, 0.063, 0.02, M.dark, 0, 0, 0));                     // フランジアダプタ
        g.add(K.box(0.20, 0.15, 0.04, M.alu, 0, 0, 0.04));                      // 取付板（フランジの真下）
        g.add(K.box(0.16, 0.10, 0.035, M.dark, 0, 0, 0.0775));                  // 真空ブロック
        g.add(K.box(hx * 2 + 0.06, 0.04, 0.03, M.alu, 0, 0, 0.045));           // 左右に伸びる腕
        for (const sx of [-1, 1]) g.add(K.box(0.04, hy * 2 + 0.05, 0.03, M.alu, sx * hx, 0, 0.045));   // 腕の先の横梁
        for (const [x, y] of this.cups) {
          g.add(K.cylZ(0.008, 0.008, 0.07, M.alu, x, y, 0.0));                  // バネのガイド棒
          g.add(K.cylZ(0.014, 0.014, 0.035, M.dark, x, y, 0.06));               // バネ
          g.add(K.cylZ(0.018, 0.022, 0.008, M.rubber, x, y, 0.095));            // ベローズ吸盤（3 段）
          g.add(K.cylZ(0.022, 0.032, 0.008, M.rubber, x, y, 0.103));
          g.add(K.cylZ(0.026, 0.038, 0.008, M.rubber, x, y, 0.111));
          g.add(K.cylZ(0.03, this.cupR, 0.004, M.rubber, x, y, 0.116));
          g.add(K.hose([[0.06, 0, 0.08], [x / 2, y / 2 + 0.02, 0.09], [x, y, 0.07]], 0.005, M.hose));
        }
        // TCP の位置の距離センサー（硝子との距離を測る）
        const [tx, ty] = this.tcp;
        g.add(K.box(0.03, Math.abs(ty) + 0.02, 0.02, M.alu, tx, ty / 2, 0.06));
        g.add(K.cylZ(0.012, 0.012, 0.05, M.dark, tx, ty, 0.06));
        g.add(K.box(0.03, 0.03, 0.015, led, 0.09, 0.06, 0.03));
        return { group: g, update(st) { setLed(led, st); } };
      }
    },
    {
      id: 'glassV',
      name: 'ガラス縦取り 4吸盤ハンド（バネ付き）',
      desc: '立てかけたガラスを正面から押し当てて吸着します。吸盤はバネで 20mm 縮みます（押し当てを検出する接触センサー付き）。寸法は写真からの推定です。',
      kind: 'vacuum',
      tcp: [0, 0, 0.24],
      cups: [[0.22, 0.30], [0.22, -0.30], [-0.22, 0.30], [-0.22, -0.30]],
      cupR: 0.045,
      stroke: 0.02,                       // 吸盤のバネの縮み代（この範囲なら押し当てても干渉にしない）
      work: 'glassDark',
      approach: 0.2,
      probes: [[0.22, 0.3, 0.24], [0.22, -0.3, 0.24], [-0.22, 0.3, 0.24], [-0.22, -0.3, 0.24],
               [0.27, 0.36, 0.13], [0.27, -0.36, 0.13], [-0.27, 0.36, 0.13], [-0.27, -0.36, 0.13]],
      build(K) {
        const g = K.group(), M = K.mats;
        const led = M.led.clone();
        g.add(K.cylZ(0.063, 0.063, 0.02, M.dark, 0, 0, 0));            // フランジアダプタ
        g.add(K.box(0.14, 0.14, 0.06, M.alu, 0, 0, 0.05));             // 中央ブロック
        g.add(K.box(0.04, 0.80, 0.04, M.alu, 0, 0, 0.1));              // 横フレーム（Y）
        for (const x of [0.22, -0.22]) g.add(K.box(0.04, 0.72, 0.035, M.alu, x, 0, 0.13)); // 吸盤の梁
        g.add(K.box(0.48, 0.04, 0.035, M.alu, 0, 0.30, 0.125)); g.add(K.box(0.48, 0.04, 0.035, M.alu, 0, -0.30, 0.125));
        g.add(K.box(0.07, 0.05, 0.04, M.dark, 0, 0.12, 0.05));          // 真空エジェクタ
        g.add(K.box(0.03, 0.03, 0.015, led, 0.07, 0, 0.03));
        for (const [x, y] of this.cups) {
          g.add(K.cylZ(0.012, 0.012, 0.04, M.alu, x, y, 0.148));        // バネ付き支柱
          g.add(K.cylZ(0.02, 0.02, 0.018, M.dark, x, y, 0.16));          // バネ
          g.add(K.cylZ(0.022, this.cupR, 0.05, M.rubber, x, y, 0.19));   // ベローズ吸盤（黒）
          g.add(K.hose([[Math.sign(x) * 0.04, 0.12, 0.06], [x * 0.5, y * 0.6, 0.09], [x * 0.9, y, 0.13], [x, y, 0.15]], 0.005, M.hose));
        }
        return { group: g, update(st) { setLed(led, st); } };
      }
    },
    {
      id: 'vac1',
      name: '単吸盤ハンド（小物・箱）',
      desc: '吸盤1つで箱や小物部品の上面を吸着します。',
      kind: 'vacuum',
      tcp: [0, 0, 0.15],
      cups: [[0, 0]],
      cupR: 0.03,
      work: 'box',
      approach: 0.12,
      probes: [[0, 0, 0.15], [0.04, 0, 0.06], [-0.04, 0, 0.06]],
      build(K) {
        const g = K.group(), M = K.mats;
        const led = M.led.clone();
        g.add(K.cylZ(0.063, 0.063, 0.018, M.dark, 0, 0, 0));
        g.add(K.box(0.08, 0.08, 0.05, M.alu, 0, 0, 0.043));
        g.add(K.box(0.02, 0.02, 0.01, led, 0.04, 0, 0.03));
        g.add(K.cylZ(0.01, 0.01, 0.05, M.dark, 0, 0, 0.068));
        g.add(K.cylZ(0.018, this.cupR, 0.032, M.rubber, 0, 0, 0.118));
        return { group: g, update(st) { setLed(led, st); } };
      }
    },
    {
      id: 'grip2',
      name: '2爪グリッパ',
      desc: '平行に開閉する2本の爪で、ワークを両側からつかみます。',
      kind: 'gripper',
      tcp: [0, 0, 0.17],
      grip: { open: 0.24, depth: 0.08 },
      work: 'box',
      approach: 0.15,
      probes: [[0, 0.12, 0.21], [0, -0.12, 0.21], [0.05, 0, 0.09], [-0.05, 0, 0.09]],
      build(K) {
        const g = K.group(), M = K.mats;
        const led = M.led.clone();
        g.add(K.cylZ(0.063, 0.063, 0.018, M.dark, 0, 0, 0));
        g.add(K.box(0.10, 0.30, 0.07, M.blue, 0, 0, 0.053));           // 本体（Y 方向に開閉）
        g.add(K.box(0.02, 0.02, 0.01, led, 0.055, 0, 0.04));
        const fA = K.box(0.06, 0.015, this.grip.depth + 0.02, M.alu, 0, 0, 0.088 + (this.grip.depth + 0.02) / 2);
        const fB = fA.clone();
        g.add(fA, fB);
        const open = this.grip.open;
        return {
          group: g,
          update(st) {
            // st.k: 0=全開, 1=閉（st.width があればその幅で止まる）
            const w = st.width != null ? Math.max(st.width, open * (1 - st.k)) : open * (1 - st.k * 0.9);
            fA.position.y = w / 2 + 0.0075; fB.position.y = -w / 2 - 0.0075;
            setLed(led, st);
          }
        };
      }
    }
  ];

  RS.DEFAULT_TOOL = 'glass4';
  RS.toolById = id => RS.TOOLS.find(t => t.id === id) || RS.TOOLS[0];
})(window.RS = window.RS || {});
