// node tests/smoke.js : ブラウザでの総合動作確認（Playwright）
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
  const ev = f => page.evaluate(f);

  // 1. 初期状態
  check('初期ハンドはガラス4吸盤', (await ev(() => RSIM.tool.id)) === 'glass4');
  check('ワーク1枚', (await ev(() => RSIM.works.length)) === 1);
  if (shots) await page.screenshot({ path: shots + '/01-start.png' });

  // 2. サンプル作成 → 再生 → ガラスが排出台へ
  await page.click('button[data-t="prog"]');
  await page.click('#sampleBtn');
  check('サンプル行数', (await ev(() => RSIM.prog.lines.length)) >= 12, await ev(() => RSIM.prog.lines.length));
  await ev(() => { RSIM.state.opts.ovr = 100; });
  await page.click('#runBtn');
  await page.waitForTimeout(500);
  if (shots) await page.screenshot({ path: shots + '/02-running.png' });
  await page.waitForFunction(() => !RSIM.run, null, { timeout: 60000 });
  const r1 = await ev(() => ({ alarm: RSIM.state.alarm, w: RSIM.works.map(w => [w.g.position.x, w.g.position.y, w.g.position.z]), cnt: RSIM.state.stats.count }));
  check('アラームなしで完了', !r1.alarm, r1.alarm);
  check('ガラスが排出台(Y<0)', r1.w.length === 1 && r1.w[0][2] > 0.5 && Math.abs(r1.w[0][1] - 0.4525) < 0.002, r1.w);
  if (shots) await page.screenshot({ path: shots + '/03-done.png' });

  // 3. 繰り返し＋自動供給で2サイクル
  await ev(() => { document.querySelector('#loop').click(); });
  await page.click('#runBtn');
  await page.waitForFunction(() => RSIM.state.stats.count >= 3, null, { timeout: 90000 });
  await page.click('#stopBtn');
  const r2 = await ev(() => ({ alarm: RSIM.state.alarm, n: RSIM.works.length, cnt: RSIM.state.stats.count, last: RSIM.state.stats.last }));
  check('繰り返し 3サイクル', !r2.alarm && r2.cnt >= 3, r2);
  await ev(() => { document.querySelector('#loop').click(); });

  // 4. ファナックに切替 → サンプル → 再生
  await page.click('.seg.sys button[data-sys="fanuc"]');
  check('ファナック表示', (await ev(() => RSIM.robot.id)) === 'fanuc');
  check('J1 ラベル', (await page.textContent('#sliders')).includes('J1'));
  await ev(() => document.querySelector('#resetWork').click());
  await page.click('#sampleBtn');
  const lsText = await page.textContent('#code');
  check('ファナック表記', lsText.includes('J P[1]') && lsText.includes('L P[') && lsText.includes('RO[1]=ON'), lsText.slice(0, 200));
  await page.click('#runBtn');
  await page.waitForFunction(() => !RSIM.run, null, { timeout: 60000 });
  const r3 = await ev(() => ({ alarm: RSIM.state.alarm, w: RSIM.works.map(w => [w.g.position.x, w.g.position.y, w.g.position.z]) }));
  check('ファナックでもガラス搬送', !r3.alarm && r3.w[0][2] > 0.5, r3);

  // 5. ハンド切替（2爪グリッパ＋箱）
  await page.click('button[data-t="cell"]');
  await page.click('[data-tool="grip2"]');
  check('グリッパ', (await ev(() => RSIM.tool.id + '/' + RSIM.state.workId)) === 'grip2/box');
  await page.click('button[data-t="prog"]');
  await page.click('#sampleBtn');
  await page.click('#runBtn');
  await page.waitForFunction(() => !RSIM.run, null, { timeout: 60000 });
  const r4 = await ev(() => ({ alarm: RSIM.state.alarm, w: RSIM.works.map(w => [w.g.position.x, w.g.position.y, w.g.position.z]) }));
  check('グリッパで箱搬送', !r4.alarm && r4.w[0][2] > 0.5, r4);
  if (shots) await page.screenshot({ path: shots + '/04-gripper.png' });

  // 6. 単吸盤
  await ev(() => RSIM.switchTool('vac1'));
  await page.click('#sampleBtn');
  await page.click('#runBtn');
  await page.waitForFunction(() => !RSIM.run, null, { timeout: 60000 });
  const r5 = await ev(() => ({ alarm: RSIM.state.alarm, w: RSIM.works.map(w => [w.g.position.x, w.g.position.y, w.g.position.z]) }));
  check('単吸盤で箱搬送', !r5.alarm && r5.w[0][2] > 0.5, r5);

  // 7. 安川に戻してガラスハンド、ジョグ（関節・直交）
  await ev(() => { RSIM.switchSystem('yaskawa'); RSIM.switchTool('glass4'); });
  await page.click('button[data-t="jog"]');
  const before = await ev(() => RSIM.state.q.slice());
  const b = await page.$('#sliders button[aria-label="S プラス"]');
  const bb = await b.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await ev(() => RSIM.state.q.slice());
  check('関節ジョグ(長押し)で S が増える', after[0] > before[0] + 2, [before[0], after[0]]);
  const s1 = await ev(() => RSIM.state.q[0]); await page.waitForTimeout(300);
  check('離すと止まる', Math.abs((await ev(() => RSIM.state.q[0])) - s1) < 1e-6);
  // 直交 X+（押す間）
  const p0 = await ev(() => RSIM.curPose());
  const xb = await (await page.$('#cartJog button[aria-label="Z プラス"]')).boundingBox();
  await page.mouse.move(xb.x + 5, xb.y + 5); await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up();
  const p1 = await ev(() => RSIM.curPose());
  check('直交ジョグ Z+ で Z だけ増える', p1.Z > p0.Z + 5 && Math.abs(p1.X - p0.X) < 0.5 && Math.abs(p1.Y - p0.Y) < 0.5 && Math.abs(p1.rx - p0.rx) < 0.05, [p0, p1]);

  // 8. 位置指定 直線移動
  await page.fill('#pi0', '1000'); await page.fill('#pi1', '200'); await page.fill('#pi2', '700');
  await page.fill('#pi3', '180'); await page.fill('#pi4', '0'); await page.fill('#pi5', '0');
  await page.click('#poseL');
  await page.waitForFunction(() => !RSIM.mv, null, { timeout: 20000 });
  const p2 = await ev(() => RSIM.curPose());
  check('直線移動で目標到達', Math.abs(p2.X - 1000) < 0.5 && Math.abs(p2.Y - 200) < 0.5 && Math.abs(p2.Z - 700) < 0.5, p2);
  await page.fill('#pi0', '3000'); await page.click('#poseJ');
  check('届かない位置のメッセージ', (await page.textContent('#jogMsg')).includes('届きません'));

  // 9. 干渉：床へ突っ込む
  await page.fill('#pi0', '1300'); await page.fill('#pi1', '0'); await page.fill('#pi2', '-30');
  await page.click('#poseL');
  await page.waitForFunction(() => !RSIM.mv, null, { timeout: 20000 });
  const al = await ev(() => RSIM.state.alarm);
  check('床干渉でアラーム', al && al.code === 'ALM 201', [al, await page.textContent('#jogMsg'), await ev(() => RSIM.curPose())]);
  if (!al) { console.log(ng); process.exit(1); }
  await page.click('#alarmReset');
  check('アラームリセット', !(await ev(() => RSIM.state.alarm)));

  // 10. ペンダント（安川）
  await page.click('button[data-t="pend"]');
  const q0 = await ev(() => RSIM.state.q[0]);
  const pk = async (sel, ms) => { const h = await page.$(sel); await h.scrollIntoViewIfNeeded(); const e = await h.boundingBox(); await page.mouse.move(e.x + 5, e.y + 5); await page.mouse.down(); await page.waitForTimeout(ms || 50); await page.mouse.up(); };
  await pk('#pend .jgrid button[data-jog*="\\"axis\\":0,\\"dir\\":1"]', 400);
  check('サーボOFFではジョグ不可', (await ev(() => RSIM.state.q[0])) === q0 && (await page.textContent('#lcd')).includes('サーボ'));
  await page.click('#pend [data-act="servo"]');
  await pk('#pend .jgrid button[data-jog*="\\"axis\\":0,\\"dir\\":1"]', 500);
  check('サーボONでジョグ', (await ev(() => RSIM.state.q[0])) > q0 + 0.5);
  // 挿入
  const n0 = await ev(() => RSIM.prog.lines.length);
  await page.click('#pend [data-act="ins"]');
  check('挿入で1行増える', (await ev(() => RSIM.prog.lines.length)) === n0 + 1);
  // 再生モードでスタート
  await page.click('#pend [data-act="mode"]');
  await page.click('#pend [data-act="servo"]');  // mode切替で止まるのでサーボは維持されている → OFFになるので再度ON
  if (!(await ev(() => document.querySelector('#pend [data-act="servo"]').classList.contains('on')))) await page.click('#pend [data-act="servo"]');
  await ev(() => document.querySelector('#code li[data-i="0"]').click());
  await page.click('#pend [data-act="run"]');
  check('ペンダントでスタート', !!(await ev(() => RSIM.run)));
  await page.click('#pend [data-act="hold"]');
  check('ホールドで一時停止', (await ev(() => RSIM.run && RSIM.run.paused)) === true);
  await ev(() => document.querySelector('#stopBtn').click());
  if (shots) await page.screenshot({ path: shots + '/05-pendant-yaskawa.png' });

  // 11. ペンダント（ファナック）
  await ev(() => RSIM.switchSystem('fanuc'));
  await page.click('button[data-t="jog"]'); await page.click('button[data-t="pend"]');
  const f0 = await ev(() => RSIM.state.q[0]);
  for (const a of ['tp', 'dead']) await page.click(`#pend [data-act="${a}"]`);
  await pk('#pend .jgrid button[data-jog*="\\"axis\\":0,\\"dir\\":1"]', 300);
  check('SHIFTなしでは動かない', (await ev(() => RSIM.state.q[0])) === f0);
  await page.click('#pend [data-act="shift"]');
  await pk('#pend .jgrid button[data-jog*="\\"axis\\":0,\\"dir\\":1"]', 500);
  check('TP+DEADMAN+SHIFTでジョグ', (await ev(() => RSIM.state.q[0])) > f0 + 0.5);
  if (shots) await page.screenshot({ path: shots + '/06-pendant-fanuc.png' });

  // 12. 書き出し・読み込み（LS / JBI / JSON）
  const io = await ev(() => {
    const out = {};
    const rb = RS.ROBOTS.yaskawa, tl = RSIM.tool;
    const p = { name: 'T1', tool: tl.id, lines: [{ op: 'MOVJ', q: [10, 20, 5, 0, 60, 0], v: 50 }, { op: 'MOVL', q: [-10, 25, 0, 0, 70, 5], v: 300 }, { op: 'OUT', on: true }, { op: 'WAITIN', on: true }, { op: 'TIMER', t: 0.5 }] };
    const ls = RS.exportLS(p); const r = RS.importText(ls);
    out.ls = r.prog && JSON.stringify(r.prog.lines) === JSON.stringify(p.lines);
    const jbi = RS.exportJBI(p, q => RS.poseFromMatrix(RS.fk(rb, q, tl.tcp)));
    const r2 = RS.importText(jbi, (P, ref) => { const k = RS.ik(rb, RS.matrixFromPose(P), tl.tcp, ref || rb.home); return k.q; });
    out.jbi = r2.prog && r2.prog.lines.length === 5 && r2.prog.lines.every((l, i) => !l.q || l.q.every((v, j) => Math.abs(v - p.lines[i].q[j]) < 0.01));
    const r3 = RS.importText(RS.exportJSON(p, 'fanuc'));
    out.json = r3.system === 'fanuc' && r3.prog.lines.length === 5;
    out.jbiText = jbi.split('\r\n').slice(0, 14).join('\n');
    return out;
  });
  check('LS 往復', io.ls); check('JBI 往復', io.jbi, io.jbiText); check('JSON 往復', io.json);

  // 13. モバイル幅
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const sw = await ev(() => document.documentElement.scrollWidth);
  check('スマホ幅で横スクロールなし', sw <= 390, sw);
  if (shots) await page.screenshot({ path: shots + '/07-mobile.png' });

  check('JSエラーなし', errors.length === 0, errors);
  console.log('OK:\n  ' + ok.join('\n  '));
  if (ng.length) console.log('NG:\n  ' + ng.join('\n  '));
  await browser.close();
  process.exit(ng.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
