// 製造種類の表示の大きさ・全画面のときの青い線
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1600, height:900}, screen:{width:1920, height:1080}});
  const errs = [];
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push(e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(400);
  const vis = () => r.evaluate(() => getComputedStyle(document.querySelector('.rp-progress')).visibility);
  ok(await vis() === 'visible', 'progress line visible in a normal window');
  await r.setViewportSize({width:1920, height:1080}); await r.waitForTimeout(200);
  ok(await vis() === 'hidden', 'progress line hidden when the page fills the screen (F11)');
  // テスト用ブラウザは画面の大きさも一緒に変わるので、別の窓で「元の大きさ」を確かめる
  const r2 = await (await b.newContext({viewport:{width:1600, height:900}, screen:{width:1920, height:1080}})).newPage();
  await r2.goto(URL + '#report'); await r2.waitForTimeout(300);
  await r2.evaluate(() => document.dispatchEvent(new Event('fullscreenchange')));
  ok(await r2.evaluate(() => getComputedStyle(document.querySelector('.rp-progress')).visibility) === 'visible', 'visible in a normal-size window after a full-screen change event');
  // 実績のない品種はスライドに出ないので、不良を1件入れておく
  const c0 = await ctx.newPage(); await c0.goto(URL); await c0.evaluate(() => startJob(state.shifts[0])); await c0.mouse.click(5, 5); await c0.keyboard.press('Numpad1'); await c0.waitForTimeout(200); await c0.close();
  await r.evaluate(() => { rpDirty = true; rpShow(0, false); });
  await r.evaluate(() => document.dispatchEvent(new Event('fullscreenchange')));
  ok(await r.evaluate(() => document.querySelector('.rp-scope') && parseFloat(getComputedStyle(document.querySelector('.rp-scope')).fontSize) >= 28), 'product name in the slide subtitle is larger');
  await r.screenshot({path:'rp_sub.png'});
  // カウンター：作業の記録オフでも製造種類を大きく表示
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); await c.goto(URL);
  await c.evaluate(() => { state.features.jobs = false; saveState(); renderAll(); });
  ok(await c.isVisible('#jobBar') && (await c.textContent('#jobBar')).includes('製品A'), 'product bar shown when jobs are off');
  const fs = await c.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.jb-name')).fontSize));
  ok(fs >= 50, 'product name font is large: ' + fs + 'px');
  await c.screenshot({path:'shift_bar.png'});
  console.log('errors', errs);
  await b.close();
})();
