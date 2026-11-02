// 停止理由をテンキーで選ぶ／作業の記録を直す／作業終了の押し忘れ通知
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1600, height:900}});
  { const n = new Date(); await ctx.clock.install({time:new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 0)}); } // 夜中に動かしても「3時間前」が前の日にならないよう、今日の正午から始める
  const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); await c.goto(URL);
  const ev = (f, a) => c.evaluate(f, a), keys = async (...ks) => { for (const k of ks) await c.keyboard.press(k); };
  await ev(() => { state.features.reasons = true; state.features.rate = true; saveState(); renderAll(); });
  await c.mouse.click(5, 5);
  await keys('NumpadAdd', 'Numpad1', 'NumpadEnter', 'Numpad1');
  ok(await ev(() => state.job.running && total() === 1), 'job started, 1 defect');

  // ===== 停止理由をテンキーで =====
  await keys('NumpadEnter');
  ok(await c.locator('#ssReasons .rk').count() === 5 && (await c.textContent('#ssReasons button:nth-of-type(2)')).startsWith('2'), 'reason buttons show numbers 1-5');
  await keys('Numpad2');
  ok(await ev(() => state.downtime.reason) === '故障' && await ev(() => total()) === 1, 'key 2 selects 故障, no defect counted');
  ok((await c.getAttribute('#ssReasons button[data-reason="故障"]', 'class')) === 'on', 'button highlighted');
  await keys('Numpad2');
  ok(await ev(() => state.downtime.reason) === '故障' && await ev(() => total()) === 2, 'after a reason is chosen, digits count defects (total 2)');
  await keys('NumpadDecimal', 'Numpad2');
  ok(await ev(() => state.downtime.reason) === '', '. then 2 clears the reason (re-pick)');
  await keys('Numpad9');
  ok(await ev(() => state.downtime.reason) === '' && (await c.textContent('#toast')).includes('9番の停止理由はありません'), 'key 9 with 5 reasons: message only');
  await keys('Numpad3');
  await c.waitForTimeout(1000); await c.screenshot({path:'stop_reason_key.png'}); await c.waitForTimeout(1200);
  await keys('NumpadEnter');
  ok(await ev(() => hist.w[hist.w.length - 1][5]) === '材料待ち', 'reason 材料待ち saved with the stop');
  await keys('Numpad1');
  ok(await ev(() => total()) === 3, 'after resuming, 1 counts a defect again');
  // 停止理由を使わないときは、停止中でも数字は不良を数える（今まで通り）
  await ev(() => { state.features.reasons = false; saveState(); renderAll(); });
  await keys('NumpadEnter', 'Numpad1', 'NumpadEnter');
  ok(await ev(() => total()) === 4, 'reasons off: digits during a stop still count');
  await ev(() => { state.features.reasons = true; saveState(); renderAll(); });

  // ===== 作業終了の押し忘れ =====
  await ev(() => { state.jobWarnH = 1; state.job.start = new Date(Date.now() - 2 * 3600000).toISOString(); saveState(); renderAll(); jobWarnAt = 0; jobWarnCheck(); });
  ok(await ev(() => $("jobBar").classList.contains('warn')) && (await c.textContent('#jobBar')).includes('押し忘れていませんか'), 'job bar warns after the set hours');
  ok((await c.textContent('#toast')).includes('作業終了を押し忘れていませんか'), 'toast + beep reminder');
  await c.waitForTimeout(1000); await c.screenshot({path:'job_warn.png'});
  await ev(() => { state.jobWarnH = 0; saveState(); renderAll(); });
  ok(!(await ev(() => $("jobBar").classList.contains('warn'))), 'no warning when set to 0');
  await ev(() => { state.jobWarnH = 12; saveState(); renderAll(); });

  // ===== 作業中の開始時刻を直す =====
  await ev(() => openFix(dkey(Date.now())));
  ok(await c.locator('tr[data-ji]').count() === 1 && (await c.textContent('tr[data-ji]')).includes('作業中'), 'fix screen lists the running job');
  const earlier = await ev(() => dtLocal(Date.now() - 3 * 3600000));
  await c.fill('tr[data-ji] input[data-js]', earlier); await c.dispatchEvent('tr[data-ji] input[data-js]', 'change');
  ok(await ev(() => Math.round((Date.now() - Date.parse(state.job.start)) / 60000)) >= 179, 'running job start moved 3 h earlier');
  await c.click('#fixClose');

  // ===== 終わった作業の終了時刻を直す（押し忘れ） =====
  await keys('NumpadAdd'); await c.waitForTimeout(300); await keys('NumpadAdd');
  await keys('Numpad1', 'Numpad0', 'Numpad0', 'NumpadEnter'); // 生産数100
  const jid = await ev(() => hist.j[0][3]);
  await ev(() => openFix(dkey(Date.now())));
  const row = 'tr[data-ji="0"]';
  const s0 = await ev(() => hist.j[0][0] * 1000);
  const newEnd = await ev(s => dtLocal(s + 90 * 60000), s0);
  await c.fill(`${row} input[data-je]`, newEnd); await c.dispatchEvent(`${row} input[data-je]`, 'change');
  ok(await ev(() => Math.round((hist.j[0][1] - hist.j[0][0]) / 60)) === 90, 'ended job: end time corrected to 1 h 30 min');
  ok(await ev(() => Math.round((Date.parse(state.lastJob.end) - Date.parse(state.lastJob.start)) / 60000)) === 90, 'end screen summary updated too');
  // 終了が開始より前 → エラー
  const bad = await ev(s => dtLocal(s - 10 * 60000), s0);
  await c.fill(`${row} input[data-je]`, bad); // fill が change を出す
  ok((await c.textContent('#fixError')).includes('終了は開始より後'), 'end before start rejected');
  ok(await ev(() => Math.round((hist.j[0][1] - hist.j[0][0]) / 60)) === 90, 'record unchanged after rejected edit');
  await c.waitForTimeout(1000); await c.screenshot({path:'fix_jobs.png'});
  // 削除（2回押し）→ 生産数も引く
  const day = await ev(() => dkey(Date.now())), sh = await ev(() => state.lastJob.shift);
  ok(await ev(([d, s]) => hist.p[d + '|' + s], [day, sh]) === 100, 'production 100 recorded for the day');
  await c.click(`${row} button[data-jd]`);
  ok(await ev(() => hist.j.length) === 1, 'first click on delete only asks');
  await c.click(`${row} button[data-jd]`);
  ok(await ev(() => hist.j.length) === 0 && await ev(([d, s]) => hist.p[d + '|' + s], [day, sh]) === 0 && await ev(() => state.lastJob) === null, 'job deleted, its production removed, end screen cleared');
  ok(await ev(() => hist.d.length) > 0, 'defect records kept');
  await c.click('#fixClose');

  // ===== 実績グラフのタブの「修正」からも直せる =====
  await keys('NumpadAdd', 'Numpad1', 'NumpadEnter'); await keys('NumpadAdd'); await c.waitForTimeout(300); await keys('NumpadAdd');
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push('report: ' + e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(400);
  await r.evaluate(() => openFix(dkey(Date.now())));
  ok(await r.locator('tr[data-ji]').count() === 1, 'report tab fix screen shows the job');
  console.log('errors', errs);
  await b.close();
})();
