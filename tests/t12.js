const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const errs = [];
  // --- scenario A: counting, then midnight passes while the page is open
  {
    const ctx = await b.newContext(); await ctx.addInitScript(require('./nojobs.js'));
    await ctx.clock.install({time: new Date('2026-10-01T23:58:00')});
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); await p.click('h1');
    await p.keyboard.press('Numpad1'); await p.keyboard.press('Numpad1'); await p.keyboard.press('Numpad2');
    ok(await p.evaluate(() => total()) === 3, 'counted 3 before midnight');
    await p.reload(); await p.click('h1');
    ok(await p.evaluate(() => total()) === 3, 'same-day reload keeps counts');
    await ctx.clock.runFor(3 * 60 * 1000); // -> 00:01
    ok(await p.evaluate(() => total()) === 0, 'counts reset automatically after 0:00');
    ok(await p.evaluate(() => dkey(Date.parse(state.shiftStart)) === '2026-10-02' && new Date(state.shiftStart).getHours() === 0), 'new start = 10/02 0:00');
    ok((await p.textContent('#toast')).includes('リセットしました'), 'notice shown: ' + await p.textContent('#toast'));
    const h = await p.evaluate(() => replayHist(loadHist()).length);
    ok(h === 3, 'history keeps the 3 counts from 10/01');
    await p.keyboard.press('Numpad0');
    ok(await p.evaluate(() => total()) === 0, 'undo after reset does not touch previous day');
    await ctx.close();
  }
  // --- scenario B: equipment stopped across midnight
  {
    const ctx = await b.newContext(); await ctx.addInitScript(require('./nojobs.js'));
    await ctx.clock.install({time: new Date('2026-10-01T23:40:00')});
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); await p.click('h1');
    await p.keyboard.press('NumpadEnter'); // stop at 23:40
    await ctx.clock.runFor(30 * 60 * 1000); // -> 00:10
    const s = await p.evaluate(() => ({running: state.downtime.running, start: state.downtime.currentStart, w: loadHist().w}));
    ok(s.running && new Date(s.start).getHours() === 0 && new Date(s.start).getMinutes() === 0, 'stop continues from 0:00 on the new day');
    ok(s.w.length === 1 && (s.w[0][1] - s.w[0][0]) === 20 * 60, `previous day stop recorded 23:40-24:00 (${(s.w[0][1] - s.w[0][0]) / 60} min)`);
    ok(await p.isVisible('#stopScreen'), 'stop screen still shown after reset');
    await ctx.clock.runFor(5 * 60 * 1000); // 00:15
    await p.keyboard.press('NumpadEnter'); // resume
    const w = await p.evaluate(() => loadHist().w);
    ok(w.length === 2 && (w[1][1] - w[1][0]) === 15 * 60, `new day stop recorded 0:00-0:15 (${(w[1][1] - w[1][0]) / 60} min)`);
    // report: 10/01 has 20 min, 10/02 has 15 min
    const r = await ctx.newPage(); await r.goto(URL + '#report'); await r.waitForTimeout(300);
    const per = await r.evaluate(() => { rp.preset = '7d'; const A = rpAgg(null); return A.downByDay; });
    ok(Math.round(per['2026-10-01'] / 60000) === 20 && Math.round(per['2026-10-02'] / 60000) === 15, 'report splits the stop across the two days');
    ok(await r.evaluate(() => !document.getElementById('toast').textContent.includes('自動')), 'report tab does not auto-reset');
    await ctx.close();
  }
  // --- scenario C: PC off overnight, page opened next morning
  {
    const ctx = await b.newContext(); await ctx.addInitScript(require('./nojobs.js'));
    await ctx.clock.install({time: new Date('2026-10-01T17:00:00')});
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); await p.click('h1');
    for (let i = 0; i < 4; i++) await p.keyboard.press('Numpad3');
    await p.close();
    await ctx.clock.setSystemTime(new Date('2026-10-02T08:05:00'));
    const p2 = await ctx.newPage(); p2.on('pageerror', e => errs.push(e.message));
    await p2.goto(URL); await p2.waitForTimeout(200);
    ok(await p2.evaluate(() => total()) === 0, 'opened next morning: counts reset on load');
    ok(await p2.evaluate(() => replayHist(loadHist()).length) === 4, 'yesterday\'s 4 counts kept in history');
    ok(await p2.evaluate(() => new Date(state.shiftStart).getDate() === 2 && new Date(state.shiftStart).getHours() === 0), 'start shown as today 0:00');
    await p2.screenshot({path: 'autoreset.png'});
    await ctx.close();
  }
  console.log('errors', errs);
  await b.close();
})();
