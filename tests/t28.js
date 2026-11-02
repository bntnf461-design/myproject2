// 決まった時間の自動の休憩：設定・時間帯ごとのオン/オフ・全体のオン/オフ・自動で開始/終了・早く戻る・途中から作業開始・24時またぎ
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1600, height:900}});
  const base = new Date(); base.setHours(9, 55, 0, 0);
  await ctx.clock.install({time:base});
  const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); await c.goto(URL);
  const ev = f => c.evaluate(f);
  const at = async (h, m, s = 0) => { const t = new Date(base); t.setHours(h, m, s, 0); const now = await ev(() => Date.now()); const d = t.getTime() - now; if (d > 7000) await c.clock.fastForward(d - 7000); await c.clock.runFor(Math.min(d, 7000)); };
  const hhmm = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  await c.mouse.click(5, 5);

  ok(await ev(() => !state.autoBrkOn && state.autoBrks.length === 3), 'defaults: 3 times, auto off');
  ok((await c.textContent('#autoBrkBtn')).includes('OFF'), 'quick button shows OFF');
  await ev(() => startJob('製品A'));
  await at(10, 0, 10);
  ok(!(await ev(() => state.brk.running)), 'auto off: no break at 10:00');

  // 設定：オン、12:00 は使わない、16:00〜16:05 を追加
  await ev(() => openSettings());
  ok(await c.locator('#brkRows .brkrow').count() === 3, 'settings lists 3 break times');
  await c.check('#autoBrkOnInput');
  await c.locator('#brkRows .brkrow').nth(1).locator('[data-on]').uncheck();
  await c.click('#addBrkBtn');
  await c.click('#saveSettingsBtn');
  ok((await c.textContent('#settingsError')).includes('空欄'), 'empty new row rejected');
  const last = c.locator('#brkRows .brkrow').last();
  await last.locator('[data-s]').fill('16:00'); await last.locator('[data-s]').dispatchEvent('change');
  await last.locator('[data-e]').fill('16:05'); await last.locator('[data-e]').dispatchEvent('change');
  ok((await c.textContent('#brkRows')).includes('5分'), 'row shows length');
  await c.click('#saveSettingsBtn');
  ok(await ev(() => !settingsOpen && state.autoBrkOn && state.autoBrks.length === 4 && !state.autoBrks[1].on), 'settings saved ' + JSON.stringify(await ev(() => state.autoBrks)));
  // 10:00〜10:10 の途中で設定をオンにした → いまの時間帯に入っているので休憩になる
  await c.clock.runFor(6000);
  ok(await ev(() => state.brk.running && state.brk.auto), 'turning on mid-slot starts the break');
  ok(await ev(() => hhmmOf(Date.parse(state.brk.start))) === '10:00', 'turned on within the first minute: break counted from 10:00');
  ok((await c.textContent('#bsInfo')).includes('10:10 に自動で戻ります'), 'break screen says auto end time');
  await at(10, 10, 6);
  ok(!(await ev(() => state.brk.running)), 'break ended automatically at 10:10');
  const r1 = await ev(() => hist.b[hist.b.length - 1]);
  ok(hhmm(r1[1] * 1000) === '10:10', 'recorded end is 10:10 ' + hhmm(r1[0] * 1000) + '-' + hhmm(r1[1] * 1000));
  await at(10, 10, 30);
  ok(!(await ev(() => state.brk.running)), 'no restart after end');

  // 12:00 は「使う」を外した
  await at(12, 0, 10);
  ok(!(await ev(() => state.brk.running)), 'unchecked slot (12:00) skipped');

  // 15:00：自動で始まり、* で早く戻る → 同じ時間帯では再開しない
  await at(15, 0, 6);
  ok(await ev(() => state.brk.running && state.brk.auto && hhmmOf(Date.parse(state.brk.start)) === '15:00'), 'auto break at 15:00, start=15:00');
  await at(15, 3, 0);
  await c.keyboard.press('NumpadMultiply');
  ok(!(await ev(() => state.brk.running)), '* ends auto break early');
  await at(15, 4, 0);
  ok(!(await ev(() => state.brk.running)), 'not restarted in the same slot');
  await ev(() => { openSettings(); saveSettings(); });
  await at(15, 4, 30);
  ok(!(await ev(() => state.brk.running)), 'saving settings does not restart an ended slot');

  // 停止中に自動の休憩 → 停止は終わる
  await at(15, 58, 0);
  await c.keyboard.press('NumpadEnter');
  ok(await ev(() => state.downtime.running), 'stop before 16:00');
  await at(16, 0, 6);
  ok(await ev(() => state.brk.running && !state.downtime.running), 'auto break ends running stop');
  ok(await ev(() => { const ev2 = state.downtime.events[state.downtime.events.length - 1]; return Date.parse(state.brk.start) >= Date.parse(ev2.end); }), 'auto break does not overlap the stop');
  // クイックボタンでオフ → いまの休憩はそのまま、次の時間帯は始まらない
  await c.evaluate(() => document.body.classList.remove('on-break'));
  await at(16, 5, 6);
  ok(!(await ev(() => state.brk.running)), 'ended at 16:05');
  await ev(() => document.getElementById('autoBrkBtn').click());
  ok(await ev(() => !state.autoBrkOn) && (await c.textContent('#autoBrkBtn')).includes('OFF'), 'quick button turns auto off');
  await ev(() => document.getElementById('autoBrkBtn').click());
  ok(await ev(() => state.autoBrkOn), 'quick button turns auto on');

  // 作業を休憩の途中で始めたときは自動で休憩にしない
  await ev(() => endJob(true));
  ok(await ev(() => !state.job.running), 'job ended');
  await ev(() => { state.autoBrks.push({s:'17:00', e:'17:30', on:true}); saveState(); });
  await at(17, 5, 0);
  await ev(() => startJob('製品B'));
  await at(17, 6, 0);
  ok(!(await ev(() => state.brk.running)), 'job started mid-slot: no auto break');
  // 作業していないときは始まらない
  await ev(() => { endJob(true); state.autoBrks.push({s:'18:00', e:'18:10', on:true}); saveState(); });
  await at(18, 0, 10);
  ok(!(await ev(() => state.brk.running)), 'no auto break while not working');

  // 24時をまたぐ休憩
  await ev(() => { startJob('製品C'); state.autoBrks.push({s:'23:50', e:'00:10', on:true}); saveState(); });
  await at(23, 50, 6);
  ok(await ev(() => state.brk.running && state.brk.auto), 'overnight slot starts at 23:50');
  await c.evaluate(() => document.body.classList.remove('on-break'));
  const t2 = new Date(base); t2.setDate(t2.getDate() + 1); t2.setHours(0, 10, 6, 0);
  await c.clock.fastForward(t2.getTime() - await ev(() => Date.now()) - 7000); await c.clock.runFor(7000);
  ok(!(await ev(() => state.brk.running)), 'overnight break ended at 00:10');
  const r2 = await ev(() => hist.b[hist.b.length - 1]);
  ok((r2[1] - r2[0]) === 1200, 'overnight break is 20 min: ' + (r2[1] - r2[0]));
  ok(await ev(() => state.job.running), 'job still running after midnight');

  // 再読み込みしても設定が残る
  await c.reload(); await c.waitForTimeout(300);
  ok(await ev(() => state.autoBrkOn && state.autoBrks.some(x => x.s === '16:00') && state.autoBrks.some(x => !x.on)), 'settings persist after reload');
  console.log('errors', JSON.stringify(errs));
  await b.close();
})();
