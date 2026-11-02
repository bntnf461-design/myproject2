// テンキー SANWA NT-BT23BK：00 キー（0 が2回届く）・← キー（Backspace）・NumLock オフ・配置表
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}}); const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); await c.goto(URL); await c.waitForTimeout(300);
  const ev = (f, a) => c.evaluate(f, a);
  // 00 キーと同じ：keydown 0 が続けて2回（数ミリ秒の間）
  const zz = () => ev(() => { for (let i = 0; i < 2; i++) { document.body.dispatchEvent(new KeyboardEvent('keydown', {code:'Numpad0', key:'0', bubbles:true, cancelable:true})); document.body.dispatchEvent(new KeyboardEvent('keyup', {code:'Numpad0', key:'0', bubbles:true})); } });
  const key = (code, k) => ev(([code, k]) => document.body.dispatchEvent(new KeyboardEvent('keydown', {code, key:k, bubbles:true, cancelable:true})), [code, k]);
  await ev(() => startJob(state.shifts[0])); await c.mouse.click(5, 5);
  for (const k of ['Numpad1', 'Numpad1', 'Numpad2']) { await c.keyboard.press(k); await c.waitForTimeout(120); }
  ok(await ev(() => total()) === 3, '3 defects');
  await zz(); await c.waitForTimeout(150);
  ok(await ev(() => total()) === 2, '00 key undoes only once (3 → 2)');
  await c.keyboard.press('Numpad0'); await c.waitForTimeout(150); await c.keyboard.press('Numpad0'); await c.waitForTimeout(150);
  ok(await ev(() => total()) === 0, 'two separate presses of 0 still undo twice');
  // 停止中：00 で「停止の取り消し」にならない
  await c.keyboard.press('NumpadEnter'); await c.waitForTimeout(200);
  await zz(); await c.waitForTimeout(150);
  ok(await ev(() => state.downtime.running), '00 during a stop does not cancel the stop');
  await c.waitForTimeout(1200); await c.keyboard.press('NumpadEnter'); await c.waitForTimeout(200);
  ok(await ev(() => !state.downtime.running && hist.w.length === 1), 'stop recorded normally');
  // NumLock オフ（key が End など、code は Numpad1）でも数える
  await key('Numpad1', 'End'); await key('Numpad2', 'ArrowDown'); await c.waitForTimeout(150);
  ok(await ev(() => total()) === 2, 'NumLock off: 1 (End) and 2 (↓) still count');
  // ← キー：カウンターでは何もしない
  const t0 = await ev(() => total()); await c.keyboard.press('Backspace'); await c.waitForTimeout(150);
  ok(await ev(() => total()) === t0 && !(await c.textContent('#toast').catch(() => '')).includes('作業していません'), 'Backspace does nothing on the counter');
  // 作業終了 → 作業数の入力：1 → 00 → 100、← で1文字消す
  await c.keyboard.press('NumpadAdd'); await c.waitForTimeout(400); await c.keyboard.press('NumpadAdd'); await c.waitForTimeout(300);
  await c.keyboard.press('Numpad1'); await zz(); await c.waitForTimeout(100);
  ok(await ev(() => jobProdBuf) === '100', '00 types two zeros when entering the job count: ' + await ev(() => jobProdBuf));
  await c.keyboard.press('Backspace'); await c.waitForTimeout(100);
  ok(await ev(() => jobProdBuf) === '10', '← deletes one digit (100 → 10)');
  await c.keyboard.press('NumpadEnter'); await c.waitForTimeout(200);
  ok(await ev(() => state.lastJob && state.lastJob.prod === 10), 'job count saved as 10');
  // 製造種類を選ぶ画面：番号の 00 と ←
  await c.keyboard.press('NumpadAdd'); await c.waitForTimeout(200);
  await c.keyboard.press('Numpad1'); await zz(); await c.waitForTimeout(100);
  ok(await ev(() => $('pkSearch').value) === '100', 'picker: 1 + 00 → 100');
  await c.keyboard.press('Backspace'); await c.keyboard.press('Backspace'); await c.waitForTimeout(100);
  ok(await ev(() => $('pkSearch').value) === '1', 'picker: ← deletes digits');
  await c.keyboard.press('Escape');
  // メニュー：00 で閉じたあと、元に戻すにならない
  await c.evaluate(() => startJob(state.shifts[0])); await c.mouse.click(5, 5); await c.keyboard.press('Numpad1'); await c.waitForTimeout(150);
  const t1 = await ev(() => total());
  await c.keyboard.press('NumpadDivide'); await c.waitForTimeout(150); await zz(); await c.waitForTimeout(150);
  ok(await ev(t1 => !menuOpen && total() === t1, t1), '00 closes the menu without an extra undo');
  // 配置表
  await ev(() => openKeymap()); await c.waitForTimeout(200);
  const km = await c.textContent('#keymapSheet');
  ok(km.includes('Tab') && km.includes('言語') && km.includes('00') && km.includes('←'), 'key sheet shows the NT-BT23BK layout (Tab, ←, 00)');
  await ev(() => closeKeymap());
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
