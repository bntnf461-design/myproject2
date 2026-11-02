// 作業終了 → 作業数を入れて保存すると「日報を表示」ボタン（Enter でも開く）
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}}); const errs = [];
  { const n = new Date(); await ctx.clock.install({time:new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 0)}); }
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); await c.goto(URL); await c.waitForTimeout(300);
  const ev = (f, a) => c.evaluate(f, a); const key = async (k, w = 150) => { await c.keyboard.press(k); await c.waitForTimeout(w); };
  ok(await c.locator('.js-day').count() === 0, 'no daily-report button before any job');
  await ev(() => startJob(state.shifts[0])); await c.mouse.click(5, 5);
  await key('Numpad1'); await key('Numpad2');
  await key('NumpadAdd', 400); await key('NumpadAdd', 300);
  ok(await ev(() => !state.job.running && !!state.lastJob), 'job ended');
  ok(await c.locator('.js-day').count() === 0, 'no button before the job count is entered');
  await key('Enter');
  ok(await ev(() => !dayOpen), 'Enter before entering the count does not open the daily report');
  await key('Numpad5'); await key('Numpad0');
  ok(await c.locator('.js-day').count() === 0, 'no button while typing the count');
  await key('NumpadEnter');
  ok(await ev(() => state.lastJob.prod === 50), 'job count 50 saved');
  ok(await c.isVisible('.js-day') && (await c.textContent('.js-day')).includes('日報を表示'), '"日報を表示" button appears after saving');
  ok(!(await ev(() => dayOpen)), 'saving with Enter does not open the report by itself');
  // ボタンで開く
  await c.click('.js-day'); await c.waitForTimeout(300);
  ok(await ev(() => dayOpen && dayKey === dkey(Date.parse(state.lastJob.start))), 'button opens the daily report for the job day');
  const day = await c.textContent('#dayPaper');
  ok(day.includes('日報'), 'daily report shown');
  ok(/50/.test(day), 'daily report includes the job count (50)');
  await key('NumpadEnter');
  ok(await ev(() => !dayOpen), 'Enter closes the daily report');
  // Enter で開く
  await key('NumpadEnter', 300);
  ok(await ev(() => dayOpen), 'Enter on the job-end screen (count saved) opens the daily report');
  await key('NumpadDivide');
  ok(await ev(() => !dayOpen), '/ closes it');
  // 作業数を直すときは、数字を入れ直せばよい（ボタンは入力中は消える）
  await key('Numpad6'); await key('Numpad0');
  ok(await c.locator('.js-day').count() === 0, 'button hidden while re-typing');
  await key('NumpadEnter');
  ok(await ev(() => state.lastJob.prod === 60 && !dayOpen) && await c.isVisible('.js-day'), 're-entered count saved (60), button back, report not opened');
  // 日報を開いたまま ＋：日報を閉じて次の作業へ（製造種類を選ぶ画面）
  await key('NumpadEnter', 300);
  ok(await ev(() => dayOpen), 'daily report open again');
  await key('NumpadAdd', 400);
  ok(await ev(() => !dayOpen && pickOpen), '+ while the daily report is open closes it and goes to the next job (product picker)');
  await c.keyboard.press('Escape'); await c.waitForTimeout(200);
  // 実績グラフのタブで Enter：「日報を表示」と案内
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push('r: ' + e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(600);
  await r.mouse.click(900, 400); await r.keyboard.press('NumpadEnter'); await r.waitForTimeout(500);
  ok((await r.textContent('#rpKeyNote')).includes('日報を表示') && await ev(() => dayOpen), 'Enter from the report tab: notice says 日報を表示 and the counter opens it');
  await ev(() => closeDay()); await r.close(); await c.bringToFront();
  // 次の作業を始めると消える
  await key('NumpadAdd', 300); await key('Numpad1'); await key('NumpadEnter', 300);
  ok(await ev(() => state.job.running) && !(await c.isVisible('.js-day')), 'next job started, button no longer shown');
  // インドネシア語
  await ev(() => setLang('id')); await key('NumpadAdd', 400); await key('NumpadAdd', 300); await key('Numpad7'); await key('NumpadEnter');
  ok((await c.textContent('.js-day')).includes('Lihat laporan harian'), 'button translated in Indonesian');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
