// 稼働中タイマーの追加確認：再読み込み・インドネシア語・閲覧モード・時計のずれ
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const sec = t => t.split(':').map(Number).reduce((a, v) => a * 60 + v, 0);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}}); const errs = [];
  { const n = new Date(); await ctx.clock.install({time:new Date(n.getFullYear(), n.getMonth(), n.getDate(), 9, 0)}); }
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); c.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await c.goto(URL); await c.waitForTimeout(300);
  const ev = (f, a) => c.evaluate(f, a); const T = () => c.textContent('#downTimer');
  const want = () => ev(() => Math.round((Date.now() - Date.parse(state.job.start) - state.downtime.events.reduce((a, e) => a + Date.parse(e.end) - Date.parse(e.start), 0)) / 1000));
  const run = async ms => { await ctx.clock.runFor(ms); await c.waitForTimeout(50); };
  await ev(() => startJob(state.shifts[0])); await c.mouse.click(5, 5);
  await run(3 * 60000); await c.keyboard.press('NumpadEnter'); await run(60000); await c.keyboard.press('NumpadEnter'); await run(60000);
  await c.reload(); await c.waitForTimeout(300); await run(1000);
  { const w = await want(); ok(w >= 240 && Math.abs(sec(await T()) - w) <= 1, 'after reload the timer keeps the job total (job time − stop ≈ ' + w + 's): ' + await T()); }
  await c.keyboard.press('Tab'); await run(2000);
  { const w = await want(); ok(Math.abs(sec(await T()) - w) <= 1 && (await c.textContent('#downState')).includes('Beroperasi'), 'Indonesian: timer still counts: ' + await T()); }
  await c.keyboard.press('Tab'); await run(1000);
  // 作業開始の時刻が未来（時計のずれ）→ 00:00、エラーなし
  await ev(() => { state.job.start = new Date(Date.now() + 3600000).toISOString(); }); await run(1500);
  ok(await T() === '00:00', 'job start in the future → 00:00: ' + await T());
  for (const h of ['#view', '#report']) { const p = await ctx.newPage(); const e2 = []; p.on('pageerror', e => e2.push(e.message)); await p.goto(URL + h); await p.waitForTimeout(300); await ctx.clock.runFor(3000); await p.waitForTimeout(50);
    ok(!e2.length, h + ' no errors ' + JSON.stringify(e2)); await p.close(); }
  ok(!errs.length, 'no JS errors: ' + JSON.stringify(errs));
  await b.close();
})();
