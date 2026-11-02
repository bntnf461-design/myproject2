const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1600, height:1000}, acceptDownloads:true}); await ctx.addInitScript(require('./nojobs.js'));
  { const n = new Date(); await ctx.clock.install({time:new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 0)}); } // 夜中に動かしても「2時間前」が前の日にならないよう、今日の正午から始める
  const errs = [];
  const mk = async u => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(p.url().slice(-7) + ': ' + e.message)); await p.goto(u); return p; };
  const c = await mk(URL); await c.click('h1');
  const ev = f => c.evaluate(f);

  // --- stop pressed by mistake: cancel from stop screen (2 clicks), nothing recorded
  await c.keyboard.press('NumpadEnter');
  await c.click('#ssCancel');
  ok(await ev(() => state.downtime.running), 'first click only arms cancel');
  await c.click('#ssCancel');
  ok(!(await ev(() => state.downtime.running)) && (await ev(() => state.downtime.events.length)) === 0 && (await ev(() => hist.w.length)) === 0,
     'second click cancels stop, nothing recorded');

  // --- stop pressed late: fix start time on running stop
  await c.keyboard.press('NumpadEnter');
  await c.click('#ssFixStart');
  ok(await ev(() => fixOpen), 'stop screen opens correction for today');
  const earlier = await ev(() => { const d = new Date(Date.now() - 20 * 60000); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; });
  await c.fill('tr[data-di] input[data-ds]', earlier);
  await c.dispatchEvent('tr[data-di] input[data-ds]', 'change');
  const started = await ev(() => Date.now() - Date.parse(state.downtime.currentStart));
  ok(started > 19 * 60000 && started < 21 * 60000, `running stop start moved ~20 min earlier (${Math.round(started / 60000)} min)`);
  await c.click('#fixClose');
  await c.keyboard.press('NumpadEnter'); // resume
  const w0 = await ev(() => hist.w[hist.w.length - 1]);
  ok(w0 && (w0[1] - w0[0]) >= 19 * 60 && w0[4] === 1, 'resumed stop recorded with corrected start, marked edited');

  // --- counts: operator counted 3 キズ by mistake, fix -2 in editor; +1 汚れ forgot
  for (let i = 0; i < 3; i++) await c.keyboard.press('Numpad1');
  await c.click('#fixBtn');
  const minus = 'button[data-fc="-1"][data-id="t1"][data-sh="製品A"]';
  await c.click(minus); await c.click(minus);
  await c.click('button[data-fc="1"][data-id="t2"][data-sh="製品A"]');
  ok((await ev(() => state.counts.t1)) === 1 && (await ev(() => state.counts.t2)) === 1, 'counter counts corrected (キズ 3→1, 汚れ 0→1) got ' + JSON.stringify(await ev(() => state.counts)) + ' log ' + JSON.stringify(await ev(() => state.log.map(l => l.typeId + l.delta + (l.corr ? 'c' : '')))));
  const repl = await ev(() => { const it = replayHist(hist); return {t1: it.filter(i => i.id === 't1').length, t2: it.filter(i => i.id === 't2').length, corr: it.filter(i => i.c).length}; });
  ok(repl.t1 === 1 && repl.t2 === 1 && repl.corr === 1, 'history replay matches, added item marked as correction');
  ok(await ev(() => replayLog().length === total()), 'counter hourly replay matches total after corrections');
  ok(await c.isDisabled('button[data-fc="-1"][data-id="t3"][data-sh="製品A"]'), 'minus disabled when count is 0');

  // --- downtime: add forgotten stop, edit, overlap rejected, delete
  const hh = off => c.evaluate(o => { const d = new Date(Date.now() - o * 60000); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }, off);
  await c.fill('#fxAddS', await hh(120)); await c.fill('#fxAddE', await hh(100)); await c.click('#fxAddBtn');
  ok((await ev(() => hist.w.length)) === 2 && (await ev(() => state.downtime.events.length)) >= 1, 'forgotten stop added');
  await c.fill('#fxAddS', await hh(110)); await c.fill('#fxAddE', await hh(90)); await c.click('#fxAddBtn');
  ok((await c.textContent('#fixError')).includes('重なって'), 'overlapping stop rejected: ' + await c.textContent('#fixError'));
  ok((await ev(() => hist.w.length)) === 2, 'no record added on overlap');
  // edit end of first listed stop (the added one, earliest) to +5 minutes
  const newEnd = await hh(95);
  await c.fill('tr[data-di="0"] input[data-de]', newEnd);
  await c.dispatchEvent('tr[data-di="0"] input[data-de]', 'change');
  const wAdded = await ev(() => hist.w.slice().sort((a, b) => a[0] - b[0])[0]);
  ok(Math.round((wAdded[1] - wAdded[0]) / 60) === 25 && wAdded[4] === 1, `edited stop now 25 min and marked edited (${Math.round((wAdded[1] - wAdded[0]) / 60)} min)`);
  ok((await c.textContent('#fixBody')).includes('修正済み'), 'editor shows 修正済み');
  await c.click('tr[data-di="0"] button[data-dd]');
  ok((await ev(() => hist.w.length)) === 2, 'delete needs second click');
  await c.click('tr[data-di="0"] button[data-dd]');
  ok((await ev(() => hist.w.length)) === 1, 'second click deletes stop');
  // future time rejected
  await c.fill('#fxAddS', await hh(-30)); await c.fill('#fxAddE', await hh(-40)); await c.click('#fxAddBtn');
  ok((await c.textContent('#fixError')).includes('今より後'), 'future time rejected');
  await c.screenshot({path:'fix_editor.png'});
  await c.keyboard.press('Escape');
  ok(!(await ev(() => fixOpen)), 'Esc closes editor');

  // --- past day correction from report tab
  const r = await mk(URL + '#report'); await r.waitForTimeout(400);
  await r.evaluate(() => { // seed a past day
    const k = daddDays(dkey(Date.now()), -3), t = atDay(k, '10:00') / 1000;
    const H = loadHist();
    for (let i = 0; i < 5; i++) H.d.push([t + i * 60, 't1', 1, H.shifts.indexOf('製品A') >= 0 ? H.shifts.indexOf('製品A') : (H.shifts.push('製品A') - 1), 0]);
    localStorage.setItem('defectCounterHistory', JSON.stringify(H));
    rpReload(); rpRenderPanel();
  });
  const past = await r.evaluate(() => daddDays(dkey(Date.now()), -3));
  const countBefore = await c.evaluate(() => state.counts.t1);
  await r.click(`button[data-fix="${past}"]`);
  ok(await r.evaluate(() => fixOpen && fixDay) === past, 'report day row opens editor for that day');
  await r.click('button[data-fc="-1"][data-id="t1"][data-sh="製品A"]');
  const pastCount = await r.evaluate(k => rpData.items.filter(i => dkey(i.t) === k && i.id === 't1').length, past);
  ok(pastCount === 4, 'past day キズ 5→4 in report data');
  await r.waitForTimeout(300);
  ok((await c.evaluate(() => state.counts.t1)) === countBefore, 'past-day fix does not change current counter (outside session)');
  const todayCount = await r.evaluate(() => rpData.items.filter(i => dkey(i.t) === dkey(Date.now()) && i.id === 't1').length);
  ok(todayCount === 1, 'today\'s items untouched by past-day correction');
  // numpad typing into time input in report is not forwarded
  const tBefore = await c.evaluate(() => total());
  await r.click('#fxAddS'); await r.keyboard.press('Numpad1'); await r.waitForTimeout(300);
  ok((await c.evaluate(() => total())) === tBefore, 'typing in time input is not forwarded as a count');
  await r.screenshot({path:'fix_report.png'});

  // --- Excel shows 区分
  await r.click('#fixClose');
  const [dl] = await Promise.all([r.waitForEvent('download'), r.click('#rpExcel')]);
  await dl.saveAs('xl_out/fix.xlsx');
  console.log('errors', errs);
  await b.close();
})();
