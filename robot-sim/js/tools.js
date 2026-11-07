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
      alu: new T.MeshStandardMaterial({ color: 0xc3c9d1, roughness: 0.35, metalness: 0.6 }),
      dark: new T.MeshStandardMaterial({ color: 0x30363e, roughness: 0.6, metalness: 0.3 }),
      rubber: new T.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.9, metalness: 0 }),
      blue: new T.MeshStandardMaterial({ color: 0x2f6fd0, roughness: 0.5, metalness: 0.2 }),
      white: new T.MeshStandardMaterial({ color: 0xe6eaef, roughness: 0.5, metalness: 0.1 }),
      led: new T.MeshStandardMaterial({ color: 0x777777, emissive: 0x000000, roughness: 0.4 })
    };
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
      group() { return new T.Group(); }
    };
  };

  /* LED（状態表示）共通 */
  function setLed(mat, st) {
    if (!st.on) { mat.color.setHex(0x666666); mat.emissive.setHex(0x000000); }
    else if (st.holding) { mat.color.setHex(0x22c55e); mat.emissive.setHex(0x0f7a35); }
    else { mat.color.setHex(0xf59e0b); mat.emissive.setHex(0x7a4a00); }
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
