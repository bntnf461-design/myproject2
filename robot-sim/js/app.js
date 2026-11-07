/* =====================================================================
 * app.js — 画面・3D表示・動作制御・ティーチングペンダント
 * ===================================================================== */
(function () {
  'use strict';
  const T = window.THREE, RS = window.RS;
  const VERSION = '2.0';
  const D2R = Math.PI / 180;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できない環境 */ } }
  };
  $('#ver').textContent = 'v' + VERSION;

  /* =================== 状態 =================== */
  const S = {
    sys: store.get('rs2-sys', 'yaskawa') === 'fanuc' ? 'fanuc' : 'yaskawa',
    toolId: RS.toolById(store.get('rs2-tool', RS.DEFAULT_TOOL)).id,
    workId: null,
    q: null,
    out: false,           // ハンド出力（吸着／閉）
    holding: null,        // 保持中のワーク
    gripK: 0,             // 爪の閉じ量 0〜1
    alarm: null,
    estop: false,
    opts: Object.assign({ coll: true, trail: true, reach: false, loop: false, autoSup: true, ovr: 100, jogSpd: 30 }, store.get('rs2-opts', {})),
    stats: { count: 0, last: 0, cycleT0: 0 }
  };
  let robot = RS.ROBOTS[S.sys];
  let tool = RS.toolById(S.toolId);
  S.workId = RS.WORKS[store.get('rs2-work', tool.work)] ? store.get('rs2-work', tool.work) : tool.work;
  S.q = robot.home.slice();
  const saveOpts = () => store.set('rs2-opts', S.opts);

  /* =================== Three.js シーン =================== */
  const canvas = $('#c'), stage = $('#stage');
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(40, 1, 0.05, 60);
  scene.add(new T.HemisphereLight(0xffffff, 0x8b95a3, 0.8));
  const sun = new T.DirectionalLight(0xffffff, 0.85);
  sun.position.set(2.5, 5, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 14 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  function shadowed(m) { m.castShadow = true; m.receiveShadow = true; return m; }
  function mesh(geo, mat, x, y, z) { const m = shadowed(new T.Mesh(geo, mat)); m.position.set(x || 0, y || 0, z || 0); return m; }
  function zCyl(r, len, mat, x, y, z) { const g = new T.CylinderGeometry(r, r, len, 32); g.rotateX(Math.PI / 2); return mesh(g, mat, x, y, z); }
  function xCyl(r, len, mat, x, y, z) { const g = new T.CylinderGeometry(r, r, len, 32); g.rotateZ(Math.PI / 2); return mesh(g, mat, x, y, z); }

  /* 床 */
  let floor, grid, reachRing;
  function cssVar(n, d) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; }
  function buildFloor() {
    scene.background = new T.Color(cssVar('--scene', '#e3e8ee'));
    if (floor) { scene.remove(floor); floor.geometry.dispose(); floor.material.dispose(); }
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
    floor = new T.Mesh(new T.PlaneGeometry(16, 16), new T.ShadowMaterial({ opacity: 0.22 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const gc = new T.Color(cssVar('--grid', '#c4ccd7'));
    grid = new T.GridHelper(8, 32, gc, gc);
    grid.position.y = 0.001; scene.add(grid);
  }
  buildFloor();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', buildFloor);

  /* セル（供給台・排出台） */
  const TABLES = [
    { id: 'A', name: '供給台', X: 0.95, Y: 0.75, w: 0.8, d: 0.6, h: 0.45 },
    { id: 'B', name: '排出台', X: 0.95, Y: -0.75, w: 0.8, d: 0.6, h: 0.45 }
  ];
  const mTable = new T.MeshStandardMaterial({ color: 0x8d99a8, roughness: 0.7, metalness: 0.2 });
  const mTop = new T.MeshStandardMaterial({ color: 0x5f6b7a, roughness: 0.8 });
  const mMark = { A: new T.MeshBasicMaterial({ color: 0x1d9a5b }), B: new T.MeshBasicMaterial({ color: 0xd2691e }) };
  for (const t of TABLES) {
    const g = new T.Group();
    g.position.set(t.X, 0, -t.Y);
    g.add(mesh(new T.BoxGeometry(t.w, 0.03, t.d), mTop, 0, t.h - 0.015, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(new T.BoxGeometry(0.04, t.h - 0.03, 0.04), mTable, sx * (t.w / 2 - 0.04), (t.h - 0.03) / 2, sz * (t.d / 2 - 0.04)));
    const mk = new T.Mesh(new T.PlaneGeometry(t.w, 0.03), mMark[t.id]);
    mk.rotation.x = -Math.PI / 2; mk.position.set(0, t.h + 0.0005, t.d / 2 - 0.015); g.add(mk);
    scene.add(g);
  }
  /* 安全柵（簡易） */
  {
    const mPost = new T.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.6 });
    const mNet = new T.MeshBasicMaterial({ color: 0x9aa4b0, transparent: true, opacity: 0.12, side: T.DoubleSide, depthWrite: false });
    const xs = [-1.1, 2.0], zs = [-1.6, 1.6], H = 1.4;
    const corners = [[xs[0], zs[0]], [xs[1], zs[0]], [xs[1], zs[1]], [xs[0], zs[1]]];
    corners.forEach(([x, z]) => scene.add(mesh(new T.BoxGeometry(0.05, H, 0.05), mPost, x, H / 2, z)));
    const walls = [[xs[0], 0, 0, zs[1] - zs[0]], [xs[1], 0, 0, zs[1] - zs[0]], [(xs[0] + xs[1]) / 2, zs[0], 1, xs[1] - xs[0]], [(xs[0] + xs[1]) / 2, zs[1], 1, xs[1] - xs[0]]];
    walls.forEach(([x, z, rot, len]) => {
      const p = new T.Mesh(new T.PlaneGeometry(len, H - 0.2), mNet);
      p.position.set(x, 0.1 + (H - 0.2) / 2, rot ? z : 0);
      if (!rot) { p.rotation.y = Math.PI / 2; p.position.z = 0; }
      scene.add(p);
    });
  }

  /* =================== ロボット =================== */
  let robotRoot = null;
  const G = {};  // sG,lG,uG,rG,bG,tG,mount,tcp
  let toolVis = null;
  function buildRobot() {
    if (robotRoot) {
      if (S.holding) dropWork(true);
      scene.remove(robotRoot);
      robotRoot.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    const d = robot.dims, c = robot.colors;
    const mMain = new T.MeshStandardMaterial({ color: c.main, roughness: 0.42, metalness: 0.2 });
    const mSub = new T.MeshStandardMaterial({ color: c.sub, roughness: 0.5, metalness: 0.1 });
    const mDark = new T.MeshStandardMaterial({ color: c.dark, roughness: 0.6, metalness: 0.3 });
    const root = new T.Group();
    // ベース
    root.add(mesh(new T.CylinderGeometry(0.27, 0.29, 0.16, 40), mDark, 0, 0.08, 0));
    root.add(mesh(new T.BoxGeometry(0.62, 0.02, 0.62), mDark, 0, 0.01, 0));
    // S
    const sG = new T.Group(); root.add(sG);
    sG.add(mesh(new T.CylinderGeometry(0.23, 0.25, 0.14, 40), mSub, 0, 0.23, 0));
    sG.add(mesh(new T.BoxGeometry(0.34, d.pivY - 0.28, 0.32), mMain, d.pivR * 0.5, 0.3 + (d.pivY - 0.28) / 2 - 0.02, 0));
    sG.add(xCyl(0.07, 0.16, mDark, -0.12, d.pivY - 0.05, 0.16));
    // L
    const lG = new T.Group(); lG.position.set(d.pivR, d.pivY, 0); sG.add(lG);
    lG.add(zCyl(0.13, 0.36, mSub));
    lG.add(zCyl(0.09, 0.08, mDark, 0, 0, 0.21));
    lG.add(mesh(new T.BoxGeometry(0.17, d.la, 0.2), mMain, 0, d.la / 2, 0.02));
    // U
    const uG = new T.Group(); uG.position.set(0, d.la, 0); lG.add(uG);
    uG.add(zCyl(0.11, 0.3, mSub));
    uG.add(mesh(new T.BoxGeometry(0.34, 0.2, 0.22), mMain, 0.02, 0.02, -0.01));
    uG.add(xCyl(0.07, 0.14, mDark, -0.2, 0.02, 0));
    // R
    const rG = new T.Group(); uG.add(rG);
    rG.add(xCyl(0.085, d.ua - 0.32, mMain, 0.17 + (d.ua - 0.32) / 2, 0, 0));
    rG.add(xCyl(0.095, 0.04, mSub, 0.17, 0, 0));
    // 手首フォーク
    rG.add(mesh(new T.BoxGeometry(0.16, 0.12, 0.03), mMain, d.ua - 0.06, 0, 0.085));
    rG.add(mesh(new T.BoxGeometry(0.16, 0.12, 0.03), mMain, d.ua - 0.06, 0, -0.085));
    // B
    const bG = new T.Group(); bG.position.set(d.ua, 0, 0); rG.add(bG);
    bG.add(zCyl(0.065, 0.2, mSub));
    // T
    const tG = new T.Group(); bG.add(tG);
    tG.add(xCyl(0.055, d.fl - 0.012, mMain, (d.fl - 0.012) / 2, 0, 0));
    tG.add(xCyl(0.05, 0.012, mDark, d.fl - 0.006, 0, 0));
    const mount = new T.Group();
    mount.position.set(d.fl, 0, 0);
    mount.quaternion.setFromRotationMatrix(RS.TOOL_BASIS);
    tG.add(mount);
    const tcp = new T.Object3D(); mount.add(tcp);
    scene.add(root);
    robotRoot = root;
    Object.assign(G, { sG, lG, uG, rG, bG, tG, mount, tcp, mats: { mMain, mSub, mDark } });
    buildTool();
    buildReach();
  }
  const toolKit = RS.makeToolKit(T);
  function buildTool() {
    if (toolVis) { G.mount.remove(toolVis.group); toolVis.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    toolVis = tool.build(toolKit);
    G.mount.add(toolVis.group);
    G.tcp.position.set(tool.tcp[0], tool.tcp[1], tool.tcp[2]);
  }
  function buildReach() {
    if (reachRing) { scene.remove(reachRing); reachRing.geometry.dispose(); }
    const d = robot.dims, R = d.pivR + d.la + d.ua + d.fl + tool.tcp[2];
    reachRing = new T.Mesh(new T.RingGeometry(R - 0.012, R, 96), new T.MeshBasicMaterial({ color: 0x0a84ff, transparent: true, opacity: 0.6, side: T.DoubleSide }));
    reachRing.rotation.x = -Math.PI / 2; reachRing.position.y = 0.003;
    reachRing.visible = S.opts.reach;
    scene.add(reachRing);
  }

  /* 姿勢を反映 */
  let poseDirty = true;
  function applyPose() {
    const k = RS.toKin(robot, S.q);
    G.sG.rotation.y = k[0] * D2R;
    G.lG.rotation.z = -k[1] * D2R;
    G.uG.rotation.z = k[2] * D2R;
    G.rG.rotation.x = k[3] * D2R;
    G.bG.rotation.z = -k[4] * D2R;
    G.tG.rotation.x = k[5] * D2R;
    scene.updateMatrixWorld(true);
    poseDirty = true;
  }
  const tcpMatrix = q => RS.fk(robot, q || S.q, tool.tcp);
  const curPose = () => RS.poseFromMatrix(tcpMatrix());

  /* =================== ワーク =================== */
  let works = [];
  function workDef() { return RS.WORKS[S.workId]; }
  function makeWork(def) {
    const [sx, sy, sz] = def.size;
    const g = new T.Group();
    const mat = new T.MeshStandardMaterial({ color: def.color, roughness: def.opacity < 1 ? 0.1 : 0.7, metalness: 0, transparent: def.opacity < 1, opacity: def.opacity, depthWrite: def.opacity >= 1 });
    const m = new T.Mesh(new T.BoxGeometry(sx, sz, sy), mat);
    m.castShadow = def.opacity >= 1; m.receiveShadow = true;
    g.add(m);
    g.add(new T.LineSegments(new T.EdgesGeometry(m.geometry), new T.LineBasicMaterial({ color: def.edge })));
    scene.add(g);
    return { def, g, vy: 0, falling: false };
  }
  function clearWorks() {
    if (S.holding) { S.holding = null; }
    for (const w of works) { w.g.parent && w.g.parent.remove(w.g); w.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
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
    spawnAt(TABLES[0]);
    updateToolVis();
  }
  function tableAt(x, z) { // Three 座標
    return TABLES.find(t => Math.abs(x - t.X) <= t.w / 2 && Math.abs(-z - t.Y) <= t.d / 2);
  }
  function worksOn(tbl) {
    return works.filter(w => w !== S.holding && !w.falling && tableAt(w.g.position.x, w.g.position.z) === tbl);
  }
  /* 支える面の高さ（Three y） */
  function supportY(w) {
    const p = w.g.position;
    let y = 0;
    const t = tableAt(p.x, p.z); if (t) y = t.h;
    for (const o of works) {
      if (o === w || o === S.holding) continue;
      const lp = o.g.worldToLocal(p.clone());
      if (Math.abs(lp.x) <= o.def.size[0] / 2 && Math.abs(lp.z) <= o.def.size[1] / 2 && o.g.position.y < p.y)
        y = Math.max(y, o.g.position.y + o.def.size[2] / 2);
    }
    return y;
  }
  const _v = new T.Vector3(), _v2 = new T.Vector3(), _q = new T.Quaternion();
  /* 吸着・把持できるか調べる */
  function tryGrasp() {
    if (S.holding || !S.out) return false;
    const cand = works.filter(w => !w.falling);
    if (tool.kind === 'vacuum') {
      const up = new T.Vector3(0, 0, 1).applyQuaternion(G.mount.getWorldQuaternion(_q));
      for (const w of cand) {
        const wup = new T.Vector3(0, 1, 0).applyQuaternion(w.g.getWorldQuaternion(new T.Quaternion()));
        if (up.dot(wup) > -0.97) continue;          // 吸盤がワーク面に向いていない
        const [sx, sy, sz] = w.def.size;
        let ok = 0;
        for (const [cx, cy] of tool.cups) {
          _v.set(cx, cy, tool.tcp[2]);
          G.mount.localToWorld(_v);
          w.g.worldToLocal(_v);
          const inX = Math.abs(_v.x) <= sx / 2 - tool.cupR * 0.5, inZ = Math.abs(_v.z) <= sy / 2 - tool.cupR * 0.5;
          const gap = _v.y - sz / 2;
          if (inX && inZ && gap > -0.004 && gap < 0.004) ok++;
        }
        if (ok === tool.cups.length) { attach(w); return true; }
      }
    } else {
      G.tcp.getWorldPosition(_v);
      for (const w of cand) {
        const lp = w.g.worldToLocal(_v.clone());
        const [sx, sy, sz] = w.def.size;
        if (Math.abs(lp.x) > sx / 2 || Math.abs(lp.z) > sy / 2 || Math.abs(lp.y) > sz / 2) continue;
        // 爪の開閉方向（ツールY）のワーク幅
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
    G.mount.attach(w.g);
    S.holding = w; w.falling = false; w.vy = 0;
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
  function setOut(on) {
    S.out = !!on;
    if (!on && S.holding) dropWork(false);
    if (on) tryGrasp();
    updateToolVis();
    updateOutBtn();
  }
  function updateToolVis() {
    if (toolVis) toolVis.update({ on: S.out, holding: !!S.holding, k: S.gripK, width: S.holding ? S.gripWidth : null });
  }
  /* 自動供給：排出台のワークを払い出し、供給台が空なら補充 */
  function supplyCycle() {
    const done = worksOn(TABLES[1]);
    for (const w of done) { scene.remove(w.g); works.splice(works.indexOf(w), 1); }
    if (!worksOn(TABLES[0]).length) spawnAt(TABLES[0]);
  }

  /* =================== 干渉チェック =================== */
  function collisionCheck() {
    if (!S.opts.coll) return '';
    const pts = [];
    for (const p of tool.probes) { _v.set(p[0], p[1], p[2]); pts.push({ p: G.mount.localToWorld(_v.clone()), r: 0, what: 'ハンド' }); }
    pts.push({ p: G.bG.getWorldPosition(new T.Vector3()), r: 0.08, what: '手首' });
    pts.push({ p: G.uG.getWorldPosition(new T.Vector3()), r: 0.12, what: '肘' });
    pts.push({ p: G.mount.getWorldPosition(new T.Vector3()), r: 0.05, what: 'フランジ' });
    if (S.holding) {
      const w = S.holding, [sx, sy, sz] = w.def.size;
      for (const a of [-1, 1]) for (const b of [-1, 1]) {
        _v.set(a * sx / 2, -sz / 2, b * sy / 2);
        pts.push({ p: w.g.localToWorld(_v.clone()), r: 0, what: '保持ワーク', tol: 0.003 });
      }
    }
    for (const it of pts) {
      const { p, r } = it, tol = it.tol != null ? it.tol : 0.002;
      if (p.y - r < -tol) return it.what + 'が床に当たります';
      for (const t of TABLES) {
        if (Math.abs(p.x - t.X) <= t.w / 2 + r && Math.abs(-p.z - t.Y) <= t.d / 2 + r && p.y - r < t.h - tol && p.y > -0.01)
          return `${it.what}が${t.name}に当たります`;
      }
    }
    if (tool.kind === 'vacuum') {
      for (const w of works) {
        if (w === S.holding || w.falling) continue;
        const [sx, sy, sz] = w.def.size;
        for (let i = 0; i < tool.probes.length; i++) {
          const lp = w.g.worldToLocal(pts[i].p.clone());
          if (Math.abs(lp.x) < sx / 2 - 0.003 && Math.abs(lp.z) < sy / 2 - 0.003 && Math.abs(lp.y) < sz / 2 - 0.003)
            return 'ハンドがワークに当たります';
        }
      }
    }
    return '';
  }

  /* =================== アラーム =================== */
  const ALM = {
    estop: ['ALM 100', '非常停止中です'],
    coll: ['ALM 201', '干渉を検出しました'],
    reach: ['ALM 202', '直線動作の経路が動作範囲外です'],
    sing: ['ALM 203', '特異点付近のため直線動作できません'],
    limit: ['ALM 204', '可動範囲を超えます'],
    hand: ['ALM 301', 'ハンド確認信号が来ません'],
    prog: ['ALM 401', 'プログラムに誤りがあります']
  };
  function raiseAlarm(key, detail) {
    const [code, msg] = ALM[key];
    S.alarm = { code, msg: msg + (detail ? '：' + detail : '') };
    const errPc = run ? run.pc : -1;
    stopAll();
    if (errPc >= 0) markErrLine(errPc);
    $('#alarmCode').textContent = code;
    $('#alarmMsg').textContent = S.alarm.msg;
    $('#alarm').hidden = false;
    pend.msg = code + ' ' + S.alarm.msg;
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
    if (S.estop) { pend.servo = false; raiseAlarm('estop'); }
    else refreshState();
    renderPend();
  });

  /* =================== 動作 =================== */
  let mv = null;     // 実行中の動作
  let run = null;    // プログラム実行状態
  const smooth = k => k * k * (3 - 2 * k);
  const ovr = () => S.opts.ovr / 100;

  function canMove() {
    if (S.estop) return '非常停止中です';
    if (S.alarm) return 'アラームをリセットしてください';
    return '';
  }
  /* 関節補間 */
  function startJ(to, vPct, done) {
    const from = S.q.slice();
    if (RS.limitViolation(robot, to) >= 0) { raiseAlarm('limit', robot.axes[RS.limitViolation(robot, to)] + '軸'); return false; }
    let tt = 0;
    const f = clamp(vPct, 0.1, 100) / 100 * ovr();
    for (let i = 0; i < 6; i++) tt = Math.max(tt, Math.abs(to[i] - from[i]) / (robot.vmax[i] * f));
    mv = { kind: 'j', from, to: to.slice(), dur: Math.max(0.15, tt * 1.5), t: 0, done };
    return true;
  }
  /* 直線補間 */
  function planL(M, vmm) {
    const r = RS.planLinear(robot, S.q, M, tool.tcp);
    if (!r.ok) return r;
    const f = ovr();
    let tj = 0;
    for (let i = 0; i < 6; i++) {
      let s = 0; for (let k = 1; k < r.qs.length; k++) s = Math.max(s, Math.abs(r.qs[k][i] - r.qs[k - 1][i]));
      tj = Math.max(tj, s * (r.qs.length - 1) / robot.vmax[i]);
    }
    const tl = (r.dist * 1000) / (clamp(vmm, 1, robot.vlMax) * f);
    const ta = r.ang / (180 * f);
    r.dur = Math.max(0.15, 1.5 * Math.max(tl, ta), 1.5 * tj / f);
    return r;
  }
  function startL(M, vmm, done) {
    const r = planL(M, vmm);
    if (!r.ok) { raiseAlarm(r.err === 'singular' ? 'sing' : 'reach', `経路の${Math.round(r.at * 100)}%地点`); return false; }
    mv = { kind: 'p', qs: r.qs, dur: r.dur, t: 0, done };
    return true;
  }
  function stepMotion(dt) {
    if (!mv || (run && run.paused)) return;
    mv.t += dt;
    const k = Math.min(1, mv.t / mv.dur), e = smooth(k);
    const prev = S.q.slice();
    if (mv.kind === 'j') {
      for (let i = 0; i < 6; i++) S.q[i] = mv.from[i] + (mv.to[i] - mv.from[i]) * e;
    } else {
      const x = e * (mv.qs.length - 1), i0 = Math.min(mv.qs.length - 2, Math.floor(x)), fr = x - i0;
      const a = mv.qs[Math.max(0, i0)], b = mv.qs[Math.min(mv.qs.length - 1, i0 + 1)];
      for (let i = 0; i < 6; i++) S.q[i] = a[i] + (b[i] - a[i]) * (mv.qs.length === 1 ? 0 : fr);
    }
    applyPose();
    const c = collisionCheck();
    if (c) { S.q = prev; applyPose(); raiseAlarm('coll', c); return; }
    if (S.out && !S.holding) tryGrasp();
    if (S.opts.trail && run) addTrail();
    if (k >= 1) { const cb = mv.done; mv = null; if (cb) cb(); }
  }
  function stopAll() {
    mv = null;
    jogHold = null;
    $$('.hold').forEach(b => b.classList.remove('hold'));
    if (run) { run = null; renderCode(); }
    refreshState();
  }

  /* =================== プログラム =================== */
  const progKey = () => 'rs2-prog-' + S.sys;
  let prog = loadProg();
  let sel = -1;
  let undoStack = [];
  function loadProg() {
    const p = RS.validateProgram(store.get(progKey(), null));
    return p || { name: 'SAMPLE', tool: S.toolId, lines: [] };
  }
  function saveProg() { store.set(progKey(), prog); }
  function pushUndo() { undoStack.push(JSON.stringify(prog)); if (undoStack.length > 60) undoStack.shift(); }
  function undo() {
    if (run) return;
    const s = undoStack.pop(); if (!s) { flash('#progMsg', 'これ以上戻せません'); return; }
    prog = JSON.parse(s); sel = clamp(sel, -1, prog.lines.length - 1); saveProg(); renderCode(); renderPend();
  }
  function edit(fn) { if (run) { flash('#progMsg', '再生中は編集できません'); return false; } pushUndo(); fn(); saveProg(); renderCode(); renderPend(); return true; }
  const curQ = () => S.q.map(v => +v.toFixed(3));
  function insertLine(l) {
    edit(() => { const at = sel < 0 ? prog.lines.length : sel + 1; prog.lines.splice(at, 0, l); sel = at; });
  }
  function defaultV(op) { return op === 'MOVJ' ? 50 : 300; }

  /* 1行を実行 */
  function execLine(i, done) {
    const l = prog.lines[i];
    if (!l) { done(); return; }
    switch (l.op) {
      case 'MOVJ': if (!startJ(l.q, l.v, done)) return; break;
      case 'MOVL': if (!startL(tcpMatrix(l.q), l.v, done)) return; break;
      case 'OUT': setOut(l.on); done(); break;
      case 'WAITIN': run && (run.wait = { kind: 'in', on: l.on, t: 0, done }); if (!run) done(); break;
      case 'TIMER': run && (run.wait = { kind: 't', t: l.t, done }); if (!run) done(); break;
      default: done();
    }
  }
  function startRun(from, single) {
    const why = canMove(); if (why) { flash('#progMsg', why); return false; }
    if (!prog.lines.length) { flash('#progMsg', 'プログラムがありません'); return false; }
    jogHold = null; mv = null;
    run = { pc: clamp(from, 0, prog.lines.length - 1), single: !!single, paused: false, wait: null };
    if (!single && run.pc === 0) beginCycle();
    if (!single) clearTrail();
    refreshState(); renderCode();
    return true;
  }
  function beginCycle() {
    if (S.opts.autoSup) supplyCycle();
    S.stats.cycleT0 = performance.now();
  }
  function endCycle() {
    S.stats.last = (performance.now() - S.stats.cycleT0) / 1000;
    S.stats.count++;
    updateCycle();
  }
  function stepRun(dt) {
    if (!run || run.paused || mv || S.alarm) return;
    if (run.wait) {
      const w = run.wait;
      if (w.kind === 't') { w.t -= dt; if (w.t > 0) return; }
      else {
        if (S.out && !S.holding) tryGrasp();
        if (!!S.holding !== w.on) { w.t += dt; if (w.t > 3) raiseAlarm('hand', tool.kind === 'vacuum' ? '吸着を確認できません（位置・高さを確認）' : '把持を確認できません'); return; }
      }
      run.wait = null; w.done(); return;
    }
    if (run.pc >= prog.lines.length) {
      endCycle();
      if (S.opts.loop) { run.pc = 0; beginCycle(); renderCode(); return; }
      run = null; sel = prog.lines.length - 1; refreshState(); renderCode(); setStatus('プログラム終了'); return;
    }
    const pc = run.pc;
    sel = pc; markPc();
    run.busy = true;
    execLine(pc, () => {
      if (!run) return;
      run.pc = pc + 1;
      if (run.single) { run = null; sel = Math.min(pc + 1, prog.lines.length - 1); refreshState(); renderCode(); renderPend(); }
      else markPc();
    });
  }

  /* サンプルプログラム（供給台 → 排出台） */
  function makeSample() {
    const def = workDef(), A = TABLES[0], B = TABLES[1];
    const grasp = tool.kind === 'gripper' ? Math.min(def.size[2] * 0.5, tool.grip.depth * 0.6) : 0;
    const zA = A.h + def.size[2] - grasp, zB = B.h + def.size[2] - grasp, ap = tool.approach;
    const P = (t, z) => ({ X: t.X * 1000, Y: t.Y * 1000, Z: z * 1000, rx: 180, ry: 0, rz: 0 });
    const targets = [P(A, zA + ap), P(A, zA), P(B, zB + ap), P(B, zB)];
    const qs = []; let ref = robot.home;
    for (const p of targets) {
      const r = RS.ik(robot, RS.matrixFromPose(p), tool.tcp, ref);
      if (!r.q) { flash('#progMsg', 'サンプルの位置に届きません（ハンド・ワークの組合せを確認）'); return; }
      qs.push(r.q.map(v => +v.toFixed(3))); ref = r.q;
    }
    const home = robot.home.slice();
    const isVac = tool.kind === 'vacuum';
    edit(() => {
      prog.name = 'SAMPLE'; prog.tool = tool.id;
      prog.lines = [
        { op: 'MOVJ', q: home, v: 50 },
        { op: 'MOVJ', q: qs[0], v: 60 },
        { op: 'MOVL', q: qs[1], v: 200 },
        { op: 'OUT', on: true },
        { op: 'WAITIN', on: true },
        ...(isVac ? [{ op: 'TIMER', t: 0.2 }] : []),
        { op: 'MOVL', q: qs[0], v: 400 },
        { op: 'MOVJ', q: qs[2], v: 60 },
        { op: 'MOVL', q: qs[3], v: 200 },
        { op: 'OUT', on: false },
        { op: 'WAITIN', on: false },
        { op: 'TIMER', t: 0.3 },
        { op: 'MOVL', q: qs[2], v: 400 },
        { op: 'MOVJ', q: home, v: 60 }
      ];
      sel = 0;
    });
    resetWorks();
    if (S.out) setOut(false);
    flash('#progMsg', 'サンプルを作成しました。「▶ 再生」で動かせます', true);
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
  let jogHold = null;   // {kind:'j'|'c', axis, dir, frame, spd, src}
  let stepSize = 0;     // 0 = 押している間
  let cartFrame = 'base';
  const LIN_MAX = 250, ROT_MAX = 45, JNT_FRAC = 0.25; // 手動速度の上限（mm/s, deg/s, 最高速度比）
  const BASE_AX = [new T.Vector3(1, 0, 0), new T.Vector3(0, 0, -1), new T.Vector3(0, 1, 0)];

  function cartTarget(M, axis, dir, amt, frame) {
    // amt: mm または 度
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
    const Rot = new T.Matrix4().extractRotation(M);
    const O = R.multiply(Rot); O.setPosition(p);
    return O;
  }
  /* 1フレーム分のジョグ */
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
    if (S.out && !S.holding) tryGrasp();
    if (msg) jogMsg(msg); else if (j.msgShown) { jogMsg(''); j.msgShown = false; }
    if (msg) j.msgShown = true;
  }
  function jogMsg(m) { $('#jogMsg').textContent = m; $('#jogMsg').classList.remove('ok'); pend.msg = m; }
  function endJog() { jogHold = null; $$('.hold').forEach(b => b.classList.remove('hold')); }
  /* 決まった量だけ動かす（ステップ送り） */
  function jogStep(kind, axis, dir, frame) {
    const why = canMove(); if (why) { jogMsg(why); return; }
    if (mv) return;
    const lin = stepSize, rot = { 1: 1, 10: 5, 50: 15 }[stepSize];
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
    if (S.alarm) { pill.textContent = 'アラーム'; pill.classList.add('alm'); }
    else if (run) { pill.textContent = run.paused ? '一時停止' : (run.single ? '1行実行' : '再生中'); pill.classList.add('run'); }
    else pill.textContent = '手動';
    if (!S.alarm && !run) setStatus('手動操作');
    if (run && !S.alarm) setStatus(run.paused ? '一時停止中' : `実行中 ${String(run.pc + 1).padStart(3, '0')} 行目 / ${prog.lines.length}`);
    if (S.alarm) setStatus('アラーム停止中');
    $('#runBtn').textContent = run && run.paused ? '▶ 再開' : '▶ 再生';
  }
  function flash(sel, m, ok) { const el = $(sel); el.textContent = m; el.classList.toggle('ok', !!ok); }

  $$('.seg.sys button').forEach(b => b.addEventListener('click', () => switchSystem(b.dataset.sys)));
  function switchSystem(id) {
    if (id === S.sys) return;
    stopAll();
    saveProg();
    if (S.holding) dropWork(true);
    if (S.alarm && !S.estop) resetAlarm();
    S.sys = id; robot = RS.ROBOTS[id]; store.set('rs2-sys', id);
    S.q = robot.home.slice();
    prog = loadProg(); sel = prog.lines.length ? 0 : -1; undoStack = [];
    Object.assign(pend, { servo: false, tp: false, dead: false, shift: false, mode: 'teach', coord: 'joint', msg: '' });
    buildRobot(); applyPose();
    renderAll();
  }
  /* ハンド */
  const toolSel = $('#toolSel');
  toolSel.innerHTML = RS.TOOLS.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  toolSel.addEventListener('change', () => switchTool(toolSel.value));
  function switchTool(id) {
    if (id === tool.id) return;
    stopAll();
    if (S.holding) dropWork(true);
    S.out = false; S.gripK = 0;
    tool = RS.toolById(id); S.toolId = tool.id; store.set('rs2-tool', tool.id);
    S.workId = tool.work; store.set('rs2-work', S.workId);
    buildTool(); buildReach(); applyPose();
    resetWorks();
    renderAll();
    flash('#progMsg', prog.lines.length && prog.tool !== tool.id ? 'このプログラムは別のハンド用です。「サンプル作成」で作り直すか、位置を修正してください' : '');
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
        if (S.out && !S.holding) tryGrasp();
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
  $('#outBtn').addEventListener('click', () => { setOut(!S.out); if (S.out && !S.holding) flash('#jogMsg', tool.kind === 'vacuum' ? '吸着ON（ワークに触れていません）' : '閉（ワークをつかんでいません）'); else flash('#jogMsg', ''); });
  function outName(on) { return tool.kind === 'vacuum' ? (on ? '吸着 ON' : '吸着 OFF') : (on ? '閉' : '開'); }
  function updateOutBtn() {
    const b = $('#outBtn');
    b.textContent = 'ハンド：' + outName(S.out) + (S.holding ? '（保持中）' : '');
    b.setAttribute('aria-pressed', String(S.out));
  }
  const jogSpd = $('#jogSpd');
  jogSpd.value = S.opts.jogSpd; $('#jogSpdOut').textContent = S.opts.jogSpd + '%';
  jogSpd.addEventListener('input', () => { S.opts.jogSpd = +jogSpd.value; $('#jogSpdOut').textContent = jogSpd.value + '%'; saveOpts(); });

  /* =================== 画面：プログラムタブ =================== */
  const codeEl = $('#code');
  function renderCode() {
    const pi = RS.pointIndex(prog);
    const Y = S.sys === 'yaskawa';
    let h = Y ? '<li class="fixed"><span class="n">0000</span>NOP</li>' : '';
    prog.lines.forEach((l, i) => {
      const n = Y ? String(i + 1).padStart(4, '0') : String(i + 1).padStart(3, ' ') + ':';
      h += `<li data-i="${i}" class="${i === sel ? 'sel' : ''}${run && run.pc === i ? ' pc' : ''}"><span class="n">${n}</span>${esc(RS.formatLine(S.sys, l, pi[i]))}</li>`;
    });
    h += Y ? `<li class="fixed"><span class="n">${String(prog.lines.length + 1).padStart(4, '0')}</span>END</li>` : '<li class="fixed"><span class="n">[End]</span></li>';
    codeEl.innerHTML = h;
    const s = codeEl.querySelector('li.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
    $('#progName').value = prog.name;
    renderLineEdit();
    refreshState();
  }
  function markPc() {
    codeEl.querySelectorAll('li[data-i]').forEach(li => {
      const i = +li.dataset.i;
      li.classList.toggle('pc', !!run && run.pc === i);
      li.classList.toggle('sel', i === sel);
    });
    const s = codeEl.querySelector('li.pc'); if (s) s.scrollIntoView({ block: 'nearest' });
    refreshState();
  }
  function markErrLine(i) { const li = codeEl.querySelector(`li[data-i="${i}"]`); if (li) li.classList.add('err'); }
  codeEl.addEventListener('click', e => {
    const li = e.target.closest('li[data-i]'); if (!li) return;
    sel = +li.dataset.i; markPc(); renderLineEdit(); renderPend();
  });
  codeEl.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = clamp(sel + (e.key === 'ArrowDown' ? 1 : -1), 0, prog.lines.length - 1); markPc(); renderLineEdit();
    } else if (e.key === 'Delete' && sel >= 0) delLine();
  });
  function renderLineEdit() {
    const box = $('#lineEdit');
    const l = prog.lines[sel];
    if (!l) { box.innerHTML = '<p class="note" style="margin:0">行を選ぶと、ここで編集できます。新しい行は選んだ行の下に追加されます。</p>'; return; }
    const Y = S.sys === 'yaskawa';
    let h = `<div class="row"><b>${String(sel + 1).padStart(3, '0')} 行目</b>`;
    if (RS.isMove(l)) {
      h += `<span class="seg mini"><button data-e="op" data-v="MOVJ" aria-pressed="${l.op === 'MOVJ'}">${Y ? 'MOVJ' : 'J'} 関節</button><button data-e="op" data-v="MOVL" aria-pressed="${l.op === 'MOVL'}">${Y ? 'MOVL' : 'L'} 直線</button></span></div>`;
      h += `<div class="row"><label class="chk">速度 <input type="number" id="eV" min="1" max="${l.op === 'MOVJ' ? 100 : robot.vlMax}" step="${l.op === 'MOVJ' ? 1 : 10}" value="${l.v}"> ${l.op === 'MOVJ' ? '%' : 'mm/s'}</label></div>`;
      h += `<div class="row grow"><button data-e="touch">現在位置で修正</button><button data-e="goto">この位置へ移動</button></div>`;
    } else if (l.op === 'OUT' || l.op === 'WAITIN') {
      h += `<span class="seg mini"><button data-e="on" data-v="1" aria-pressed="${l.on}">ON</button><button data-e="on" data-v="0" aria-pressed="${!l.on}">OFF</button></span></div>`;
      h += `<p class="note" style="margin:2px 0">${l.op === 'OUT' ? (tool.kind === 'vacuum' ? 'ON＝吸着、OFF＝解放' : 'ON＝閉じる、OFF＝開く') : 'ハンドの確認信号（保持中＝ON）を待ちます。3秒で来なければアラーム'}</p>`;
    } else if (l.op === 'TIMER') {
      h += `</div><div class="row"><label class="chk">待ち時間 <input type="number" id="eT" min="0" max="60" step="0.1" value="${l.t}"> 秒</label></div>`;
    }
    h += `<div class="row grow"><button data-e="up">↑ 上へ</button><button data-e="down">↓ 下へ</button><button data-e="dup">複製</button><button data-e="del" class="danger">削除</button></div>`;
    box.innerHTML = h;
    const eV = $('#eV'); if (eV) eV.addEventListener('change', () => { const v = +eV.value; if (!(v > 0)) return; edit(() => { l.v = clamp(v, 1, l.op === 'MOVJ' ? 100 : robot.vlMax); }); });
    const eT = $('#eT'); if (eT) eT.addEventListener('change', () => { const v = +eT.value; if (!(v >= 0)) return; edit(() => { l.t = clamp(v, 0, 60); }); });
  }
  function delLine() { if (sel < 0) return; edit(() => { prog.lines.splice(sel, 1); sel = Math.min(sel, prog.lines.length - 1); }); }
  $('#lineEdit').addEventListener('click', e => {
    const b = e.target.closest('[data-e]'); if (!b) return;
    const l = prog.lines[sel]; if (!l) return;
    switch (b.dataset.e) {
      case 'op': if (l.op !== b.dataset.v) edit(() => { l.op = b.dataset.v; l.v = defaultV(l.op); }); break;
      case 'on': edit(() => { l.on = b.dataset.v === '1'; }); break;
      case 'touch': edit(() => { l.q = curQ(); }); flash('#progMsg', '現在位置で修正しました', true); break;
      case 'goto': {
        const why = canMove(); if (why) { flash('#progMsg', why); break; }
        if (run) stopAll();
        startJ(l.q, S.opts.jogSpd, null); break;
      }
      case 'up': if (sel > 0) edit(() => { const [x] = prog.lines.splice(sel, 1); prog.lines.splice(sel - 1, 0, x); sel--; }); break;
      case 'down': if (sel < prog.lines.length - 1) edit(() => { const [x] = prog.lines.splice(sel, 1); prog.lines.splice(sel + 1, 0, x); sel++; }); break;
      case 'dup': edit(() => { prog.lines.splice(sel + 1, 0, JSON.parse(JSON.stringify(l))); sel++; }); break;
      case 'del': delLine(); break;
    }
  });
  $$('[data-ins]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.ins;
    if (k === 'MOVJ' || k === 'MOVL') {
      const prev = [...prog.lines.slice(0, sel + 1)].reverse().find(l => l.op === k);
      insertLine({ op: k, q: curQ(), v: prev ? prev.v : defaultV(k) });
    } else if (k === 'ON' || k === 'OFF') insertLine({ op: 'OUT', on: k === 'ON' });
    else if (k === 'WAITIN') { const o = [...prog.lines.slice(0, sel + 1)].reverse().find(l => l.op === 'OUT'); insertLine({ op: 'WAITIN', on: o ? o.on : true }); }
    else if (k === 'TIMER') insertLine({ op: 'TIMER', t: 0.5 });
  }));
  $('#progName').addEventListener('change', e => {
    const n = e.target.value.toUpperCase().replace(/[^A-Z0-9_\-]/g, '').slice(0, 16) || 'SAMPLE';
    edit(() => { prog.name = n; });
  });
  $('#undoBtn').addEventListener('click', undo);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); undo(); }
  });
  $('#runBtn').addEventListener('click', () => {
    if (run && run.paused) { run.paused = false; refreshState(); return; }
    if (run) return;
    startRun(sel > 0 && confirmFromSel() ? sel : 0, false);
  });
  function confirmFromSel() { return window.confirm(`${sel + 1} 行目から再生しますか？\n（キャンセルで先頭から）`); }
  $('#pauseBtn').addEventListener('click', () => { if (run) { run.paused = true; refreshState(); } });
  $('#stopBtn').addEventListener('click', () => { stopAll(); setStatus('停止しました'); });
  $('#stepBtn').addEventListener('click', () => { if (!run) startRun(Math.max(0, sel), true); });
  const loopEl = $('#loop'), autoEl = $('#autoSup'), ovrEl = $('#ovr');
  loopEl.checked = S.opts.loop; autoEl.checked = S.opts.autoSup; ovrEl.value = S.opts.ovr; $('#ovrOut').textContent = S.opts.ovr + '%';
  loopEl.addEventListener('change', () => { S.opts.loop = loopEl.checked; saveOpts(); });
  autoEl.addEventListener('change', () => { S.opts.autoSup = autoEl.checked; saveOpts(); });
  ovrEl.addEventListener('input', () => { S.opts.ovr = +ovrEl.value; $('#ovrOut').textContent = ovrEl.value + '%'; saveOpts(); renderPend(); });
  $('#sampleBtn').addEventListener('click', () => {
    if (prog.lines.length && !window.confirm('今のプログラムをサンプルで置き換えます。よろしいですか？（元に戻すこともできます）')) return;
    stopAll(); makeSample();
  });
  $('#clearBtn').addEventListener('click', () => {
    if (!prog.lines.length) return;
    if (!window.confirm('プログラムをすべて削除します。よろしいですか？（元に戻すこともできます）')) return;
    stopAll(); edit(() => { prog.lines = []; sel = -1; });
  });

  /* ファイル */
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('#saveJson').addEventListener('click', () => { download(prog.name + '.json', RS.exportJSON(prog, S.sys), 'application/json'); flash('#progMsg', 'JSON を保存しました', true); });
  $('#saveNative').addEventListener('click', () => {
    if (!prog.lines.length) { flash('#progMsg', 'プログラムがありません'); return; }
    if (S.sys === 'yaskawa') download(prog.name + '.JBI', RS.exportJBI(prog, q => RS.poseFromMatrix(tcpMatrix(q))));
    else download(prog.name + '.LS', RS.exportLS(prog));
    flash('#progMsg', (S.sys === 'yaskawa' ? 'JBI' : 'LS') + ' を書き出しました', true);
  });
  $('#loadBtn').addEventListener('click', () => $('#fileIn').click());
  $('#fileIn').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const text = await f.text();
    const ikOf = (P, ref) => { const r = RS.ik(RS.ROBOTS.yaskawa, RS.matrixFromPose(P), tool.tcp, ref || RS.ROBOTS.yaskawa.home); return r.q ? r.q.map(v => +v.toFixed(3)) : null; };
    const r = RS.importText(text, ikOf);
    if (r.err) { flash('#progMsg', r.err); return; }
    if (r.system && r.system !== S.sys) {
      if (!window.confirm(`このファイルは${RS.ROBOTS[r.system].label}用です。システムを切り替えて読み込みますか？`)) return;
      switchSystem(r.system);
    }
    stopAll();
    edit(() => { prog = r.prog; sel = prog.lines.length ? 0 : -1; });
    saveProg(); renderCode(); renderPend();
    flash('#progMsg', `${f.name} を読み込みました（${prog.lines.length} 行）` + (prog.tool !== tool.id ? '。ハンドが違います：' + RS.toolById(prog.tool).name : ''), true);
  });

  /* =================== 画面：ハンド・セル =================== */
  function renderCell() {
    const ic = { vacuum: '◎', gripper: '⊐' };
    $('#toolCards').innerHTML = RS.TOOLS.map(t => `<button class="tcard" data-tool="${t.id}" aria-pressed="${t.id === tool.id}"><span class="ic">${ic[t.kind] || '■'}</span><b>${esc(t.name)}</b><span class="d">${esc(t.desc)}<br>TCP Z=${Math.round(t.tcp[2] * 1000)}mm ／ ${t.kind === 'vacuum' ? '吸盤 ' + t.cups.length + '個' : '爪 開き ' + Math.round(t.grip.open * 1000) + 'mm'} ／ 標準ワーク：${esc(RS.WORKS[t.work].name)}</span></button>`).join('');
    $('#workSel').innerHTML = Object.entries(RS.WORKS).map(([k, w]) => `<option value="${k}"${k === S.workId ? ' selected' : ''}>${esc(w.name)}</option>`).join('');
    toolSel.value = tool.id;
    const d = robot.dims;
    $('#cellInfo').innerHTML = [
      ['機種', robot.model], ['リーチ', Math.round((d.pivR + d.la + d.ua + d.fl) * 1000) + ' mm（フランジまで）'],
      ['ハンド', tool.name], ['ワーク', workDef().name],
      ['供給台', `X ${TABLES[0].X * 1000} / Y ${TABLES[0].Y * 1000} / 高さ ${TABLES[0].h * 1000} mm`],
      ['排出台', `X ${TABLES[1].X * 1000} / Y ${TABLES[1].Y * 1000} / 高さ ${TABLES[1].h * 1000} mm`]
    ].map(([a, b]) => `<dt>${a}</dt><dd>${esc(b)}</dd>`).join('');
  }
  $('#toolCards').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) switchTool(b.dataset.tool); });
  $('#workSel').addEventListener('change', e => { stopAll(); S.workId = e.target.value; store.set('rs2-work', S.workId); if (S.out) setOut(false); resetWorks(); renderCell(); });
  $('#resetWork').addEventListener('click', () => { stopAll(); if (S.holding) dropWork(true); setOut(false); resetWorks(); S.stats.count = 0; updateCycle(); });
  $('#trailClr').addEventListener('click', clearTrail);
  const optColl = $('#optColl'), optTrail = $('#optTrail'), optReach = $('#optReach');
  optColl.checked = S.opts.coll; optTrail.checked = S.opts.trail; optReach.checked = S.opts.reach;
  optColl.addEventListener('change', () => { S.opts.coll = optColl.checked; saveOpts(); });
  optTrail.addEventListener('change', () => { S.opts.trail = optTrail.checked; trail.visible = S.opts.trail; saveOpts(); });
  optReach.addEventListener('change', () => { S.opts.reach = optReach.checked; reachRing.visible = S.opts.reach; saveOpts(); });
  trail.visible = S.opts.trail;

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
    $('#cycleInfo').innerHTML = S.stats.count ? `サイクル <b>${S.stats.last.toFixed(2)} s</b><br>完了 <b>${S.stats.count}</b>` : '';
  }

  /* =================== タブ =================== */
  $$('.tabs button').forEach(b => b.addEventListener('click', () => {
    $$('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    ['jog', 'prog', 'pend', 'cell'].forEach(t => { $('#t-' + t).hidden = (t !== b.dataset.t); });
    if (b.dataset.t === 'jog') fillPoseIn();
    if (b.dataset.t === 'pend') renderPend();
  }));

  /* =================== カメラ =================== */
  const target = new T.Vector3(0.5, 0.55, 0);
  let cam = { theta: 0.95, phi: 0.45, r: 4.2 };
  const VIEWS = { iso: { theta: 0.95, phi: 0.45, r: 4.2 }, front: { theta: Math.PI / 2, phi: 0.12, r: 4.4 }, side: { theta: 0, phi: 0.12, r: 4.4 }, top: { theta: Math.PI / 2, phi: 1.5, r: 4.8 } };
  function updateCam() {
    cam.phi = clamp(cam.phi, 0.02, 1.55); cam.r = clamp(cam.r, 1, 12);
    camera.position.set(
      target.x + cam.r * Math.cos(cam.phi) * Math.sin(cam.theta),
      target.y + cam.r * Math.sin(cam.phi),
      target.z + cam.r * Math.cos(cam.phi) * Math.cos(cam.theta));
    camera.lookAt(target);
  }
  $('#views').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) { cam = { ...VIEWS[b.dataset.v] }; target.set(0.5, 0.55, 0); updateCam(); }
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
    if (ptrs.size === 1) {
      if (panMode) pan(dx, dy);
      else { cam.theta -= dx * 0.008; cam.phi += dy * 0.006; }
    } else if (ptrs.size === 2) {
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
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);

  /* =================== ティーチングペンダント =================== */
  const pend = { servo: false, mode: 'teach', coord: 'joint', sp: 1, ovrI: 3, tp: false, dead: false, shift: false, view: 'prog', ins: 'MOVJ', msg: '' };
  const YSP = [['微速', 3], ['低速', 12], ['中速', 35], ['高速', 70]];
  const FOV = [1, 5, 10, 25, 50, 75, 100];
  const pendEl = $('#pend');
  let lcdCache = '', lcdT = 0;
  const isY = () => S.sys === 'yaskawa';
  const COORDS = ['joint', 'base', 'tool'];
  function pendAxisLabels() { return pend.coord === 'joint' ? robot.axes : robot.cart; }
  function pendJogSpec() {
    return { spd: (isY() ? YSP[pend.sp][1] : FOV[pend.ovrI]) / 100, frame: pend.coord === 'tool' ? 'tool' : 'base', check: jogBlock };
  }
  function jogBlock() {
    if (isY()) {
      if (!pend.servo) return 'サーボ電源が入っていません';
      if (pend.mode !== 'teach') return '教示モードにしてください';
    } else {
      if (!pend.tp) return 'TPが無効です。TP ONにしてください';
      if (!pend.dead) return 'デッドマンスイッチを握ってください';
      if (!pend.shift) return 'SHIFTを押しながら操作してください';
    }
    return '';
  }
  function editBlock() {
    if (isY()) return pend.mode !== 'teach' ? '教示モードにしてください' : '';
    return pend.tp ? '' : 'TPが無効です。TP ONにしてください';
  }
  function runBlock() {
    if (S.alarm) return 'アラームをリセットしてください';
    if (!prog.lines.length) return 'プログラムがありません';
    if (isY()) {
      if (!pend.servo) return 'サーボ電源が入っていません';
      if (pend.mode !== 'play') return '再生モードにしてください';
    } else if (pend.tp) return 'TPが有効です。TP OFFにしてください';
    return '';
  }
  function lcdHTML() {
    const Y = isY();
    const pi = RS.pointIndex(prog);
    let title = '', rows = [], selRow = -1, right = '';
    if (pend.view === 'prog') {
      if (Y) {
        title = 'ジョブ内容　' + prog.name; right = 'S:' + String(Math.max(0, sel) + 1).padStart(4, '0');
        rows.push('0000 NOP');
        prog.lines.forEach((l, k) => { rows.push(`${String(k + 1).padStart(4, '0')} ${RS.formatLine('yaskawa', l, pi[k])}`); if (k === sel) selRow = rows.length - 1; });
        rows.push(`${String(prog.lines.length + 1).padStart(4, '0')} END`);
      } else {
        title = prog.name; right = `${Math.max(0, sel) + 1}/${prog.lines.length + 1}`;
        prog.lines.forEach((l, k) => { rows.push(`${String(k + 1).padStart(3, ' ')}: ${RS.formatLine('fanuc', l, pi[k])} ;`); if (k === sel) selRow = rows.length - 1; });
        rows.push('[End]');
      }
    } else {
      const P = curPose(), j = pend.coord === 'joint';
      const cl = robot.cart;
      if (Y) {
        title = '現在位置　' + (j ? '関節' : 'ロボット');
        rows = j ? S.q.map((v, i) => `${robot.axes[i]}  : ${v.toFixed(3).padStart(9)} °`) :
          [P.X, P.Y, P.Z, P.rx, P.ry, P.rz].map((v, i) => `${cl[i].padEnd(3)}: ${v.toFixed(i < 3 ? 3 : 4).padStart(10)} ${i < 3 ? 'mm' : '°'}`);
      } else {
        title = 'POSITION　' + (j ? 'JOINT' : 'WORLD');
        rows = j ? S.q.map((v, i) => `J${i + 1}: ${v.toFixed(3).padStart(9)} deg`) :
          [P.X, P.Y, P.Z, P.rx, P.ry, P.rz].map((v, i) => `${cl[i]}: ${v.toFixed(3).padStart(9)} ${i < 3 ? 'mm' : 'deg'}`);
      }
    }
    const N = 7;
    const st = clamp((selRow >= 0 ? selRow : 0) - 3, 0, Math.max(0, rows.length - N));
    let vis = '';
    for (let i = 0; i < N; i++) {
      const t = rows[st + i];
      vis += t === undefined ? '<div class="lr"></div>' : `<div class="lr${st + i === selRow ? ' sel' : ''}">${esc(t)}</div>`;
    }
    const cn = robot.coordNames[pend.coord];
    const foot = Y
      ? `${pend.servo ? '●サーボON' : '○サーボOFF'} ${pend.mode === 'teach' ? '教示' : '再生'} ${YSP[pend.sp][0]} ${cn} 挿入:${pend.ins}`
      : `${cn} ${FOV[pend.ovrI]}% TP ${pend.tp ? 'ON' : 'OFF'}${pend.dead ? ' DMS' : ''}${pend.shift ? ' SHIFT' : ''} ${pend.ins === 'MOVJ' ? 'J' : 'L'}`;
    const msg = S.alarm ? S.alarm.code + ' ' + S.alarm.msg : (pend.msg || (run ? (Y ? '再生中' : 'RUNNING') : ''));
    return `<div class="t"><span>${esc(title)}</span><span>${esc(right)}</span></div><div class="b">${vis}</div><div class="f">${esc(foot)}</div><div class="m">${esc(msg)}</div>`;
  }
  function updateLcd() {
    const el = $('#lcd'); if (!el) return;
    const h = lcdHTML();
    if (h !== lcdCache) { lcdCache = h; el.innerHTML = h; }
  }
  function renderPend() {
    if ($('#t-pend').hidden && pendEl.innerHTML) { lcdCache = ''; return; }
    const Y = isY(), ax = pendAxisLabels();
    let jr = '';
    for (let i = 0; i < 6; i++) {
      const spec = pend.coord === 'joint' ? `{"kind":"j","axis":${i},"dir":DIR,"pendant":true}` : `{"kind":"c","axis":${i},"dir":DIR,"pendant":true}`;
      jr += `<button class="pk" data-jog='${spec.replace('DIR', -1)}'>−</button><span class="ax">${ax[i]}</span><button class="pk" data-jog='${spec.replace('DIR', 1)}'>＋</button>`;
    }
    const on = b => (b ? ' on' : '');
    const cn = robot.coordNames[pend.coord];
    const modeKeys = Y
      ? `<button class="pk${on(pend.servo)}" data-act="servo">サーボ<br>${pend.servo ? 'ON' : 'OFF'}</button><button class="pk" data-act="mode">モード<br>${pend.mode === 'teach' ? '教示' : '再生'}</button><button class="pk" data-act="coord">座標<br>${cn}</button><button class="pk" data-act="speed">手動速度<br>${YSP[pend.sp][0]}</button>`
      : `<button class="pk${on(pend.tp)}" data-act="tp">TP<br>${pend.tp ? 'ON' : 'OFF'}</button><button class="pk${on(pend.dead)}" data-act="dead">DEAD<br>MAN</button><button class="pk${on(pend.shift)}" data-act="shift">SHIFT</button><button class="pk" data-act="coord">COORD<br>${cn}</button><button class="pk" data-act="ovr-">−%</button><button class="pk" data-act="ovr+">＋%</button><button class="pk" data-act="ins-type">${pend.ins === 'MOVJ' ? 'J' : 'L'}<br>補間</button><button class="pk" data-act="view">DISP</button>`;
    const yExtra = Y ? `<button class="pk" data-act="ins-type">補間<br>${pend.ins}</button><button class="pk" data-act="view">画面<br>切替</button><button class="pk" data-act="grip">ハンド<br>${S.out ? 'ON' : 'OFF'}</button><button class="pk" data-act="reset">リセット</button>` : '';
    const editKeys = Y
      ? `<button class="pk" data-act="ins">挿入</button><button class="pk" data-act="upd">修正</button><button class="pk" data-act="del">削除</button><button class="pk" data-act="enter">エンター</button><button class="pk" data-act="up">▲</button><button class="pk" data-act="down">▼</button><button class="pk" data-act="bwd">後退</button><button class="pk" data-act="fwd">前進</button>`
      : `<button class="pk" data-act="ins">POINT</button><button class="pk" data-act="upd">TOUCH<br>UP</button><button class="pk" data-act="del">DELETE</button><button class="pk" data-act="grip">RO[1]<br>${S.out ? 'ON' : 'OFF'}</button><button class="pk" data-act="up">▲</button><button class="pk" data-act="down">▼</button><button class="pk" data-act="bwd">BWD</button><button class="pk" data-act="fwd">FWD</button>`;
    const runKeys = Y
      ? `<button class="pk go" data-act="run">スタート</button><button class="pk stop" data-act="hold">ホールド</button><button class="pk" data-act="estop">非常停止</button>`
      : `<button class="pk go" data-act="run">CYCLE<br>START</button><button class="pk stop" data-act="hold">HOLD</button><button class="pk" data-act="reset">RESET</button>`;
    const how = Y
      ? '手順：サーボON → 教示モード → 軸キーを押し続けるとジョグ。「挿入」で現在位置を選択行の下に追加（補間キーで MOVJ／MOVL 切替）。「前進」を押すと選択行を1行ずつ実行。自動運転は「再生」モード＋サーボONで「スタート」。'
      : '手順：TP ON → DEADMAN と SHIFT を有効 → 軸キーを押し続けるとジョグ。POINT で現在位置を追加（J/L 補間キーで切替）、SHIFT＋FWD で1行ずつ実行。自動運転は TP OFF で CYCLE START。';
    pendEl.innerHTML = `<div class="pend ${Y ? 'yas' : 'fan'}"><div class="pbrand"><span>${robot.brand}</span><span>${Y ? 'プログラミングペンダント' : 'iPendant'}</span></div><div class="lcd" id="lcd"></div>` +
      `<div class="pgrid">${modeKeys}${yExtra}</div><div class="jgrid">${jr}</div><div class="pgrid">${editKeys}</div><div class="pgrid g3">${runKeys}</div></div>` +
      `<p class="note">${how}</p><p class="note">実機の画面・キー配列を簡略化した再現です。</p>`;
    lcdCache = ''; updateLcd();
  }
  bindHold(pendEl);
  function pendAct(a) {
    const P = pend;
    switch (a) {
      case 'servo':
        if (!P.servo && S.estop) { P.msg = '非常停止中はサーボONできません'; break; }
        if (!P.servo && S.alarm) { P.msg = 'アラームをリセットしてください'; break; }
        P.servo = !P.servo; if (!P.servo) stopAll(); P.msg = P.servo ? '' : 'サーボ電源を切りました'; break;
      case 'mode': stopAll(); P.mode = P.mode === 'teach' ? 'play' : 'teach'; P.msg = ''; break;
      case 'speed': P.sp = (P.sp + 1) % YSP.length; break;
      case 'tp': stopAll(); P.tp = !P.tp; P.msg = ''; break;
      case 'dead': P.dead = !P.dead; if (!P.dead) { endJog(); if (run && P.tp) stopAll(); } P.msg = ''; break;
      case 'shift': P.shift = !P.shift; break;
      case 'ovr+': P.ovrI = Math.min(FOV.length - 1, P.ovrI + 1); break;
      case 'ovr-': P.ovrI = Math.max(0, P.ovrI - 1); break;
      case 'coord': P.coord = COORDS[(COORDS.indexOf(P.coord) + 1) % 3]; break;
      case 'view': P.view = P.view === 'prog' ? 'pos' : 'prog'; break;
      case 'ins-type': P.ins = P.ins === 'MOVJ' ? 'MOVL' : 'MOVJ'; break;
      case 'up': sel = Math.max(0, sel - 1); markPc(); renderLineEdit(); break;
      case 'down': sel = Math.min(prog.lines.length - 1, sel + 1); markPc(); renderLineEdit(); break;
      case 'enter': P.view = 'prog'; break;
      case 'grip': {
        const why = isY() ? (P.mode !== 'teach' ? '教示モードにしてください' : '') : (P.tp && !P.shift ? 'SHIFTを押しながら操作してください' : '');
        if (why) { P.msg = why; break; }
        setOut(!S.out); P.msg = ''; break;
      }
      case 'ins': {
        const why = editBlock(); if (why) { P.msg = why; break; }
        const prev = [...prog.lines.slice(0, sel + 1)].reverse().find(l => l.op === P.ins);
        insertLine({ op: P.ins, q: curQ(), v: prev ? prev.v : defaultV(P.ins) }); P.msg = ''; break;
      }
      case 'upd': {
        const why = editBlock(); if (why) { P.msg = why; break; }
        const l = prog.lines[sel];
        if (!l || !RS.isMove(l)) { P.msg = '移動命令の行を選んでください'; break; }
        edit(() => { l.q = curQ(); }); P.msg = isY() ? '位置を修正しました' : 'TOUCHUP 完了'; break;
      }
      case 'del': {
        const why = editBlock(); if (why) { P.msg = why; break; }
        if (sel < 0) { P.msg = 'プログラムがありません'; break; }
        delLine(); P.msg = ''; break;
      }
      case 'fwd': {
        const why = jogBlock(); if (why) { P.msg = why; break; }
        if (run || mv) break;
        if (sel < 0) { P.msg = 'プログラムがありません'; break; }
        startRun(sel, true); P.msg = ''; break;
      }
      case 'bwd': {
        const why = jogBlock(); if (why) { P.msg = why; break; }
        if (run || mv) break;
        // 1つ前の移動命令の位置へ戻る
        let i = sel - 1; while (i >= 0 && !RS.isMove(prog.lines[i])) i--;
        if (i < 0) { P.msg = '戻る位置がありません'; break; }
        sel = i; startJ(prog.lines[i].q, prog.lines[i].op === 'MOVJ' ? prog.lines[i].v : 25, null); markPc(); P.msg = ''; break;
      }
      case 'run': {
        const why = runBlock(); if (why) { P.msg = why; break; }
        if (run && run.paused) { run.paused = false; refreshState(); break; }
        if (run) break;
        startRun(Math.max(0, sel), false); P.msg = ''; break;
      }
      case 'hold': if (run) { run.paused = true; refreshState(); } else { mv = null; } P.msg = isY() ? 'ホールド中' : 'HOLD'; break;
      case 'reset': resetAlarm(); P.msg = S.alarm ? P.msg : ''; break;
      case 'estop': $('#estopBtn').click(); break;
    }
    renderPend();
  }
  pendEl.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) pendAct(b.dataset.act); });
  pendEl.addEventListener('contextmenu', e => e.preventDefault());

  /* =================== メインループ =================== */
  let last = performance.now(), hudT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000) * (S.timeScale || 1); last = now;
    if (jogHold && !mv) stepJog(dt);
    stepMotion(dt);
    stepRun(dt);
    // 爪の開閉
    const tg = S.out ? 1 : 0;
    if (Math.abs(S.gripK - tg) > 1e-3) { S.gripK += (tg - S.gripK) * Math.min(1, dt * 12); updateToolVis(); }
    // 落下
    for (const w of works) {
      if (!w.falling) continue;
      const sy = supportY(w) + w.def.size[2] / 2;
      w.vy += 9.8 * dt; w.g.position.y -= w.vy * dt;
      if (w.g.position.y <= sy) { w.g.position.y = sy; w.falling = false; w.vy = 0; }
    }
    if (poseDirty && now - hudT > 50) {
      hudT = now; poseDirty = false;
      updateHud(); syncSliders();
    }
    if (!$('#t-pend').hidden && now - lcdT > 120) { lcdT = now; updateLcd(); }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  function renderAll() {
    document.documentElement.dataset.sys = S.sys;
    $$('.seg.sys button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sys === S.sys)));
    $('#saveNative').textContent = S.sys === 'yaskawa' ? 'JBI 書き出し' : 'LS 書き出し';
    renderSliders(); renderCartJog(); renderHudLabels(); renderCode(); renderCell(); renderPend(); updateOutBtn(); updateCycle();
    syncSliders(); updateHud(); refreshState();
  }

  /* =================== 起動 =================== */
  buildRobot();
  applyPose();
  resetWorks();
  sel = prog.lines.length ? 0 : -1;
  renderAll();
  resize(); updateCam();
  requestAnimationFrame(frame);

  /* テスト・デバッグ用（ブラウザのコンソールから参照できます） */
  window.RSIM = {
    get state() { return S; }, get prog() { return prog; }, get run() { return run; }, get mv() { return mv; },
    get works() { return works; }, get robot() { return robot; }, get tool() { return tool; },
    curPose, collisionCheck, G, TABLES, switchSystem, switchTool, makeSample, setOut
  };
})();
