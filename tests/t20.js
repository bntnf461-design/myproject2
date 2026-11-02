// KPI（目標）の表示と、Excelの「転記用」シート
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1600, height:900}, acceptDownloads:true}); await ctx.addInitScript(require('./nojobs.js'));
  const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); await c.goto(URL);
  // 10日分：製品A・B、毎日 キズ5 汚れ3（=8件）、生産 400、停止 20分。3日前だけ 不良20件・停止60分
  await c.evaluate(() => {
    const H = {v:1, shifts:['製品A', '製品B'], types:{}, d:[], w:[], p:{}};
    state.types.forEach(t => { H.types[t.id] = {n:t.name, c:t.color}; });
    for (let day = 9; day >= 0; day--) {
      const k = daddDays(dkey(Date.now()), -day), big = day === 3;
      [0, 1].forEach(si => {
        const n1 = big && si === 0 ? 17 : 5;
        for (let i = 0; i < n1; i++) H.d.push([atDay(k, '09:00') / 1000 + i * 60 + si, 't1', 1, si, 0]);
        for (let i = 0; i < 3; i++) H.d.push([atDay(k, '10:00') / 1000 + i * 60 + si, 't2', 1, si, 0]);
        H.p[k + '|' + H.shifts[si]] = 400;
        if (si === 0) { const st = atDay(k, '11:00') / 1000; H.w.push([st, st + (big ? 60 : 20) * 60, 0, 'w' + day, 0, '段取り']); }
      });
    }
    H.d.sort((a, z) => a[0] - z[0]);
    localStorage.setItem('defectCounterHistory', JSON.stringify(H));
    state.shifts = ['製品A', '製品B']; state.features = {rate:true, reasons:true}; saveState();
    localStorage.setItem('defectCounterReport', JSON.stringify({preset:'7d', split:false, anim:'off'}));
  });
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push(e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(400);
  const show = id => r.evaluate(id => { const i = rpSlides.findIndex(x => x.id === id); rpShow(i, false); return i; }, id);
  const html = () => r.evaluate(() => document.querySelector('#rpStage, .rp-stage, #report').innerHTML);

  // KPI未設定：線もバッジも出ない
  await show('daily');
  ok(!(await html()).includes('stroke-dasharray:16 10'), 'no target line before KPI is set');
  ok(await r.locator('input[data-kpi]').count() === 3, 'panel has 3 KPI inputs (rate feature on)');

  // 目標を入れる：1日の不良数 10件（製品A+Bで1日16件 → 毎日未達）、不良率 2.5%（16/800=2% 達成、3日前 28/800=3.5% 未達）、停止 30分
  const setK = async (k, v) => { await r.fill(`input[data-kpi="${k}"]`, String(v)); await r.dispatchEvent(`input[data-kpi="${k}"]`, 'change'); };
  await setK('defDay', 20); await setK('rate', 2.5); await setK('downDay', 30);
  ok(await r.evaluate(() => JSON.stringify(rp.kpi)) === '{"defDay":20,"rate":2.5,"downDay":30,"avail":null}', 'KPI saved in report settings');
  ok(await r.evaluate(() => JSON.parse(localStorage.getItem('defectCounterReport')).kpi.rate) === 2.5, 'KPI persisted to storage');
  ok(await r.inputValue('input[data-kpi="rate"]') === '2.5', 'panel shows saved value after re-render');

  await show('daily'); let h = await html();
  ok(h.includes('stroke-dasharray:16 10'), 'daily chart: dashed target line');
  ok(/目標達成 <b[^>]*>6<\/b> \/ 7日/.test(h), 'daily: 6 of 7 days achieved (one day 28 > 20): ' + (h.match(/目標達成.{0,80}/) || [''])[0]);
  ok(h.includes('fill:var(--red);font-size'), 'daily: over-target bar value is red');
  await r.screenshot({path:'kpi_daily.png'});

  await show('rate'); h = await html();
  ok(h.includes('stroke-dasharray:16 10') && /目標 2.5%以下/.test(h), 'rate chart: target line and label');
  ok(/目標達成 <b[^>]*>6<\/b> \/ 7日/.test(h), 'rate: 6 of 7 days achieved');
  await r.screenshot({path:'kpi_rate.png'});

  await show('down'); h = await html();
  ok(/目標達成 <b[^>]*>6<\/b> \/ 7日/.test(h), 'down: 6 of 7 days achieved (60 > 30 min)');

  await show('summary'); h = await html();
  const badges = await r.$$eval('.kpi .kb', els => els.map(e => e.className + ':' + e.textContent));
  ok(badges.length === 3, 'summary: 3 KPI badges ' + JSON.stringify(badges));
  ok(badges.some(t => t.includes('ok') && t.includes('2.5%')), 'summary: rate badge achieved (period 2.2%)');
  ok(badges.some(t => t.includes('ok') && t.includes('30分')), 'summary: downtime avg achieved');
  ok(badges.some(t => t.includes('ok') && t.includes('20')), 'summary: defects/day avg achieved (17.7 <= 20)');
  await r.screenshot({path:'kpi_summary.png'});

  await show('cmpRate'); h = await html();
  ok((await r.locator('.tmark').count()) === 2 && h.includes('目標達成'), 'cmpRate: target marker on each product');
  await r.screenshot({path:'kpi_cmprate.png'});

  // 目標を消すと線が消える
  await setK('defDay', ''); await show('daily');
  ok(!(await html()).includes('stroke-dasharray:16 10') && await r.evaluate(() => rp.kpi.defDay) === null, 'clearing KPI removes the line');
  // 不良率の機能をオフにすると、不良率のKPI欄は出ない
  await c.evaluate(() => { state.features.rate = false; saveState(); });
  await r.reload(); await r.waitForTimeout(300);
  ok(await r.locator('input[data-kpi="rate"]').count() === 0, 'rate KPI input hidden when rate feature is off');
  await c.evaluate(() => { state.features.rate = true; saveState(); });
  await r.reload(); await r.waitForTimeout(300);
  await setK('defDay', 20);

  // Excel
  const [dl] = await Promise.all([r.waitForEvent('download'), r.click('#rpExcel')]);
  await dl.saveAs('xl_out/kpi.xlsx');
  console.log('errors', errs);
  await b.close();
})();
