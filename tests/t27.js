// 休憩（* キー）：開始・終了・取り消し、停止中からの切り替え、作業終了、稼働率から除く、Excel・記録の修正
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1600, height:900}});
  const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push('counter: ' + e.message)); await c.goto(URL);
  const ev = f => c.evaluate(f);
  const keys = async (...ks) => { for (const k of ks) { await c.keyboard.press(k); await c.waitForTimeout(120); } };
  await c.mouse.click(5, 5);

  // 待機画面では休憩できない
  await keys('NumpadMultiply');
  ok(!(await ev(() => state.brk.running)) && (await c.textContent('#toast')).includes('休憩は作業中'), 'break refused while not working');

  await ev(() => startJob('製品A'));
  await keys('Numpad1', 'Numpad1');
  ok(await ev(() => total()) === 2, 'counting in job');

  // 休憩開始
  await keys('NumpadMultiply');
  ok(await ev(() => state.brk.running) && await c.isVisible('#brkScreen'), '* starts break, green screen shown');
  ok((await c.textContent('#brkScreen')).includes('休憩中'), 'break screen text');
  await keys('Numpad1', 'NumpadEnter');
  ok(await ev(() => total()) === 3 && !(await ev(() => state.downtime.running)), 'digit counts during break, Enter (stop) blocked');
  ok((await c.textContent('#toast')).includes('休憩中です'), 'message during break');
  ok(await ev(() => document.getElementById('downPanel').classList.contains('on-break') && document.getElementById('downState').textContent.includes('休憩中')), 'stop panel turns blue break state');
  ok(await ev(() => getComputedStyle(document.getElementById('brkScreen')).backgroundColor).then(v => /rgb\((21, 101, 192|13, 63, 138|\d+, \d+, \d+)\)/.test(v) && !v.includes('30, 107, 82')), 'break screen is blue');
  await c.waitForTimeout(1200);
  await keys('NumpadMultiply');
  ok(!(await ev(() => state.brk.running)) && !(await c.isVisible('#brkScreen')), '* ends break');
  ok(await ev(() => !document.getElementById('downPanel').classList.contains('on-break') && document.getElementById('downState').textContent.includes('稼働中')), 'panel back to running after break');
  await ev(() => openChart('downlog'));
  const dl = await ev(() => document.getElementById('chartBody').innerHTML);
  ok(dl.includes('fill:#1565C0') && dl.includes('青＝休憩') && dl.includes('休憩 <b>1回'), 'timeline draws break in blue with legend');
  await ev(() => closeChart());
  ok(await ev(() => hist.b.length) === 1 && await ev(() => state.brkMs) >= 1000, 'break recorded in history');

  // 0 を2回で取り消し
  await keys('NumpadMultiply', 'Numpad0');
  ok(await ev(() => state.brk.running), 'one 0 does not cancel');
  await keys('Numpad0');
  ok(!(await ev(() => state.brk.running)) && await ev(() => hist.b.length) === 1, '0 twice cancels break (not recorded)');
  ok(await ev(() => total()) === 3, 'cancel did not undo a count');

  // 停止中に休憩 → 停止は終わって休憩へ
  await keys('NumpadEnter');
  ok(await ev(() => state.downtime.running), 'stop started');
  await c.waitForTimeout(1100);
  await keys('NumpadMultiply');
  ok(!(await ev(() => state.downtime.running)) && await ev(() => state.brk.running), 'break during stop ends the stop');
  ok(await ev(() => state.downtime.events.length) === 1 && !(await c.isVisible('#stopScreen')), 'stop recorded, stop screen hidden');

  // 休憩中に＋で作業終了 → 休憩も閉じる
  await c.waitForTimeout(1100);
  await keys('NumpadAdd'); await c.waitForTimeout(300); await keys('NumpadAdd');
  ok(!(await ev(() => state.job.running)) && !(await ev(() => state.brk.running)), '+ + during break ends job and break');
  ok(await ev(() => hist.b.length) === 2 && await ev(() => state.lastJob.brkMs) >= 2000, 'job summary has break time');
  ok((await c.textContent('#jobScreen')).includes('休憩'), 'end screen shows break');

  // 稼働率：作業 8:00-17:00（540分）、休憩 12:00-13:00、停止 30分 → 計画 480分、稼働率 93.8%
  await ev(() => {
    const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0, 0, 0, 0);
    const t = h => Math.round((d.getTime() + h * 3600000) / 1000), si = histShiftIdx('製品B');
    hist.j.push([t(8), t(17), si, 'jT', 1000]);
    hist.b.push([t(12), t(13), si, 'bT']);
    hist.w.push([t(9), t(9.5), si, 'wT', 0, '']);
    state.features.avail = true; saveState(); saveHist();
  });
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push('report: ' + e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(400);
  const res = await r.evaluate(() => {
    rp.preset = 'yesterday'; rp.shifts = null; rpReload();
    const k = rpRange()[0], A = rpAgg('製品B');
    const job = rpData.jobs.find(j => j.id === 'jT'), st = jobStats(job);
    const sh = rpExportSheets().sheets, js = sh.find(s => s.name === '作業一覧'), daily = sh.find(s => s.name === '日別集計');
    const flat = sh.find(s => s.name === '転記用').rows.filter(x => x[1] === '製品B' && x[2] === '休憩(分)');
    return {plan:planMinOf(k), avail:availPct(A.planMs, A.availDown), brk:A.brkMs, stBrk:st.brkMs,
      jobHead:js.header, jobRow:js.rows.find(x => x[2] === '製品B'), dailyHead:daily.header, dailyRow:daily.rows[0], flat};
  });
  ok(res.plan === 480, 'planned time = job time minus break (480) got ' + res.plan);
  ok(res.avail === 93.8, 'availability excludes break: ' + res.avail);
  ok(res.brk === 3600000 && res.stBrk === 3600000, 'break totals in agg and job stats');
  const bi = res.jobHead.indexOf('休憩(分)'), ai = res.jobHead.indexOf('稼働率(%)');
  ok(bi > 0 && res.jobRow[bi].dec === 60 && res.jobRow[ai].dec === 93.8, 'job sheet: break 60 min, availability 93.8 ' + JSON.stringify([res.jobRow[bi], res.jobRow[ai]]));
  const di = res.dailyHead.indexOf('休憩(分)');
  ok(di > 0 && res.dailyRow[di].dec === 60, 'daily sheet has break minutes ' + JSON.stringify(res.dailyRow[di]));
  ok(res.flat.length === 1 && res.flat[0][3].dec === 60, 'transfer sheet has break item');
  await r.evaluate(() => { const i = rpSlides.findIndex(s => s.id === 'avail'); if (i >= 0) rpShow(i, false); });
  ok((await r.evaluate(() => document.body.innerText)).includes('除いた休憩'), 'availability slide mentions excluded break');
  const jobsSlide = await r.evaluate(() => RENDER.jobs(null).html);
  ok(jobsSlide.includes('<th class="n">休憩</th>') && jobsSlide.includes('1時間00分'), 'jobs slide shows break column');

  // 記録の修正：休憩の時刻を直す・削除
  await ev(() => openFix(dkey(Date.now() - 86400000)));
  ok(await c.isVisible('tr[data-bi]'), 'fix screen lists breaks');
  const be = c.locator('tr[data-bi] [data-be]').first();
  const v = await be.inputValue(); await be.fill(v.replace(/T13:00$/, 'T12:45')); await be.dispatchEvent('change');
  ok(await ev(() => { const x = hist.b.find(r => r[3] === 'bT'); return (x[1] - x[0]) / 60; }) === 45, 'break end edited to 12:45');
  await c.click('tr[data-bi] [data-bd]'); await c.click('tr[data-bi] [data-bd]');
  ok(await ev(() => !hist.b.some(r => r[3] === 'bT')), 'break deleted from fix screen');
  await ev(() => closeFix());

  // テンキー配置表・ボタン
  await ev(() => openKeymap());
  ok((await c.textContent('#keymapSheet')).includes('休憩'), 'keymap shows break on *');
  await ev(() => closeKeymap());
  ok((await c.textContent('#brkBtn')).includes('休憩'), 'break button present');
  console.log('errors', JSON.stringify(errs));
  await b.close();
})();
