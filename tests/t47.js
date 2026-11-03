// ①製造種類を選んでから ＋ で作業開始 ②記録の修正で、終わった作業の不良数・作業数・時刻を直す
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}}); const errs = [];
  { const n = new Date(); await ctx.clock.install({time:new Date(n.getFullYear(), n.getMonth(), n.getDate(), 10, 0)}); }
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); c.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await c.goto(URL); await c.waitForTimeout(300); await c.mouse.click(5, 5);
  const ev = (f, a) => c.evaluate(f, a); const k = async key => { await c.keyboard.press(key); await c.waitForTimeout(60); };
  const run = async ms => { await ctx.clock.runFor(ms); await c.waitForTimeout(50); };
  // ① 選ぶだけでは始まらない
  ok(await ev(() => !state.job.running) && (await c.textContent('.js-go')).includes('製造種類を選ぶ'), 'idle: button says 製造種類を選ぶ');
  await k('NumpadAdd'); ok(await c.isVisible('#pickScreen.show'), '+ opens the picker');
  await k('Numpad2'); await k('NumpadEnter');
  ok(await ev(() => !state.job.running && nextShift === state.shifts[1]), 'choosing does NOT start the job; it is remembered as next');
  ok((await c.textContent('.js-next')).includes(await ev(() => state.shifts[1])) && (await c.textContent('.js-go')).includes('作業開始'), 'screen shows the chosen product and 作業開始');
  await k('NumpadDecimal'); ok(await c.isVisible('#pickScreen.show'), '. opens the picker to choose again');
  await k('Numpad1'); await k('NumpadEnter');
  ok(await ev(() => nextShift === state.shifts[0] && !state.job.running), 'choice changed to product 1');
  await k('NumpadAdd');
  ok(await ev(() => state.job.running && state.job.shift === state.shifts[0] && nextShift === null), '+ starts the job with the chosen product');
  // 数えて終了
  await k('Numpad1'); await k('Numpad1'); await k('Numpad2'); await run(60000);
  await ev(() => endJob(true)); await run(500);
  // 作業数を入れずに ＋ → 確認 → ＋ で選ぶ画面 → 選ぶ → ＋ で開始（もう一度は聞かない）
  await k('NumpadAdd'); ok(await ev(() => !!confirmState), 'no production → confirm');
  await run(300); await k('NumpadAdd'); ok(await c.isVisible('#pickScreen.show'), 'second + opens picker');
  await k('Numpad1'); await k('NumpadEnter'); await k('NumpadAdd');
  ok(await ev(() => state.job.running && !confirmState), 'after choosing, + starts without asking again');
  await k('Numpad3'); await run(60000); await ev(() => endJob(true)); await run(500);
  // ② 記録の修正：1つ目の作業（もう終わって次の作業も終わったあと）
  await ev(() => openFix()); await c.waitForTimeout(200);
  const rows = await c.$$('#fixBody tr[data-ji]:not(.fix-jc)');
  ok(rows.length === 2, 'fix editor lists 2 jobs');
  const total = async i => Number(await c.textContent(`#fixBody tr[data-ji="${i}"]:not(.fix-jc) td:nth-child(6) b`));
  ok(await total(0) === 3 && await total(1) === 1, 'per-job defect totals 3 and 1');
  await c.click('#fixBody tr[data-ji="0"] [data-jc]');
  ok(await c.isVisible('#fixBody tr.fix-jc'), '直す opens the per-job counts');
  const id1 = await ev(() => typeByKey(1).id), id2 = await ev(() => typeByKey(2).id);
  await c.click(`#fixBody tr.fix-jc [data-jcd="1"][data-id="${id2}"]`);
  ok(await total(0) === 4 && await total(1) === 1, '+ on job 1 → 4; job 2 unchanged');
  await c.click(`#fixBody tr.fix-jc [data-jcd="-1"][data-id="${id1}"]`); await c.click(`#fixBody tr.fix-jc [data-jcd="-1"][data-id="${id1}"]`);
  ok(await total(0) === 2 && await total(1) === 1, '−2 キズ on job 1 → 2; job 2 unchanged');
  ok(await c.isDisabled(`#fixBody tr.fix-jc [data-jcd="-1"][data-id="${id1}"]`), 'minus disabled at 0');
  const js = await ev(() => fixJobsCache.map(j => Object.values(jobCounts(j)).reduce((a, v) => a + v, 0)));
  ok(js[0] === 2 && js[1] === 1, 'history per job: ' + JSON.stringify(js));
  // 作業数
  await c.fill('#fixBody tr[data-ji="0"] [data-jp]', '250'); await c.press('#fixBody tr[data-ji="0"] [data-jp]', 'Tab'); await c.waitForTimeout(100);
  ok(await ev(() => hist.j[0][4] === 250 && hist.p[dkey(Date.now()) + '|' + state.shifts[0]] === 250), 'production 250 saved for job 1 and the day');
  await c.fill('#fixBody tr[data-ji="1"] [data-jp]', '80'); await c.press('#fixBody tr[data-ji="1"] [data-jp]', 'Tab'); await c.waitForTimeout(100);
  ok(await ev(() => hist.p[dkey(Date.now()) + '|' + state.shifts[0]] === 330 && state.lastJob.prod === 80), 'job 2 production 80 → day total 330, job-end screen updated');
  // 時刻
  const sIn = '#fixBody tr[data-ji="0"]:not(.fix-jc) [data-js]';
  const v = await c.inputValue(sIn);
  await c.fill(sIn, v.slice(0, 11) + '09:30'); await c.dispatchEvent(sIn, 'change'); await c.waitForTimeout(100);
  ok(await ev(() => new Date(hist.j[0][0] * 1000).getHours() === 9 && new Date(hist.j[0][0] * 1000).getMinutes() === 30), 'job 1 start time changed to 09:30');
  const j0 = () => ev(() => { const r = hist.j[0]; return [Object.values(jobCounts({s:r[0] * 1000, e:r[1] * 1000, sh:hist.shifts[r[2]]})).reduce((a, v) => a + v, 0), r[4]]; });
  ok((await j0())[0] === 2, 'counts kept after time change');
  await c.reload(); await c.waitForTimeout(300);
  { const [n, p] = await j0(); ok(n === 2 && p === 250, 'kept after reload'); }
  // インドネシア語：次の作業を選んだ画面
  await k('Tab'); await run(500);
  await k('NumpadAdd'); await run(300); await k('NumpadAdd'); await k('Numpad2'); await k('NumpadEnter'); await c.waitForTimeout(200);
  await c.screenshot({path:'/tmp/claude-0/-home-user-myproject2/5908aa41-2e2f-58e4-9fda-dd0c1a90772d/scratchpad/next_id.png'});
  const t = await c.textContent('#jobScreen'), names = await ev(() => i18nUserNames());
  let rest = t.replace('日本語', ''); names.forEach(n => { rest = rest.split(n).join(''); });
  const jp = rest.match(/\S*[\u3040-\u30ff\u4e00-\u9fff]\S*/g);
  ok(!jp, 'Indonesian: no Japanese left on the idle screen: ' + JSON.stringify(jp));
  ok(!errs.length, 'no JS errors: ' + JSON.stringify(errs));
  await b.close();
})();
