// 作業終了の画面：不良数の訂正（* キー）
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}}); const errs = [];
  { const n = new Date(); await ctx.clock.install({time:new Date(n.getFullYear(), n.getMonth(), n.getDate(), 10, 0)}); }
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); c.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await c.goto(URL); await c.waitForTimeout(300);
  const ev = (f, a) => c.evaluate(f, a); const k = async key => { await c.keyboard.press(key); await c.waitForTimeout(60); };
  const run = async ms => { await ctx.clock.runFor(ms); await c.waitForTimeout(50); };
  const ids = await ev(() => [typeByKey(1).id, typeByKey(2).id]);
  await ev(() => startJob(state.shifts[0])); await c.mouse.click(5, 5);
  await k('Numpad1'); await k('Numpad1'); await k('Numpad1'); await k('Numpad2'); await run(60000);
  await ev(() => endJob(true)); await run(500);
  const lj = () => ev(() => ({c:state.lastJob.counts, t:state.lastJob.total}));
  const jobHist = () => ev(() => { const j = state.lastJob, s = Date.parse(j.start), e = Date.parse(j.end) + 999; const r = {}; replayHist(hist).filter(it => it.t >= s - 999 && it.t <= e).forEach(it => r[it.id] = (r[it.id] || 0) + 1); return r; });
  ok((await lj()).t === 4, 'job ended with 4 defects');
  ok(await c.isVisible('[data-jfopen]'), 'job-end screen shows the 不良数を訂正 button');
  await k('NumpadMultiply');
  ok(await c.isVisible('.js-fix'), '* opens the correction panel');
  await k('Numpad1');
  ok((await lj()).c[ids[0]] === 4 && (await lj()).t === 5, 'digit adds 1 (キズ 3→4, total 5)');
  await k('NumpadSubtract'); ok(await c.isVisible('.js-fix.minus'), '− arms minus');
  await k('Numpad2');
  ok(!(await lj()).c[ids[1]] && (await lj()).t === 4, '− then 2 removes 1 (汚れ 1→0)');
  await k('NumpadSubtract'); await k('Numpad2');
  ok(!(await lj()).c[ids[1]] && (await lj()).t === 4, 'cannot go below 0');
  await k('Numpad1'); await k('Numpad0');
  ok((await lj()).c[ids[0]] === 4, '0 undoes the last correction');
  await k('Numpad7');
  ok((await lj()).t === 4, 'unassigned key changes nothing');
  ok(await ev(() => state.counts[typeByKey(1).id] === 4 && !state.counts[typeByKey(2).id]), 'screen counts follow the correction');
  const h = await jobHist();
  ok(h[ids[0]] === 4 && !h[ids[1]], 'history (graphs/daily report) has the corrected counts: ' + JSON.stringify(h));
  await k('NumpadEnter');
  ok(!(await c.isVisible('.js-fix')) && (await c.textContent('#jobScreen')).includes('合計 4'), 'Enter closes; screen shows total 4');
  // 作業数の入力はいつもどおり
  await k('Numpad1'); await k('Numpad0'); await k('Numpad0'); await k('NumpadEnter');
  ok(await ev(() => state.lastJob.prod === 100), 'production count still entered after correction');
  ok((await c.textContent('#jobScreen')).includes('良品 96'), 'good count uses corrected total (100−4=96)');
  // 入力途中の作業数は * で保存されてから訂正に入る
  await k('Numpad1'); await k('Numpad2'); await k('NumpadMultiply');
  ok(await ev(() => state.lastJob.prod === 12 && !!jobFix), 'typed production saved when opening correction');
  await k('NumpadMultiply'); ok(!(await c.isVisible('.js-fix')), '* closes too');
  // 再読み込みしても訂正は残る
  await c.reload(); await c.waitForTimeout(300);
  ok((await lj()).t === 4 && (await jobHist())[ids[0]] === 4, 'correction kept after reload');
  // マウスでも直せる
  await c.click('[data-jfopen]'); await c.click(`[data-jf="${ids[1]}"][data-d="1"]`);
  ok((await lj()).t === 5, 'mouse ＋ button works'); await c.click('[data-jfclose]');
  // 休憩ボタン（マウス）は今までどおりの案内
  await ev(() => $("brkBtn").click()); ok(!(await c.isVisible('.js-fix')), 'break button does not open correction');
  // インドネシア語
  await k('Tab'); await run(500); await k('NumpadMultiply'); await c.waitForTimeout(200);
  const txt = await c.textContent('.js-fix'); await c.screenshot({path:'jobfix_id.png'});
  ok(!/[぀-ヿ一-鿿]/.test(txt.replace(/[キズ汚れ変形異物寸法その他ハマワレ]/g, '')), 'Indonesian: no Japanese left in the panel: ' + txt.slice(0, 160));
  await k('NumpadEnter'); await k('Tab'); await run(500);
  await k('NumpadMultiply'); await c.waitForTimeout(200); await c.screenshot({path:'jobfix.png'}); await k('NumpadEnter');
  // 次の作業は0から
  await ev(() => startJob(state.shifts[0])); await run(200);
  ok(await ev(() => total() === 0 && !jobFix), 'next job starts from 0');
  ok(!errs.length, 'no JS errors: ' + JSON.stringify(errs));
  await b.close();
})();
