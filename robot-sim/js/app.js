/* =====================================================================
 * app.js — 画面・3D表示・動作制御・ティーチングペンダント
 * ===================================================================== */
(function () {
  'use strict';
  const T = window.THREE, RS = window.RS;
  const VERSION = '3.7';
  const D2R = Math.PI / 180;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r3 = v => +(+v).toFixed(3);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できない環境 */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 無視 */ } }
  };
  $('#ver').textContent = 'v' + VERSION;
  RS.applyRobotOverrides(store.get('rs3-robot-ov', null));

  /* =================== 入出力の割り当て =================== */
  const IOMAP = {
    yaskawa: {
      handOut: { kind: 'OT', n: 1 }, handIn: { kind: 'IN', n: 1 },
      outs: [['OT', 8]], ins: [['IN', 8]],
      auto: { IN1: 'ハンド保持確認', IN2: '供給台 ワーク有', IN3: '排出台 ワーク有' }, outName: { OT1: 'ハンド（吸着/閉）' },
      fmt: (k, n) => `${k}#(${n})`
    },
    fanuc: {
      handOut: { kind: 'RO', n: 1 }, handIn: { kind: 'RI', n: 1 },
      outs: [['RO', 8], ['DO', 8]], ins: [['RI', 8], ['DI', 8]],
      auto: { RI1: 'ハンド保持確認', DI1: '供給台 ワーク有', DI2: '排出台 ワーク有' }, outName: { RO1: 'ハンド（吸着/閉）' },
      fmt: (k, n) => `${k}[${n}]`
    }
  };

  /* 実機ライン（縦置きラック → コンベア）の入出力。保持確認・ハンドは共通 */
  const CELL_IO = {
    yaskawa: { auto: { IN1: 'ハンド保持確認', IN2: '直進ラック ワーク有', IN3: 'コンベア置き場 ワーク有', IN4: '吸盤接触（押し当て検出）', IN5: '曲進ラック ワーク有' }, outName: { OT1: 'ハンド（吸着）', OT2: '置き完了（コンベア搬送開始）' } },
    fanuc: { auto: { RI1: 'ハンド保持確認', DI1: '直進ラック ワーク有', DI2: 'コンベア置き場 ワーク有', DI3: '吸盤接触（押し当て検出）', DI4: '曲進ラック ワーク有' }, outName: { RO1: 'ハンド（吸着）', DO1: '置き完了（コンベア搬送開始）' } }
  };

  /* =================== 状態 =================== */
  const S = {
    sys: store.get('rs3-sys', store.get('rs2-sys', 'yaskawa')) === 'fanuc' ? 'fanuc' : 'yaskawa',
    cellId: store.get('rs3-cell', 'line') === 'table' ? 'table' : 'line',
    toolId: null,
    workId: null,
    q: null,
    holding: null, gripK: 0, gripWidth: null,
    alarm: null, estop: false,
    io: { out: {}, force: {} },
    ovrRun: 100,
    opts: loadOpts(),
    stats: { count: 0, last: 0, t0: 0 },
    log: []
  };
  /* 保存された設定を、型と範囲を確かめてから使う */
  function loadOpts() {
    const def = { coll: true, trail: true, reach: false, loop: false, autoSup: true, autoOut: true, ovr: 100, jogSpd: 30, skipUnknown: false, waitTimeout: 10, fanucTmout: 30, jbiSjis: true, quality: 'auto', grid: false, pickDir: 'S', ver: 4 };
    const rng = { ovr: [5, 100], jogSpd: [1, 100], waitTimeout: [0, 3600], fanucTmout: [0.1, 3600] };
    const raw = store.get('rs3-opts', store.get('rs2-opts', {})) || {};
    const o = Object.assign({}, def);
    for (const k of Object.keys(def)) {
      const v = raw[k];
      if (typeof v !== typeof def[k]) continue;
      if (typeof v === 'number') { if (!isFinite(v)) continue; const r = rng[k]; o[k] = r ? clamp(v, r[0], r[1]) : v; }
      else o[k] = v;
    }
    if (!(raw.ver >= 4)) o.skipUnknown = false;   // v3.3 から未対応命令は既定で停止
    o.ver = 4;
    return o;
  }
  function validPos(v) {
    if (!v || typeof v !== 'object') return null;
    if (v.k === 'j' && Array.isArray(v.q) && v.q.length === 6 && v.q.every(x => typeof x === 'number' && isFinite(x))) return { k: 'j', q: v.q.slice() };
    if (v.k === 'c' && v.p && ['X', 'Y', 'Z', 'rx', 'ry', 'rz'].every(a => typeof v.p[a] === 'number' && isFinite(v.p[a]))) return { k: 'c', p: Object.assign({}, v.p), cfg: String(v.cfg || 'N U T, 0, 0, 0'), uf: +v.uf || 0, ut: v.ut == null ? 1 : +v.ut };
    return null;
  }
  function loadVars(key) {
    const raw = store.get(key, null) || {};
    const out = { num: {}, pos: {}, conv: 2 };
    if (raw.num && typeof raw.num === 'object') for (const [k, v] of Object.entries(raw.num)) if (typeof v === 'number' && isFinite(v)) out.num[k] = v;
    if (raw.pos && typeof raw.pos === 'object') for (const [k, v] of Object.entries(raw.pos)) { const p = validPos(v); if (p) out.pos[k] = p; }
    if (raw.conv !== 2) for (const p of Object.values(out.pos)) if (p.k === 'j') p.q[4] = -p.q[4];   // v3.3 で B/J5 の向きを変更
    return out;
  }
  function loadUF(key) {
    const raw = store.get(key, {}) || {}, out = {};
    for (const [n, u] of Object.entries(raw)) if (u && ['X', 'Y', 'Z', 'rx', 'ry', 'rz'].every(a => typeof u[a] === 'number' && isFinite(u[a]))) out[n] = u;
    return out;
  }
  const cellTool = id => (id === 'line' ? 'glassV' : RS.DEFAULT_TOOL);
  S.toolId = RS.toolById(store.get('rs3-tool', store.get('rs2-tool', cellTool(S.cellId)))).id;
  let robot = RS.ROBOTS[S.sys];
  let tool = RS.toolById(S.toolId);
  {
    const w = store.get('rs3-work', tool.work);
    S.workId = RS.WORKS[w] ? w : tool.work;
  }
  S.q = robot.home.slice();
  const saveOpts = () => store.set('rs3-opts', S.opts);
  let ioCache = null;
  const io = () => {
    const key = S.sys + (CELL ? CELL.id : '');
    if (!ioCache || ioCache.key !== key) ioCache = { key, v: CELL && CELL.id === 'line' ? Object.assign({}, IOMAP[S.sys], CELL_IO[S.sys]) : IOMAP[S.sys] };
    return ioCache.v;
  };
  const handOn = () => !!S.io.out[io().handOut.kind + io().handOut.n];

  /* =================== Three.js シーン =================== */
  const canvas = $('#c'), stage = $('#stage');
  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(40, 1, 0.05, 50);
  // 照明：天井の照明（真上寄りの主光源）＋建屋からの照り返し（環境マップ）
  scene.add(new T.HemisphereLight(0xf4f6f8, 0x5d6f62, 0.55));
  const sun = new T.DirectionalLight(0xfff6ea, 1.5);
  sun.position.set(1.6, 7.5, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -3.2, right: 3.2, top: 3.2, bottom: -3.2, near: 1, far: 14 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.002;
  scene.add(sun); scene.add(sun.target); sun.target.position.set(0.45, 0, 0);
  const fill = new T.DirectionalLight(0xe4ecf5, 0.35); fill.position.set(-4, 5, -3); scene.add(fill);
  const look = RS.makeLook(T, renderer, scene, camera);

  function shadowed(m) { m.castShadow = true; m.receiveShadow = true; return m; }
  function mesh(geo, mat, x, y, z) { const m = shadowed(new T.Mesh(geo, mat)); m.position.set(x || 0, y || 0, z || 0); return m; }

  /* 床 */
  // 床は建屋（look.js）の塗り床。目盛り（250mm 格子）は設定で表示できる
  let reachRing;
  const grid = new T.GridHelper(8, 32, 0xdfe6dd, 0xdfe6dd);
  grid.material.transparent = true; grid.material.opacity = 0.35; grid.material.depthWrite = false;
  grid.position.y = 0.003; scene.add(grid);

  /* =================== セル（周りの設備：cell.js） =================== */
  let CELL = null, TABLES = [], FENCE = { x: [-9, 9], z: [-9, 9] }, FLOOR_Y = 0;
  const lineKey = 'rs3-line3';   // 配置の項目が変わったので別のキー
  { const sv = store.get(lineKey, null); if (sv && typeof sv === 'object') RS.setLine(sv); }
  function buildCellScene(id) {
    if (CELL) { scene.remove(CELL.group); CELL.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    CELL = RS.buildCell(T, id, RS.lookTex || {});
    TABLES = CELL.TABLES; FENCE = CELL.FENCE; FLOOR_Y = CELL.FLOOR_Y;
    scene.add(CELL.group);
    look.hall.position.y = FLOOR_Y;
    grid.position.y = FLOOR_Y + 0.003;
    sun.target.position.y = FLOOR_Y;
    ioCache = null;
  }

  /* =================== ロボット =================== */
  let model = null, toolVis = null;
  const G = {};
  const toolKit = RS.makeToolKit(T);
  function buildRobot() {
    if (model) {
      if (S.holding) dropWork(true);
      scene.remove(model.root);
      model.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    model = RS.buildRobotModel(T, robot);
    scene.add(model.root);
    Object.assign(G, model);
    G.tcp = new T.Object3D(); G.mount.add(G.tcp);
    toolVis = null;
    buildTool(); buildReach();
  }
  function buildTool() {
    if (toolVis) { G.mount.remove(toolVis.group); toolVis.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    toolVis = tool.build(toolKit);
    G.mount.add(toolVis.group);
    G.tcp.position.set(tool.tcp[0], tool.tcp[1], tool.tcp[2]);
  }
  function buildReach() {
    if (reachRing) { scene.remove(reachRing); reachRing.geometry.dispose(); }
    const d = robot.dims, R = d.pivR + d.la + Math.hypot(d.ua, d.a3 || 0) + d.fl + tool.tcp[2];
    reachRing = new T.Mesh(new T.RingGeometry(R - 0.012, R, 96), new T.MeshBasicMaterial({ color: 0x0a84ff, transparent: true, opacity: 0.6, side: T.DoubleSide }));
    reachRing.rotation.x = -Math.PI / 2; reachRing.position.y = FLOOR_Y + 0.004;
    reachRing.visible = S.opts.reach;
    scene.add(reachRing);
  }
  let poseDirty = true, cableDirty = true;
  function applyPose() {
    const k = RS.toKin(robot, S.q);
    G.sG.rotation.y = k[0] * D2R;
    G.lG.rotation.z = -k[1] * D2R;
    G.uG.rotation.z = k[2] * D2R;
    G.rG.rotation.x = k[3] * D2R;
    G.bG.rotation.z = -k[4] * D2R;
    G.tG.rotation.x = k[5] * D2R;
    scene.updateMatrixWorld(true);
    cableDirty = true;
    poseDirty = true;
  }
  const tcpMatrix = q => RS.fk(robot, q || S.q, tool.tcp);
  const curPose = () => RS.poseFromMatrix(tcpMatrix());
  const curQ = () => S.q.map(r3);

  /* ロボット座標の行列（Three 変換なし） */
  const C4 = new T.Matrix4().makeBasis(new T.Vector3(1, 0, 0), new T.Vector3(0, 0, -1), new T.Vector3(0, 1, 0));
  const C4i = C4.clone().transpose();
  function rawMat(P) {
    const M = new T.Matrix4().makeRotationZ(P.rz * D2R).multiply(new T.Matrix4().makeRotationY(P.ry * D2R)).multiply(new T.Matrix4().makeRotationX(P.rx * D2R));
    M.setPosition(P.X / 1000, P.Y / 1000, P.Z / 1000);
    return M;
  }
  const ufKey = () => 'rs3-uf-' + S.sys;
  let uframes = loadUF(ufKey());
  function ufMat(n) {
    if (!n) return new T.Matrix4();
    const u = uframes[n];
    if (!u) { logMsg(`ユーザ座標 UF${n} が未設定のため、ベース座標として扱います`, 'warn', 'uf' + n); return new T.Matrix4(); }
    return rawMat(u);
  }
  /* 位置データ → Three ワールド行列（UF を含む） */
  function posMatrix(pos) {
    if (pos.k === 'j') return tcpMatrix(pos.q);
    return C4.clone().multiply(ufMat(pos.uf)).multiply(rawMat(pos.p));
  }
  /* Three ワールド行列 → その UF での姿勢 */
  function poseInUf(M, uf) {
    const raw = C4i.clone().multiply(M);
    const loc = uf ? ufMat(uf).invert().multiply(raw) : raw;
    return RS.poseFromMatrix(C4.clone().multiply(loc));
  }

  /* =================== ワーク =================== */
  let works = [];
  const workDef = () => RS.WORKS[S.workId];
  function makeWork(def) {
    const [sx, sy, sz] = def.size;
    const g = new T.Group();
    const glass = def.opacity < 1;
    const mat = glass
      ? new T.MeshPhysicalMaterial({ color: 0xbfe3d8, roughness: 0.03, metalness: 0, transparent: true, opacity: Math.min(def.opacity, 0.34), depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6 })
      : new T.MeshStandardMaterial({ color: def.color, roughness: 0.8, metalness: 0 });
    // 板ガラスの端面（厚み方向）は緑がかった不透明に近い色に見える
    const edgeM = glass ? new T.MeshPhysicalMaterial({ color: 0x5fa892, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.85, clearcoat: 1 }) : null;
    const m = new T.Mesh(new T.BoxGeometry(sx, sz, sy), glass ? [edgeM, edgeM, mat, mat, edgeM, edgeM] : mat);
    m.castShadow = !glass; m.receiveShadow = true;
    g.add(m);
    // 板ガラスは端面が緑がかって見える。箱・部品は線を描かない（実物に輪郭線はない）
    if (glass) g.add(new T.LineSegments(new T.EdgesGeometry(m.geometry), new T.LineBasicMaterial({ color: 0x9fd8c6, transparent: true, opacity: 0.7 })));
    scene.add(g);
    return { def, g, vy: 0, falling: false };
  }
  function disposeWork(w) { if (w.g.parent) w.g.parent.remove(w.g); w.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); }); }
  function clearWorks() {
    S.holding = null;
    for (const w of works) disposeWork(w);
    works = [];
  }
  function spawnAt(tbl) {
    const def = workDef(), w = makeWork(def);
    w.g.position.set(tbl.X, tbl.h + def.size[2] / 2, -tbl.Y);
    works.push(w);
    return w;
  }
  function resetWorks() {
    clearWorks();
    if (CELL.id === 'line') {
      CELL.conveyor.running = 0;
      for (const r of CELL.racks) { r.rotating = 0; r.fillT = 0; for (const f of r.faces) { f.front = null; f.stack = disposeStack(r, f); setFace(r, f, CELL.glassDef.count); } }
    } else spawnAt(TABLES[0]);
    updateToolVis();
  }
  /* ---- 実機ライン：ラックに立てかけたガラス ---- */
  let stackMats = null;
  function disposeStack(r, f) { if (f.stack) { r.rot.remove(f.stack); f.stack.geometry.dispose(); } return null; }
  /* 面 f の i 枚目（0＝背もたれ側）の位置・向き（ラックの回転部分の座標） */
  function sheetMatrix(f, i, th) {
    const g = CELL.glassDef, x = new T.Vector3(0, 0, 1), y = f.n.clone(), z = new T.Vector3().crossVectors(x, y);
    const c = f.B.clone().addScaledVector(f.d, g.h / 2).addScaledVector(f.n, th != null ? th / 2 : g.t * (i + 0.5));
    return new T.Matrix4().makeBasis(x, y, z).setPosition(c);
  }
  function setFace(r, f, count) {
    f.count = Math.max(0, count);
    if (f.front && f.front.rack) { disposeWork(f.front); works.splice(works.indexOf(f.front), 1); }
    f.front = null; f.stack = disposeStack(r, f);
    if (!f.count) return;
    const w = makeWork(RS.WORKS.glassDark);
    r.rot.add(w.g);
    sheetMatrix(f, f.count - 1).decompose(w.g.position, w.g.quaternion, w.g.scale);
    w.rack = r; w.face = f; f.front = w; works.push(w);
    if (f.count > 1) {
      const g = CELL.glassDef, th = g.t * (f.count - 1);
      if (!stackMats) {
        const face = new T.MeshPhysicalMaterial({ color: 0x15191b, roughness: 0.05, metalness: 0, clearcoat: 1, envMapIntensity: 1.8 });
        const side = new T.MeshStandardMaterial({ color: 0x24493d, roughness: 0.35 });
        stackMats = [side, side, face, face, side, side];
      }
      const m = new T.Mesh(new T.BoxGeometry(g.w, th, g.h), stackMats);
      sheetMatrix(f, 0, th).decompose(m.position, m.quaternion, m.scale);
      m.castShadow = true; m.receiveShadow = true;
      r.rot.add(m); f.stack = m;
    }
  }
  /* 吸盤がガラス面に触れているか（接触センサー） */
  function cupContact() {
    if (tool.kind !== 'vacuum') return false;
    const up = new T.Vector3(0, 0, 1).applyQuaternion(G.mount.getWorldQuaternion(_q));
    const stroke = tool.stroke || 0.004;
    for (const w of works) {
      if (w === S.holding || w.falling) continue;
      const wup = new T.Vector3(0, 1, 0).applyQuaternion(w.g.getWorldQuaternion(new T.Quaternion()));
      if (up.dot(wup) > -0.9) continue;
      const [sx, sy, sz] = w.def.size;
      for (const [cx, cy] of tool.cups) {
        _v.set(cx, cy, tool.tcp[2]); G.mount.localToWorld(_v); w.g.worldToLocal(_v);
        const gap = _v.y - sz / 2;
        if (Math.abs(_v.x) <= sx / 2 && Math.abs(_v.z) <= sy / 2 && gap <= 0.001 && gap > -stroke - 0.01) return true;
      }
    }
    return false;
  }
  const rackOf = id => CELL.racks && CELL.racks.find(r => r.id === id);
  const rackHas = id => { const r = rackOf(id); return !!r && !r.rotating && r.faces[r.inside].count > 0; }
  function convWorks() { return works.filter(w => !w.rack && w !== S.holding && !w.falling && tableAt(w.g.position.x, w.g.position.z) === TABLES[0]); }
  const convPos = (w, C) => _v.copy(w.g.position).sub(C.p0).dot(C.u);   // 上流端からの距離
  const placeBusy = () => convWorks().some(w => Math.abs(convPos(w, CELL.conveyor) - CELL.conveyor.placeD) < 0.75);
  function tableAt(x, z) { return TABLES.find(t => Math.abs(x - t.X) <= t.w / 2 && Math.abs(-z - t.Y) <= t.d / 2); }
  function worksOn(tbl) { return works.filter(w => w !== S.holding && !w.falling && !w.rack && tableAt(w.g.position.x, w.g.position.z) === tbl); }
  function supportY(w) {
    const p = w.g.position;
    let y = 0;
    const t = tableAt(p.x, p.z); if (t) y = t.h;
    for (const o of works) {
      if (o === w || o === S.holding || o.rack) continue;
      const lp = o.g.worldToLocal(p.clone());
      if (Math.abs(lp.x) <= o.def.size[0] / 2 && Math.abs(lp.z) <= o.def.size[1] / 2 && o.g.position.y < p.y)
        y = Math.max(y, o.g.position.y + o.def.size[2] / 2);
    }
    return y;
  }
  const _v = new T.Vector3(), _v2 = new T.Vector3(), _q = new T.Quaternion();
  function tryGrasp() {
    if (S.holding || !handOn()) return false;
    const cand = works.filter(w => !w.falling);
    if (tool.kind === 'vacuum') {
      const up = new T.Vector3(0, 0, 1).applyQuaternion(G.mount.getWorldQuaternion(_q));
      for (const w of cand) {
        const wup = new T.Vector3(0, 1, 0).applyQuaternion(w.g.getWorldQuaternion(new T.Quaternion()));
        if (up.dot(wup) > -0.97) continue;
        const [sx, sy, sz] = w.def.size;
        let ok = 0;
        for (const [cx, cy] of tool.cups) {
          _v.set(cx, cy, tool.tcp[2]);
          G.mount.localToWorld(_v);
          w.g.worldToLocal(_v);
          const inX = Math.abs(_v.x) <= sx / 2 - tool.cupR * 0.5, inZ = Math.abs(_v.z) <= sy / 2 - tool.cupR * 0.5;
          const gap = _v.y - sz / 2;
          if (inX && inZ && gap > -(tool.stroke || 0.004) && gap < 0.004) ok++;
        }
        if (ok === tool.cups.length) { attach(w); return true; }
      }
    } else {
      G.tcp.getWorldPosition(_v);
      for (const w of cand) {
        const lp = w.g.worldToLocal(_v.clone());
        const [sx, sy, sz] = w.def.size;
        if (Math.abs(lp.x) > sx / 2 || Math.abs(lp.z) > sy / 2 || Math.abs(lp.y) > sz / 2) continue;
        const ty = new T.Vector3(0, 1, 0).applyQuaternion(G.mount.getWorldQuaternion(_q));
        const wq = w.g.getWorldQuaternion(new T.Quaternion());
        const ax = [new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1)].map(a => a.applyQuaternion(wq));
        const width = Math.abs(ty.dot(ax[0])) * sx + Math.abs(ty.dot(ax[1])) * sz + Math.abs(ty.dot(ax[2])) * sy;
        if (width >= tool.grip.open - 0.005) continue;
        attach(w); S.gripWidth = width; return true;
      }
    }
    return false;
  }
  function attach(w) {
    G.mount.attach(w.g); S.holding = w; w.falling = false; w.vy = 0;
    if (w.rack) { const r = w.rack, f = w.face; w.rack = null; w.face = null; f.front = null; setFace(r, f, f.count - 1); }   // 次の 1 枚が手前になる
    updateToolVis();
  }
  function dropWork(instant) {
    const w = S.holding; if (!w) return;
    scene.attach(w.g);
    const ax = new T.Vector3(1, 0, 0).applyQuaternion(w.g.quaternion);
    w.g.rotation.set(0, Math.atan2(-ax.z, ax.x), 0);
    S.holding = null; S.gripWidth = null;
    w.falling = true; w.vy = 0;
    if (instant) { w.g.position.y = supportY(w) + w.def.size[2] / 2; w.falling = false; }
    updateToolVis();
  }
  function setHand(on) {
    if (!on && S.holding) dropWork(false);
    if (on) tryGrasp();
    updateToolVis(); updateOutBtn();
  }
  function updateToolVis() { if (toolVis) toolVis.update({ on: handOn(), holding: !!S.holding, k: S.gripK, width: S.holding ? S.gripWidth : null }); }

  /* I/O */
  function setOut(kind, n, v) {
    const was = !!S.io.out[kind + n];
    S.io.out[kind + n] = !!v;
    const h = io().handOut;
    if (kind === h.kind && n === h.n) setHand(!!v);
    if (v && !was && CELL && CELL.conveyor && /置き完了/.test(io().outName[kind + n] || '')) CELL.conveyor.running = 1.0;   // 搬送開始
  }
  function getOut(kind, n) { return !!S.io.out[kind + n]; }
  function getIn(kind, n) {
    const key = kind + n;
    if (S.io.force[key] != null) return S.io.force[key];
    const a = io().auto[key];
    if (a === 'ハンド保持確認') return !!S.holding;
    if (a === '供給台 ワーク有') return worksOn(TABLES[0]).length > 0;
    if (a === '排出台 ワーク有') return worksOn(TABLES[1]).length > 0;
    if (a === '直進ラック ワーク有') return rackHas('S');
    if (a === '曲進ラック ワーク有') return rackHas('C');
    if (a === 'コンベア置き場 ワーク有') return placeBusy();
    if (a === '吸盤接触（押し当て検出）') return cupContact();
    return false;
  }

  /* 自動供給・払い出し */
  let supT = 0, outT = 0;
  function near(t) { G.tcp.getWorldPosition(_v); return Math.hypot(_v.x - t.X, -_v.z - t.Y) < 0.6 && _v.y < t.h + 0.6; }
  const ROT_T = 6;   // ターンテーブルが半回転する時間（秒、推定）
  function countOut(n) {
    const now = performance.now();
    if (S.stats.t0) S.stats.last = (now - S.stats.t0) / 1000 / n / (S.timeScale || 1);
    S.stats.t0 = now; S.stats.count += n;
    updateCycle();
  }
  function lineTick(dt) {
    G.tcp.getWorldPosition(_v2);
    for (const r of CELL.racks) {
      if (r.rotating > 0) {   // 半回転して、外で補充した面をロボット側へ
        r.rotating = Math.max(0, r.rotating - dt);
        const k = 1 - r.rotating / ROT_T;
        r.rot.rotation.y = r.rotFrom + Math.PI * k * k * (3 - 2 * k);
        if (!r.rotating) { r.inside = 1 - r.inside; r.rot.rotation.y = r.rotFrom + Math.PI; logMsg(`${r.name}：ターンテーブルが回転しました（新しいガラスがロボット側に来ました）`); }
        continue;
      }
      const inF = r.faces[r.inside], outF = r.faces[1 - r.inside];
      if (!S.opts.autoSup) continue;
      if (!outF.count) { r.fillT = (r.fillT || 0) + dt; if (r.fillT > 3) { r.fillT = 0; setFace(r, outF, CELL.glassDef.count); } }   // 作業者が外側の面に補充
      const away = Math.hypot(_v2.x - r.def.X, _v2.z + r.def.Y) > 1.25;
      if (!inF.count && outF.count && away && !(S.holding && S.holding.face)) { r.rotating = ROT_T; r.rotFrom = r.rot.rotation.y; }
    }
    const C = CELL.conveyor, on = convWorks();
    if (C.running > 0) {
      C.running -= dt;
      const v = 0.6 * dt;
      for (const w of on) w.g.position.addScaledVector(C.u, v);   // 上流端 → 下流端の向きへ
      C.tex.offset.y -= v / 0.1;
      const gone = on.filter(w => convPos(w, C) > C.len - 0.55);
      for (const w of gone) { disposeWork(w); works.splice(works.indexOf(w), 1); }
      if (gone.length) countOut(gone.length);
      if (C.running <= 0 && on.length > gone.length) C.running = 0.2;   // 載っている間は流し続ける
      outT = 0;
    } else if (on.length && !S.holding && !handOn()) {
      // ガラスをコンベアに置いて手を離したら、信号がなくても流れ始める（実機のコンベアは置いたら搬送する）
      outT += dt; if (outT > 0.8) { outT = 0; C.running = 1; }
    } else outT = 0;
  }
  function cellTick(dt) {
    if (CELL.id === 'line') { lineTick(dt); return; }
    if (S.opts.autoSup && !worksOn(TABLES[0]).length && !works.some(w => w.falling) && !(S.holding && near(TABLES[0]))) {
      supT += dt; if (supT > 1.0) { supT = 0; spawnAt(TABLES[0]); }
    } else supT = 0;
    const onB = worksOn(TABLES[1]);
    if (S.opts.autoOut && onB.length && !near(TABLES[1])) {
      outT += dt;
      if (outT > 1.5) {
        outT = 0;
        for (const w of onB) { disposeWork(w); works.splice(works.indexOf(w), 1); }
        countOut(onB.length);
      }
    } else outT = 0;
  }

  /* =================== 干渉チェック =================== */
  function collisionCheck() {
    if (!S.opts.coll) return '';
    const pts = [];
    for (const p of tool.probes) { _v.set(p[0], p[1], p[2]); pts.push({ p: G.mount.localToWorld(_v.clone()), r: 0, what: 'ハンド' }); }
    pts.push({ p: G.bG.getWorldPosition(new T.Vector3()), r: 0.08, what: '手首' });
    pts.push({ p: G.uG.getWorldPosition(new T.Vector3()), r: 0.14, what: '肘' });
    pts.push({ p: G.mount.getWorldPosition(new T.Vector3()), r: 0.05, what: 'フランジ' });
    const d = robot.dims;
    for (const f of [0.35, 0.7]) pts.push({ p: G.lG.localToWorld(new T.Vector3(0, d.la * f, 0.15)), r: 0.1, what: '下腕' });
    for (const f of [0.35, 0.7]) pts.push({ p: G.rG.localToWorld(new T.Vector3(d.ua * f, 0, 0)), r: 0.09, what: '上腕' });
    if (S.holding) {
      const w = S.holding, [sx, sy, sz] = w.def.size;
      for (const a of [-1, 1]) for (const b of [-1, 1]) {
        _v.set(a * sx / 2, -sz / 2, b * sy / 2);
        pts.push({ p: w.g.localToWorld(_v.clone()), r: 0, what: '保持ワーク', tol: 0.003 });
      }
    }
    for (const it of pts) {
      const { p, r } = it, tol = it.tol != null ? it.tol : 0.002;
      if (p.y - r < FLOOR_Y - tol) return it.what + 'が床に当たります';
      for (const ob of CELL.OBST) if (ob.test(p)) return `${it.what}が${ob.name}に当たります`;
      if ((p.x - r < FENCE.x[0] || p.x + r > FENCE.x[1] || p.z - r < FENCE.z[0] || p.z + r > FENCE.z[1]) &&
        !(FENCE.open || []).some(o => p.x >= o.x[0] && p.x <= o.x[1] && p.z >= o.z[0] && p.z <= o.z[1])) return it.what + 'が安全柵に当たります';
      for (const t of TABLES) {
        if (Math.abs(p.x - t.X) <= t.w / 2 + r && Math.abs(-p.z - t.Y) <= t.d / 2 + r && p.y - r < t.h - tol && p.y > (t.y0 != null ? t.y0 : 0) - 0.01)
          return `${it.what}が${t.name}に当たります`;
      }
    }
    if (tool.kind === 'vacuum') {
      for (const w of works) {
        if (w === S.holding || w.falling) continue;
        const [sx, sy, sz] = w.def.size;
        for (let i = 0; i < tool.probes.length; i++) {
          const lp = w.g.worldToLocal(pts[i].p.clone());
          // ワーク上面から 2mm 以上めり込んだら干渉（薄い板ガラスでも検出できるよう、上面基準で判定）
          // 吸盤（probes の先頭）はバネの縮み代までは押し当ててよい
          const allow = i < tool.cups.length ? Math.max(0.002, tool.stroke || 0) : 0.002;
          if (Math.abs(lp.x) < sx / 2 - 0.003 && Math.abs(lp.z) < sy / 2 - 0.003 && lp.y < sz / 2 - allow && lp.y > -sz / 2 - 0.05) return 'ハンドがワークに当たります';
        }
      }
    }
    return '';
  }

  /* =================== ログ・アラーム =================== */
  const logged = new Set();
  function logMsg(msg, lv, onceKey) {
    if (onceKey) { if (logged.has(onceKey)) return; logged.add(onceKey); }
    const t = new Date();
    S.log.push({ t: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`, msg, lv: lv || 'info' });
    if (S.log.length > 200) S.log.shift();
    renderLog();
  }
  const ALM = {
    estop: ['ALM 100', '非常停止中です'],
    coll: ['ALM 201', '干渉を検出しました'],
    reach: ['ALM 202', '目標位置が動作範囲外です'],
    sing: ['ALM 203', '特異点付近のため直線動作できません'],
    limit: ['ALM 204', '可動範囲を超えます'],
    hand: ['ALM 301', 'ハンド確認信号が来ません'],
    wait: ['ALM 302', '入力待ちタイムアウト'],
    prog: ['ALM 401', 'プログラムエラー']
  };
  function raiseAlarm(key, detail) {
    const [code, msg] = ALM[key] || ALM.prog;
    S.alarm = { code, msg: msg + (detail ? '：' + detail : '') };
    const errLine = run && run.interp.frame && run.interp.progName === prog().name ? run.interp.pc : -1;
    stopAll();
    if (errLine >= 0) markErrLine(errLine);
    $('#alarmCode').textContent = code;
    $('#alarmMsg').textContent = S.alarm.msg;
    $('#alarm').hidden = false;
    pend.msg = code + ' ' + S.alarm.msg;
    logMsg(code + ' ' + S.alarm.msg, 'err');
    refreshState();
  }
  function resetAlarm() {
    if (S.estop) { flash('#jogMsg', '非常停止を解除してからリセットしてください'); return; }
    S.alarm = null; $('#alarm').hidden = true; pend.msg = '';
    $$('.code li.err').forEach(li => li.classList.remove('err'));
    refreshState();
  }
  $('#alarmReset').addEventListener('click', resetAlarm);
  $('#estopBtn').addEventListener('click', () => {
    S.estop = !S.estop;
    $('#estopBtn').classList.toggle('on', S.estop);
    $('#estopBtn').textContent = S.estop ? '非常停止 解除' : '非常停止';
    if (S.estop) { pend.ready = false; pend.enable = false; raiseAlarm('estop'); } else refreshState();
    renderPend();
  });

  /* =================== 動作 =================== */
  let mv = null, run = null;
  let motLim = null;    // ペンダント操作時の制限 { spdFac, tcpCap(mm/s) }
  let stepKeep = null;  // 1行実行・押している間の運転を止めたときの続き { it, prog, pc }
  const smooth = k => k * k * (3 - 2 * k);
  const ovr = () => S.opts.ovr / 100 * (run ? S.ovrRun / 100 : 1) * (motLim ? motLim.spdFac : 1);
  const tcpCap = () => (motLim && motLim.tcpCap) || 0;
  function canMove() {
    if (S.estop) return '非常停止中です';
    if (S.alarm) return 'アラームをリセットしてください';
    return '';
  }
  /* 関節補間（vPct: 速度%、dur: 時間指定 秒） */
  function startJ(to, vPct, done, dur) {
    const lv = RS.limitViolation(robot, to);
    if (lv >= 0) { raiseAlarm('limit', robot.axes[lv] + '軸'); return false; }
    const from = S.q.slice();
    let tt = 0;
    if (dur != null) tt = dur / ovr();
    else {
      const f = clamp(vPct, 0.1, 100) / 100 * ovr();
      for (let i = 0; i < 6; i++) tt = Math.max(tt, Math.abs(to[i] - from[i]) / (robot.vmax[i] * f));
      tt *= 1.5;
    }
    if (tcpCap()) {   // 教示モード（T1）は TCP 速度 250mm/s まで
      const a = new T.Vector3().setFromMatrixPosition(tcpMatrix(from)), b = new T.Vector3().setFromMatrixPosition(tcpMatrix(to));
      tt = Math.max(tt, 1.5 * a.distanceTo(b) * 1000 / tcpCap());
    }
    mv = { kind: 'j', from, to: to.slice(), dur: Math.max(0.12, tt), t: 0, done };
    return true;
  }
  /* 直線補間（vmm: mm/s、opt.rot: 姿勢速度 deg/s、opt.dur: 時間指定） */
  function planL(M, vmm, opt) {
    opt = opt || {};
    const r = RS.planLinear(robot, S.q, M, tool.tcp);
    if (!r.ok) return r;
    const f = ovr();
    let tj = 0;
    for (let i = 0; i < 6; i++) {
      let s = 0; for (let k = 1; k < r.qs.length; k++) s = Math.max(s, Math.abs(r.qs[k][i] - r.qs[k - 1][i]));
      tj = Math.max(tj, s * (r.qs.length - 1) / robot.vmax[i]);
    }
    if (opt.dur != null) r.dur = Math.max(0.12, opt.dur / f, 1.5 * tj / f);
    else {
      const tl = vmm ? (r.dist * 1000) / (clamp(vmm, 0.1, robot.vlMax) * f) : 0;
      const ta = r.ang / ((opt.rot || 180) * f);
      r.dur = Math.max(0.12, 1.5 * Math.max(tl, ta), 1.5 * tj / f);
    }
    if (tcpCap()) r.dur = Math.max(r.dur, 1.5 * r.dist * 1000 / tcpCap());
    return r;
  }
  function startL(M, vmm, done, opt) {
    const r = planL(M, vmm, opt);
    if (!r.ok) { raiseAlarm(r.err === 'singular' ? 'sing' : 'reach', `直線経路の${Math.round(r.at * 100)}%地点`); return false; }
    mv = { kind: 'p', qs: r.qs, dur: r.dur, t: 0, done };
    return true;
  }
  function stepMotion(dt) {
    if (!mv || (run && run.paused)) return;
    // 入力で止まる移動は細かく刻んで、行き過ぎを小さくする
    const n = mv.stopIf ? 8 : 1;
    for (let s = 0; s < n && mv; s++) stepMotion1(dt / n);
  }
  function stepMotion1(dt) {
    mv.t += dt;
    const k = Math.min(1, mv.t / mv.dur), e = smooth(k);
    const prev = S.q.slice();
    if (mv.kind === 'j') for (let i = 0; i < 6; i++) S.q[i] = mv.from[i] + (mv.to[i] - mv.from[i]) * e;
    else {
      const n = mv.qs.length - 1, x = e * n, i0 = Math.min(Math.max(0, n - 1), Math.floor(x)), fr = n ? x - i0 : 0;
      const a = mv.qs[i0], b = mv.qs[Math.min(n, i0 + 1)];
      for (let i = 0; i < 6; i++) S.q[i] = a[i] + (b[i] - a[i]) * fr;
    }
    applyPose();
    const c = collisionCheck();
    if (c) { S.q = prev; applyPose(); raiseAlarm('coll', c); return; }
    if (handOn() && !S.holding) tryGrasp();
    if (S.opts.trail && run) addTrail();
    if (mv.stopIf && mv.stopIf()) { const cb = mv.done; mv = null; if (cb) cb(true); return; }
    if (k >= 1) { const cb = mv.done; mv = null; if (cb) cb(false); }
  }
  function stopAll() {
    mv = null;
    jogHold = null;
    motLim = null; stepKeep = null;
    $$('.hold').forEach(b => b.classList.remove('hold'));
    if (run) { run = null; S.ovrRun = 100; renderCode(); }
    refreshState();
  }

  /* プログラムの移動命令を実行する */
  function addRot(raw, P) { // ベース側から回転 P を掛け、位置を P だけ動かす
    const p = new T.Vector3().setFromMatrixPosition(raw).add(new T.Vector3(P.X / 1000, P.Y / 1000, P.Z / 1000));
    const R = new T.Matrix4().extractRotation(rawMat({ X: 0, Y: 0, Z: 0, rx: P.rx, ry: P.ry, rz: P.rz })).multiply(new T.Matrix4().extractRotation(raw));
    R.setPosition(p);
    return R;
  }
  function execMove(a, done) {
    let M = null, q = null, pref = null;
    if (a.rel) {
      const cur = C4i.clone().multiply(tcpMatrix());
      M = C4.clone().multiply(a.rel.frame === 'TF' ? cur.multiply(rawMat(a.rel.p)) : addRot(cur, a.rel.p));
    } else {
      const pos = a.pos;
      if (pos.k === 'c' && pos.ut != null && pos.ut > 1) logMsg(`UT${pos.ut} の位置を、今のハンドの TCP で動かします`, 'warn', 'ut' + pos.ut);
      if (pos.k === 'j' && !a.offset && !a.shift) q = pos.q.slice();
      else if (pos.k === 'j' && a.offset && a.offset.pos.k === 'j' && !a.shift) q = pos.q.map((v, i) => v + a.offset.pos.q[i]);
      else {
        let raw = C4i.clone().multiply(posMatrix(pos));
        if (a.offset) {
          const o = a.offset.pos;
          if (o.k !== 'c') { raiseAlarm('prog', '関節形式の PR は関節位置にだけ足せます'); return; }
          if (a.offset.type === 'tool') raw = raw.multiply(rawMat(o.p));
          else {
            const U = ufMat(pos.k === 'c' ? (pos.uf || 0) : 0);
            raw = U.clone().multiply(addRot(U.clone().invert().multiply(raw), o.p));
          }
        }
        if (a.shift) raw = a.shift.frame === 'TF' ? raw.multiply(rawMat(a.shift.p)) : addRot(raw, a.shift.p);
        M = C4.clone().multiply(raw);
        if (pos.k === 'c' && S.sys === 'fanuc') pref = RS.parseConfig(pos.cfg);
      }
    }
    const sp = a.speed || { v: 50, unit: '%' };
    if (a.mode === 'J') {
      if (!q) {
        const ref = a.pos && a.pos.q && !a.offset && !a.shift ? a.pos.q : S.q;
        const r = RS.ik(robot, M, tool.tcp, ref, pref);
        if (!r.q) { if (r.err === 'config') raiseAlarm('prog', `${a.prog} ${a.line + 1}行目：肘下（D）・後方（B）の形態はシミュレーターで再現できません`); else raiseAlarm(r.err === 'reach' ? 'reach' : 'limit', `${a.prog} ${a.line + 1}行目`); return; }
        q = r.q;
      }
      if (sp.unit === 'sec' || sp.unit === 'msec') startJ(q, null, done, sp.unit === 'sec' ? sp.v : sp.v / 1000);
      else startJ(q, sp.v, done);
    } else {
      if (!M) M = tcpMatrix(q);
      const u = sp.unit;
      if (u === 'sec' || u === 'msec') startL(M, null, done, { dur: u === 'sec' ? sp.v : sp.v / 1000 });
      else if (u === 'deg/s') startL(M, null, done, { rot: sp.v });
      else startL(M, u === 'cm/min' ? sp.v / 6 : u === 'inch/min' ? sp.v * 25.4 / 60 : sp.v, done);
    }
  }

  /* =================== プログラム・ライブラリ =================== */
  const libKey = () => 'rs3-lib-' + S.sys;
  let lib = loadLib();
  function loadLib() {
    const L = store.get(libKey(), null);
    const out = { cur: 'MAIN', progs: {} };
    if (L && L.progs) {
      for (const p of Object.values(L.progs)) { const v = RS.validateProgram(p, S.sys); if (v) { v.sys = S.sys; out.progs[v.name] = v; } }
      if (L.cur && out.progs[L.cur]) out.cur = L.cur;
    } else {
      const old = RS.validateProgram(store.get('rs2-prog-' + S.sys, null), S.sys);   // v2 からの移行
      if (old && old.lines.length) { old.name = 'SAMPLE'; out.progs.SAMPLE = old; out.cur = 'SAMPLE'; }
    }
    if (!L || L.conv !== 2) {   // v3.3 で B/J5 の向き（ツール下向き＝-90°）を変更したので、保存済みの関節値を変換
      for (const p of Object.values(out.progs)) for (const pos of Object.values(p.pos)) {
        if (pos.k === 'j') pos.q[4] = -pos.q[4];
        if (pos.q) { if (pos.k === 'c') pos.q[4] = -pos.q[4]; if (pos.k === 'c') pos.cfg = RS.configOf(pos.q); }
      }
    }
    out.conv = 2;
    if (!Object.keys(out.progs).length) out.progs.MAIN = RS.emptyProgram(S.sys, 'MAIN', S.toolId);
    if (!out.progs[out.cur]) out.cur = Object.keys(out.progs)[0];
    return out;
  }
  const prog = () => lib.progs[lib.cur];
  function saveLib() { lib.conv = 2; store.set(libKey(), lib); }
  let sel = -1;
  let undoStack = [];
  function pushUndo() { undoStack.push(JSON.stringify(lib)); if (undoStack.length > 60) undoStack.shift(); }
  function undo() {
    if (run) return;
    const s = undoStack.pop(); if (!s) { flash('#progMsg', 'これ以上戻せません'); return; }
    lib = JSON.parse(s);
    sel = clamp(sel, -1, prog().lines.length - 1); saveLib(); renderProgAll();
  }
  function edit(fn) {
    if (run) { flash('#progMsg', '再生中は編集できません'); return false; }
    pushUndo(); stepKeep = null; fn(); saveLib(); renderCode(); renderPend(); return true;
  }
  function teachPos() {
    if (S.sys === 'yaskawa') return { k: 'j', q: curQ() };
    const P = curPose();
    const p = {}; for (const k of ['X', 'Y', 'Z', 'rx', 'ry', 'rz']) p[k] = r3(P[k]);
    return { k: 'c', p, cfg: RS.configOf(S.q), uf: 0, ut: 1, q: curQ() };
  }
  function insertLine(text, pos) {
    edit(() => {
      const P = prog();
      const at = sel < 0 ? P.lines.length : sel + 1;
      let line = text;
      if (pos) { const id = RS.nextPosId(S.sys, P); P.pos[id] = pos; line = text.replace('@', id); }
      P.lines.splice(at, 0, line); sel = at;
    });
  }
  function lastSpeed(mode) {
    const P = prog();
    for (let i = Math.min(sel, P.lines.length - 1); i >= 0; i--) {
      const ins = RS.parseLine(S.sys, P.lines[i]);
      if (ins.op === 'MOVE' && ins.mode === mode && (ins.speed.unit === '%' || ins.speed.unit === 'mm/s')) return ins.speed.v;
    }
    return mode === 'J' ? 50 : 300;
  }
  function insertMove(mode) { insertLine(RS.lineMove(S.sys, mode, '@', lastSpeed(mode)), teachPos()); }

  /* =================== プログラム実行 =================== */
  const varKey = () => 'rs3-vars-' + S.sys;
  let vars = loadVars(varKey());
  const saveVars = () => store.set(varKey(), vars);
  function makeHost() {
    return {
      lib: () => lib.progs, getIn, getOut, setOut, vars, curPose, curQ,
      setOverride: v => { S.ovrRun = clamp(v, 1, 100); },
      log: (m, lv) => logMsg(m, lv), opts: S.opts
    };
  }
  /* lim: ペンダントからの運転の速度制限 { spdFac, tcpCap } */
  function startRun(from, single, lim) {
    const why = canMove(); if (why) { flash('#progMsg', why); pend.msg = why; return false; }
    const P = prog();
    if (!P.lines.length) { flash('#progMsg', 'プログラムがありません'); return false; }
    const errs = RS.checkProgram(P, lib.progs).filter(e => e.lv === 'err');
    if (errs.length && !single) { flash('#progMsg', `${errs[0].line} 行目：${errs[0].msg}`); renderCheck(); return false; }
    from = clamp(from, 0, P.lines.length - 1);
    const keep = stepKeep;
    jogHold = null; mv = null; stepKeep = null;
    let it, main = P.name;
    if (keep && keep.prog === P.name && keep.pc === from && keep.it.frame) { it = keep.it; main = keep.main; }   // 続きから（SFTON・CALL・OVERRIDE を引き継ぐ）
    else { it = new RS.Interp(makeHost()); it.start(P.name, from); S.ovrRun = 100; }
    run = { interp: it, single: !!single, paused: false, main };
    motLim = lim || null;
    if (!single) { clearTrail(); logged.clear(); }
    lastPcKey = '';
    refreshState(); renderCode();
    return true;
  }
  function stepRun(dt) {
    if (!run || run.paused || mv || S.alarm) return;
    const a = run.interp.tick(dt, run.single);
    if (run && run.interp.frame) syncPc();
    if (!a) return;
    switch (a.t) {
      case 'move':
        execMove(a, met => {
          if (!run) return;
          // ファナック Skip：条件が来ないまま目標に着いたら LBL へ。来たらそこで止まって次の行へ
          if (a.stop && a.stop.lbl != null && !met) {
            if (!run.interp.jump(a.stop.lbl)) { raiseAlarm('prog', `Skip の飛び先 LBL[${a.stop.lbl}] がありません`); return; }
          } else run.interp.done();
          if (a.stop && !met) logMsg(`入力が来ないまま目標に着きました（${a.prog} ${a.line + 1}行目）`, 'warn');
          syncPc();
          if (run.single) finishSingle();
        });
        if (a.stop && mv) { const c = a.stop.cond, it = run.interp; mv.stopIf = () => it.cond(c); }
        break;
      case 'stepped': finishSingle(); break;
      case 'pause': run.paused = true; logMsg('PAUSE で一時停止しました（再生で続行）'); refreshState(); break;
      case 'alarm': raiseAlarm(a.key, a.msg); break;
      case 'end':
        saveVars();
        if (run.single) { finishSingle(); break; }
        if (S.opts.loop) { run.interp.start(run.main, 0); logMsg(`${run.main} を先頭から繰り返します`); }
        else { run = null; S.ovrRun = 100; motLim = null; stepKeep = null; refreshState(); renderCode(); setStatus('プログラム終了'); }
        break;
    }
  }
  function finishSingle() {
    const it = run.interp, main = run.main;
    run = null; motLim = null;
    if (it.frame) {
      // 次の 1 行実行で同じインタプリタを続けて使う（呼び出し先・シフトなどを保つ）
      if (it.progName !== prog().name && lib.progs[it.progName]) { lib.cur = it.progName; renderProgSelect(); }
      sel = clamp(it.pc, 0, prog().lines.length - 1);
      stepKeep = it.pc < it.frame.ins.length ? { it, prog: it.progName, pc: it.pc, main } : null;
    } else { stepKeep = null; S.ovrRun = 100; sel = clamp(sel + 1, 0, prog().lines.length - 1); }
    refreshState(); renderCode(); renderPend(); saveVars();
  }
  /* 押している間だけの運転で、キーを離したとき：止めて、続きから再開できるようにする */
  function holdStop(msg) {
    if (!run) { if (mv) { mv = null; motLim = null; } return; }
    const it = run.interp, main = run.main;
    run = null; mv = null; motLim = null;
    if (it.frame) { if (it.progName !== prog().name && lib.progs[it.progName]) { lib.cur = it.progName; renderProgSelect(); } sel = it.pc; stepKeep = { it, prog: it.progName, pc: it.pc, main }; }
    if (msg) pend.msg = msg;
    refreshState(); renderCode(); updateLcd();
  }
  let lastPcKey = '';
  function syncPc() {
    if (!run || !run.interp.frame) return;
    const it = run.interp;
    const key = it.progName + ':' + it.pc;
    if (key === lastPcKey) return;
    lastPcKey = key;
    if (it.progName !== prog().name && lib.progs[it.progName]) { lib.cur = it.progName; renderProgSelect(); renderCode(); }
    if (it.progName === prog().name) { sel = it.pc; markPc(); }
    if (pendVisible()) updateLcd();
  }

  /* サンプルプログラム（供給台 → 排出台、3回繰り返し） */
  function makeSample() {
    if (CELL.id === 'line') return makeLineSample();
    const def = workDef(), A = TABLES[0], B = TABLES[1];
    const grasp = tool.kind === 'gripper' ? Math.min(def.size[2] * 0.5, tool.grip.depth * 0.6) : 0;
    const zA = A.h + def.size[2] - grasp, zB = B.h + def.size[2] - grasp, ap = tool.approach;
    const P = (t, z) => ({ X: t.X * 1000, Y: t.Y * 1000, Z: r3(z * 1000), rx: 180, ry: 0, rz: 0 });
    const targets = [P(A, zA + ap), P(A, zA), P(B, zB + ap), P(B, zB)];
    const qs = []; let ref = robot.home;
    for (const p of targets) {
      const r = RS.ik(robot, RS.matrixFromPose(p), tool.tcp, ref);
      if (!r.q) { flash('#progMsg', 'サンプルの位置に届きません（ハンド・ワーク・機種寸法の組合せを確認）'); return; }
      qs.push({ q: r.q.map(v => +v.toFixed(4)), p: targets[qs.length] }); ref = r.q;
    }
    const sys = S.sys, ho = io().handOut, hi = io().handIn, Y = sys === 'yaskawa';
    const P2 = RS.emptyProgram(sys, 'SAMPLE', tool.id);
    P2.comment = 'PICK AND PLACE';
    const L = [];
    const mv2 = (mode, t, v, cart) => {
      const id = RS.nextPosId(sys, P2);
      if (!cart) P2.pos[id] = { k: 'j', q: t };
      else P2.pos[id] = { k: 'c', p: Object.assign({}, t.p), cfg: RS.configOf(t.q), uf: 0, ut: 1, q: t.q };
      L.push(RS.lineMove(sys, mode, id, v));
      P2.lines = L;
    };
    const isVac = tool.kind === 'vacuum';
    L.push(RS.lineComment(sys, 'PICK AND PLACE SAMPLE'));
    if (!Y) { L.push('UFRAME_NUM=0'); L.push('UTOOL_NUM=1'); }
    L.push(RS.lineOut(sys, ho, false));
    L.push(Y ? 'SET I000 0' : 'R[1]=0');
    mv2('J', robot.home.slice(), 50, false);
    L.push(Y ? '*LOOP' : 'LBL[1]');
    L.push(RS.lineWait(sys, Y ? { kind: 'IN', n: 2 } : { kind: 'DI', n: 1 }, true));
    mv2('J', qs[0], 50, true);
    mv2('L', qs[1], 200, true);
    L.push(RS.lineOut(sys, ho, true));
    L.push(RS.lineWait(sys, hi, true));
    if (isVac) L.push(RS.lineTimer(sys, 0.2));
    mv2('L', qs[0], 400, true);
    L.push(RS.lineWait(sys, Y ? { kind: 'IN', n: 3 } : { kind: 'DI', n: 2 }, false));
    mv2('J', qs[2], 50, true);
    mv2('L', qs[3], 200, true);
    L.push(RS.lineOut(sys, ho, false));
    L.push(RS.lineWait(sys, hi, false));
    L.push(RS.lineTimer(sys, 0.3));
    mv2('L', qs[2], 400, true);
    mv2('J', robot.home.slice(), 50, false);
    if (Y) { L.push('INC I000'); L.push('JUMP *LOOP IF I000<3'); }
    else { L.push('R[1]=R[1]+1'); L.push('IF R[1]<3,JMP LBL[1]'); }
    P2.lines = L;
    edit(() => { lib.progs.SAMPLE = P2; lib.cur = 'SAMPLE'; sel = 0; });
    renderProgSelect();
    resetWorks();
    setOut(ho.kind, ho.n, false);
    flash('#progMsg', 'サンプル（3回繰り返し）を作成しました。「▶ 再生」で動かせます', true);
  }

  /* 実機ライン用のサンプル：ラックのガラスを押し当てで探して吸着 → コンベアに平置き → 搬送開始 */
  function makeLineSample() {
    const dirId = S.opts.pickDir === 'C' ? 'C' : 'S', r = rackOf(dirId), f = r.faces[r.inside], g = CELL.glassDef;
    const wq = r.rot.getWorldQuaternion(new T.Quaternion());
    const nW = f.n.clone().applyQuaternion(wq), dW = f.d.clone().applyQuaternion(wq);
    const surf = off => r.rot.localToWorld(f.B.clone().addScaledVector(f.d, g.h / 2).addScaledVector(f.n, off));
    const zt = nW.clone().negate(), xt = dW.clone(), yt = new T.Vector3().crossVectors(zt, xt);
    const rackPose = p => { const M = new T.Matrix4().makeBasis(xt, yt, zt).setPosition(p); const P = RS.poseFromMatrix(M); for (const k in P) P[k] = r3(P[k]); return P; };
    const C = CELL.conveyor, zPl = (C.h + g.t) * 1000;
    const placeP = dz => ({ X: r3(C.place.x * 1000), Y: r3(-C.place.z * 1000), Z: r3(zPl + dz), rx: 180, ry: 0, rz: C.axis === 'x' ? 90 : 0 });   // ガラスの長辺をコンベアの流れの向きに
    const targets = [
      rackPose(surf(g.t * g.count).addScaledVector(nW, 0.2)),   // 1: ラックの手前 200mm（満杯のときの 1 枚目から）
      rackPose(surf(0)),                                         // 2: 押し当ての終点（背もたれの面。ガラスがあれば手前で止まる）
      rackPose(surf(g.t * g.count).addScaledVector(nW, 0.25).add(new T.Vector3(0, 0.7, 0))),   // 3: 持ち上げ（ガラスの下辺をコンベアより上へ）
      placeP(350),                                                // 3: コンベアの上
      placeP(150),                                                // 4: 置く手前
      placeP(2),                                                  // 5: 置く（ガラスの下面がコンベアの 2mm 上）
      // 6: 旋回の前にロボットの近くへ引き寄せる（ガラスを持ったまま旋回しても柵・ラックに当たらないように）
      rackPose((() => { const c = new T.Vector3(r.def.X, 0, -r.def.Y).setY(0).normalize().multiplyScalar(0.9); c.y = surf(g.t * g.count).y + 0.7; return c; })()),
      // 7: コンベア側の引き寄せ位置（腕をたたんだまま旋回し終える）
      (() => { const d = new T.Vector3(C.place.x, 0, C.place.z).normalize().multiplyScalar(0.9), zc = (surf(g.t * g.count).y + 0.7) * 1000; return { X: r3(d.x * 1000), Y: r3(-d.z * 1000), Z: r3(zc), rx: 180, ry: 0, rz: C.axis === 'x' ? 90 : 0 }; })()
    ];
    const qs = []; let ref = robot.home;
    for (const p of targets) {
      const res = RS.ik(robot, RS.matrixFromPose(p), tool.tcp, ref);
      if (!res.q) { flash('#progMsg', `サンプルの位置（${qs.length + 1} 点目）に届きません。ハンド・機種寸法・セルの寸法を確認してください`); return; }
      qs.push({ q: res.q.map(v => +v.toFixed(4)), p }); ref = res.q;
    }
    const sys = S.sys, Y = sys === 'yaskawa', ho = io().handOut, hi = io().handIn;
    const inRack = Y ? { kind: 'IN', n: dirId === 'S' ? 2 : 5 } : { kind: 'DI', n: dirId === 'S' ? 1 : 4 };
    const inPlace = Y ? { kind: 'IN', n: 3 } : { kind: 'DI', n: 2 };
    const doneOut = Y ? 'PULSE OT#(2) T=0.50' : 'DO[1]=PULSE,0.5sec';
    const name = dirId === 'S' ? 'GLASS_S' : 'GLASS_C';
    const P2 = RS.emptyProgram(sys, name, tool.id);
    P2.comment = dirId === 'S' ? 'RACK S TO CONV' : 'RACK C TO CONV';
    const L = [], id = {};
    const pt = (k, t, cart) => { if (!id[k]) { id[k] = RS.nextPosId(sys, P2); P2.pos[id[k]] = cart ? { k: 'c', p: Object.assign({}, t.p), cfg: RS.configOf(t.q), uf: 0, ut: 1, q: t.q } : { k: 'j', q: t }; P2.lines = L; } return id[k]; };
    const J = (k, t, v, cart) => { const ref2 = pt(k, t, cart); L.push(RS.lineMove(sys, 'J', ref2, v)); };
    const Lm = (k, t, v) => { const ref2 = pt(k, t, true); L.push(RS.lineMove(sys, 'L', ref2, v)); };
    L.push(RS.lineComment(sys, (dirId === 'S' ? 'STRAIGHT' : 'CURVED') + ' RACK TO CONVEYOR'));
    if (!Y) { L.push('UFRAME_NUM=0'); L.push('UTOOL_NUM=1'); }
    L.push(RS.lineOut(sys, ho, false));
    L.push(Y ? 'SET I000 0' : 'R[1]=0');
    J('home', robot.home.slice(), 30, false);
    L.push(Y ? '*LOOP' : 'LBL[1]');
    L.push(RS.lineWait(sys, inRack, true));
    J('carry', qs[6], 30, true);
    Lm('lift', qs[2], 300);
    Lm('ap', qs[0], 300);
    // 押し当て：吸盤接触が来たら止まる
    pt('end', qs[1], true);
    if (Y) L.push(`MOVL ${id.end} V=50.0 UNTIL IN#(4)=ON`);
    else { L.push('SKIP CONDITION DI[3]=ON'); L.push(`L ${id.end} 50mm/sec FINE Skip,LBL[9]`); }
    if (Y) L.push('JUMP *NOGLASS IF IN#(4)=OFF');
    L.push(RS.lineOut(sys, ho, true));
    L.push(RS.lineWait(sys, hi, true));
    L.push(RS.lineTimer(sys, 0.3));
    Lm('ap', qs[0], 200);
    Lm('lift', qs[2], 300);
    Lm('carry', qs[6], 300);
    L.push(RS.lineWait(sys, inPlace, false));
    J('cf', qs[7], 30, true);
    Lm('up', qs[3], 300);
    Lm('pa', qs[4], 300);
    Lm('pl', qs[5], 50);
    L.push(RS.lineOut(sys, ho, false));
    L.push(RS.lineWait(sys, hi, false));
    L.push(RS.lineTimer(sys, 0.3));
    Lm('pa', qs[4], 200);
    L.push(doneOut);
    Lm('up', qs[3], 300);
    Lm('cf', qs[7], 300);
    if (Y) { L.push('INC I000'); L.push('JUMP *LOOP IF I000<5'); }
    else { L.push('R[1]=R[1]+1'); L.push('IF R[1]<5,JMP LBL[1]'); }
    J('home', robot.home.slice(), 30, false);
    L.push(Y ? 'JUMP *FIN' : 'JMP LBL[99]');
    L.push(Y ? '*NOGLASS' : 'LBL[9]');
    L.push(RS.lineComment(sys, 'NO GLASS FOUND'));
    L.push(RS.lineOut(sys, ho, false));
    Lm('ap', qs[0], 200);
    L.push('PAUSE');
    L.push(Y ? 'JUMP *LOOP' : 'JMP LBL[1]');
    L.push(Y ? '*FIN' : 'LBL[99]');
    P2.lines = L;
    edit(() => { lib.progs[name] = P2; lib.cur = name; sel = 0; });
    renderProgSelect();
    resetWorks();
    setOut(ho.kind, ho.n, false);
    flash('#progMsg', `サンプル ${name}（${r.name}から 5 枚）を作成しました。「▶ 再生」で動かせます`, true);
  }

  /* =================== 軌跡 =================== */
  const TRAIL_MAX = 8000;
  const trailPos = new Float32Array(TRAIL_MAX * 3);
  const trailGeo = new T.BufferGeometry();
  trailGeo.setAttribute('position', new T.BufferAttribute(trailPos, 3));
  trailGeo.setDrawRange(0, 0);
  const trail = new T.Line(trailGeo, new T.LineBasicMaterial({ color: 0xe08a1e }));
  trail.frustumCulled = false; scene.add(trail);
  let trailN = 0;
  function addTrail() {
    G.tcp.getWorldPosition(_v2);
    if (trailN > 0) { const i = (trailN - 1) * 3; if (Math.hypot(trailPos[i] - _v2.x, trailPos[i + 1] - _v2.y, trailPos[i + 2] - _v2.z) < 0.005) return; }
    if (trailN >= TRAIL_MAX) { trailPos.copyWithin(0, 3 * (TRAIL_MAX / 2)); trailN = TRAIL_MAX / 2; }
    trailPos.set([_v2.x, _v2.y, _v2.z], trailN * 3); trailN++;
    trailGeo.setDrawRange(0, trailN); trailGeo.attributes.position.needsUpdate = true;
  }
  function clearTrail() { trailN = 0; trailGeo.setDrawRange(0, 0); }

  /* =================== ジョグ =================== */
  let jogHold = null, stepSize = 0, cartFrame = 'base';
  const LIN_MAX = 250, ROT_MAX = 45, JNT_FRAC = 0.25;
  const BASE_AX = [new T.Vector3(1, 0, 0), new T.Vector3(0, 0, -1), new T.Vector3(0, 1, 0)];
  function cartTarget(M, axis, dir, amt, frame) {
    const N = M.clone();
    if (frame === 'tool') {
      const D = new T.Matrix4();
      if (axis < 3) { const v = [0, 0, 0]; v[axis] = dir * amt / 1000; D.makeTranslation(v[0], v[1], v[2]); }
      else D.makeRotationAxis(new T.Vector3(axis === 3 ? 1 : 0, axis === 4 ? 1 : 0, axis === 5 ? 1 : 0), dir * amt * D2R);
      return N.multiply(D);
    }
    const p = new T.Vector3().setFromMatrixPosition(M);
    if (axis < 3) { p.addScaledVector(BASE_AX[axis], dir * amt / 1000); N.setPosition(p); return N; }
    const R = new T.Matrix4().makeRotationAxis(BASE_AX[axis - 3], dir * amt * D2R);
    const O = R.multiply(new T.Matrix4().extractRotation(M)); O.setPosition(p);
    return O;
  }
  function stepJog(dt) {
    const j = jogHold; if (!j) return;
    const why = canMove() || (j.check ? j.check() : '');
    if (why) { jogMsg(why); endJog(); return; }
    const prev = S.q.slice();
    let msg = '';
    if (j.kind === 'j') {
      const lim = robot.lim[j.axis];
      let nv = S.q[j.axis] + j.dir * robot.vmax[j.axis] * JNT_FRAC * j.spd * dt;
      if (nv < lim[0] || nv > lim[1]) { nv = clamp(nv, lim[0], lim[1]); msg = robot.axes[j.axis] + '軸 可動範囲の限界です'; }
      S.q[j.axis] = nv;
    } else {
      const amt = (j.axis < 3 ? LIN_MAX : ROT_MAX) * j.spd * dt;
      const M = cartTarget(tcpMatrix(), j.axis, j.dir, amt, j.frame);
      const r = RS.ik(robot, M, tool.tcp, S.q);
      if (!r.q) msg = r.err === 'reach' ? '動作範囲外です' : '可動範囲の限界です';
      else if (r.q.some((v, i) => Math.abs(v - S.q[i]) > 8)) msg = '特異点付近のため直交操作できません。関節で動かしてください';
      else S.q = r.q;
    }
    applyPose();
    const c = collisionCheck();
    if (c) { S.q = prev; applyPose(); msg = '干渉するため停止：' + c; endJog(); }
    if (handOn() && !S.holding) tryGrasp();
    if (msg) { jogMsg(msg); j.msgShown = true; } else if (j.msgShown) { jogMsg(''); j.msgShown = false; }
  }
  function jogMsg(m) { $('#jogMsg').textContent = m; $('#jogMsg').classList.remove('ok'); pend.msg = m; }
  function endJog() { jogHold = null; $$('.hold').forEach(b => b.classList.remove('hold')); }
  function jogStep(kind, axis, dir, frame, inch) {
    const why = canMove(); if (why) { jogMsg(why); return; }
    if (mv) return;
    const lin = inch ? 0.5 : stepSize, rot = inch ? 0.2 : { 1: 1, 10: 5, 50: 15 }[stepSize];
    if (kind === 'j') {
      const to = S.q.slice(); to[axis] = clamp(to[axis] + dir * rot, robot.lim[axis][0], robot.lim[axis][1]);
      startJ(to, S.opts.jogSpd, null);
    } else {
      const M = cartTarget(tcpMatrix(), axis, dir, axis < 3 ? lin : rot, frame);
      const r = RS.planLinear(robot, S.q, M, tool.tcp);
      if (!r.ok) { jogMsg(r.err === 'singular' ? '特異点付近のため動けません' : '動作範囲外です'); return; }
      mv = { kind: 'p', qs: r.qs, dur: Math.max(0.15, 1.5 * Math.max(r.dist * 1000 / (LIN_MAX * S.opts.jogSpd / 100), r.ang / (ROT_MAX * S.opts.jogSpd / 100))), t: 0, done: null };
    }
    jogMsg('');
  }
  function startHold(btn, spec) {
    if (stepSize && !spec.pendant) { jogStep(spec.kind, spec.axis, spec.dir, spec.frame); return; }
    if (spec.inch) {   // 安川の「微動」：押すごとに少しだけ動く
      const w = canMove() || spec.check(); if (w) { jogMsg(w); updateLcd(); return; }
      jogStep(spec.kind, spec.axis, spec.dir, spec.frame, true); return;
    }
    const why = canMove() || (spec.check ? spec.check() : '');
    if (why) { jogMsg(why); updateLcd(); return; }
    if (run) stopAll();
    mv = null;
    pend.msg = ''; $('#jogMsg').textContent = '';
    jogHold = spec;
    btn.classList.add('hold');
  }
  function bindHold(container) {
    container.addEventListener('pointerdown', e => {
      const b = e.target.closest('[data-jog]'); if (!b || b.disabled) return;
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (x) { /* 無視 */ }
      const spec = JSON.parse(b.dataset.jog);
      if (spec.pendant) Object.assign(spec, pendJogSpec());
      else spec.spd = S.opts.jogSpd / 100;
      if (spec.kind === 'c' && !spec.pendant) spec.frame = cartFrame;
      startHold(b, spec);
    });
    const end = e => { if (e.target.closest && e.target.closest('[data-jog]')) endJog(); };
    container.addEventListener('pointerup', end);
    container.addEventListener('pointercancel', end);
    container.addEventListener('lostpointercapture', end);
    container.addEventListener('contextmenu', e => { if (e.target.closest('[data-jog]')) e.preventDefault(); });
  }
  window.addEventListener('blur', endJog);
  window.addEventListener('pointerup', () => { if (jogHold) endJog(); });

  /* =================== 画面：ヘッダー =================== */
  function setStatus(s) { $('#status').textContent = s; }
  function refreshState() {
    const pill = $('#statePill');
    pill.className = 'pill';
    if (S.alarm) { pill.textContent = 'アラーム'; pill.classList.add('alm'); setStatus('アラーム停止中'); }
    else if (run) {
      pill.textContent = run.paused ? '一時停止' : (run.single ? '1行実行' : '再生中'); pill.classList.add('run');
      const it = run.interp, st = it.status();
      setStatus(run.paused ? '一時停止中' : `${it.progName} ${String(it.pc + 1).padStart(3, '0')} 行目${st ? '　' + st : ''}`);
    } else { pill.textContent = '手動'; setStatus('手動操作'); }
    $('#runBtn').textContent = run && run.paused ? '▶ 再開' : '▶ 再生';
  }
  function flash(sel2, m, ok) { const el = $(sel2); if (!el) return; el.textContent = m; el.classList.toggle('ok', !!ok); }

  $$('.seg.sys button').forEach(b => b.addEventListener('click', () => switchSystem(b.dataset.sys)));
  function switchSystem(id) {
    if (id === S.sys) return;
    stopAll(); saveLib(); saveVars();
    if (S.holding) dropWork(true);
    if (S.alarm && !S.estop) resetAlarm();
    S.sys = id; robot = RS.ROBOTS[id]; store.set('rs3-sys', id);
    S.q = robot.home.slice();
    S.io = { out: {}, force: {} };
    lib = loadLib(); sel = prog().lines.length ? 0 : -1; undoStack = [];
    vars = loadVars(varKey());
    uframes = loadUF(ufKey());
    resetPend();
    buildRobot(); applyPose(); updateToolVis();
    renderAll();
  }
  const toolSel = $('#toolSel');
  toolSel.innerHTML = RS.TOOLS.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  toolSel.addEventListener('change', () => switchTool(toolSel.value));
  function switchCell(id) {
    id = id === 'table' ? 'table' : 'line';
    if (CELL && CELL.id === id) return;
    stopAll();
    if (S.holding) dropWork(true);
    clearWorks();
    S.io.out = {}; S.gripK = 0;
    S.cellId = id; store.set('rs3-cell', id);
    buildCellScene(id);
    tool = RS.toolById(cellTool(id)); S.toolId = tool.id; store.set('rs3-tool', tool.id);
    S.workId = tool.work; store.set('rs3-work', S.workId);
    buildTool(); buildReach(); applyPose();
    resetWorks();
    S.stats = { count: 0, last: 0, t0: 0 };
    target.set(...CELL.view.target); cam = { ...VIEWS.iso, r: CELL.view.r, theta: CELL.view.theta != null ? CELL.view.theta : VIEWS.iso.theta }; updateCam();
    renderAll();
  }
  function switchTool(id) {
    if (id === tool.id) return;
    stopAll();
    if (S.holding) dropWork(true);
    S.io.out = {}; S.gripK = 0;
    tool = RS.toolById(id); S.toolId = tool.id; store.set('rs3-tool', tool.id);
    S.workId = tool.work; store.set('rs3-work', S.workId);
    buildTool(); buildReach(); applyPose();
    resetWorks();
    renderAll();
    flash('#progMsg', prog().lines.length && prog().tool !== tool.id ? `このプログラムは「${RS.toolById(prog().tool).name}」用です` : '');
  }

  /* =================== 画面：ジョグタブ =================== */
  const sEl = [], oEl = [], rowEl = [];
  function renderSliders() {
    const box = $('#sliders'); box.innerHTML = ''; sEl.length = oEl.length = rowEl.length = 0;
    robot.axes.forEach((n, i) => {
      const row = document.createElement('div'); row.className = 'jrow';
      const [lo, hi] = robot.lim[i];
      row.innerHTML = `<label for="j${i}"><b>${n}</b><span>${robot.axisJa[i]}</span></label>` +
        `<button data-jog='{"kind":"j","axis":${i},"dir":-1}' aria-label="${n} マイナス">−</button>` +
        `<input id="j${i}" type="range" min="${lo}" max="${hi}" step="0.1" value="0">` +
        `<button data-jog='{"kind":"j","axis":${i},"dir":1}' aria-label="${n} プラス">＋</button><output for="j${i}">0.0°</output>`;
      box.appendChild(row);
      const inp = row.querySelector('input');
      sEl.push(inp); oEl.push(row.querySelector('output')); rowEl.push(row);
      inp.addEventListener('input', () => {
        const why = canMove(); if (why) { jogMsg(why); syncSliders(); return; }
        if (run) stopAll(); mv = null;
        const prev = S.q.slice();
        S.q[i] = +inp.value; applyPose();
        const c = collisionCheck();
        if (c) { S.q = prev; applyPose(); jogMsg('干渉するため動かせません：' + c); }
        if (handOn() && !S.holding) tryGrasp();
      });
    });
  }
  bindHold($('#sliders'));
  function syncSliders() {
    for (let i = 0; i < 6; i++) {
      if (document.activeElement !== sEl[i]) sEl[i].value = S.q[i];
      oEl[i].textContent = S.q[i].toFixed(1) + '°';
      const [lo, hi] = robot.lim[i];
      rowEl[i].classList.toggle('lim', S.q[i] <= lo + 0.5 || S.q[i] >= hi - 0.5);
    }
  }
  function renderCartJog() {
    const lab = robot.cart;
    $('#cartJog').innerHTML = lab.map((n, i) =>
      `<div class="pair"><button data-jog='{"kind":"c","axis":${i},"dir":-1}' aria-label="${n} マイナス">−</button><span>${n}</span><button data-jog='{"kind":"c","axis":${i},"dir":1}' aria-label="${n} プラス">＋</button></div>`).join('');
    const fr = $('#cartFrame').querySelectorAll('button');
    fr[0].textContent = robot.coordNames.base; fr[1].textContent = robot.coordNames.tool;
    $('#poseIn').innerHTML = lab.map((n, i) => `<label>${n}${i < 3 ? '（mm）' : '（°）'}<input type="number" id="pi${i}" step="${i < 3 ? 1 : 0.1}"></label>`).join('');
    fillPoseIn();
  }
  bindHold($('#cartJog'));
  $('#cartFrame').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    cartFrame = b.dataset.f;
    $$('#cartFrame button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  $('#stepSel').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    stepSize = +b.dataset.s;
    $$('#stepSel button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  function fillPoseIn() {
    const P = curPose(), v = [P.X, P.Y, P.Z, P.rx, P.ry, P.rz];
    v.forEach((x, i) => { const el = $('#pi' + i); if (el) el.value = x.toFixed(i < 3 ? 1 : 2); });
  }
  function readPoseIn() {
    const v = [0, 1, 2, 3, 4, 5].map(i => +$('#pi' + i).value);
    if (v.some(x => !isFinite(x))) return null;
    return { X: v[0], Y: v[1], Z: v[2], rx: v[3], ry: v[4], rz: v[5] };
  }
  $('#poseGet').addEventListener('click', fillPoseIn);
  function poseMove(lin) {
    const why = canMove(); if (why) { jogMsg(why); return; }
    const P = readPoseIn(); if (!P) { jogMsg('数値を入れてください'); return; }
    const M = RS.matrixFromPose(P);
    if (run) stopAll();
    if (lin) {
      const r = planL(M, 250 * S.opts.jogSpd / 100 * 4);
      if (!r.ok) { jogMsg(r.err === 'singular' ? '経路上に特異点があり直線移動できません。関節移動を使ってください' : 'その位置・姿勢には直線で行けません'); return; }
      mv = { kind: 'p', qs: r.qs, dur: r.dur, t: 0, done: () => flash('#jogMsg', '移動しました', true) };
    } else {
      const r = RS.ik(robot, M, tool.tcp, S.q);
      if (!r.q) { jogMsg(r.err === 'reach' ? 'この位置には届きません。値を調整してください' : 'この姿勢は可動範囲外です'); return; }
      startJ(r.q, S.opts.jogSpd, () => flash('#jogMsg', '移動しました', true));
    }
    jogMsg('');
  }
  $('#poseJ').addEventListener('click', () => poseMove(false));
  $('#poseL').addEventListener('click', () => poseMove(true));
  $('#homeBtn').addEventListener('click', () => {
    const why = canMove(); if (why) { jogMsg(why); return; }
    if (run) stopAll();
    startJ(robot.home, S.opts.jogSpd, null);
  });
  $('#outBtn').addEventListener('click', () => {
    const h = io().handOut; setOut(h.kind, h.n, !handOn());
    if (handOn() && !S.holding) flash('#jogMsg', tool.kind === 'vacuum' ? '吸着ON（ワークに触れていません）' : '閉（ワークをつかんでいません）'); else flash('#jogMsg', '');
  });
  function outName(on) { return tool.kind === 'vacuum' ? (on ? '吸着 ON' : '吸着 OFF') : (on ? '閉' : '開'); }
  function updateOutBtn() {
    const b = $('#outBtn');
    b.textContent = 'ハンド：' + outName(handOn()) + (S.holding ? '（保持中）' : '');
    b.setAttribute('aria-pressed', String(handOn()));
  }
  const jogSpd = $('#jogSpd');
  jogSpd.value = S.opts.jogSpd; $('#jogSpdOut').textContent = S.opts.jogSpd + '%';
  jogSpd.addEventListener('input', () => { S.opts.jogSpd = +jogSpd.value; $('#jogSpdOut').textContent = jogSpd.value + '%'; saveOpts(); });

  /* =================== 画面：プログラムタブ =================== */
  const codeEl = $('#code');
  let textMode = false;
  function renderProgSelect() {
    $('#progSel').innerHTML = Object.keys(lib.progs).sort().map(n => `<option value="${esc(n)}"${n === lib.cur ? ' selected' : ''}>${esc(n)}${lib.progs[n].comment ? '　' + esc(lib.progs[n].comment) : ''}</option>`).join('');
    $('#progComment').value = prog().comment || '';
  }
  $('#progSel').addEventListener('change', e => { if (run) { renderProgSelect(); return; } lib.cur = e.target.value; sel = prog().lines.length ? 0 : -1; saveLib(); renderProgAll(); });
  $('#progNew').addEventListener('click', () => {
    if (run) return;
    const n = window.prompt('新しいプログラムの名前（英大文字・数字・_）', 'PROG' + (Object.keys(lib.progs).length + 1));
    if (n == null) return;
    const name = RS.cleanName(n, S.sys);
    if (!name) { flash('#progMsg', S.sys === 'fanuc' ? '名前は英大文字・数字・_ で付けてください' : '名前に使える文字がありません'); return; }
    if (lib.progs[name]) { flash('#progMsg', name + ' はすでにあります'); return; }
    pushUndo();
    lib.progs[name] = RS.emptyProgram(S.sys, name, tool.id); lib.cur = name; sel = -1; saveLib(); renderProgAll();
  });
  $('#progRen').addEventListener('click', () => {
    if (run) return;
    const n = window.prompt('名前を変更', prog().name); if (n == null) return;
    const name = RS.cleanName(n, S.sys);
    if (!name) { flash('#progMsg', '名前に使える文字がありません'); return; }
    if (name === prog().name) return;
    if (lib.progs[name]) { flash('#progMsg', name + ' はすでにあります'); return; }
    pushUndo();
    const p = prog(); delete lib.progs[p.name]; p.name = name; lib.progs[name] = p; lib.cur = name; saveLib(); renderProgAll();
  });
  $('#progDup').addEventListener('click', () => {
    if (run) return;
    const name = uniqueName(prog().name, lib.progs);
    if (!name) { flash('#progMsg', '複製の名前を作れませんでした'); return; }
    pushUndo();
    const p = JSON.parse(JSON.stringify(prog())); p.name = name; lib.progs[name] = p; lib.cur = name; saveLib(); renderProgAll();
  });
  $('#progDel').addEventListener('click', () => {
    if (run) return;
    if (!window.confirm(`プログラム ${prog().name} を削除します。よろしいですか？（元に戻せます）`)) return;
    pushUndo();
    delete lib.progs[lib.cur];
    if (!Object.keys(lib.progs).length) lib.progs.MAIN = RS.emptyProgram(S.sys, 'MAIN', tool.id);
    lib.cur = Object.keys(lib.progs)[0]; sel = prog().lines.length ? 0 : -1; saveLib(); renderProgAll();
  });
  /* 重複しない名前（末尾に _2, _3 … を付け、長さの上限内に収める） */
  function uniqueName(base, taken) {
    const max = S.sys === 'fanuc' ? 36 : 32;
    if (!taken[base]) return base;
    for (let k = 2; k < 1000; k++) {
      const suf = '_' + k;
      const n = RS.cleanName(String(base).slice(0, Math.max(1, max - suf.length)) + suf, S.sys);
      if (n && !taken[n]) return n;
    }
    return '';
  }
  function lineNo(i) { return S.sys === 'yaskawa' ? String(i + 1).padStart(4, '0') : String(i + 1).padStart(3, ' ') + ':'; }
  function renderCode() {
    const P = prog();
    const Y = S.sys === 'yaskawa';
    if (textMode) $('#codeText').value = P.lines.join('\n');
    else {
      const errs = RS.checkProgram(P, lib.progs);
      const bad = {}; errs.forEach(e => { bad[e.line - 1] = bad[e.line - 1] === 'err' ? 'err' : e.lv; });
      let h = Y ? '<li class="fixed"><span class="n">0000</span>NOP</li>' : '';
      P.lines.forEach((l, i) => {
        const pc = run && run.interp.progName === P.name && run.interp.pc === i;
        h += `<li data-i="${i}" class="${i === sel ? 'sel' : ''}${pc ? ' pc' : ''}${bad[i] ? ' ' + (bad[i] === 'err' ? 'bad' : 'warnl') : ''}"><span class="n">${lineNo(i)}</span>${esc(l)}${Y ? '' : ' ;'}</li>`;
      });
      h += Y ? `<li class="fixed"><span class="n">${String(P.lines.length + 1).padStart(4, '0')}</span>END</li>` : '<li class="fixed"><span class="n">[End]</span></li>';
      codeEl.innerHTML = h;
      const s = codeEl.querySelector('li.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
    }
    codeEl.hidden = textMode; $('#textBox').hidden = !textMode;
    $$('#viewSel button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.v === 'text') === textMode)));
    renderLineEdit(); renderCheck(); renderVars();
    refreshState();
  }
  function renderProgAll() { renderProgSelect(); renderCode(); renderPend(); }
  function markPc() {
    const P = prog();
    codeEl.querySelectorAll('li[data-i]').forEach(li => {
      const i = +li.dataset.i;
      li.classList.toggle('pc', !!run && run.interp.progName === P.name && run.interp.pc === i);
      li.classList.toggle('sel', i === sel);
    });
    const s = codeEl.querySelector('li.pc'); if (s) s.scrollIntoView({ block: 'nearest' });
  }
  function markErrLine(i) { const li = codeEl.querySelector(`li[data-i="${i}"]`); if (li) li.classList.add('err'); }
  codeEl.addEventListener('click', e => {
    const li = e.target.closest('li[data-i]'); if (!li) return;
    sel = +li.dataset.i; markPc(); renderLineEdit(); renderPend();
  });
  codeEl.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = clamp(sel + (e.key === 'ArrowDown' ? 1 : -1), 0, prog().lines.length - 1); markPc(); renderLineEdit();
    } else if (e.key === 'Delete' && sel >= 0) delLine();
  });
  $('#viewSel').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (textMode && b.dataset.v !== 'text' && $('#codeText').value !== prog().lines.join('\n')) {
      if (!window.confirm('テキストの変更を「反映」していません。破棄して一覧に戻りますか？')) return;
    }
    textMode = b.dataset.v === 'text'; renderCode();
  });
  $('#textApply').addEventListener('click', () => {
    const lines = $('#codeText').value.split(/\r?\n/).map(l => l.replace(/^\s*\d+\s*:\s*/, '').replace(/\s*;\s*$/, '').trimEnd());
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const clean = S.sys === 'yaskawa' ? lines.filter(l => !/^\s*(NOP|END)\s*$/i.test(l)) : lines;
    edit(() => { prog().lines = clean; sel = Math.min(sel, clean.length - 1); });
    const errs = RS.checkProgram(prog(), lib.progs);
    flash('#progMsg', errs.length ? `反映しました（確認事項 ${errs.length} 件）` : '反映しました', !errs.some(e => e.lv === 'err'));
  });
  $('#fillPos').addEventListener('click', () => {
    const P = prog();
    const miss = [];
    P.lines.forEach(l => { const i = RS.parseLine(S.sys, l); if (i.op === 'MOVE' && /^(C\d{5}|P\[\d+\])$/.test(i.ref) && !P.pos[i.ref] && !miss.includes(i.ref)) miss.push(i.ref); });
    if (!miss.length) { flash('#progMsg', '不足している位置はありません', true); return; }
    edit(() => { miss.forEach(id => { P.pos[id] = teachPos(); }); });
    flash('#progMsg', `${miss.join(', ')} を現在位置で作成しました。各行で「現在位置で修正」して教示してください`, true);
  });
  function renderCheck() {
    const errs = RS.checkProgram(prog(), lib.progs);
    $('#checkList').innerHTML = errs.slice(0, 30).map(e => `<li class="${e.lv}" data-l="${e.line - 1}">${e.line} 行目：${esc(e.msg)}</li>`).join('');
    $('#checkList').hidden = !errs.length;
  }
  $('#checkList').addEventListener('click', e => { const li = e.target.closest('[data-l]'); if (!li) return; textMode = false; sel = +li.dataset.l; renderCode(); });

  /* 行の編集パネル */
  function renderLineEdit() {
    const box = $('#lineEdit');
    const P = prog(), l = P.lines[sel];
    if (textMode) { box.hidden = true; return; }
    box.hidden = false;
    if (l == null) { box.innerHTML = '<p class="note" style="margin:0">行を選ぶと、ここで編集できます。新しい行は選んだ行の下に追加されます。</p>'; return; }
    const Y = S.sys === 'yaskawa';
    const ins = RS.parseLine(S.sys, l);
    let h = `<div class="row"><b>${String(sel + 1).padStart(3, '0')} 行目</b><input type="text" id="eText" class="grow1" spellcheck="false" value="${esc(l)}" aria-label="命令文"></div>`;
    if (ins.op === 'ERR') h += `<p class="msg" style="margin:2px 0">${esc(ins.msg)}</p>`;
    if (ins.op === 'UNKNOWN') h += `<p class="note" style="margin:2px 0">${esc(ins.msg || 'シミュレーターが解釈できない命令です（実行時は飛ばします）。')}</p>`;
    if (ins.op === 'MOVE') {
      h += `<div class="row"><span class="seg mini"><button data-e="mode" data-v="J" aria-pressed="${ins.mode === 'J'}">${Y ? 'MOVJ' : 'J'} 関節</button><button data-e="mode" data-v="L" aria-pressed="${ins.mode === 'L'}">${Y ? 'MOVL' : 'L'} 直線</button></span>` +
        `<label class="chk">速度 <input type="number" id="eV" min="0.1" step="${ins.mode === 'J' ? 1 : 10}" value="${ins.speed.v}"> ${esc(ins.speed.unit)}</label>` +
        (Y ? `<label class="chk">PL <select id="eTerm"><option value="">なし</option>${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option${ins.term && ins.term.pl === n ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`
          : `<label class="chk"><select id="eTerm"><option value="FINE">FINE</option>${[0, 25, 50, 75, 100].map(n => `<option value="${n}"${ins.term && ins.term.cnt === n ? ' selected' : ''}>CNT${n}</option>`).join('')}</select></label>`) + '</div>';
      if (/^(C\d{5}|P\[\d+\])$/.test(ins.ref)) {
        const pos = P.pos[ins.ref];
        if (pos) {
          const lab = pos.k === 'j' ? robot.axes : robot.cart;
          const vals = pos.k === 'j' ? pos.q : [pos.p.X, pos.p.Y, pos.p.Z, pos.p.rx, pos.p.ry, pos.p.rz];
          h += `<div class="row"><b>${esc(ins.ref)}</b><span class="seg mini"><button data-e="pk" data-v="c" aria-pressed="${pos.k === 'c'}">直交</button><button data-e="pk" data-v="j" aria-pressed="${pos.k === 'j'}">関節</button></span>${pos.k === 'c' ? `<span class="note">UF${pos.uf || 0} UT${pos.ut == null ? 1 : pos.ut}${S.sys === 'fanuc' ? ' ' + esc(pos.cfg) : ''}</span>` : ''}</div>`;
          h += `<div class="xyz6">${lab.map((a, i) => `<label>${a}<input type="number" data-pv="${i}" step="0.1" value="${(+vals[i]).toFixed(3)}"></label>`).join('')}</div>`;
        } else h += `<p class="msg" style="margin:4px 0">位置 ${esc(ins.ref)} がありません。「現在位置で修正」で作れます。</p>`;
        h += `<div class="row grow"><button data-e="touch">現在位置で修正</button><button data-e="goto">この位置へ移動</button></div>`;
      } else h += `<p class="note">位置変数 ${esc(ins.ref)} への移動です（値は「変数」で設定）。</p>`;
    }
    h += `<div class="row grow"><button data-e="up">↑ 上へ</button><button data-e="down">↓ 下へ</button><button data-e="dup">複製</button><button data-e="del" class="danger">削除</button></div>`;
    box.innerHTML = h;
    const eText = $('#eText');
    eText.addEventListener('change', () => { const v = eText.value.replace(/\s*;\s*$/, '').trim(); edit(() => { prog().lines[sel] = v; }); });
    if (ins.op === 'MOVE') {
      const upd = fn => { const i2 = RS.parseLine(S.sys, prog().lines[sel]); if (i2.op !== 'MOVE') return; fn(i2); edit(() => { prog().lines[sel] = RS.formatMove(S.sys, i2); }); };
      $('#eV').addEventListener('change', e => { const v = +e.target.value; if (!(v > 0)) return; upd(i2 => { i2.speed.v = i2.speed.unit === '%' ? clamp(v, 0.01, 100) : clamp(v, 0.1, i2.speed.unit === 'mm/s' ? robot.vlMax : 100000); }); });
      $('#eTerm').addEventListener('change', e => upd(i2 => { const v = e.target.value; if (Y) i2.term = v === '' ? null : { pl: +v }; else i2.term = v === 'FINE' ? { fine: true } : { cnt: +v }; }));
      box.querySelectorAll('[data-pv]').forEach(inp => inp.addEventListener('change', () => {
        const v = +inp.value; if (!isFinite(v)) return;
        const k = +inp.dataset.pv;
        edit(() => { const pos = prog().pos[ins.ref]; if (!pos) return; if (pos.k === 'j') pos.q[k] = v; else { pos.p[['X', 'Y', 'Z', 'rx', 'ry', 'rz'][k]] = v; delete pos.q; } });
      }));
    }
  }
  function delLine() { if (sel < 0) return; edit(() => { prog().lines.splice(sel, 1); sel = Math.min(sel, prog().lines.length - 1); }); }
  $('#lineEdit').addEventListener('click', e => {
    const b = e.target.closest('[data-e]'); if (!b) return;
    const l = prog().lines[sel]; if (l == null) return;
    const ins = RS.parseLine(S.sys, l);
    switch (b.dataset.e) {
      case 'mode':
        if (ins.op === 'MOVE' && ins.mode !== b.dataset.v) edit(() => {
          ins.mode = b.dataset.v;
          ins.speed = { v: lastSpeed(ins.mode), unit: ins.mode === 'J' ? '%' : 'mm/s' };
          prog().lines[sel] = RS.formatMove(S.sys, ins);
        });
        break;
      case 'pk': {
        const pos = prog().pos[ins.ref]; if (!pos || pos.k === b.dataset.v) break;
        if (b.dataset.v === 'j') {
          const r = pos.q ? { q: pos.q } : RS.ik(robot, posMatrix(pos), tool.tcp, S.q, S.sys === 'fanuc' ? RS.parseConfig(pos.cfg) : null);
          if (!r.q) { flash('#progMsg', 'この位置は関節に変換できません（届かない）'); break; }
          edit(() => { prog().pos[ins.ref] = { k: 'j', q: r.q.map(r3) }; });
        } else edit(() => {
          const q = pos.q, p = RS.poseFromMatrix(tcpMatrix(q));
          for (const k in p) p[k] = r3(p[k]);
          prog().pos[ins.ref] = { k: 'c', p, cfg: RS.configOf(q), uf: 0, ut: 1, q: q.slice() };
        });
        break;
      }
      case 'touch':
        if (ins.op !== 'MOVE') break;
        edit(() => {
          const P = prog(), old = P.pos[ins.ref];
          if (old && old.k === 'c') {
            const p = poseInUf(tcpMatrix(), old.uf || 0); for (const k in p) p[k] = r3(p[k]);
            P.pos[ins.ref] = { k: 'c', p, cfg: RS.configOf(S.q), uf: old.uf || 0, ut: old.ut == null ? 1 : old.ut, q: curQ() };
          } else if (old && old.k === 'j') P.pos[ins.ref] = { k: 'j', q: curQ() };
          else P.pos[ins.ref] = teachPos();
        });
        flash('#progMsg', `${ins.ref} を現在位置で修正しました`, true); break;
      case 'goto': {
        const why = canMove(); if (why) { flash('#progMsg', why); break; }
        const pos = prog().pos[ins.ref]; if (!pos) break;
        if (run) stopAll();
        let q = pos.k === 'j' ? pos.q : null;
        if (!q) { const r = RS.ik(robot, posMatrix(pos), tool.tcp, pos.q || S.q, S.sys === 'fanuc' ? RS.parseConfig(pos.cfg) : null); if (!r.q) { flash('#progMsg', 'この位置には届きません'); break; } q = r.q; }
        startJ(q, S.opts.jogSpd, null); break;
      }
      case 'up': if (sel > 0) edit(() => { const L = prog().lines; const [x] = L.splice(sel, 1); L.splice(sel - 1, 0, x); sel--; }); break;
      case 'down': if (sel < prog().lines.length - 1) edit(() => { const L = prog().lines; const [x] = L.splice(sel, 1); L.splice(sel + 1, 0, x); sel++; }); break;
      case 'dup': edit(() => { prog().lines.splice(sel + 1, 0, l); sel++; }); break;
      case 'del': delLine(); break;
    }
  });
  $$('[data-ins]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.ins;
    if (k === 'MOVJ') insertMove('J');
    else if (k === 'MOVL') insertMove('L');
    else if (k === 'ON' || k === 'OFF') insertLine(RS.lineOut(S.sys, io().handOut, k === 'ON'));
    else if (k === 'WAITIN') {
      let on = true;
      for (let i = sel; i >= 0; i--) { const x = RS.parseLine(S.sys, prog().lines[i] || ''); if (x.op === 'DOUT' && x.kind === io().handOut.kind && x.n === io().handOut.n) { on = x.val; break; } }
      insertLine(RS.lineWait(S.sys, io().handIn, on));
    } else if (k === 'TIMER') insertLine(RS.lineTimer(S.sys, 0.5));
    else if (k === 'CMT') insertLine(RS.lineComment(S.sys, 'COMMENT'));
  }));
  $('#progComment').addEventListener('change', e => edit(() => { prog().comment = e.target.value.slice(0, 64); }));
  $('#undoBtn').addEventListener('click', undo);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); undo(); }
  });
  $('#runBtn').addEventListener('click', () => {
    if (run && run.paused) { run.paused = false; refreshState(); return; }
    if (run) return;
    startRun(sel > 0 && window.confirm(`${sel + 1} 行目から再生しますか？\n（キャンセルで先頭から）`) ? sel : 0, false);
  });
  $('#pauseBtn').addEventListener('click', () => { if (run) { run.paused = true; refreshState(); } });
  $('#stopBtn').addEventListener('click', () => { stopAll(); setStatus('停止しました'); });
  $('#stepBtn').addEventListener('click', () => { if (!run) startRun(Math.max(0, sel), true); });
  const loopEl = $('#loop'), ovrEl = $('#ovr');
  loopEl.checked = S.opts.loop; ovrEl.value = S.opts.ovr; $('#ovrOut').textContent = S.opts.ovr + '%';
  loopEl.addEventListener('change', () => { S.opts.loop = loopEl.checked; saveOpts(); });
  ovrEl.addEventListener('input', () => { S.opts.ovr = +ovrEl.value; $('#ovrOut').textContent = ovrEl.value + '%'; saveOpts(); renderPend(); });
  $('#sampleBtn').addEventListener('click', () => {
    if (lib.progs.SAMPLE && lib.progs.SAMPLE.lines.length && !window.confirm('プログラム SAMPLE を作り直します。よろしいですか？（元に戻せます）')) return;
    stopAll(); makeSample();
  });
  $('#clearBtn').addEventListener('click', () => {
    if (!prog().lines.length) return;
    if (!window.confirm(`${prog().name} の命令をすべて削除します。よろしいですか？（元に戻せます）`)) return;
    stopAll(); edit(() => { prog().lines = []; prog().pos = {}; sel = -1; });
  });

  /* I/O・変数・ログ */
  function renderIO() {
    const m = io();
    const cell = (k, n, isIn) => {
      const key = k + n, v = isIn ? getIn(k, n) : getOut(k, n);
      const name = isIn ? m.auto[key] : m.outName[key];
      const f = S.io.force[key];
      return `<button class="iob${v ? ' on' : ''}" data-io="${isIn ? 'i' : 'o'}" data-k="${k}" data-n="${n}" title="${esc(name || '')}">${m.fmt(k, n)}${name ? `<small>${esc(name)}</small>` : ''}${isIn && f != null ? '<small>強制</small>' : ''}</button>`;
    };
    let h = '<div class="iogrp"><b>出力</b><div>';
    for (const [k, c] of m.outs) for (let n = 1; n <= c; n++) h += cell(k, n, false);
    h += '</div></div><div class="iogrp"><b>入力</b><div>';
    for (const [k, c] of m.ins) for (let n = 1; n <= c; n++) h += cell(k, n, true);
    h += '</div></div><p class="note">押すと切り替わります（入力は 強制ON → 強制OFF → 自動 の順）。</p>';
    const el = $('#ioBox');
    if (el.innerHTML !== h) el.innerHTML = h;
  }
  $('#ioBox').addEventListener('click', e => {
    const b = e.target.closest('[data-io]'); if (!b) return;
    const k = b.dataset.k, n = +b.dataset.n, key = k + n;
    if (b.dataset.io === 'o') setOut(k, n, !getOut(k, n));
    else { const f = S.io.force[key]; if (f == null) S.io.force[key] = true; else if (f === true) S.io.force[key] = false; else delete S.io.force[key]; }
    renderIO();
  });
  function usedVars() {
    const nums = new Set(), poss = new Set();
    for (const p of Object.values(lib.progs)) for (const l of p.lines) {
      if (S.sys === 'yaskawa') {
        for (const m of l.matchAll(/\b([BIDR]\d{3})\b/g)) nums.add(m[1]);
        for (const m of l.matchAll(/\b(P\d{3})\b/g)) poss.add(m[1]);
      } else {
        for (const m of l.matchAll(/(^|[^P])R\[(\d+)/g)) nums.add('R' + m[2]);
        for (const m of l.matchAll(/PR\[(\d+)/g)) poss.add('PR' + m[1]);
      }
    }
    Object.keys(vars.num).forEach(k => { if (vars.num[k]) nums.add(k); });
    Object.keys(vars.pos).forEach(k => poss.add(k));
    return { nums: [...nums].sort(), poss: [...poss].sort() };
  }
  const varLabel = k => S.sys === 'yaskawa' ? k : k.replace(/^(PR|R)(\d+)$/, '$1[$2]');
  function renderVars() {
    const { nums, poss } = usedVars();
    let h = '';
    if (!nums.length && !poss.length) h = '<p class="note">プログラムで使っている変数・レジスタがここに出ます。</p>';
    if (nums.length) h += '<div class="vgrid">' + nums.map(k => `<label>${varLabel(k)}<input type="number" data-vn="${k}" value="${vars.num[k] || 0}"></label>`).join('') + '</div>';
    for (const k of poss) {
      const p = vars.pos[k];
      const v = p ? (p.k === 'j' ? p.q : [p.p.X, p.p.Y, p.p.Z, p.p.rx, p.p.ry, p.p.rz]) : [0, 0, 0, 0, 0, 0];
      const lab = p && p.k === 'j' ? robot.axes : robot.cart;
      h += `<div class="row"><b>${varLabel(k)}</b><span class="note">${p ? (p.k === 'j' ? '関節' : '直交') : '未設定'}</span><button data-vp="${k}" data-a="here">現在位置</button><button data-vp="${k}" data-a="zero">0 にする</button></div>` +
        `<div class="xyz6">${lab.map((a, i) => `<label>${a}<input type="number" step="0.1" data-vpi="${k}" data-i="${i}" value="${(+v[i]).toFixed(3)}"></label>`).join('')}</div>`;
    }
    $('#varBox').innerHTML = h;
  }
  $('#varBox').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.vn) { vars.num[t.dataset.vn] = +t.value || 0; saveVars(); }
    if (t.dataset.vpi) {
      const k = t.dataset.vpi, i = +t.dataset.i;
      if (!vars.pos[k]) vars.pos[k] = { k: 'c', p: { X: 0, Y: 0, Z: 0, rx: 0, ry: 0, rz: 0 }, cfg: 'N U T, 0, 0, 0', uf: 0, ut: 1 };
      const p = vars.pos[k];
      if (p.k === 'j') p.q[i] = +t.value || 0; else p.p[['X', 'Y', 'Z', 'rx', 'ry', 'rz'][i]] = +t.value || 0;
      saveVars(); renderVars();
    }
  });
  $('#varBox').addEventListener('click', e => {
    const b = e.target.closest('[data-vp]'); if (!b) return;
    const k = b.dataset.vp;
    if (b.dataset.a === 'here') { const P = curPose(); for (const a in P) P[a] = r3(P[a]); vars.pos[k] = { k: 'c', p: P, cfg: RS.configOf(S.q), uf: 0, ut: 1 }; }
    else vars.pos[k] = { k: 'c', p: { X: 0, Y: 0, Z: 0, rx: 0, ry: 0, rz: 0 }, cfg: 'N U T, 0, 0, 0', uf: 0, ut: 1 };
    saveVars(); renderVars();
  });
  $('#varReset').addEventListener('click', () => { vars.num = {}; saveVars(); renderVars(); });
  function renderLog() {
    const el = $('#logBox'); if (!el) return;
    el.innerHTML = S.log.slice(-60).reverse().map(l => `<li class="${l.lv}">${l.t} ${esc(l.msg)}</li>`).join('') || '<li class="note">まだありません</li>';
  }

  /* ファイル */
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function ioText() {
    const m = io();
    return [`${m.fmt(m.handOut.kind, m.handOut.n)}＝ハンド`].concat(Object.entries(m.auto).map(([k, v]) => `${m.fmt(k.replace(/\d+$/, ''), +k.match(/\d+$/)[0])}＝${v}`)).join('、');
  }
  function nativeText(P) {
    const tl = RS.toolById(P.tool || tool.id), tcp = tl.tcp;   // 教示したときのハンドの TCP で変換する
    const poseOf = q => RS.poseFromMatrix(RS.fk(robot, q, tcp));
    if (S.sys === 'yaskawa') return RS.exportJBI(P, { pulse: robot.pulse, jointConfirmed: robot.jointConfirmed, poseOf });
    return RS.exportLS(P, {
      jointConfirmed: robot.jointConfirmed,
      jointAsCart: q => { const p = poseOf(q); for (const k in p) p[k] = r3(p[k]); return { k: 'c', p, cfg: RS.configOf(q), uf: 0, ut: 1 }; }
    });
  }
  const ext = () => S.sys === 'yaskawa' ? '.JBI' : '.LS';
  function exportNative(all) {
    const list = all ? Object.values(lib.progs).filter(p => p.lines.length) : [prog()];
    if (!list.length || !list[0].lines.length) { flash('#progMsg', 'プログラムがありません'); return; }
    const warns = new Set();
    list.forEach(P => {
      RS.exportWarnings(P, { pulse: robot.pulse, jointConfirmed: robot.jointConfirmed, tool: RS.toolById(P.tool || tool.id), ioText: ioText() }).forEach(w => warns.add(w));
      if (P.tool && P.tool !== tool.id) warns.add(`${P.name} は「${RS.toolById(P.tool).name}」で教示したプログラムです（今のハンドと違います）`);
    });
    const errs = list.flatMap(P => RS.checkProgram(P, lib.progs).filter(e => e.lv === 'err').map(e => `${P.name} ${e.line}行目：${e.msg}`));
    if (errs.length) { flash('#progMsg', 'エラーがあるため書き出せません：' + errs[0]); return; }
    if (!window.confirm('実機に入れる前に確認してください：\n\n・' + [...warns].join('\n・') + '\n\n書き出しますか？')) return;
    let bad = 0;
    list.forEach((P, i) => {
      let body, type = 'text/plain';
      try { body = nativeText(P); } catch (x) { flash('#progMsg', `${P.name}：${x.message}`); return; }
      if (S.sys === 'yaskawa' && S.opts.jbiSjis) { const e = RS.encodeSJIS(body); body = e.bytes; bad += e.bad; type = 'application/octet-stream'; }
      setTimeout(() => download(P.name + ext(), body, type), i * 250);
    });
    if (bad) logMsg(`Shift_JIS にできない文字が ${bad} 文字あり、? に置き換えました`, 'warn');
    flash('#progMsg', `${list.length} 本を ${ext().slice(1)} で書き出しました`, true);
  }
  $('#saveJson').addEventListener('click', () => { download(`ROBOTSIM_${S.sys}.json`, RS.exportJSON(Object.values(lib.progs)), 'application/json'); flash('#progMsg', 'すべてのプログラムを JSON で保存しました', true); });
  $('#saveNative').addEventListener('click', () => exportNative(false));
  $('#saveNativeAll').addEventListener('click', () => exportNative(true));
  $('#loadBtn').addEventListener('click', () => $('#fileIn').click());
  $('#fileIn').addEventListener('change', async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    const got = [], warns = [];
    for (const f of files) {
      const buf = await f.arrayBuffer();
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
      catch (x) { try { text = new TextDecoder('shift_jis').decode(buf); } catch (y) { text = new TextDecoder().decode(buf); } }
      const r = RS.importText(text, { pulse: { yaskawa: RS.ROBOTS.yaskawa.pulse } });
      if (r.err) { flash('#progMsg', `${f.name}：${r.err}`); return; }
      r.progs.forEach(p => got.push(p)); r.warns.forEach(w => warns.push(`${f.name}：${w}`));
    }
    importProgs(got, warns);
  });
  function importProgs(got, warns) {
    const sys = got[0].sys;
    if (got.some(p => p.sys !== sys)) { flash('#progMsg', '安川とファナックのファイルが混ざっています。分けて読み込んでください'); return; }
    if (sys !== S.sys) {
      if (!window.confirm(`このファイルは${RS.ROBOTS[sys].label}用です。システムを切り替えて読み込みますか？`)) return;
      switchSystem(sys);
    }
    { // 読み込むファイルどうしで名前が重なったら、後のほうに番号を付ける
      const seen = {};
      for (const p of got) { if (seen[p.name]) { const n = uniqueName(p.name, Object.assign({}, seen)); (warns = warns || []).push(`${p.name} が重複したため ${n} にしました`); p.name = n; } seen[p.name] = true; }
    }
    const dup = got.filter(p => lib.progs[p.name]).map(p => p.name);
    if (dup.length && !window.confirm(`${dup.join(', ')} は同じ名前のプログラムがあります。上書きしますか？`)) return;
    stopAll();
    edit(() => { got.forEach(p => { p.tool = p.tool || tool.id; lib.progs[p.name] = p; }); lib.cur = got[0].name; sel = prog().lines.length ? 0 : -1; });
    renderProgAll();
    (warns || []).forEach(w => logMsg(w, 'warn'));
    const errs = got.flatMap(p => RS.checkProgram(p, lib.progs));
    flash('#progMsg', `${got.map(p => p.name).join(', ')} を読み込みました` + (errs.length ? `（確認事項 ${errs.length} 件）` : '') + (warns && warns.length ? `（注意 ${warns.length} 件はログ参照）` : ''), true);
  }

  /* =================== 画面：設定 =================== */
  function renderCell() {
    const ic = { vacuum: '◎', gripper: '⊐' };
    $('#toolCards').innerHTML = RS.TOOLS.map(t => `<button class="tcard" data-tool="${t.id}" aria-pressed="${t.id === tool.id}"><span class="ic">${ic[t.kind] || '■'}</span><b>${esc(t.name)}</b><span class="d">${esc(t.desc)}<br>TCP Z=${Math.round(t.tcp[2] * 1000)}mm ／ ${t.kind === 'vacuum' ? '吸盤 ' + t.cups.length + '個' : '爪 開き ' + Math.round(t.grip.open * 1000) + 'mm'} ／ 標準ワーク：${esc(RS.WORKS[t.work].name)}</span></button>`).join('');
    $('#workSel').innerHTML = Object.entries(RS.WORKS).map(([k, w]) => `<option value="${k}"${k === S.workId ? ' selected' : ''}>${esc(w.name)}</option>`).join('');
    toolSel.value = tool.id;
    const line = CELL.id === 'line';
    if (!/^[SC]$/.test(S.opts.pickDir)) S.opts.pickDir = 'S';
    $('#cellSel').value = CELL.id; $('#pickDir').value = S.opts.pickDir;
    $('#lineOpts').hidden = !line; $('#lineNote').hidden = !line; $('#lineLayout').hidden = !line; $('#workRow').hidden = line;
    $('#autoSupL').textContent = line ? 'ラックが空になったら補充してターンテーブルを回す' : '供給台に自動補充';
    $('#autoOutL').textContent = line ? '置き完了の信号がなくてもコンベアで流す' : '排出台から自動払い出し';
    const d = robot.dims;
    const rows = [['機種', robot.model], ['リーチ', Math.round((d.pivR + d.la + Math.hypot(d.ua, d.a3 || 0) + d.fl) * 1000) + ' mm（フランジまで）'],
      ['ハンド', tool.name]];
    if (CELL.id === 'line') {
      const g = CELL.glassDef, C = CELL.conveyor, mm = v => Math.round(v * 1000);
      rows.push(['ワーク', `色付き板ガラス ${mm(g.w)}×${mm(g.h)}×${mm(g.t)}mm、1 面 ${g.count} 枚（推定）`],
        ['架台', `ロボットのベース面は床から ${mm(-FLOOR_Y)} mm（推定）`],
        ...CELL.racks.map(r => [r.name, `中心 X ${mm(r.def.X)} / Y ${mm(r.def.Y)} mm、傾き ${r.def.lean}°、受けの高さ 床から ${mm(r.def.ledge)} mm（推定）`]),
        ['コンベア', `(${mm(C.p0.x)}, ${mm(-C.p0.z)}) → (${mm(C.p1.x)}, ${mm(-C.p1.z)}) へ流れる。置き場 X ${mm(C.place.x)} / Y ${mm(-C.place.z)}、上面 Z ${mm(C.h)} mm（ロボット座標）`]);
    } else rows.push(['ワーク', workDef().name],
      ['供給台', `X ${TABLES[0].X * 1000} / Y ${TABLES[0].Y * 1000} / 高さ ${TABLES[0].h * 1000} mm`],
      ['排出台', `X ${TABLES[1].X * 1000} / Y ${TABLES[1].Y * 1000} / 高さ ${TABLES[1].h * 1000} mm`]);
    $('#cellInfo').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${esc(b)}</dd>`).join('');
    renderRobotForm(); renderUF(); renderIOMapDoc();
  }
  $('#toolCards').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) switchTool(b.dataset.tool); });
  $('#cellSel').innerHTML = RS.CELLS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
  $('#cellSel').addEventListener('change', e => switchCell(e.target.value));
  function renderLineForm() {
    const v = RS.lineValues();
    $('#lineForm').innerHTML = RS.LINE_FIELDS.map(([k, n]) => `<label>${n}<input type="number" step="10" data-ln="${k}" value="${v[k]}"></label>`).join('');
  }
  function rebuildLine() { const was = CELL.id; CELL.id = ''; switchCell(was); renderLineForm(); }
  $('#lineApply').addEventListener('click', () => {
    const vals = {};
    $$('#lineForm input').forEach(i => { if (i.value.trim() === '' || !isFinite(+i.value)) return; vals[i.dataset.ln] = +i.value; });
    RS.setLine(vals);
    store.set(lineKey, vals);
    rebuildLine();
    $('#lineMsg').textContent = '適用しました。サンプルは「サンプル」を押し直すと、新しい位置で作り直されます（今のプログラムの位置は変わりません）。';
  });
  $('#lineReset').addEventListener('click', () => { RS.resetLine(); RS.setLine({}); store.set(lineKey, null); rebuildLine(); $('#lineMsg').textContent = '初期値に戻しました'; });
  renderLineForm();
  $('#pickDir').addEventListener('change', e => { S.opts.pickDir = e.target.value === 'C' ? 'C' : 'S'; saveOpts(); });
  $('#workSel').addEventListener('change', e => { stopAll(); S.workId = e.target.value; store.set('rs3-work', S.workId); setOut(io().handOut.kind, io().handOut.n, false); resetWorks(); renderCell(); });
  $('#resetWork').addEventListener('click', () => { stopAll(); if (S.holding) dropWork(true); setOut(io().handOut.kind, io().handOut.n, false); resetWorks(); S.stats = { count: 0, last: 0, t0: 0 }; updateCycle(); });
  $('#trailClr').addEventListener('click', clearTrail);
  const bindOpt = (id, key, after) => { const el = $(id); el.checked = !!S.opts[key]; el.addEventListener('change', () => { S.opts[key] = el.checked; saveOpts(); if (after) after(); }); };
  bindOpt('#optColl', 'coll');
  bindOpt('#optTrail', 'trail', () => { trail.visible = S.opts.trail; });
  bindOpt('#optReach', 'reach', () => { reachRing.visible = S.opts.reach; });
  bindOpt('#autoSup', 'autoSup');
  bindOpt('#autoOut', 'autoOut');
  bindOpt('#optSkip', 'skipUnknown');
  bindOpt('#optSjis', 'jbiSjis');
  bindOpt('#optGrid', 'grid', () => { grid.visible = S.opts.grid; });
  grid.visible = S.opts.grid;
  const qs = $('#optQuality');
  if (!['auto', 'high', 'std', 'low'].includes(S.opts.quality)) S.opts.quality = 'auto';
  qs.value = S.opts.quality;
  const QN = { high: '実写風（陰り・周辺減光あり）', std: '標準', low: '軽量（画素を粗く・影を簡略）' };
  const qNote = () => { $('#qualityNote').textContent = '現在：' + QN[look.quality()] + (S.opts.quality === 'auto' && autoDropped ? '。描画が重いため自動で切り替えました（「実写風」を選ぶと固定できます）' : ''); };
  let autoDropped = false;
  look.onAutoDrop = () => { autoDropped = true; qNote(); };
  // 画質に合わせて画素密度と影の解像度を変える
  look.onChange = q => {
    renderer.setPixelRatio(q === 'low' ? 0.6 : Math.min(2, window.devicePixelRatio || 1));
    const ms = q === 'high' ? 4096 : q === 'std' ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    resize();
  };
  if (!['auto', 'high', 'std', 'low'].includes(S.opts.quality)) S.opts.quality = 'auto';
  look.setQuality(S.opts.quality); look.onChange(look.quality()); qNote();
  qs.addEventListener('change', () => { S.opts.quality = qs.value; saveOpts(); autoDropped = false; look.setQuality(qs.value); look.onChange(look.quality()); qNote(); });
  trail.visible = S.opts.trail;
  const wt = $('#waitTo'); wt.value = S.opts.waitTimeout;
  wt.addEventListener('change', () => { S.opts.waitTimeout = clamp(+wt.value || 0, 0, 3600); wt.value = S.opts.waitTimeout; saveOpts(); });
  const ft = $('#fanucTo'); ft.value = S.opts.fanucTmout;
  ft.addEventListener('change', () => { S.opts.fanucTmout = clamp(+ft.value || 30, 0.1, 3600); ft.value = S.opts.fanucTmout; saveOpts(); });

  function renderRobotForm() {
    const d = robot.dims;
    const dimLab = { pivR: '旋回中心→L軸 水平距離', pivY: '床→L軸 高さ', la: '下腕長さ（L→U）', a3: '上腕オフセット（U軸→上腕中心線）', ua: '上腕長さ（U→手首中心）', fl: '手首中心→フランジ' };
    let h = `<label class="pname">機種名 <input type="text" id="rbModel" value="${esc(robot.model)}"></label>`;
    h += '<div class="vgrid w2">' + Object.keys(dimLab).map(k => `<label>${dimLab[k]}（mm）<input type="number" step="1" data-dim="${k}" value="${Math.round(d[k] * 1000)}"></label>`).join('') + '</div>';
    h += '<p class="note" style="margin:6px 0 2px">可動範囲（度）　最小／最大</p><div class="limgrid">' + robot.axes.map((a, i) => `<span>${a}</span><input type="number" data-lim="${i}" data-m="0" value="${robot.lim[i][0]}" aria-label="${a} 最小"><input type="number" data-lim="${i}" data-m="1" value="${robot.lim[i][1]}" aria-label="${a} 最大">`).join('') + '</div>';
    h += '<p class="note" style="margin:6px 0 2px">関節角の向き（実機と逆の軸は「反転」）</p><div class="signrow">' + robot.axes.map((a, i) => `<label class="chk"><input type="checkbox" data-sign="${i}"${robot.sign[i] < 0 !== (RS.ROBOT_DEFAULTS[robot.id].sign[i] < 0) ? ' checked' : ''}>${a} 反転</label>`).join('') + '</div>';
    h += `<label class="chk confirm"><input type="checkbox" id="rbConfirmed"${robot.jointConfirmed ? ' checked' : ''}> 実機で 2 姿勢以上、関節値と直交値（X/Y/Z）がシミュレーターと一致することを確認した</label>`;
    h += `<p class="note">確認するまでは、関節位置を実機用ファイルに関節値のまま書き出しません（直交位置に変換します）。今の向き：ツール下向きの待機姿勢 ${robot.axes[4]}=${robot.home[4]}°</p>`;
    if (robot.id === 'yaskawa') h += '<p class="note" style="margin:6px 0 2px">1度あたりのパルス数（JBI の PULSE 形式の読み書きに使用。取扱説明書の値）</p><div class="vgrid">' + robot.axes.map((a, i) => `<label>${a}<input type="number" step="0.001" data-pulse="${i}" value="${robot.pulse ? robot.pulse[i] : ''}" placeholder="未設定"></label>`).join('') + '</div>';
    $('#robotForm').innerHTML = h;
  }
  $('#robotSave').addEventListener('click', () => {
    const ov = store.get('rs3-robot-ov', {}) || {};
    const o = { dims: {}, lim: [], model: $('#rbModel').value };
    const num = el => (el.value.trim() === '' || !isFinite(+el.value)) ? null : +el.value;
    for (const i of $$('[data-dim]')) { const v = num(i); if (v == null || v < 0) { flash('#rbMsg', '寸法に空欄か正しくない値があります'); return; } o.dims[i.dataset.dim] = v / 1000; }
    for (let i = 0; i < 6; i++) {
      const a = num($(`[data-lim="${i}"][data-m="0"]`)), b = num($(`[data-lim="${i}"][data-m="1"]`));
      if (a == null || b == null || !(a < b)) { flash('#rbMsg', `${robot.axes[i]} の可動範囲が正しくありません（空欄・最小≧最大）`); return; }
      o.lim.push([a, b]);
    }
    const defS = RS.ROBOT_DEFAULTS[robot.id].sign;
    o.sign = defS.map((v, i) => ($(`[data-sign="${i}"]`).checked ? -v : v));
    o.jointConfirmed = $('#rbConfirmed').checked;
    if (robot.id === 'yaskawa') { const p = $$('[data-pulse]').map(i => +i.value); o.pulse = p.every(v => isFinite(v) && v !== 0) ? p : null; }
    if (!(o.dims.la > 0) || !(o.dims.ua > 0)) { flash('#rbMsg', '下腕・上腕の長さは 0 より大きくしてください'); return; }
    ov[robot.id] = o; store.set('rs3-robot-ov', ov);
    if (robot.id === 'yaskawa' && !o.pulse) robot.pulse = null;
    RS.applyRobotOverrides(ov);
    stopAll(); S.q = S.q.map((v, i) => clamp(v, robot.lim[i][0], robot.lim[i][1]));
    buildRobot(); applyPose(); updateToolVis(); renderAll();
    flash('#rbMsg', '保存して反映しました', true);
  });
  $('#robotReset').addEventListener('click', () => {
    if (!window.confirm(`${robot.label} の機種パラメータを初期値に戻します。よろしいですか？`)) return;
    const ov = store.get('rs3-robot-ov', {}) || {}; delete ov[robot.id]; store.set('rs3-robot-ov', ov);
    const def = RS.ROBOT_DEFAULTS[robot.id];
    robot.dims = JSON.parse(JSON.stringify(def.dims)); robot.lim = JSON.parse(JSON.stringify(def.lim)); robot.pulse = def.pulse; robot.model = def.model;
    robot.sign = def.sign.slice(); robot.home = def.home.slice(); robot.jointConfirmed = def.jointConfirmed;
    stopAll(); S.q = robot.home.slice(); buildRobot(); applyPose(); updateToolVis(); renderAll();
    flash('#rbMsg', '初期値に戻しました', true);
  });
  function renderUF() {
    let h = '<div class="uftab"><span></span>' + robot.cart.map(c => `<span>${c}</span>`).join('');
    for (let n = 1; n <= 5; n++) {
      const u = uframes[n] || {};
      h += `<span>UF${n}</span>` + ['X', 'Y', 'Z', 'rx', 'ry', 'rz'].map(k => `<input type="number" step="0.1" data-uf="${n}" data-k="${k}" value="${u[k] != null ? u[k] : ''}" placeholder="—" aria-label="UF${n} ${k}">`).join('');
    }
    $('#ufBox').innerHTML = h + '</div>';
  }
  $('#ufBox').addEventListener('change', e => {
    const t = e.target; if (!t.dataset.uf) return;
    const n = t.dataset.uf;
    const row = $$(`[data-uf="${n}"]`);
    if (row.every(i => i.value === '')) delete uframes[n];
    else { uframes[n] = {}; row.forEach(i => { uframes[n][i.dataset.k] = +i.value || 0; }); }
    store.set(ufKey(), uframes);
  });
  function renderIOMapDoc() {
    const m = io();
    $('#ioMapDoc').innerHTML = `<dt>${m.fmt(m.handOut.kind, m.handOut.n)}</dt><dd>ハンド出力（ON＝${tool.kind === 'vacuum' ? '吸着' : '閉'}）</dd>` +
      Object.entries(m.auto).map(([k, v]) => `<dt>${m.fmt(k.replace(/\d+$/, ''), +k.match(/\d+$/)[0])}</dt><dd>${esc(v)}</dd>`).join('');
  }

  /* =================== 画面：AI =================== */
  const aiKeyEl = $('#aiKey'), aiRem = $('#aiRemember');
  { const k = store.get('rs3-ai-key', ''); if (k) { aiKeyEl.value = k; aiRem.checked = true; } }
  aiRem.addEventListener('change', () => { if (aiRem.checked) store.set('rs3-ai-key', aiKeyEl.value.trim()); else store.del('rs3-ai-key'); });
  aiKeyEl.addEventListener('change', () => { if (aiRem.checked) store.set('rs3-ai-key', aiKeyEl.value.trim()); });
  let aiMode = 'edit', aiResult = null, aiAbort = null;
  $('#aiMode').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    aiMode = b.dataset.m;
    $$('#aiMode button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  $('#aiExamples').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { $('#aiText').value = b.textContent; aiMode = b.dataset.m || aiMode; $$('#aiMode button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.m === aiMode))); } });
  function aiContext() {
    const m = io();
    const ioTxt = `- ハンド出力：${m.fmt(m.handOut.kind, m.handOut.n)}（ON＝${tool.kind === 'vacuum' ? '吸着' : '閉じる'}、OFF＝${tool.kind === 'vacuum' ? '解放' : '開く'}）\n` +
      Object.entries(m.auto).map(([k, v]) => `- 入力 ${m.fmt(k.replace(/\d+$/, ''), +k.match(/\d+$/)[0])}：${v}`).join('\n') +
      '\n- それ以外の出力・入力は未接続（入力は常に OFF。教育用に手動で切り替えられる）';
    const P = curPose();
    return {
      sys: S.sys, robot, tool, work: workDef(), tables: TABLES, io: ioTxt, prog: prog(), lib: lib.progs,
      curPoseText: robot.cart.map((c, i) => `${c}=${[P.X, P.Y, P.Z, P.rx, P.ry, P.rz][i].toFixed(1)}`).join(' ') + `（関節 ${S.q.map(v => v.toFixed(1)).join(', ')}）`
    };
  }
  function aiPrompts() {
    const t = $('#aiText').value.trim();
    if (!t) { flash('#aiMsg', '指示を入力してください'); return null; }
    const c = aiContext();
    return { system: RS.aiSystemPrompt(c), user: RS.aiUserPrompt(c, t, aiMode) };
  }
  $('#aiRun').addEventListener('click', async () => {
    const key = aiKeyEl.value.trim();
    if (!key) { flash('#aiMsg', 'API キーがありません。キーなしで使う場合は「指示文をコピー」を使ってください'); return; }
    const pr = aiPrompts(); if (!pr) return;
    if (aiAbort) aiAbort.abort();
    aiAbort = new AbortController();
    const btn = $('#aiRun'); btn.disabled = true; btn.textContent = '作成中…（数十秒かかります）';
    flash('#aiMsg', '', true);
    try {
      const text = await RS.aiCall(key, pr.system, pr.user, aiAbort.signal);
      showAiResult(text);
    } catch (e) {
      if (e.name !== 'AbortError') flash('#aiMsg', /fetch/i.test(e.message) ? 'AI に接続できません（社内ネットワークで api.anthropic.com が遮断されている可能性）。「指示文をコピー」を使ってください' : e.message);
    } finally { btn.disabled = false; btn.textContent = 'AIで作成'; aiAbort = null; }
  });
  $('#aiCopy').addEventListener('click', async () => {
    const pr = aiPrompts(); if (!pr) return;
    const all = pr.system + '\n\n----\n\n' + pr.user;
    try { await navigator.clipboard.writeText(all); flash('#aiMsg', '指示文をコピーしました。Claude に貼り付け、返ってきた JSON を下の欄に貼り付けてください', true); }
    catch (e) { $('#aiPaste').value = all; flash('#aiMsg', 'コピーできなかったため、下の欄に指示文を入れました。全選択してコピーしてください'); }
  });
  $('#aiImport').addEventListener('click', () => showAiResult($('#aiPaste').value));
  function showAiResult(text) {
    const r = RS.aiParse(text, S.sys, tool.id);
    if (r.err) { flash('#aiMsg', r.err); aiResult = null; $('#aiOut').hidden = true; return false; }
    aiResult = r;
    const box = $('#aiOut'); box.hidden = false;
    let h = `<h3>AI の説明</h3><p class="aiexp">${esc(r.explanation).replace(/\n/g, '<br>')}</p>`;
    const allWarn = r.warnings.slice();
    const merged = Object.assign({}, lib.progs, Object.fromEntries(r.progs.map(x => [x.name, x])));
    for (const p of r.progs) {
      const errs = RS.checkProgram(p, merged);
      const bad = [];
      for (const [id, pos] of Object.entries(p.pos)) {
        if (pos.k === 'j') { if (RS.limitViolation(robot, pos.q) >= 0) bad.push(id); }
        else if (!RS.ik(robot, posMatrix(pos), tool.tcp, robot.home).q) bad.push(id);
      }
      h += `<h3>${esc(p.name)}${lib.progs[p.name] ? '（上書き）' : '（新規）'}　${p.lines.length} 行・位置 ${Object.keys(p.pos).length} 点</h3>`;
      h += `<ol class="code small">${p.lines.map((l, i) => `<li class="${errs.some(e => e.line === i + 1 && e.lv === 'err') ? 'bad' : ''}"><span class="n">${i + 1}</span>${esc(l)}</li>`).join('')}</ol>`;
      errs.forEach(e => allWarn.push(`${p.name} ${e.line}行目：${e.msg}`));
      if (bad.length) allWarn.push(`${p.name}：届かない位置 ${bad.join(', ')}`);
    }
    if (allWarn.length) h += `<h3>確認事項</h3><ul class="aiwarn">${allWarn.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`;
    h += '<div class="row grow"><button class="primary" id="aiApply">プログラムに反映</button><button id="aiDiscard">破棄</button></div>';
    box.innerHTML = h;
    flash('#aiMsg', '内容を確認して「プログラムに反映」を押してください', true);
    return true;
  }
  $('#aiOut').addEventListener('click', e => {
    if (e.target.id === 'aiDiscard') { aiResult = null; $('#aiOut').hidden = true; flash('#aiMsg', ''); return; }
    if (e.target.id !== 'aiApply' || !aiResult) return;
    stopAll();
    edit(() => { aiResult.progs.forEach(p => { lib.progs[p.name] = p; }); lib.cur = aiResult.progs[0].name; sel = 0; });
    renderProgAll();
    logMsg(`AI の結果を反映：${aiResult.progs.map(p => p.name).join(', ')}`);
    aiResult = null; $('#aiOut').hidden = true;
    flash('#aiMsg', '反映しました。「プログラム」タブで確認・再生してください（元に戻すこともできます）', true);
  });

  /* =================== HUD =================== */
  function renderHudLabels() {
    $('#modelName').textContent = `${robot.brand}  ${robot.model}  ／  ${tool.name}`;
    const L = robot.cart;
    $('#poseRead').innerHTML = [0, 1, 2].map(i => `<dt>${L[i]}</dt><dd id="pr${i}"></dd><dt>${L[i + 3]}</dt><dd id="pr${i + 3}"></dd>`).join('');
  }
  function updateHud() {
    const P = curPose(), v = [P.X, P.Y, P.Z, P.rx, P.ry, P.rz];
    for (let i = 0; i < 6; i++) $('#pr' + i).textContent = v[i].toFixed(i < 3 ? 1 : 2) + (i < 3 ? ' mm' : ' °');
  }
  function updateCycle() {
    $('#cycleInfo').innerHTML = S.stats.count ? `完了 <b>${S.stats.count}</b>${S.stats.last ? `<br>1個あたり <b>${S.stats.last.toFixed(2)} s</b>` : ''}` : '';
  }

  /* =================== タブ =================== */
  $$('.tabs button').forEach(b => b.addEventListener('click', () => {
    $$('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    ['jog', 'prog', 'pend', 'ai', 'cell'].forEach(t => { $('#t-' + t).hidden = (t !== b.dataset.t); });
    if (b.dataset.t === 'jog') fillPoseIn();
    if (b.dataset.t === 'pend') renderPend();
    if (b.dataset.t === 'prog') { renderIO(); renderVars(); renderLog(); }
  }));

  /* =================== カメラ =================== */
  const target = new T.Vector3(0.5, 0.6, 0);
  let cam = { theta: 0.95, phi: 0.42, r: 4.3 };
  const VIEWS = { iso: { theta: 0.95, phi: 0.42, r: 4.3 }, front: { theta: Math.PI / 2, phi: 0.12, r: 4.4 }, side: { theta: 0, phi: 0.12, r: 4.4 }, top: { theta: Math.PI / 2, phi: 1.5, r: 4.8 } };
  function updateCam() {
    cam.phi = clamp(cam.phi, 0.02, 1.55); cam.r = clamp(cam.r, 0.8, 12);
    camera.position.set(
      target.x + cam.r * Math.cos(cam.phi) * Math.sin(cam.theta),
      target.y + cam.r * Math.sin(cam.phi),
      target.z + cam.r * Math.cos(cam.phi) * Math.cos(cam.theta));
    camera.lookAt(target);
  }
  $('#views').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) { cam = { ...VIEWS[b.dataset.v] }; target.set(...CELL.view.target); if (b.dataset.v === 'iso') { cam.r = CELL.view.r; if (CELL.view.theta != null) cam.theta = CELL.view.theta; } else cam.r = Math.max(cam.r, CELL.view.r * 0.95); updateCam(); }
  });
  const ptrs = new Map(); let pinch = 0, panMode = false;
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    panMode = e.button === 2 || e.shiftKey;
    if (ptrs.size === 2) { const a = [...ptrs.values()]; pinch = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  function pan(dx, dy) {
    const s = cam.r * 0.0012;
    const right = new T.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up = new T.Vector3().setFromMatrixColumn(camera.matrix, 1);
    target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
  }
  canvas.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (ptrs.size === 1) { if (panMode) pan(dx, dy); else { cam.theta -= dx * 0.008; cam.phi += dy * 0.006; } }
    else if (ptrs.size === 2) {
      p.x = e.clientX; p.y = e.clientY;
      const a = [...ptrs.values()]; const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      if (pinch > 0) cam.r *= pinch / d; pinch = d;
      pan(dx / 2, dy / 2);
    }
    p.x = e.clientX; p.y = e.clientY; updateCam();
  });
  const endPtr = e => { ptrs.delete(e.pointerId); pinch = 0; };
  canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('wheel', e => { e.preventDefault(); cam.r *= Math.exp(e.deltaY * 0.001); updateCam(); }, { passive: false });
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); look.setSize(w, h);
  }
  new ResizeObserver(resize).observe(stage);

  /* =================== ティーチングペンダント（実機風） ===================
   * 安川：モード切替キー（REMOTE/PLAY/TEACH）、非常停止、START/HOLD、サーボオンレディ＋イネーブルスイッチ、
   *       手動速度、補間、試運転（押している間）、前進／後退、挿入／削除／修正。
   * ファナック：TP 有効/無効スイッチ、非常停止、デッドマン、SHIFT、F1〜F5、STEP、HOLD、FWD/BWD（SHIFT と押している間）、
   *       COORD、±%、POSN、I/O、RESET。自動運転は操作盤の CYCLE START（TP 無効時）。
   * 実機の画面・キー配列を簡略化した再現で、メーカーのロゴは使っていない。 */
  const pend = { ready: false, enable: false, mode: 'teach', coord: 'joint', sp: 1, ovrI: 3, tp: false, dead: false, shift: false, step: true, view: 'prog', ins: 'J', msg: '', float: false, interlock: false, fast: false, pending: null, instSel: 0, menu: true, fmode: 'T1' };
  const isY = () => S.sys === 'yaskawa';
  const servoOn = () => isY() ? (pend.ready && (pend.mode === 'teach' ? pend.enable : true)) : (pend.tp ? pend.dead : true);
  const YSP = [['微動', 3], ['低速', 12], ['中速', 35], ['高速', 70]];
  const FOV = [1, 5, 10, 25, 50, 75, 100];
  const pendEl = $('#pend');
  let lcdCache = '', lcdT = 0;
  const COORDS = ['joint', 'base', 'tool'];
  const pendVisible = () => pend.float || !$('#t-pend').hidden;
  function resetPend() { Object.assign(pend, { ready: false, enable: false, tp: false, dead: false, shift: false, mode: 'teach', coord: 'joint', msg: '', view: 'prog', interlock: false, fast: false, pending: null, fmode: 'T1' }); }
  function pendJogSpec() {
    const Y = isY();
    return { spd: (Y ? (pend.fast ? YSP[3][1] : YSP[pend.sp][1]) : FOV[pend.ovrI]) / 100, frame: pend.coord === 'tool' ? 'tool' : 'base', check: jogBlock, inch: Y && pend.sp === 0 && !pend.fast };
  }
  /* DX200 の命令一覧（よく使う命令） */
  function instList() {
    const ho = io().handOut, hi = io().handIn;
    const sub = Object.keys(lib.progs).find(n => n !== prog().name) || 'SUB';
    return [
      ['移動', 'MOVJ（関節・現在位置）', { move: 'J' }], ['移動', 'MOVL（直線・現在位置）', { move: 'L' }],
      ['入出力', RS.lineOut('yaskawa', ho, true)], ['入出力', RS.lineOut('yaskawa', ho, false)],
      ['入出力', RS.lineWait('yaskawa', hi, true)], ['入出力', RS.lineWait('yaskawa', hi, false)],
      ['制御', 'TIMER T=0.50'], ['制御', '*LABEL'], ['制御', 'JUMP *LABEL'], ['制御', 'CALL JOB:' + sub], ['制御', 'PAUSE'],
      ['演算', 'SET I000 0'], ['演算', 'INC I000'], ['演算', 'JUMP *LABEL IF I000<3'], ['その他', "'COMMENT"]
    ].map(([g, t, x]) => ({ g, t, x }));
  }
  function jogBlock() {
    if (isY()) {
      if (pend.mode !== 'teach') return 'モードを TEACH（教示）にしてください';
      if (!pend.ready) return '「サーボオン レディ」を押してください';
      if (!pend.enable) return 'イネーブルスイッチを握ってください';
    } else {
      if (pend.fmode === 'AUTO') return 'AUTO モードでは手動操作できません。操作盤でモードを T1 にしてください';
      if (!pend.tp) return 'TP が無効です。TP 有効/無効スイッチを ON にしてください';
      if (!pend.dead) return 'デッドマンスイッチを握ってください';
      if (!pend.shift) return 'SHIFT を押しながら操作してください';
    }
    return '';
  }
  function editBlock() {
    if (isY()) return pend.mode !== 'teach' ? 'モードを TEACH（教示）にしてください' : '';
    return pend.tp ? '' : 'TP が無効です。TP 有効/無効スイッチを ON にしてください';
  }
  function runBlock() {
    if (S.alarm) return 'アラームをリセットしてください';
    if (!prog().lines.length) return 'プログラムがありません';
    if (isY()) {
      if (pend.mode !== 'play') return 'モードを PLAY（再生）にしてください';
      if (!pend.ready) return '「サーボオン レディ」を押してください';
    } else {
      if (pend.fmode !== 'AUTO') return '操作盤のモードを AUTO にしてください（T1/T2 はペンダントの SHIFT＋FWD で運転）';
      if (pend.tp) return 'TP が有効です。TP を無効にしてから CYCLE START を押してください';
    }
    return '';
  }
  /* 画面の行 */
  function screenRows() {
    const Y = isY(), P = prog(), rows = [];
    let selRow = -1, title = '';
    const v = pend.view;
    if (v === 'prog') {
      if (Y) {
        title = `ジョブ内容　J:${P.name}　S:${String(Math.max(0, sel) + 1).padStart(4, '0')}　ツール:00`;
        rows.push({ t: '0000 NOP' });
        P.lines.forEach((l, k) => { rows.push({ t: `${String(k + 1).padStart(4, '0')} ${l}`, i: k, pc: run && run.interp.progName === P.name && run.interp.pc === k }); if (k === sel) selRow = rows.length - 1; });
        rows.push({ t: `${String(P.lines.length + 1).padStart(4, '0')} END` });
      } else {
        title = `${P.name}　　　　　　LINE ${Math.max(0, sel) + 1}`;
        P.lines.forEach((l, k) => { rows.push({ t: `${String(k + 1).padStart(4, ' ')}:  ${l} ;`, i: k, pc: run && run.interp.progName === P.name && run.interp.pc === k }); if (k === sel) selRow = rows.length - 1; });
        rows.push({ t: '[End]' });
      }
    } else if (v === 'pos') {
      const Pz = curPose(), j = pend.coord === 'joint', cl = robot.cart;
      title = Y ? '現在値　' + (j ? '関節' : robot.coordNames[pend.coord]) : 'POSITION　' + (j ? 'JOINT' : robot.coordNames[pend.coord]);
      if (j) S.q.forEach((x, i) => rows.push({ t: Y ? `${robot.axes[i]}  ${x.toFixed(3).padStart(10)} °` : `J${i + 1}  ${x.toFixed(3).padStart(10)} deg` }));
      else [Pz.X, Pz.Y, Pz.Z, Pz.rx, Pz.ry, Pz.rz].forEach((x, i) => rows.push({ t: `${cl[i].padEnd(3)} ${x.toFixed(3).padStart(10)} ${i < 3 ? 'mm' : (Y ? '°' : 'deg')}` }));
      if (!Y) rows.push({ t: `CONFIG: ${RS.configOf(S.q)}` });
    } else if (v === 'io') {
      const m = io();
      title = Y ? '入出力　汎用入出力' : 'I/O　Robot / Digital';
      for (const [k, c] of m.outs) for (let n = 1; n <= Math.min(c, 4); n++) rows.push({ t: `${m.fmt(k, n).padEnd(7)} ${getOut(k, n) ? '●' : '○'} ${getOut(k, n) ? 'ON ' : 'OFF'}  ${m.outName[k + n] || ''}` });
      for (const [k, c] of m.ins) for (let n = 1; n <= Math.min(c, 4); n++) rows.push({ t: `${m.fmt(k, n).padEnd(7)} ${getIn(k, n) ? '●' : '○'} ${getIn(k, n) ? 'ON ' : 'OFF'}  ${m.auto[k + n] || ''}` });
    } else if (v === 'inst') {
      title = '命令一覧（選んで［挿入］→［エンター］）';
      instList().forEach((it, k) => { rows.push({ t: `${it.g.padEnd(4, '　')} ${it.t}`, inst: k }); if (k === pend.instSel) selRow = rows.length - 1; });
    } else if (v === 'sys') {
      title = 'システム情報';
      rows.push({ t: `コントローラ   ${robot.controller || '-'}（シミュレーション）` }, { t: `機種   ${robot.model}` }, { t: `ソフト   ROBOT SIM v${VERSION}` },
        { t: `パルス係数   ${robot.pulse ? '設定済み' : '未設定（JBI は RECTAN で出力）'}` }, { t: `ジョブ数   ${Object.keys(lib.progs).length}` });
    } else if (v === 'var') {
      title = Y ? '変数' : 'DATA　Registers';
      const { nums } = usedVars();
      if (!nums.length) rows.push({ t: Y ? '（使用中の変数なし）' : '(no registers used)' });
      nums.forEach(k => rows.push({ t: `${varLabel(k).padEnd(7)} = ${vars.num[k] || 0}` }));
    }
    return { rows, selRow, title };
  }
  function lcdHTML() {
    const Y = isY();
    const { rows, selRow, title } = screenRows();
    const N = Y ? 9 : 10;
    const st = clamp((selRow >= 0 ? selRow : 0) - 4, 0, Math.max(0, rows.length - N));
    let list = '';
    for (let i = 0; i < N; i++) {
      const r = rows[st + i];
      list += r === undefined ? '<div class="lr"></div>' : `<div class="lr${st + i === selRow ? ' sel' : ''}${r.pc ? ' pcl' : ''}"${r.i != null ? ` data-row="${r.i}"` : ''}${r.inst != null ? ` data-inst="${r.inst}"` : ''}>${esc(r.t)}</div>`;
    }
    const msg = S.alarm ? S.alarm.code + ' ' + S.alarm.msg : (pend.msg || (run ? (run.interp.status() || (Y ? '再生中' : '')) : ''));
    const cn = robot.coordNames[pend.coord];
    if (Y) {
      const menu = [['prog', 'ジョブ'], ['var', '変数'], ['io', '入出力'], ['pos', 'ロボット'], ['sys', 'システム<br>情報']].map(([k, n]) => `<button class="ymenu-b${pend.view === k ? ' on' : ''}" data-view="${k}">${n}</button>`).join('');
      const icon = (txt, cls) => `<span class="ysi${cls ? ' ' + cls : ''}">${esc(txt)}</span>`;
      return `<div class="ysb">${icon(cn)}${icon(pend.fast ? '高速' : YSP[pend.sp][0])}${icon({ teach: 'TEACH', play: 'PLAY', remote: 'REMOTE' }[pend.mode], pend.mode === 'teach' ? 'tc' : 'pl')}${icon(servoOn() ? 'サーボON' : (pend.ready ? 'レディ' : 'サーボOFF'), servoOn() ? 'sv' : '')}${icon(run ? (run.paused ? 'ホールド' : '運転中') : '停止', run && !run.paused ? 'rn' : '')}${icon('挿入 MOV' + pend.ins)}</div>` +
        `<div class="ymain">${pend.menu ? `<div class="ymenu">${menu}</div>` : ''}<div class="ycont"><div class="ytitle">${esc(title)}</div><div class="ylist">${list}</div></div></div>` +
        `<div class="ymsg${S.alarm ? ' alm' : ''}"><span>${esc(msg)}</span>${S.alarm ? '<button class="ytouch" data-act="reset">リセット</button>' : ''}</div>` +
        `<div class="ybot"><button class="ytouch" data-act="mainmenu">メインメニュー</button><span>${pend.interlock ? 'インターロック' : ''}${pend.fast ? '　高速' : ''}</span></div>`;
    }
    const lamp = (n, on) => `<span class="flamp${on ? ' on' : ''}">${n}</span>`;
    const status = run ? (run.paused ? 'PAUSED' : 'RUNNING') : 'ABORTED';
    const fk = pend.view === 'prog' ? ['POINT', pend.ins === 'J' ? '[J]/L' : 'J/[L]', 'DELETE', `RO[${io().handOut.n}]`, 'TOUCHUP']
      : pend.view === 'pos' ? ['', 'JNT', 'WORLD', 'TOOL', ''] : ['', '', '', '', ''];
    return `<div class="fsb">${lamp('Busy', !!mv || (run && !run.paused))}${lamp('Step', pend.step)}${lamp('Hold', run && run.paused)}${lamp('Fault', !!S.alarm)}${lamp('Run', run && !run.paused)}${lamp('TP', pend.tp)}` +
      `<span class="fst">${esc(prog().name)} LINE ${Math.max(0, sel) + 1}　${pend.fmode}　${status}　${cn} ${FOV[pend.ovrI]}%</span></div>` +
      `<div class="ftitle">${esc(title)}</div><div class="flist">${list}</div><div class="fmsg${S.alarm ? ' alm' : ''}">${esc(msg)}</div>` +
      `<div class="ffk">${fk.map((t, i) => `<span data-act="f${i + 1}">${esc(t)}</span>`).join('')}</div>`;
  }
  function updateLcd() {
    const el = $('#lcd'); if (!el) return;
    const h = lcdHTML();
    if (h !== lcdCache) { lcdCache = h; el.innerHTML = h; }
  }
  function jogKeys(Y) {
    const lj = robot.axes, lc = robot.cart;
    const kind = pend.coord === 'joint' ? 'j' : 'c';
    let h = '';
    for (let i = 0; i < 6; i++) {
      const spec = d => `{"kind":"${kind}","axis":${i},"dir":${d},"pendant":true}`;
      const lab = d => Y ? `${lc[i]}${d}<br><small>${lj[i]}${d}</small>` : `${d}${lc[i]}<br><small>(${lj[i]})</small>`;
      h += `<button class="pk jk" data-jog='${spec(-1)}'>${lab('−')}</button><button class="pk jk" data-jog='${spec(1)}'>${lab('＋')}</button>`;
    }
    return h;
  }
  function renderPend() {
    if (!pendVisible() && pendEl.innerHTML) { lcdCache = ''; return; }
    const Y = isY(), ho = handOn(), on = b => (b ? ' on' : '');
    let html;
    if (Y) {
      const ang = { remote: -45, play: 0, teach: 45 }[pend.mode];
      // 実機（DX200 系プログラミングペンダント）の写真のキー配置どおりに並べる
      const kb = (act, label, cls, title, hold) => `<button class="yk${cls ? ' ' + cls : ''}" ${hold ? 'data-hold' : 'data-act'}="${act}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
      const pnd = op => pend.pending && pend.pending.op === op ? ' on' : '';
      const kind = pend.coord === 'joint' ? 'j' : 'c';
      const ax = (i, d, top, sub, rot) => `<button class="yax${rot ? ' rot' : ''}" data-jog='{"kind":"${kind}","axis":${i},"dir":${d},"pendant":true}'>${rot ? `<i>${d < 0 ? '↶' : '↷'}</i>` : ''}<b>${top}</b><small>${sub}</small></button>`;
      const axNone = (t, title) => `<button class="yax off" data-act="na" title="${title}"><b>${t}</b></button>`;
      html = `<div class="pendant yp2">
        <div class="yhandle"></div>
        <div class="ytop2">
          <button class="keysw2" data-act="mode" title="モード切替キー（REMOTE / PLAY / TEACH）"><span class="knob2" style="transform:rotate(${ang}deg)"></span></button>
          <button class="rbtn start${on(run && !run.paused)}" data-act="run" title="START"></button>
          <button class="rbtn hold${on(run && run.paused)}" data-act="hold" title="HOLD"></button>
          <button class="estop2${on(S.estop)}" data-act="estop" title="EMERGENCY STOP（非常停止）"><span></span></button>
          <div class="ylabels"><span class="${pend.mode === 'remote' ? 'cur' : ''}">REMOTE</span><span class="${pend.mode === 'play' ? 'cur' : ''}">PLAY</span><span class="${pend.mode === 'teach' ? 'cur' : ''}">TEACH</span><span>START</span><span>HOLD</span><span>EMERGENCY STOP</span></div>
        </div>
        <div class="ybezel"><div class="pscreen yscr" id="lcd"></div></div>
        <div class="ykp">
          <div class="yrow1">
            <div class="ycur"><button class="cu" data-act="up" title="カーソル↑">▲</button><button class="cl" data-act="na" title="カーソル←">◀</button><button class="cr" data-act="na" title="カーソル→">▶</button><button class="cd" data-act="down" title="カーソル↓">▼</button></div>
            <div class="yfn">
              ${kb('na', '<em>MULTI</em>LAYOUT', 'pu', '多画面（シミュレーターでは未対応）')}
              ${kb('coord', `<em>TOOL SEL</em>COORD<small>${robot.coordNames[pend.coord]}</small>`, 'bl', '座標切替（関節／直交／ツール）')}
              ${kb('dopen', 'DIRECT<br>OPEN', '', 'ダイレクトオープン（CALL 先のジョブを開く）')}
              ${kb(pend.shift ? 'pageup' : 'page', '<em>GO BACK</em>PAGE', 'bl', 'ページ送り（SHIFT＋で戻る）')}
              ${kb('na', 'AREA', 'bl', 'エリア（シミュレーターでは未対応）')}
              ${kb('mainmenu', 'MAIN<br>MENU', '', 'メインメニュー')}
              ${kb('view-prog', '<em>ENTRY</em>SIMPLE<br>MENU', 'bl', 'シンプルメニュー（ジョブ内容へ）')}
              ${kb('ready', 'SERVO<br>ON<br>READY', 'lamp' + on(pend.ready), 'サーボオン レディ')}
              ${kb('assist', 'ASSIST', 'pu', 'アシスト（操作の手順を表示）')}
              ${kb('cancel', 'CANCEL', '', '取消')}
            </div>
            <button class="ysel" data-act="select" title="選択">SELECT</button>
          </div>
          <div class="yrow2">
            <div class="yaxg">${ax(0, -1, 'X−', 'S−')}${ax(0, 1, 'X+', 'S+')}${ax(1, -1, 'Y−', 'L−')}${ax(1, 1, 'Y+', 'L+')}${ax(2, -1, 'Z−', 'U−')}${ax(2, 1, 'Z+', 'U+')}${axNone('E−', '外部軸（なし）')}${axNone('E+', '外部軸（なし）')}</div>
            <div class="yspd">
              <span class="svlamp${on(servoOn())}">SERVO ON</span>
              <button class="ysp${on(pend.fast)}" data-act="fast" title="高速"><b>HIGH<br>SPEED</b></button>
              <button class="ysp" data-act="speed+" title="手動速度 高"><b>FAST</b><small>▲</small></button>
              <span class="mslbl">MANUAL SPEED<br><b>${YSP[pend.sp][0]}</b></span>
              <button class="ysp" data-act="speed-" title="手動速度 低"><b>SLOW</b><small>▼</small></button>
            </div>
            <div class="yaxg">${ax(3, -1, 'X−', 'R−', true)}${ax(3, 1, 'X+', 'R+', true)}${ax(4, -1, 'Y−', 'B−', true)}${ax(4, 1, 'Y+', 'B+', true)}${ax(5, -1, 'Z−', 'T−', true)}${ax(5, 1, 'Z+', 'T+', true)}${axNone('8−', '第8軸（なし）')}${axNone('8+', '第8軸（なし）')}</div>
          </div>
          <div class="ygrid">
            ${kb('shift', 'SHIFT<i class="sq"></i>', 'bl' + on(pend.shift))}
            ${kb('interlock', 'INTER<br>LOCK<i class="sq"></i>', 'pu' + on(pend.interlock), 'インターロック')}
            ${kb('num7', '7<small>SINGLE/<br>SYNCRO</small>', 'bl')}
            ${kb('num8', '8', 'bl')}
            ${kb('num9', '9', 'bl')}
            ${kb('test', 'TEST<br>START', 'pu', '試運転（インターロックと押している間だけ）', true)}
            ${kb('shift', 'SHIFT<i class="sq"></i>', 'bl' + on(pend.shift))}
            ${kb('na', 'ROBOT', '', 'ロボット切替（1台のみ）')}
            ${kb('instlist', 'INFORM<br>LIST', on(pend.view === 'inst'), '命令一覧')}
            ${kb('num4', '4<small>SMOV</small>', 'bl')}
            ${kb('num5', '5', 'bl')}
            ${kb('num6', '6', 'bl')}
            ${kb('bwdY', 'BWD', 'pu', '後退（押している間だけ）', true)}
            ${kb('fwdY', 'FWD', 'pu', '前進（押している間だけ）', true)}
            ${kb('na', 'EX.AXIS', '', '外部軸切替（なし）')}
            ${kb('assist', 'USAGE', '', '使い方')}
            ${kb('num1', '1', 'bl')}
            ${kb('num2', `2<small>TOOL ON</small>`, 'bl' + on(ho), '数字 2 ／［INTER LOCK］と同時でハンド ON')}
            ${kb('num3', '3<small>TOOL ON<br>JOB</small>', 'bl', '数字 3 ／［INTER LOCK］と同時でハンド ON の命令を挿入')}
            ${kb('del', 'DELETE', pnd('del'))}
            ${kb('ins', 'INSERT', pnd('ins'))}
            ${kb('na', 'AUX', '', '補助（シミュレーターでは未対応）')}
            ${kb('ins-type', `MOTION<br>TYPE<small>MOV${pend.ins}</small>`, '', '補間方法の切替')}
            ${kb('num0', '0', 'bl')}
            ${kb('numdot', '.<small>TOOL OF</small>', 'bl', '小数点 ／［INTER LOCK］と同時でハンド OFF')}
            ${kb('numminus', '−<small>TOOL OF<br>JOB</small>', 'bl', 'マイナス ／［INTER LOCK］と同時でハンド OFF の命令を挿入')}
            ${kb('upd', 'MODIFY', pnd('upd'))}
            ${kb('enter', 'ENTER', 'ent')}
          </div>
          <div class="ybrand">YASKAWA</div>
        </div>
        <button class="enable${on(pend.enable)}" data-act="enable" title="側面のイネーブルスイッチ（3ポジション）">イネーブルスイッチ（側面）：${pend.enable ? '握っている' : '離している'}</button>
      </div>`;
    } else {
      // 実機（R-30iB Plus の iPendant）の写真のキー配置どおりに並べる
      const fk = (act, label, cls, title, hold) => `<button class="fk${cls ? ' ' + cls : ''}" ${hold ? 'data-hold' : 'data-act'}="${act}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
      const kindF = pend.coord === 'joint' ? 'j' : 'c';
      const fj = (i, d, top, sub, rot) => `<button class="fk jog fjog${rot ? ' rot' : ''}" data-jog='{"kind":"${kindF}","axis":${i},"dir":${d},"pendant":true}'>${rot ? `<i>${d < 0 ? '↶' : '↷'}</i>` : ''}<b>${top}</b><small>${sub}</small></button>`;
      const fjNone = (t, sub) => fk('na', `<b>${t}</b><small>${sub}</small>`, 'jog off', '付加軸（なし）');
      html = `<div class="pendant fp2">
        <div class="ftop2">
          <button class="fkeysw${on(pend.tp)}" data-act="tp" title="TP 有効/無効スイッチ"><span class="knob3"></span><small>OFF　ON</small></button>
          <div class="fhandle"></div>
          <button class="estop2${on(S.estop)}" data-act="estop" title="非常停止ボタン"><span></span></button>
        </div>
        <div class="fbezel"><div class="pscreen fscr" id="lcd"></div></div>
        <div class="fsheet">
          <div class="frowf">${fk('view-prog', 'PREV')}${[1, 2, 3, 4, 5].map(i => fk('f' + i, 'F' + i, 'fkey')).join('')}${fk('na', 'NEXT', '', '次のファンクションキー（シミュレーターでは未対応）')}</div>
          <div class="frows">
            ${fk('shift', 'SHIFT', 'blue' + on(pend.shift))}
            ${fk('na', 'MENU', '', 'メニュー（画面は SELECT・EDIT・DATA・POSN・I/O で切替）')}
            <div class="fteach"><span>TEACH</span>${fk('view-prog', 'SELECT')}${fk('view-prog', 'EDIT')}${fk('view-var', 'DATA')}</div>
            ${fk('na', 'FCTN', '', '補助機能（シミュレーターでは未対応）')}
            ${fk('shift', 'SHIFT', 'blue' + on(pend.shift))}
          </div>
          <div class="fmain">
            <button class="finfo" data-act="assist" title="i（操作の手順を表示）">i</button>
            <div class="fleds"><span class="led${on(true)}">POWER</span><span class="led fault${on(!!S.alarm)}">FAULT</span></div>
            ${fk('up', '⇧', 'cur cu')}
            ${fk('assist', '?', 'help', 'ヘルプ')}
            ${fk('step', 'STEP', 'g' + on(pend.step), 'ステップ運転の切替')}
            ${fj(0, -1, '−X', '(J1)')}${fj(0, 1, '+X', '(J1)')}
            ${fk('na', 'DISP', 'blue sm', '画面分割（シミュレーターでは未対応）')}
            ${fk('na', '⇦', 'cur', 'カーソル←')}${fk('down', '⇩', 'cur')}${fk('na', '⇨', 'cur', 'カーソル→')}
            ${fk('hold', 'HOLD', 'g')}
            ${fj(1, -1, '−Y', '(J2)')}${fj(1, 1, '+Y', '(J2)')}
            ${fk('reset', 'RESET', 'dk')}${fk('backspace', 'BACK<br>SPACE', 'dk')}${fk('na', 'ITEM', 'dk', '行番号を指定して移動（シミュレーターでは未対応）')}${fk('enter', 'ENTER', 'dk')}
            ${fk('fwdF', 'FWD', 'g arr', 'SHIFT と押している間だけ前進', true)}
            ${fj(2, -1, '−Z', '(J3)')}${fj(2, 1, '+Z', '(J3)')}
            ${fk('num7', '7', 'dk')}${fk('num8', '8', 'dk')}${fk('num9', '9', 'dk')}${fk('na', 'TOOL<br>1', 'blue sm', 'ツール切替（シミュレーターでは未対応）')}
            ${fk('bwdF', 'BWD', 'g arr', 'SHIFT と押している間だけ後退', true)}
            ${fj(3, -1, '−X', '(J4)', true)}${fj(3, 1, '+X', '(J4)', true)}
            ${fk('num4', '4', 'dk')}${fk('num5', '5', 'dk')}${fk('num6', '6', 'dk')}${fk('na', 'TOOL<br>2', 'blue sm', 'ツール切替（シミュレーターでは未対応）')}
            ${fk('coord', `COORD<small>${robot.coordNames[pend.coord]}</small>`, 'g')}
            ${fj(4, -1, '−Y', '(J5)', true)}${fj(4, 1, '+Y', '(J5)', true)}
            ${fk('num1', '1', 'dk')}${fk('num2', '2', 'dk')}${fk('num3', '3', 'dk')}${fk('na', 'MOVE<br>MENU', 'blue sm', '（シミュレーターでは未対応）')}
            ${fk('na', 'GROUP', 'g', '動作グループ切替（1 グループのみ）')}
            ${fj(5, -1, '−Z', '(J6)', true)}${fj(5, 1, '+Z', '(J6)', true)}
            ${fk('num0', '0', 'dk')}${fk('numdot', '.', 'dk')}${fk('numminus', '−<small>,</small>', 'dk')}${fk('na', 'SET<br>UP', 'blue sm', '（シミュレーターでは未対応）')}
            ${fk('ovr+', `+%<small>${FOV[pend.ovrI]}%</small>`, 'g arrup', 'オーバーライド ＋')}
            ${fjNone('−', '(J7)')}${fjNone('+', '(J7)')}
            ${fk('assist', 'DIAG<br>HELP', 'blue sm')}${fk('view-pos', 'POSN', 'lt')}${fk('view-io', 'I/O', 'lt')}${fk('view-var', 'STATUS', 'blue sm', '状態（変数）')}
            ${fk('ovr-', '−%', 'g arr', 'オーバーライド −')}
            ${fjNone('−', '(J8)')}${fjNone('+', '(J8)')}
          </div>
        </div>
        <button class="enable${on(pend.dead)}" data-act="dead" title="裏面のデッドマンスイッチ">デッドマンスイッチ（裏面）：${pend.dead ? '握っている' : '離している'}</button>
      </div>
      <div class="oppanel"><span>操作盤</span><span class="seg mini">${['T1', 'T2', 'AUTO'].map(m => `<button data-act="fmode-${m}" aria-pressed="${pend.fmode === m}">${m}</button>`).join('')}</span><button class="pk go" data-act="cycle">CYCLE START</button><span class="note">AUTO・TP 無効で自動運転</span></div>`;
    }
    const tools = `<div class="row pendtools"><button id="pendPop">${pend.float ? 'パネルに戻す' : '3D画面の上に出す'}</button><button id="pendBig">${pendEl.classList.contains('big') ? '標準の大きさ' : '大きく表示'}</button></div>`;
    const how = Y
      ? '操作（DX200）：キーを TEACH に回す → ［SERVO ON READY］ → 側面のイネーブルスイッチを握る → 軸キーでジョグ（MANUAL SPEED は FAST／SLOW、「微動」は押すたびに少しずつ、［HIGH SPEED］で速く）。数字を入れて ENTER で、選んだ移動命令の速度を変更。［INTER LOCK］＋［2 TOOL ON］／［. TOOL OF］でハンド出力、＋［3］／［−］でハンドの命令を挿入。キーの日本語名との対応：INSERT＝挿入、DELETE＝削除、MODIFY＝修正、ENTER＝エンター、CANCEL＝取消、FWD／BWD＝前進／後退、TEST START＝試運転、INFORM LIST＝命令一覧、MOTION TYPE＝補間。［挿入］［削除］［修正］は［エンター］で確定、［取消］で中止。［前進］［後退］は押している間だけ動き、離すと止まります（もう一度押すと続きから）。［前進］は移動命令だけを実行し、ほかの命令は［インターロック］＋［前進］で実行。［試運転］は［インターロック］を押しながら、押している間だけ連続で動きます。教示モードの運転は手動速度に従い、TCP 250mm/s までに制限されます。［命令一覧］で命令を選んで挿入。自動運転はキーを PLAY に回して［サーボオン レディ］→ START。'
      : '操作（iPendant）：左上のキースイッチで TP を ON → 裏面のデッドマンを握る → SHIFT を押しながら軸キーでジョグ。数字を入れて ENTER で、選んだ移動命令の速度を変更（BACK SPACE で 1 文字消す）。POSN＝現在位置、I/O＝入出力、DATA／STATUS＝レジスタ、EDIT／SELECT＝プログラム。F1 POINT で位置を追加、SHIFT＋F5 TOUCHUP で修正。SHIFT＋FWD／BWD は押している間だけ動き、SHIFT・キー・デッドマンのどれかを離すと止まります（STEP 点灯中は1行ずつ）。T1 は 250mm/s まで、速度は ±% のオーバーライドに従います。自動運転は操作盤で AUTO にし、TP を OFF にして CYCLE START。';
    pendEl.innerHTML = tools + html + `<p class="note">${how}</p><p class="note">キーの配置は実機の写真に合わせています。画面の中身（メニュー階層など）は簡略化した再現で、シミュレーターにない機能のキーは押すと「使えません」と表示します。マウスで操作しやすいよう、SHIFT・インターロック・高速・イネーブル／デッドマンは押すたびに ON/OFF が切り替わります。</p>`;
    lcdCache = ''; updateLcd();
  }
  bindHold(pendEl);
  /* 押している間だけ動くキー（試運転・FWD） */
  /* 押している間だけ動くキー（前進・後退・試運転・FWD・BWD）。離すと止まり、次に押すと続きから */
  let heldRun = null, heldMv = false;
  function pendLim() {
    if (isY()) return pend.mode === 'teach' ? { spdFac: [0.1, 0.25, 0.5, 1][pend.fast ? 3 : pend.sp], tcpCap: 250 } : null;
    return { spdFac: FOV[pend.ovrI] / 100, tcpCap: pend.fmode === 'T1' ? 250 : 0 };
  }
  /* 1つ前の移動命令の位置へ、その行の補間・速度で戻る */
  function startBwd() {
    let i = Math.min(sel, prog().lines.length) - 1, ins = null;
    for (; i >= 0; i--) { ins = RS.parseLine(S.sys, prog().lines[i]); if (ins.op === 'MOVE' && prog().pos[ins.ref]) break; }
    if (i < 0) { pend.msg = '戻る位置がありません'; return false; }
    const pos = prog().pos[ins.ref];
    let q = pos.k === 'j' ? pos.q : null;
    if (!q) { const r = RS.ik(robot, posMatrix(pos), tool.tcp, pos.q || S.q, isY() ? null : RS.parseConfig(pos.cfg)); q = r.q; }
    if (!q) { pend.msg = 'この位置には届きません'; return false; }
    sel = i; stepKeep = null; markPc();
    motLim = pendLim();
    const sp = ins.speed;
    if (ins.mode === 'L') return startL(posMatrix(pos), sp.unit === 'mm/s' ? sp.v : 100, () => { motLim = null; });
    return startJ(q, sp.unit === '%' ? sp.v : 25, () => { motLim = null; });
  }
  pendEl.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-hold]'); if (!b) return;
    e.preventDefault();
    try { b.setPointerCapture(e.pointerId); } catch (x) { /* 無視 */ }
    const k = b.dataset.hold;
    sel = Math.max(0, sel);
    const why = jogBlock() || (prog().lines.length ? '' : 'プログラムがありません');
    if (why) { pend.msg = why; updateLcd(); return; }
    if (run || mv) return;
    pend.msg = '';
    if (k === 'bwdY' || k === 'bwdF') {
      if (startBwd()) { b.classList.add('hold'); heldMv = true; }
      updateLcd(); return;
    }
    if (k === 'test' && !pend.interlock) { pend.msg = '試運転は［インターロック］を押しながら操作します'; updateLcd(); return; }
    if (k === 'fwdY' && !pend.interlock) {
      // DX200：前進では移動命令だけを実行する（ほかの命令は飛ばす）
      let i = sel;
      while (i < prog().lines.length && RS.parseLine('yaskawa', prog().lines[i]).op !== 'MOVE') i++;
      if (i >= prog().lines.length) { pend.msg = '移動命令がありません（移動以外は［インターロック］＋［前進］）'; updateLcd(); return; }
      if (i !== sel) { sel = i; stepKeep = null; markPc(); }
    }
    const single = k === 'fwdY' || (k === 'fwdF' && pend.step);
    if (startRun(sel, single, pendLim())) { b.classList.add('hold'); heldRun = run; run.fromPend = true; }
    updateLcd();
  });
  const releaseHeld = () => {
    $$('#pend [data-hold].hold').forEach(x => x.classList.remove('hold'));
    if (heldRun && run === heldRun) holdStop(isY() ? 'キーを離したため停止（もう一度押すと続きから）' : 'キーを離したため HOLD（もう一度押すと続きから）');
    if (heldMv && mv && !run) { mv = null; motLim = null; pend.msg = 'キーを離したため停止'; updateLcd(); }
    heldRun = null; heldMv = false;
  };
  pendEl.addEventListener('pointerup', e => { if (e.target.closest('[data-hold]')) releaseHeld(); });
  pendEl.addEventListener('pointercancel', releaseHeld);
  pendEl.addEventListener('lostpointercapture', e => { if (e.target.closest && e.target.closest('[data-hold]')) releaseHeld(); });
  window.addEventListener('blur', releaseHeld);
  window.addEventListener('pointerup', () => { if (heldRun || heldMv) releaseHeld(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseHeld(); });
  function touchUp() {
    const ins = RS.parseLine(S.sys, prog().lines[sel] || '');
    if (ins.op !== 'MOVE' || !/^(C\d{5}|P\[\d+\])$/.test(ins.ref)) { pend.msg = '移動命令の行を選んでください'; return; }
    const old = prog().pos[ins.ref];
    edit(() => {
      if (old && old.k === 'c') { const p = poseInUf(tcpMatrix(), old.uf || 0); for (const k in p) p[k] = r3(p[k]); prog().pos[ins.ref] = { k: 'c', p, cfg: RS.configOf(S.q), uf: old.uf || 0, ut: old.ut == null ? 1 : old.ut, q: curQ() }; }
      else prog().pos[ins.ref] = (old && old.k === 'j') ? { k: 'j', q: curQ() } : teachPos();
    });
    pend.msg = isY() ? `${ins.ref} を修正しました` : `${ins.ref} TOUCHUP 完了`;
  }
  function doPending() {
    const P = pend, pd = P.pending; P.pending = null;
    if (!pd) return false;
    const why = editBlock(); if (why) { P.msg = why; return true; }
    if (pd.op === 'ins') {
      if (pd.inst) {
        if (pd.inst.x && pd.inst.x.move) insertMove(pd.inst.x.move);
        else insertLine(pd.inst.t);
      } else insertMove(P.ins);
      P.view = 'prog'; P.msg = '挿入しました';
    } else if (pd.op === 'del') {
      if (sel < 0) { P.msg = 'ジョブが空です'; return true; }
      delLine(); P.msg = '削除しました';
    } else if (pd.op === 'upd') touchUp();
    return true;
  }
  function pendAct(a) {
    const P = pend;
    if (isY() && (a === 'ins' || a === 'del' || a === 'upd')) {
      const why = editBlock(); if (why) { P.msg = why; renderPend(); return; }
      P.pending = { op: a, inst: a === 'ins' && P.view === 'inst' ? instList()[P.instSel] : null };
      P.msg = `［${{ ins: '挿入', del: '削除', upd: '修正' }[a]}］${P.pending.inst ? '：' + P.pending.inst.t : ''}　［エンター］で確定／［取消］で中止`;
      renderPend(); return;
    }
    switch (a) {
      case 'interlock': P.interlock = !P.interlock; break;
      case 'fast': P.fast = !P.fast; break;
      case 'cancel': P.pending = null; P.num = ''; P.msg = ''; if (P.view === 'inst') P.view = 'prog'; break;
      case 'na': P.msg = 'このキーはシミュレーターでは使えません'; break;
      case 'backspace': P.num = (P.num || '').slice(0, -1); P.msg = P.num ? '入力：' + P.num : ''; break;
      case 'assist':
        if (!isY()) {
          P.msg = P.fmode === 'AUTO' ? (P.tp ? 'AUTO：TP を OFF にして、操作盤の CYCLE START' : '操作盤の CYCLE START で自動運転')
            : !P.tp ? '左上のキースイッチで TP を ON にしてください' : !P.dead ? '裏面のデッドマンスイッチを握ってください'
            : 'SHIFT を押しながら軸キーでジョグ。F1 POINT、SHIFT＋F5 TOUCHUP、SHIFT＋FWD で実行';
          break;
        }
        P.msg = P.mode !== 'teach' ? 'PLAY：［SERVO ON READY］→ START で自動運転'
          : !P.ready ? '［SERVO ON READY］を押し、イネーブルスイッチを握ってください'
          : !P.enable ? 'イネーブルスイッチを握ってください'
          : '軸キーでジョグ。INSERT／DELETE／MODIFY は ENTER で確定。FWD は押している間だけ'; break;
      case 'page': case 'pageup': {
        const n = prog().lines.length; if (!n) break;
        sel = clamp(sel + (a === 'page' ? 8 : -8), 0, n - 1); P.view = 'prog'; markPc(); renderLineEdit(); break;
      }
      case 'select':
        if (P.view === 'inst') { P.msg = `「${instList()[P.instSel].t}」を選びました。［INSERT］→［ENTER］で追加`; break; }
        if (P.view !== 'prog') { P.view = 'prog'; break; }
        { const l = prog().lines[sel]; P.msg = l ? `${String(sel + 1).padStart(4, '0')} ${l}（数字を入れて ENTER で速度を変更）` : ''; }
        break;
      case 'num0': case 'num1': case 'num2': case 'num3': case 'num4': case 'num5': case 'num6': case 'num7': case 'num8': case 'num9': case 'numdot': case 'numminus': {
        const ch = { numdot: '.', numminus: '-' }[a] || a.slice(3);
        // INTER LOCK と同時：ハンドリング用の TOOL ON／OF キーとして使う（シミュレーターでの割り当て）
        if (P.interlock && (a === 'num2' || a === 'numdot')) {
          if (P.mode !== 'teach') { P.msg = 'モードを TEACH にしてください'; break; }
          const h = io().handOut; setOut(h.kind, h.n, a === 'num2'); P.msg = `TOOL ${a === 'num2' ? 'ON' : 'OFF'}（${io().fmt(h.kind, h.n)}=${a === 'num2' ? 'ON' : 'OFF'}）`; break;
        }
        if (P.interlock && (a === 'num3' || a === 'numminus')) {
          const why = editBlock(); if (why) { P.msg = why; break; }
          const t = RS.lineOut('yaskawa', io().handOut, a === 'num3');
          P.pending = { op: 'ins', inst: { t } }; P.msg = `［INSERT］：${t}　ENTER で確定／CANCEL で中止`; break;
        }
        P.num = ((P.num || '') + ch).slice(0, 8); P.msg = '入力：' + P.num; break;
      }
      case 'mainmenu': P.menu = !P.menu; break;
      case 'instlist': P.view = P.view === 'inst' ? 'prog' : 'inst'; break;
      case 'dopen': {
        const ins = RS.parseLine(S.sys, prog().lines[sel] || '');
        if ((ins.op === 'CALL' || ins.op === 'JUMPJOB') && lib.progs[ins.name]) { lib.cur = ins.name; sel = 0; renderProgAll(); P.msg = `ジョブ ${ins.name} を開きました`; }
        else P.msg = 'CALL JOB: の行で押すと、呼び出し先のジョブを開きます';
        break;
      }
      case 'mode':
        stopAll(); P.mode = { teach: 'play', play: 'remote', remote: 'teach' }[P.mode];
        P.enable = false; P.msg = P.mode === 'remote' ? 'REMOTE：外部からの起動待ち（シミュレーターでは使いません）' : ''; break;
      case 'ready':
        if (S.estop) { P.msg = '非常停止を解除してください'; break; }
        if (S.alarm) { P.msg = 'アラームをリセットしてください'; break; }
        P.ready = !P.ready; if (!P.ready) stopAll();
        P.msg = P.ready ? (P.mode === 'teach' ? 'イネーブルスイッチを握るとサーボが入ります' : '') : 'サーボ電源を切りました'; break;
      case 'enable':
        P.enable = !P.enable;
        if (!P.enable) { endJog(); if ((run || mv) && P.mode === 'teach') holdStop('イネーブルスイッチを離したため停止'); }
        P.msg = ''; break;
      case 'speed+': P.sp = Math.min(YSP.length - 1, P.sp + 1); break;
      case 'speed-': P.sp = Math.max(0, P.sp - 1); break;
      case 'tp': stopAll(); P.tp = !P.tp; P.msg = ''; break;
      case 'dead': P.msg = ''; P.dead = !P.dead; if (!P.dead) { endJog(); if ((run || mv) && P.tp) holdStop('デッドマンを離したため停止'); } break;
      case 'shift': P.shift = !P.shift; if (!P.shift && P.tp && (heldRun || heldMv || (run && run.fromPend))) { releaseHeld(); if (run) holdStop('SHIFT を離したため停止'); } break;
      case 'fmode-T1': case 'fmode-T2': case 'fmode-AUTO':
        stopAll(); P.fmode = a.slice(6);
        P.msg = P.fmode === 'AUTO' ? (P.tp ? 'AUTO では TP を無効にしてください' : '') : (P.tp ? '' : `${P.fmode}：TP を有効にして操作します`);
        if (P.fmode === 'T2') P.msg = 'T2：速度制限なし（100% まで）。熟練者のみ'; break;
      case 'step': P.step = !P.step; break;
      case 'ovr+': P.ovrI = Math.min(FOV.length - 1, P.ovrI + 1); break;
      case 'ovr-': P.ovrI = Math.max(0, P.ovrI - 1); break;
      case 'coord': P.coord = COORDS[(COORDS.indexOf(P.coord) + 1) % 3]; break;
      case 'view-prog': case 'view-pos': case 'view-io': case 'view-var': P.view = a.slice(5); P.menu = a === 'view-prog' ? P.menu : P.menu; break;
      case 'ins-type': P.ins = P.ins === 'J' ? 'L' : 'J'; break;
      case 'up': if (P.view === 'inst') P.instSel = Math.max(0, P.instSel - 1); else if (P.view !== 'prog') P.view = 'prog'; else { sel = Math.max(0, sel - 1); markPc(); renderLineEdit(); } break;
      case 'down': if (P.view === 'inst') P.instSel = Math.min(instList().length - 1, P.instSel + 1); else if (P.view !== 'prog') P.view = 'prog'; else { sel = Math.min(prog().lines.length - 1, sel + 1); markPc(); renderLineEdit(); } break;
      case 'enter':
        if (doPending()) break;
        if (P.num) {   // 数字を入れて ENTER：選んだ移動命令の速度を変える
          const v = +P.num; P.num = '';
          const ins = RS.parseLine(S.sys, prog().lines[sel] || '');
          const why = editBlock();
          if (why) { P.msg = why; break; }
          if (ins.op !== 'MOVE' || !(v > 0)) { P.msg = '移動命令の行を選んで、速度の数字を入れてください'; break; }
          if (ins.speed.unit === '%' && v > 100) { P.msg = 'VJ は 100 以下です'; break; }
          ins.speed.v = v; edit(() => { prog().lines[sel] = RS.formatMove(S.sys, ins); });
          P.msg = '速度を変更しました：' + prog().lines[sel]; break;
        }
        if (P.view === 'inst') { P.msg = `「${instList()[P.instSel].t}」を［挿入］→［エンター］で追加します`; break; }
        P.view = 'prog'; P.msg = ''; break;
      case 'grip': case 'f4': {
        if (a === 'f4' && P.view !== 'prog') break;
        const why = isY() ? (P.mode !== 'teach' ? 'モードを TEACH にしてください' : (!P.interlock ? '出力の切替は［インターロック］を押しながら操作します' : '')) : (!P.tp ? 'TP を ON にしてください' : (!P.shift ? 'SHIFT を押しながら操作してください' : ''));
        if (why) { P.msg = why; break; }
        const h = io().handOut; setOut(h.kind, h.n, !handOn()); P.msg = `${io().fmt(h.kind, h.n)}=${handOn() ? 'ON' : 'OFF'}`; break;
      }
      case 'ins': case 'f1': {
        if (a === 'f1' && P.view !== 'prog') break;
        const why = editBlock(); if (why) { P.msg = why; break; }
        insertMove(P.ins); P.msg = isY() ? '現在位置を挿入しました' : 'POINT：位置を記録しました'; break;
      }
      case 'f2':
        if (P.view === 'prog') P.ins = P.ins === 'J' ? 'L' : 'J';
        else if (P.view === 'pos') P.coord = 'joint';
        break;
      case 'f3':
        if (P.view === 'pos') { P.coord = 'base'; break; }
        if (P.view !== 'prog') break;
      // fallthrough（DELETE）
      case 'del': {
        const why = editBlock(); if (why) { P.msg = why; break; }
        if (sel < 0) { P.msg = 'プログラムがありません'; break; }
        delLine(); P.msg = ''; break;
      }
      case 'upd': { const why = editBlock(); if (why) { P.msg = why; break; } touchUp(); break; }
      case 'f5':
        if (P.view === 'pos') { P.coord = 'tool'; break; }
        if (P.view !== 'prog') break;
        { const why = editBlock(); if (why) { P.msg = why; break; } }
        if (!P.shift) { P.msg = 'TOUCHUP は SHIFT を押しながら F5 です'; break; }
        touchUp(); break;
      case 'run': case 'cycle': {
        if (a === 'run' && !isY()) break;
        const why = runBlock(); if (why) { P.msg = why; break; }
        if (run && run.paused) { run.paused = false; refreshState(); P.msg = ''; break; }
        if (run) break;
        startRun(Math.max(0, sel), false, isY() ? null : { spdFac: FOV[P.ovrI] / 100, tcpCap: 0 }); P.msg = ''; break;
      }
      case 'hold': if (run) { run.paused = true; refreshState(); } else { mv = null; } P.msg = isY() ? 'ホールド中' : 'HOLD'; break;
      case 'reset': resetAlarm(); P.msg = S.alarm ? P.msg : ''; break;
      case 'estop': $('#estopBtn').click(); return;
    }
    renderPend();
  }
  pendEl.addEventListener('click', e => {
    if (e.target.id === 'pendPop') { setPendFloat(!pend.float); return; }
    if (e.target.id === 'pendBig') { pendEl.classList.toggle('big'); renderPend(); return; }
    const v = e.target.closest('[data-view]'); if (v) { pend.view = v.dataset.view; renderPend(); return; }
    const r = e.target.closest('[data-row]'); if (r) { sel = +r.dataset.row; markPc(); renderLineEdit(); updateLcd(); return; }
    const ri = e.target.closest('[data-inst]'); if (ri) { pend.instSel = +ri.dataset.inst; updateLcd(); return; }
    const b = e.target.closest('[data-act]'); if (b) pendAct(b.dataset.act);
  });
  pendEl.addEventListener('contextmenu', e => e.preventDefault());
  /* 3D 画面の上に重ねて表示 */
  function setPendFloat(f) {
    pend.float = f;
    const fl = $('#pendFloat');
    if (f) { fl.appendChild(pendEl); fl.hidden = false; }
    else { $('#t-pend').appendChild(pendEl); fl.hidden = true; }
    $('#pendAway').hidden = !f;
    renderPend();
  }
  {
    const fl = $('#pendFloat'), bar = fl.querySelector('.pfbar');
    let drag = null;
    bar.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      drag = { x: e.clientX - fl.offsetLeft, y: e.clientY - fl.offsetTop }; bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener('pointermove', e => {
      if (!drag) return;
      const st = fl.parentElement;
      fl.style.left = clamp(e.clientX - drag.x, 0, st.clientWidth - 80) + 'px';
      fl.style.top = clamp(e.clientY - drag.y, 0, st.clientHeight - 40) + 'px';
      fl.style.right = 'auto';
    });
    bar.addEventListener('pointerup', () => { drag = null; });
    $('#pendDock').addEventListener('click', () => setPendFloat(false));
    $('#pendBack').addEventListener('click', () => setPendFloat(false));
  }

  /* =================== メインループ =================== */
  let last = performance.now(), hudT = 0, ioT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000) * (S.timeScale || 1); last = now;
    if (jogHold && !mv) stepJog(dt);
    stepMotion(dt);
    stepRun(dt);
    cellTick(dt);
    const tg = handOn() ? 1 : 0;
    if (Math.abs(S.gripK - tg) > 1e-3) { S.gripK += (tg - S.gripK) * Math.min(1, dt * 12); updateToolVis(); }
    for (const w of works) {
      if (!w.falling) continue;
      const sy = supportY(w) + w.def.size[2] / 2;
      w.vy += 9.8 * dt; w.g.position.y -= w.vy * dt;
      if (w.g.position.y <= sy) { w.g.position.y = sy; w.falling = false; w.vy = 0; }
    }
    if (poseDirty && now - hudT > 50) { hudT = now; poseDirty = false; updateHud(); syncSliders(); }
    if (now - ioT > 250) {
      ioT = now;
      if (!$('#t-prog').hidden && $('#ioDet').open) renderIO();
      if (run) refreshState();
    }
    if (pendVisible() && now - lcdT > 120) { lcdT = now; updateLcd(); }
    if (cableDirty) { cableDirty = false; model.update(); }
    if (CELL.update) CELL.update(dt, { alarm: !!S.alarm, running: !!run });
    look.render(now);
    requestAnimationFrame(frame);
  }

  function renderAll() {
    document.documentElement.dataset.sys = S.sys;
    $$('.seg.sys button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sys === S.sys)));
    $('#saveNative').textContent = (S.sys === 'yaskawa' ? 'JBI' : 'LS') + ' 書き出し';
    $('#saveNativeAll').textContent = 'すべて ' + (S.sys === 'yaskawa' ? 'JBI' : 'LS');
    $('#aiLang').textContent = S.sys === 'yaskawa' ? '安川 INFORM（JBI）' : 'ファナック TP（LS）';
    renderSliders(); renderCartJog(); renderHudLabels(); renderProgSelect(); renderCode(); renderCell(); renderPend(); updateOutBtn(); updateCycle();
    renderIO(); renderVars(); renderLog();
    syncSliders(); updateHud(); refreshState();
  }

  /* =================== 起動 =================== */
  buildCellScene(S.cellId);
  target.set(...CELL.view.target); cam.r = CELL.view.r; if (CELL.view.theta != null) cam.theta = CELL.view.theta;
  buildRobot();
  applyPose();
  resetWorks();
  sel = prog().lines.length ? 0 : -1;
  renderAll();
  resize(); updateCam();
  requestAnimationFrame(frame);

  /* テスト・デバッグ用（ブラウザのコンソールから参照できます） */
  window.RSIM = {
    get state() { return S; }, get prog() { return prog(); }, get lib() { return lib; }, get run() { return run; }, get mv() { return mv; },
    get works() { return works; }, get robot() { return robot; }, get tool() { return tool; }, get vars() { return vars; },
    get TABLES() { return TABLES; }, get CELL() { return CELL; }, switchCell, cupContact,
    scene, look, renderer, camera, curPose, collisionCheck, G, switchSystem, switchTool, makeSample, setOut, getIn, tcpMatrix, showAiResult, importProgs
  };
})();
