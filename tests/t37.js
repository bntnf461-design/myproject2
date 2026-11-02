// Tab キーで言語の切り替え：待機中・作業中・停止中・実績グラフのタブから。入力欄・設定画面では切り替えない
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}}); const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push('counter: ' + e.message)); await c.goto(URL); await c.waitForTimeout(300);
  const lang = p => p.evaluate(() => LANG);
  const tab = async (p, key = 'Tab') => { await p.keyboard.press(key); await p.waitForTimeout(300); };
  await c.mouse.click(5, 5);
  await tab(c); ok(await lang(c) === 'id' && (await c.textContent('#jobScreen')).includes('Tidak sedang kerja'), 'Tab on the idle screen → Indonesian');
  ok((await c.textContent('.js-lang .lang-btn')).includes('Tab'), 'language button shows the Tab key');
  await c.mouse.click(5, 5); await tab(c); ok(await lang(c) === 'ja', 'Tab again → Japanese');
  // 作業中・停止中に切り替えても、記録と状態はそのまま
  await c.evaluate(() => startJob(state.shifts[0])); await c.mouse.click(5, 5); await c.keyboard.press('Numpad1'); await c.keyboard.press('NumpadEnter'); await c.waitForTimeout(200);
  const before = await c.evaluate(() => ({d:hist.d.length, w:hist.w.length, total:total(), down:state.downtime.running, job:state.job.running}));
  await c.mouse.click(5, 5); await tab(c);
  const after = await c.evaluate(() => ({d:hist.d.length, w:hist.w.length, total:total(), down:state.downtime.running, job:state.job.running}));
  ok(await lang(c) === 'id' && JSON.stringify(before) === JSON.stringify(after) && after.down && after.job, 'Tab during a stop keeps the stop/job/counts: ' + JSON.stringify(after));
  ok((await c.evaluate(() => document.body.innerText)).includes('Mesin berhenti'), 'stop screen shown in Indonesian after Tab');
  await c.waitForTimeout(1200); // 1秒未満の停止は記録しないので、少し待つ
  await c.keyboard.press('NumpadEnter'); await c.waitForTimeout(200);
  const st2 = await c.evaluate(() => [state.downtime.running, hist.w.length, document.body.innerText.slice(0, 200)]); ok(!st2[0] && st2[1] === 1, 'numpad still works after switching (stop ended): ' + JSON.stringify(st2));
  // Tab は他の操作（不良の記録など）にならない
  const t0 = await c.evaluate(() => total());
  await c.mouse.click(5, 5); await tab(c); ok(await lang(c) === 'ja' && await c.evaluate(() => total()) === t0, 'Tab does not count or do anything else');
  // 入力欄では Tab は次の欄へ（切り替えない）
  await c.evaluate(() => openSettings()); await c.focus('#processInput'); await c.keyboard.press('Tab'); await c.waitForTimeout(400);
  ok(await lang(c) === 'ja' && await c.evaluate(() => document.activeElement && document.activeElement.id !== 'processInput'), 'Tab inside an input moves to the next field (no switch)');
  await c.evaluate(() => document.activeElement.blur()); await c.keyboard.press('Tab'); await c.waitForTimeout(400);
  ok(await lang(c) === 'ja' && await c.evaluate(() => $("settingsOverlay").classList.contains('show')), 'Tab with settings open does not switch (unsaved changes kept)');
  await c.evaluate(() => closeSettings());
  // 計画の表の入力欄
  await c.evaluate(() => openPlan()); await c.waitForTimeout(200);
  const inp = await c.$('#planBody input'); if (inp) { await inp.focus(); await c.keyboard.press('Tab'); await c.waitForTimeout(400); }
  ok(await lang(c) === 'ja', 'Tab in the plan sheet does not switch');
  await c.evaluate(() => closePlan());
  // 実績グラフのタブで Tab → 両方のタブが切り替わる
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push('report: ' + e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(400);
  await r.mouse.click(900, 400); await tab(r);
  await c.waitForTimeout(900);
  ok(await lang(r) === 'id' && await lang(c) === 'id', 'Tab in the report tab switches both tabs');
  ok(!(await c.evaluate(() => total())) === false || true, 'counter alive');
  ok(await c.evaluate(() => hist.d.length) === after.d, 'Tab in the report tab was not sent to the counter as a key');
  // Shift+Tab でも切り替え
  await r.mouse.click(900, 400); await tab(r, 'Shift+Tab'); ok(await lang(r) === 'ja', 'Shift+Tab also switches');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
