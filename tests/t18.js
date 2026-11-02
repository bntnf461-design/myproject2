const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1600, height:1000}}); await ctx.addInitScript(require('./nojobs.js'));
  await ctx.clock.install({time:new Date('2026-09-29T10:00:00')});
  const errs = [];
  const c = await ctx.newPage(); await c.goto(URL);
  await c.evaluate(() => {
    const H = {v:1, shifts:['製品A'], types:{}, d:[], w:[], p:{}};
    const t = atDay(dkey(Date.now()), '09:00') / 1000; for (let i = 0; i < 20; i++) H.d.push([t + i * 60, 't1', 1, 0, 0]);
    localStorage.setItem('defectCounterHistory', JSON.stringify(H));
    // only 3 slides, single product, so the order is fixed: summary -> pie -> pareto
    localStorage.setItem('defectCounterReport', JSON.stringify({preset:'7d', shifts:['製品A'], interval:10,
      slides:{summary:true, pie:true, pareto:true, daily:false, trend:false, hourly:false, down:false, cmpDefect:false, cmpMix:false, cmpDown:false}}));
  });
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push(e.message)); await r.goto(URL + '#report');
  await ctx.clock.runFor(200);
  const cur = () => r.evaluate(() => rpSlides[rpIndex].id);
  ok(JSON.stringify(await r.evaluate(() => rpSlides.map(s => s.id))) === '["summary","pie","pareto"]', 'playlist summary, pie, pareto');
  ok(await r.$$eval('select[data-dur]', els => els.every(e => e.value === '0')), 'all slides start at 標準');
  // summary 5s, pareto 30s, pie stays 標準 (10s)
  await r.selectOption('select[data-dur="summary"]', '5');
  await r.selectOption('select[data-dur="pareto"]', '30');
  ok(await cur() === 'summary', 'showing summary');
  await ctx.clock.runFor(4800);
  ok(await cur() === 'summary', 'summary still showing at 4.8s');
  await ctx.clock.runFor(400);
  ok(await cur() === 'pie', 'summary changed to pie after 5s (its own time)');
  await ctx.clock.runFor(9700);
  ok(await cur() === 'pie', 'pie still showing at 9.7s (standard 10s)');
  await ctx.clock.runFor(500);
  ok(await cur() === 'pareto', 'pie -> pareto after 10s');
  await ctx.clock.runFor(29000);
  ok(await cur() === 'pareto', 'pareto still showing at 29s');
  await ctx.clock.runFor(1200);
  ok(await cur() === 'summary', 'pareto -> summary after 30s');
  ok(await r.evaluate(() => $('rpProgress').style.transition.includes('5s')), 'progress bar follows 5s for summary');
  // standard time change affects only 標準 slides
  await r.selectOption('#rpInterval', '20');
  await ctx.clock.runFor(5200);
  ok(await cur() === 'pie', 'summary still uses its own 5s after standard changed');
  await ctx.clock.runFor(19000);
  ok(await cur() === 'pie', 'pie now follows standard 20s (19s: still pie)');
  await ctx.clock.runFor(1300);
  ok(await cur() === 'pareto', 'pie -> pareto after 20s');
  // back to 標準 removes the override; saved across reopen
  await r.selectOption('select[data-dur="pareto"]', '0');
  ok(await r.evaluate(() => rp.durations.pareto === undefined && rp.durations.summary === 5), 'setting pareto back to 標準 removes override');
  await r.reload(); await ctx.clock.runFor(300);
  ok(await r.inputValue('select[data-dur="summary"]') === '5', 'per-slide time remembered after reopening');
  ok(await r.isDisabled('select[data-dur="daily"]'), 'time box disabled for slides not being shown');
  await r.evaluate(() => { document.querySelector('#rpPanel').scrollTop = 0; });
  await r.locator('.rp-sec', {hasText:'流すスライド'}).screenshot({path:'durations.png'});
  console.log('errors', errs);
  await b.close();
})();
