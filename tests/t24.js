// 設備停止の取り消しをテンキーの 0（2回）で
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1600, height:900}});
  const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); await c.goto(URL);
  const ev = f => c.evaluate(f), keys = async (...ks) => { for (const k of ks) { await c.keyboard.press(k); await c.waitForTimeout(120); } }; // 人が押す速さ
  await c.mouse.click(5, 5);
  await keys('NumpadAdd', 'Numpad1', 'NumpadEnter', 'NumpadAdd');           // 作業開始（番号1の製造種類）
  ok(await ev(() => state.job.running), 'job started');
  await keys('Numpad1', 'Numpad2');
  await keys('NumpadEnter');
  ok(await ev(() => state.downtime.running), 'stop started');
  await keys('Numpad0');
  ok(await ev(() => state.downtime.running) && (await c.textContent('#ssCancel')).includes('もう一度') && (await c.textContent('#toast')).includes('もう一度 0'), 'first 0 only asks (stop continues)');
  ok(await ev(() => total()) === 2, 'first 0 did not undo a defect');
  await c.screenshot({path:'stop_cancel_armed.png'});
  await keys('Numpad0');
  ok(!(await ev(() => state.downtime.running)) && await ev(() => hist.w.length) === 0 && await ev(() => state.downtime.events.length) === 0, 'second 0 cancels the stop, nothing recorded');
  ok(await ev(() => total()) === 2, 'defect counts unchanged');
  // 4秒たつと確認が消える
  await keys('NumpadEnter', 'Numpad0'); await c.waitForTimeout(4300);
  ok(!(await c.getAttribute('#ssCancel', 'data-armed')) && (await c.textContent('#ssCancel')).includes('間違えて押した'), 'arming expires after 4 s');
  await keys('Numpad0');
  ok(await ev(() => state.downtime.running), 'after expiry one 0 only asks again');
  await keys('Numpad0');
  ok(!(await ev(() => state.downtime.running)), 'cancelled');
  // 停止していないときの 0 は今まで通り「元に戻す」
  await keys('Numpad0');
  ok(await ev(() => total()) === 1, '0 without a stop undoes the last defect');
  // 実績グラフのタブから（テンキー転送）
  await keys('NumpadEnter');
  const r = await ctx.newPage(); await r.goto(URL + '#report'); await r.waitForTimeout(400); await r.click('#rpPanelBtn');
  for (const k of ['Numpad0', 'Numpad0']) { await r.keyboard.press(k); await r.waitForTimeout(200); }
  await c.waitForTimeout(300);
  ok(!(await ev(() => state.downtime.running)), 'works from the report tab too (forwarded keys)');
  // マウスの2回押しも今まで通り
  await c.bringToFront(); await keys('NumpadEnter');
  await c.click('#ssCancel'); ok(await ev(() => state.downtime.running), 'mouse first click asks');
  await c.click('#ssCancel'); ok(!(await ev(() => state.downtime.running)), 'mouse second click cancels');
  console.log('errors', errs);
  await b.close();
})();
