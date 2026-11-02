// 稼働中のタイマー：作業の合計稼働時間（作業開始から − 停止 − 休憩）が進む
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const sec = t => t.split(':').map(Number).reduce((a, v) => a * 60 + v, 0);
const near = (t, want) => Math.abs(sec(t) - want) <= 2;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}}); const errs = [];
  { const n = new Date(); await ctx.clock.install({time:new Date(n.getFullYear(), n.getMonth(), n.getDate(), 9, 0)}); }
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); await c.goto(URL); await c.waitForTimeout(300);
  const ev = (f, a) => c.evaluate(f, a); const T = () => c.textContent('#downTimer'); const S = () => c.textContent('#downState');
  const run = async ms => { await ctx.clock.runFor(ms); await c.waitForTimeout(50); };
  await ev(() => startJob(state.shifts[0])); await c.mouse.click(5, 5);
  await run(65000);
  ok((await S()).includes('稼働中') && near(await T(), 65), 'running timer counts up from job start (≈1:05): ' + await T());
  await run(10 * 60000);
  ok(near(await T(), 665), 'keeps counting (≈11:05): ' + await T());
  // 停止中は停止の時間、再開すると停止の時間を引いた合計稼働時間の続きから
  await c.keyboard.press('NumpadEnter'); await run(30000);
  ok((await S()).includes('停止中') && near(await T(), 30), 'during a stop the timer shows the stop time (≈0:30): ' + await T());
  await c.keyboard.press('NumpadEnter'); await run(5000);
  ok((await S()).includes('稼働中') && near(await T(), 670), 'after resuming, it continues without the stop time (≈11:10): ' + await T());
  // 休憩中は休憩の時間、戻ると休憩を引いた続きから
  await c.keyboard.press('NumpadMultiply'); await run(120000);
  ok((await S()).includes('休憩中') && sec(await T()) >= 119, 'during a break the panel shows the break time: ' + await T());
  await c.keyboard.press('NumpadMultiply'); await run(3000);
  ok((await S()).includes('稼働中') && near(await T(), 673), 'after a break, it continues without the break time (≈11:13): ' + await T());
  // 長い時間は 時:分:秒
  await run(3600 * 1000 + 61000);
  ok(/^\d+:\d\d:\d\d$/.test(await T()) && near(await T(), 673 + 3661), 'over an hour shows h:mm:ss (≈1:12:14): ' + await T());
  // 不良を数えても変わらない
  const before = sec(await T()); await c.keyboard.press('Numpad1'); await run(2000);
  ok(sec(await T()) >= before + 1, 'counting a defect does not reset the timer');
  // 作業終了後は 00:00
  await ev(() => endJob(true)); await run(2000);
  ok(await T() === '00:00', 'no job running → 00:00: ' + await T());
  // 作業の記録を使わないとき：数え始め（全リセット）から
  await ev(() => { state.features.jobs = false; saveState(); renderAll(); });
  await c.click('#resetBtn'); await c.waitForSelector('#confirmOverlay.show'); await c.click('#confirmYes'); await c.waitForFunction(() => total() === 0, null, {timeout:5000}).catch(() => {});
  ok(await ev(() => total() === 0), 'reset done');
  await run(20000);
  ok(near(await T(), 20), 'jobs off: counts from the reset (≈0:20): ' + await T());
  await c.keyboard.press('NumpadEnter'); await run(10000); await c.keyboard.press('NumpadEnter'); await run(5000);
  ok(near(await T(), 25), 'jobs off: stop time is subtracted (≈0:25): ' + await T());
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
