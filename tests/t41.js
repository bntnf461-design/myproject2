// 休憩中・設備停止中も不良を数える（停止理由を使うときは、はじめの数字で理由を選び、そのあとは数える。. で選び直す）
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}}); const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); await c.goto(URL); await c.waitForTimeout(300);
  const ev = (f, a) => c.evaluate(f, a);
  const key = async k => { await c.keyboard.press(k); await c.waitForTimeout(130); };
  await ev(() => startJob(state.shifts[0])); await c.mouse.click(5, 5);
  // ---- 休憩中 ----
  await key('NumpadMultiply');
  ok(await ev(() => state.brk.running), 'break started');
  await key('Numpad1'); await key('Numpad1'); await key('Numpad2');
  ok(await ev(() => total() === 3 && state.brk.running), 'during a break 1/1/2 count (total 3), break continues');
  ok(await ev(() => hist.d.length === 3), 'counted defects are in the history');
  await c.waitForTimeout(1100);
  ok((await c.textContent('#bsInfo')).includes('不良 合計 3'), 'break screen shows the defect total');
  ok((await c.textContent('#brkScreen')).includes('数字キー（1〜9）で不良を数えられます'), 'break screen tells that digits count');
  await key('NumpadSubtract');
  ok((await c.textContent('#toast')).includes('取消モード'), '− during a break shows the minus-mode message (bar is hidden behind the break screen)');
  await key('Numpad1');
  ok(await ev(() => total() === 2 && state.counts.t1 === 1), '− then 1 during a break: −1 (total 2)');
  await key('Numpad0'); await key('Numpad0');
  ok(await ev(() => !state.brk.running && total() === 2), '0 twice still cancels the break (counts kept)');
  // ---- 設備停止中（停止理由なし） ----
  await key('NumpadEnter'); await key('Numpad3');
  ok(await ev(() => state.downtime.running && total() === 3), 'during a stop (no reasons) 3 counts, stop continues');
  ok((await c.textContent('#ssNote')).includes('不良を数えられます'), 'stop screen tells that digits count');
  await c.waitForTimeout(1100); await key('NumpadEnter');
  // ---- 設備停止中（停止理由あり） ----
  await ev(() => { state.features.reasons = true; saveState(); renderAll(); });
  await c.mouse.click(5, 5); await key('NumpadEnter');
  ok(await ev(() => state.downtime.running && !state.downtime.reason), 'stop started (reasons on, none chosen)');
  ok((await c.textContent('#ssNote')) === '', 'before choosing a reason, no "count" note');
  await key('Numpad2');
  ok(await ev(() => state.downtime.reason === state.stopReasons[1] && total() === 3), 'first digit chooses the reason (2), no count');
  ok((await c.textContent('#ssNote')).includes('選び直す'), 'after choosing, the note says digits count and . re-picks');
  await key('Numpad1');
  ok(await ev(() => state.downtime.reason === state.stopReasons[1] && total() === 4), 'next digit counts a defect (total 4), reason unchanged');
  await key('NumpadDecimal');
  ok((await c.textContent('#ssReasons')).includes('選び直す'), '. → re-pick mode shown');
  await key('Numpad3');
  ok(await ev(() => state.downtime.reason === state.stopReasons[2] && total() === 4), 're-picked reason 3, no count');
  await key('Numpad2');
  ok(await ev(() => total() === 5 && state.downtime.reason === state.stopReasons[2]), 'then counts again (total 5)');
  // . を2回でやめる
  await key('NumpadDecimal'); await key('NumpadDecimal'); await key('Numpad1');
  ok(await ev(() => total() === 6 && state.downtime.reason === state.stopReasons[2]), '. twice cancels re-pick; digit counts (total 6)');
  await c.waitForTimeout(1100); await key('NumpadEnter');
  ok(await ev(() => !state.downtime.running && hist.w[hist.w.length - 1][5] === state.stopReasons[2]), 'stop recorded with the re-picked reason');
  ok(await ev(() => !state.job.running === false && state.currentShift === state.shifts[0]), 'still working on the same product (. did not switch product)');
  // 次の停止は、また理由から
  await key('NumpadEnter'); await key('Numpad1');
  ok(await ev(() => state.downtime.reason === state.stopReasons[0] && total() === 6), 'new stop: first digit chooses the reason again');
  await key('Numpad0'); await key('Numpad0');
  ok(await ev(() => !state.downtime.running && total() === 6), '0 twice still cancels the stop');
  // . のまま停止を終えても、次の停止でクリックで理由を選んだあとは数える
  await key('NumpadEnter'); await key('Numpad1'); await key('NumpadDecimal'); await c.waitForTimeout(1100); await key('NumpadEnter');
  await key('NumpadEnter'); await c.click('#ssReasons button[data-reason]:nth-of-type(2)'); await c.mouse.click(5, 5);
  const before = await ev(() => total()); await key('Numpad1');
  ok(await ev(b => total() === b + 1 && state.downtime.reason === state.stopReasons[1], before), 'after . and a new stop, a reason chosen by click → digits count');
  await c.waitForTimeout(1100); await key('NumpadEnter');
  await ev(() => { const t = state.types.find(x => x.key === 1); state.counts[t.id] -= 1; hist.d.pop(); saveState(); saveHist(); }); // 上の1件を戻して、あとの合計をそろえる
  // 実績グラフ：休憩中・停止中の不良も入る
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push(e.message)); await r.goto(URL + '#report');
  await r.waitForFunction(() => { const h = JSON.parse(localStorage.getItem('defectCounterHistory') || 'null'); return h && h.d.length >= 7; }, null, {timeout:15000});
  ok(await r.evaluate(() => { rp.preset = 'today'; rpReload(); return rpAgg(null).total; }) === 6, 'report total includes defects counted during breaks/stops (6)');
  // インドネシア語
  await c.evaluate(() => setLang('id')); await c.waitForTimeout(400); await c.mouse.click(5, 5);
  await key('NumpadMultiply'); await c.waitForTimeout(200);
  ok((await c.textContent('#brkScreen')).includes('bisa untuk menghitung cacat'), 'break note translated');
  await key('Numpad1'); ok(await ev(() => total() === 7), 'counting during a break works in Indonesian mode');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
