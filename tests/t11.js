const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1600, height:1000}, acceptDownloads:true}); await ctx.addInitScript(require('./nojobs.js'));
  const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); await c.goto(URL);
  // legacy report setting (whole-day exclusion) must migrate to both
  const legacyDay = await c.evaluate(() => { const k = daddDays(dkey(Date.now()), -6); localStorage.setItem('defectCounterReport', JSON.stringify({preset:'7d', excluded:[k]})); return k; });
  // 7 days: each day 10 defects (製品A) + one 30-min stop
  await c.evaluate(() => {
    const H = {v:1, shifts:['製品A'], types:{}, d:[], w:[]};
    for (let d = 0; d < 7; d++) {
      const k = daddDays(dkey(Date.now()), -d), t = atDay(k, '09:00') / 1000;
      for (let i = 0; i < 10; i++) H.d.push([t + i * 60, 't1', 1, 0, 0]);
      H.w.push([t + 3600, t + 3600 + 1800, 0, 'w' + d, 0]);
    }
    localStorage.setItem('defectCounterHistory', JSON.stringify(H));
  });
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push(e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(400);
  ok(await r.evaluate(k => rp.exDefect.includes(k) && rp.exDown.includes(k) && rp.excluded === undefined, legacyDay), 'legacy whole-day exclusion migrated to both');
  await r.click('#rpClearEx');
  const base = await r.evaluate(() => { const A = rpAgg(null); return {n:A.total, w:A.downCount, ms:A.downMs}; });
  ok(base.n === 70 && base.w === 7, `baseline 70 defects / 7 stops (${base.n}/${base.w})`);

  // counts wrong on day -2: exclude defects only
  const k2 = await r.evaluate(() => daddDays(dkey(Date.now()), -2));
  await r.click(`button[data-ex="exDefect"][data-k="${k2}"]`);
  let A = await r.evaluate(() => { const A = rpAgg(null); return {n:A.total, w:A.downCount}; });
  ok(A.n === 60 && A.w === 7, `defect-only exclusion: defects 60, stops still 7 (${A.n}/${A.w})`);
  // downtime wrong on day -4: exclude stops only
  const k4 = await r.evaluate(() => daddDays(dkey(Date.now()), -4));
  await r.click(`button[data-ex="exDown"][data-k="${k4}"]`);
  A = await r.evaluate(() => { const A = rpAgg(null); return {n:A.total, w:A.downCount}; });
  ok(A.n === 60 && A.w === 6, `stop-only exclusion: defects 60, stops 6 (${A.n}/${A.w})`);
  // axes: defect chart omits k2 only; downtime chart omits k4 only
  const ax = await r.evaluate(([a, b]) => ({def:rpBuckets('defect').list.map(x => x.key), down:rpBuckets('down').list.map(x => x.key), a, b}), [k2, k4]);
  ok(!ax.def.includes(k2) && ax.def.includes(k4) && ax.down.includes(k2) && !ax.down.includes(k4), 'each chart hides only its own excluded day');
  // summary averages: defects 60 / 6 days = 10.0, stops 30min * 6 / 6 days = 30
  const sum = await r.evaluate(() => { const i = rpBuildSlides().findIndex(s => s.id === 'summary'); rpPlaying = false; rpShow(i, false); return document.querySelector('#rpSlide').innerText; });
  ok(sum.includes('10.0') && /30\s*分/.test(sum.replace(/\n/g, ' ')), 'summary averages use the right day counts (10.0件 / 30分)');
  ok((await r.textContent('#rpSub')).includes('除外：不良 1日・停止 1日'), 'subtitle shows both exclusion counts: ' + await r.textContent('#rpSub'));
  await r.evaluate(() => { document.querySelector('#rpPanel').scrollTop = 99999; });
  await r.locator('#rpPanel').screenshot({path:'panel_partial.png'});

  // Excel
  const [dl] = await Promise.all([r.waitForEvent('download'), r.click('#rpExcel')]);
  await dl.saveAs('xl_out/partial.xlsx');
  console.log('K2', k2, 'K4', k4);
  // click again re-includes
  await r.click(`button[data-ex="exDefect"][data-k="${k2}"]`);
  ok((await r.evaluate(() => rpAgg(null).total)) === 70, 'clicking again re-includes defects');
  console.log('errors', errs);
  await b.close();
})();
