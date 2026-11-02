const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1600, height:1000}}); await ctx.addInitScript(require('./nojobs.js'));
  const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); await c.goto(URL); await c.click('h1');
  // reasons on, one stop recorded with 故障 (history) + today's event
  await c.evaluate(() => { state.features.reasons = true; saveState(); });
  await c.reload(); await c.click('h1');
  await c.keyboard.press('NumpadEnter');
  await c.click('#ssReasons button[data-reason="故障"]');
  await c.evaluate(() => { state.downtime.currentStart = new Date(Date.now() - 300000).toISOString(); });
  await c.keyboard.press('NumpadEnter');
  ok(await c.evaluate(() => loadHist().w[0][5]) === '故障', 'stop recorded with 故障');

  // open settings: 5 reason rows with colors
  await c.evaluate(() => openSettings());
  const rows = () => c.$$eval('#reasonRows .reasonrow input[type=text]:not(.name-id)', els => els.map(e => e.value));
  ok(JSON.stringify(await rows()) === JSON.stringify(['段取り', '故障', '材料待ち', '品質確認', 'その他']), 'editor lists default reasons');
  ok(await c.$eval('#reasonRows .reasonrow:nth-child(2) .swatch.selected', e => e.getAttribute('aria-label')) === '赤', '故障 shows its color (赤)');
  // rename 故障 -> 設備故障
  await c.fill('#reasonRows .reasonrow:nth-child(2) input[type=text]:not(.name-id)', '設備故障');
  // add 清掃 (teal) and move it to the top
  await c.click('#addReasonBtn');
  await c.fill('#reasonRows .reasonrow:last-child input[type=text]:not(.name-id)', '清掃');
  await c.click('#reasonRows .reasonrow:last-child .swatch[aria-label="水色"]');
  for (let i = 0; i < 5; i++) {
    const idx = (await rows()).indexOf('清掃');
    if (idx <= 0) break;
    await c.click(`#reasonRows .reasonrow:nth-child(${idx + 1}) button[aria-label="上へ"]`);
  }
  const order = await rows();
  ok(order[0] === '清掃', 'new reason moved to top: ' + order.join(','));
  ok(await c.isDisabled('#reasonRows .reasonrow:first-child button[aria-label="上へ"]'), 'top row cannot move up');
  // delete その他 (2 clicks)
  const delSel = '#reasonRows .reasonrow:last-child button.mini-btn:last-child';
  await c.click(delSel);
  ok((await rows()).includes('その他'), 'first delete click only arms');
  await c.click(delSel);
  ok(!(await rows()).includes('その他'), 'second click deletes その他');
  // validation: duplicate + empty
  await c.click('#addReasonBtn');
  await c.fill('#reasonRows .reasonrow:last-child input[type=text]:not(.name-id)', '段取り');
  await c.click('#saveSettingsBtn');
  ok((await c.textContent('#settingsError')).includes('重複'), 'duplicate names rejected');
  await c.fill('#reasonRows .reasonrow:last-child input[type=text]:not(.name-id)', '');
  await c.click('#saveSettingsBtn');
  ok((await c.textContent('#settingsError')).includes('名前が空'), 'empty name rejected');
  await c.fill('#reasonRows .reasonrow:last-child input[type=text]:not(.name-id)', '刃物交換');
  await c.click('#saveSettingsBtn');
  ok(!(await c.evaluate(() => settingsOpen)), 'settings saved');
  const st = await c.evaluate(() => ({r:state.stopReasons, col:state.reasonColors}));
  ok(JSON.stringify(st.r) === JSON.stringify(['清掃', '段取り', '設備故障', '材料待ち', '品質確認', '刃物交換']), 'saved order: ' + st.r.join(','));
  ok(st.col['清掃'] === 'teal' && st.col['設備故障'] === 'red', 'colors saved (renamed keeps its color)');
  ok(await c.evaluate(() => loadHist().w[0][5]) === '設備故障' && await c.evaluate(() => state.downtime.events[0].reason) === '設備故障', 'renaming updated past records');

  // stop screen uses new list, order and colors
  await c.click('h1'); await c.keyboard.press('NumpadEnter');
  const btns = await c.$$eval('#ssReasons button', bs => bs.map(b => [b.dataset.reason, b.style.getPropertyValue('--rc')]));
  ok(btns.map(x => x[0]).join(',') === '清掃,段取り,設備故障,材料待ち,品質確認,刃物交換', 'stop screen shows new reasons in order');
  ok(btns[0][1] === 'var(--teal)', 'stop screen button has reason color');
  await c.screenshot({path:'reasons_stop.png'});
  await c.keyboard.press('NumpadEnter');

  // report slide uses reason colors
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push(e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(300);
  const html = await r.evaluate(() => { rpPlaying = false; rpShow(rpBuildSlides().findIndex(s => s.id === 'reasons'), false); return document.querySelector('#rpSlide').innerHTML; });
  ok(html.includes('設備故障') && html.includes('var(--red)'), 'report reasons slide uses renamed reason and its color');
  // screenshot of the settings editor
  await c.bringToFront(); await c.evaluate(() => openSettings());
  await c.locator('#reasonRows').screenshot({path:'reasons_editor.png'});
  console.log('errors', errs);
  await b.close();
})();
