// node tests/smoke.js : ブラウザでの総合動作確認（Playwright）
//   SHOTS=フォルダ でスクリーンショットも保存
const { chromium } = require('playwright');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '../index.html');
const shots = process.env.SHOTS || '';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 820 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.RSIM);
  await page.evaluate(() => { RSIM.state.timeScale = 3; });
  const ok = [], ng = [];
  const check = (name, cond, info) => (cond ? ok : ng).push(name + (cond ? '' : ' :: ' + JSON.stringify(info)));
  const ev = (f, a) => page.evaluate(f, a);
  const click = sel => ev(s => document.querySelector(s).click(), sel);
  const tab = t => page.click(`.tabs button[data-t="${t}"]`);
  const waitIdle = (ms) => page.waitForFunction(() => !RSIM.run && !RSIM.mv, null, { timeout: ms || 90000 });
  const workPos = () => ev(() => RSIM.works.map(w => [w.g.position.x, w.g.position.y, w.g.position.z]));

  // 1. 初期状態
  check('初期ハンドはガラス4吸盤', (await ev(() => RSIM.tool.id)) === 'glass4');
  check('3D とFKが一致', await ev(() => { const v = new THREE.Vector3(); RSIM.G.tcp.getWorldPosition(v); return v.distanceTo(new THREE.Vector3().setFromMatrixPosition(RSIM.tcpMatrix())) < 1e-6; }));
  if (shots) await page.screenshot({ path: shots + '/01-start.png' });

  // 2. 安川サンプル（ラベル・変数・入力待ち付き、3回）
  await tab('prog');
  await page.click('#sampleBtn');
  const yText = await page.textContent('#code');
  check('安川サンプル表記', yText.includes('MOVJ C00000') && yText.includes('MOVL C0') && yText.includes('DOUT OT#(1) ON') && yText.includes('JUMP *LOOP IF I000<3'), yText.slice(0, 300));
  await page.click('#runBtn');
  await page.waitForTimeout(800);
  if (shots) await page.screenshot({ path: shots + '/02-running.png' });
  await waitIdle(120000);
  const r1 = await ev(() => ({ alarm: RSIM.state.alarm, cnt: RSIM.state.stats.count, I000: RSIM.vars.num.I000 }));
  await page.waitForTimeout(800);
  const r1b = await ev(() => RSIM.state.stats.count);
  check('安川サンプル 3回 アラームなし', !r1.alarm && r1.I000 === 3 && r1b >= 2, { r1, r1b });

  // 3. テキスト編集：誤りの検出
  await page.click('#viewSel button[data-v="text"]');
  await page.fill('#codeText', "'TEST\nMOVJ C00000 VJ=30.00\nJUMP *NOWHERE\nFOO BAR");
  await page.click('#textApply');
  const chk = await page.textContent('#checkList');
  check('テキスト編集の誤り検出', chk.includes('ラベル *NOWHERE がありません') && chk.includes('未対応'), chk);
  await page.click('#undoBtn');
  check('元に戻す', (await ev(() => RSIM.prog.lines.length)) > 10);
  await page.click('#viewSel button[data-v="list"]');

  // 4. 実機形式の LS を読み込んで再生（ファナックへ自動切替、PR オフセット・レジスタ・ラベル）
  const LS = await ev(() => {
    const rb = RS.ROBOTS.fanuc, tl = RSIM.tool;
    const q1 = RS.ik(rb, RS.matrixFromPose({ X: 950, Y: 750, Z: 655, rx: 180, ry: 0, rz: 0 }), tl.tcp, rb.home).q;
    return `/PROG  PICKTEST
/ATTR
COMMENT		= "test";
/MN
   1:  !REAL LS FILE ;
   2:  UFRAME_NUM=0 ;
   3:  UTOOL_NUM=1 ;
   4:  R[2]=0    ;
   5:  PR[1]=PR[1]-PR[1]    ;
   6:  PR[1,3]=100    ;
   7:  LBL[1] ;
   8:J P[1] 50% FINE    ;
   9:J P[2] 50% CNT50 Offset,PR[1]    ;
  10:L P[2] 300mm/sec FINE    ;
  11:  RO[1]=ON ;
  12:  WAIT RI[1]=ON    ;
  13:L P[2] 300mm/sec FINE    ;
   :  Offset,PR[1]    ;
  14:  RO[1]=OFF ;
  15:  WAIT RI[1]=OFF    ;
  16:  R[2]=R[2]+1    ;
  17:  IF R[2]<2,JMP LBL[1] ;
  18:J P[1] 50% FINE    ;
/POS
P[1]{
   GP1:
	UF : 0, UT : 1,
	J1=     0.000 deg,	J2=     0.000 deg,	J3=     0.000 deg,
	J4=     0.000 deg,	J5=    90.000 deg,	J6=     0.000 deg
};
P[2]{
   GP1:
	UF : 0, UT : 1,		CONFIG : '${RS.configOf(q1)}',
	X =   950.000  mm,	Y =   750.000  mm,	Z =   455.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
/END
`;
  });
  await ev(() => { document.querySelector('#resetWork').click(); RSIM.state.opts.autoOut = false; RSIM.state.opts.autoSup = false; });
  await ev(t => { const r = RS.importText(t); RSIM.importProgs(r.progs, r.warns); }, LS);
  check('LS 読込でファナックに切替', (await ev(() => RSIM.robot.id + '/' + RSIM.prog.name)) === 'fanuc/PICKTEST');
  await page.click('#runBtn');
  await waitIdle(90000);
  const r4 = await ev(() => ({ alarm: RSIM.state.alarm, R2: RSIM.vars.num.R2, w: RSIM.works.map(w => w.g.position.y) }));
  check('LS（オフセット・ジャンプ）実行', !r4.alarm && r4.R2 === 2 && Math.abs(r4.w[0] - 0.4525) < 0.002, r4);
  if (shots) await page.screenshot({ path: shots + '/03-ls.png' });

  // 5. ファナックサンプル
  await ev(() => { RSIM.state.opts.autoOut = true; RSIM.state.opts.autoSup = true; document.querySelector('#resetWork').click(); });
  await page.click('#sampleBtn');
  const fText = await page.textContent('#code');
  check('ファナック表記', fText.includes('J P[1] 50% FINE') && fText.includes('L P[') && fText.includes('RO[1]=ON') && fText.includes('IF R[1]<3,JMP LBL[1]'), fText.slice(0, 300));
  check('ファナック教示点は直交', await ev(() => Object.values(RSIM.prog.pos).some(p => p.k === 'c' && /U T/.test(p.cfg))));
  await page.click('#runBtn');
  await waitIdle(120000);
  const r5 = await ev(() => ({ alarm: RSIM.state.alarm, R1: RSIM.vars.num.R1 }));
  check('ファナックサンプル 3回', !r5.alarm && r5.R1 === 3, r5);

  // 6. ハンド切替（2爪グリッパ＋箱、単吸盤）
  for (const t of ['grip2', 'vac1']) {
    await ev(id => RSIM.switchTool(id), t);
    await page.click('#sampleBtn');
    await page.click('#runBtn');
    await waitIdle(120000);
    const r = await ev(() => ({ alarm: RSIM.state.alarm, R1: RSIM.vars.num.R1, w: RSIM.state.workId }));
    check(`${t} で搬送`, !r.alarm && r.R1 === 3 && r.w === 'box', r);
  }
  if (shots) await page.screenshot({ path: shots + '/04-gripper.png' });

  // 7. AI の回答（JSON）を取り込んで反映・実行
  await ev(() => { RSIM.switchSystem('yaskawa'); RSIM.switchTool('glass4'); });
  await tab('ai');
  const aiJson = await ev(() => JSON.stringify({
    explanation: 'テスト', warnings: [],
    programs: [{ name: 'AITEST', comment: '', lines: ["'AI MADE", 'MOVJ C00000 VJ=30.00', 'MOVL C00001 V=200.0', 'TIMER T=0.50', 'MOVJ C00000 VJ=30.00'],
      positions: [{ id: 'C00000', kind: 'joint', values: [0, 0, 0, 0, 90, 0], uf: 0 }, { id: 'C00001', kind: 'cart', values: [900, 0, 800, 180, 0, 0], uf: 0 }] }]
  }));
  await page.click('summary:has-text("キーなしで使う")');
  await page.fill('#aiPaste', 'はい、作りました。\n```json\n' + aiJson + '\n```');
  await page.click('#aiImport');
  check('AI 回答のプレビュー', (await page.textContent('#aiOut')).includes('AITEST'));
  await page.click('#aiApply');
  check('AI 回答の反映', (await ev(() => RSIM.prog.name + ':' + RSIM.prog.lines.length)) === 'AITEST:5');
  await tab('prog');
  await page.click('#runBtn');
  await waitIdle(60000);
  const p7 = await ev(() => ({ alarm: RSIM.state.alarm }));
  check('AI プログラム実行', !p7.alarm, p7);
  const prompt = await ev(() => RS.aiSystemPrompt({ sys: 'fanuc', robot: RS.ROBOTS.fanuc, tool: RSIM.tool, work: RS.WORKS.glass, tables: RSIM.TABLES, io: '-', prog: RSIM.prog, lib: {}, curPoseText: '' }));
  check('AI 指示文（ファナック）', prompt.includes('ファナック TP') && prompt.includes('P[1]') && prompt.includes('供給台'));

  // 8. ジョグ（関節長押し・直交）
  await tab('jog');
  const before = await ev(() => RSIM.state.q[0]);
  const hold = async (sel, ms) => { const h = await page.$(sel); await h.scrollIntoViewIfNeeded(); const b = await h.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); };
  await hold('#sliders button[aria-label="S プラス"]', 500);
  const after = await ev(() => RSIM.state.q[0]);
  check('関節ジョグ(長押し)', after > before + 2, [before, after]);
  await page.waitForTimeout(200);
  const s1 = await ev(() => RSIM.state.q[0]); await page.waitForTimeout(300);
  check('離すと止まる', Math.abs((await ev(() => RSIM.state.q[0])) - s1) < 1e-6);
  const p0 = await ev(() => RSIM.curPose());
  await hold('#cartJog button[aria-label="Z プラス"]', 400);
  const p1 = await ev(() => RSIM.curPose());
  check('直交ジョグ Z+', p1.Z > p0.Z + 5 && Math.abs(p1.X - p0.X) < 0.5 && Math.abs(p1.Y - p0.Y) < 0.5, [p0, p1]);
  for (const [i, v] of [[0, 1000], [1, 200], [2, 700], [3, 180], [4, 0], [5, 0]]) await page.fill('#pi' + i, String(v));
  await page.click('#poseL');
  await waitIdle(20000);
  const p2 = await ev(() => RSIM.curPose());
  check('直線移動で目標到達', Math.abs(p2.X - 1000) < 0.5 && Math.abs(p2.Y - 200) < 0.5 && Math.abs(p2.Z - 700) < 0.5, p2);
  await page.fill('#pi0', '3000'); await page.click('#poseJ');
  check('届かない位置のメッセージ', (await page.textContent('#jogMsg')).includes('届きません'));
  await page.fill('#pi0', '1300'); await page.fill('#pi1', '0'); await page.fill('#pi2', '-30');
  await page.click('#poseL');
  await waitIdle(20000);
  const al = await ev(() => RSIM.state.alarm);
  check('床干渉でアラーム', al && al.code === 'ALM 201', al);
  await page.click('#alarmReset');

  // 9. ペンダント（安川・実機風）
  await tab('pend');
  const pk = async (sel, ms) => hold(sel, ms || 60);
  const jogKey = '#pend .jgrid2 button[data-jog*="\\"axis\\":0,\\"dir\\":1"]';
  const q0 = await ev(() => RSIM.state.q[0]);
  await pk(jogKey, 400);
  check('レディ前はジョグ不可', (await ev(() => RSIM.state.q[0])) === q0 && (await page.textContent('#lcd')).includes('サーボオン'));
  await page.click('#pend [data-act="ready"]');
  await pk(jogKey, 300);
  check('イネーブルなしではジョグ不可', (await ev(() => RSIM.state.q[0])) === q0 && (await page.textContent('#lcd')).includes('イネーブル'));
  await page.click('#pend [data-act="enable"]');
  await pk(jogKey, 500);
  check('レディ＋イネーブルでジョグ', (await ev(() => RSIM.state.q[0])) > q0 + 0.5);
  const n0 = await ev(() => RSIM.prog.lines.length);
  await page.click('#pend [data-act="ins"]');
  check('挿入で1行増える', (await ev(() => RSIM.prog.lines.length)) === n0 + 1);
  await ev(() => { document.querySelector('#code li[data-i="0"]').click(); });
  await pk('#pend [data-hold="test"]', 700);
  const tr = await ev(() => ({ run: !!RSIM.run, sel: RSIM.state }));
  check('試運転は離すと止まる', !tr.run, tr);
  await page.click('#pend [data-act="mode"]');
  check('モードキー PLAY', (await page.textContent('#lcd')).includes('PLAY'));
  await ev(() => { document.querySelector('#code li[data-i="0"]').click(); });
  await page.click('#pend [data-act="run"]');
  check('START で自動運転', !!(await ev(() => RSIM.run)));
  await page.click('#pend [data-act="hold"]');
  check('HOLD で一時停止', (await ev(() => RSIM.run && RSIM.run.paused)) === true);
  await click('#stopBtn');
  if (shots) await page.screenshot({ path: shots + '/05-pendant-yaskawa.png' });

  // 10. ペンダント（ファナック・実機風）
  await ev(() => RSIM.switchSystem('fanuc'));
  await tab('jog'); await tab('pend');
  const f0 = await ev(() => RSIM.state.q[0]);
  for (const a of ['tp', 'dead']) await page.click(`#pend [data-act="${a}"]`);
  await pk(jogKey, 300);
  check('SHIFTなしでは動かない', (await ev(() => RSIM.state.q[0])) === f0);
  await page.click('#pend [data-act="shift"] >> nth=0');
  await pk(jogKey, 500);
  check('TP+DEADMAN+SHIFTでジョグ', (await ev(() => RSIM.state.q[0])) > f0 + 0.5);
  const nf = await ev(() => RSIM.prog.lines.length);
  await page.click('#pend [data-act="f1"] >> nth=0');
  check('F1 POINT', (await ev(() => RSIM.prog.lines.length)) === nf + 1);
  await ev(() => { document.querySelector('#code li[data-i="0"]').click(); });
  await pk('#pend [data-hold="fwdF"]', 200);
  await waitIdle(20000);
  check('STEP 中の SHIFT+FWD は1行', (await ev(() => RSIM.run)) === null);
  await page.click('#pend [data-act="tp"]');
  await page.click('#pend [data-act="cycle"]');
  check('TP OFF で CYCLE START', !!(await ev(() => RSIM.run)));
  await click('#stopBtn');
  await page.click('#pend #pendPop');
  check('3D画面の上に表示', await ev(() => !document.querySelector('#pendFloat').hidden && !!document.querySelector('#pendFloat #lcd')));
  if (shots) await page.screenshot({ path: shots + '/06-pendant-fanuc.png' });
  await page.click('#pendDock');
  check('パネルに戻す', await ev(() => document.querySelector('#pendFloat').hidden && !!document.querySelector('#t-pend #lcd')));

  // 11. 書き出し → 読み込み
  const io = await ev(() => {
    const out = {};
    const P = RSIM.lib.progs.SAMPLE;
    const ls = RS.exportLS(P), r = RS.importText(ls);
    out.ls = r.progs && JSON.stringify(r.progs[0].lines) === JSON.stringify(P.lines) && Object.keys(r.progs[0].pos).length === Object.keys(P.pos).length;
    const yp = { name: 'J1', sys: 'yaskawa', tool: 'glass4', comment: '', lines: ['MOVJ C00000 VJ=50.00', 'MOVL C00001 V=300.0'], pos: { C00000: { k: 'j', q: [10, 20, 5, 0, 60, 0] }, C00001: { k: 'c', p: { X: 900, Y: 0, Z: 700, rx: 180, ry: 0, rz: 0 }, cfg: '', uf: 0, ut: 1 } } };
    const jbi = RS.exportJBI(yp, { pulse: null, poseOf: q => RS.poseFromMatrix(RS.fk(RS.ROBOTS.yaskawa, q, RSIM.tool.tcp)) });
    const r2 = RS.importText(jbi, {});
    out.jbi = r2.progs && r2.progs[0].lines.length === 2 && r2.progs[0].pos.C00001.p.Z === 700;
    out.json = RS.importText(RS.exportJSON([P])).progs[0].name === 'SAMPLE';
    return out;
  });
  check('LS 往復', io.ls, io); check('JBI 往復', io.jbi, io); check('JSON 往復', io.json, io);

  // 12. 設定：機種パラメータの変更が反映される
  await tab('cell');
  await ev(() => { document.querySelector('[data-dim="la"]').value = 850; });
  await page.click('#robotSave');
  check('機種寸法の変更', (await ev(() => RSIM.robot.dims.la)) === 0.85 && await ev(() => { const v = new THREE.Vector3(); RSIM.G.tcp.getWorldPosition(v); return v.distanceTo(new THREE.Vector3().setFromMatrixPosition(RSIM.tcpMatrix())) < 1e-6; }));
  await page.click('#robotReset');
  check('機種寸法を初期値へ', (await ev(() => RSIM.robot.dims.la)) === 0.79);
  if (shots) await page.screenshot({ path: shots + '/07-settings.png' });

  // 13. モバイル幅
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const sw = await ev(() => document.documentElement.scrollWidth);
  check('スマホ幅で横スクロールなし', sw <= 390, sw);
  if (shots) await page.screenshot({ path: shots + '/08-mobile.png' });

  check('JSエラーなし', errors.length === 0, errors);
  console.log('OK:\n  ' + ok.join('\n  '));
  if (ng.length) console.log('NG:\n  ' + ng.join('\n  '));
  await browser.close();
  process.exit(ng.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
