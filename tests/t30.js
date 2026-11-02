// 目標（KPI）をカウンター画面に／自動の休憩を曜日ごとに／日報／生産計画（Excel取り込み・表示・出力）
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}, acceptDownloads:true}); const errs = [];
  await ctx.clock.install({time:new Date(2026, 9, 8, 10, 0)}); // 見本の計画ファイル（plan/）の日付が 2026/10/8〜 なので、その日として動かす
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); await c.goto(URL);
  const ev = (f, a) => c.evaluate(f, a);
  const keys = async (...ks) => { for (const k of ks) { await c.keyboard.press(k); await c.waitForTimeout(70); } };
  await c.mouse.click(5, 5);
  await ev(() => { state.shiftCodes = {'製品A':'101', '製品B':'102', '製品C':'103'}; saveState(); });

  // ===== 4. 目標（KPI）=====
  ok(await c.isHidden('#kpiBar'), 'no KPI chips without targets');
  await ev(() => { localStorage.setItem('defectCounterReport', JSON.stringify({kpi:{defDay:10, downDay:5}})); state.features.avail = true; saveState(); });
  await ev(() => startJob('製品A'));
  await ev(() => renderKpi());
  ok(await c.isVisible('#kpiBar') && (await c.textContent('#kpiBar')).includes('今日の不良数') && (await c.textContent('#kpiBar')).includes('目標 10件以下'), 'KPI chips shown when targets set');
  for (let i = 0; i < 8; i++) await keys('Numpad1');
  await c.waitForTimeout(600);
  ok(await ev(() => document.querySelector('#kpiBar .kpi').classList.contains('warn')), '8/10 → yellow');
  ok((await c.textContent('#toast')).includes('目標に近づいています'), 'warn toast once');
  await keys('Numpad2', 'Numpad2', 'Numpad2'); await c.waitForTimeout(600);
  ok(await ev(() => document.querySelector('#kpiBar .kpi').classList.contains('over')), '11/10 → red');
  ok((await c.textContent('#toast')).includes('目標を超えました'), 'over toast');
  await ev(() => { state.kpiAlert.lv = {defDay:'over'}; showToast('x'); }); await keys('Numpad1'); await c.waitForTimeout(600);
  ok((await c.textContent('#toast')) === 'x' || !(await c.textContent('#toast')).includes('超えました'), 'no repeated alert at same level');
  ok((await c.textContent('#kpiBar')).includes('今日の停止時間'), 'downtime KPI chip');

  // ===== 5. 曜日 =====
  const wd = await ev(() => new Date().getDay());
  await ev(() => { openSettings(); });
  ok(await c.locator('#brkRows .brkrow').first().locator('[data-wd]').count() === 7, 'each break row has 7 weekday buttons');
  await c.locator('#brkRows .brkrow').first().locator(`[data-wd="${wd}"]`).click();
  await c.click('#saveSettingsBtn');
  ok(await ev(wd => !state.autoBrks[0].days.includes(wd) && state.autoBrks[0].days.length === 6, wd), 'weekday toggled off and saved');
  ok(await ev(() => { const x = state.autoBrks[0], t = new Date(); const [h, m] = x.s.split(':').map(Number); t.setHours(h, m + 1, 0, 0); return autoSlotNow(t.getTime()) === null; }), 'slot not active on an unchecked weekday');
  ok(await ev(() => { const x = state.autoBrks[2], t = new Date(); const [h, m] = x.s.split(':').map(Number); t.setHours(h, m + 1, 0, 0); return !!autoSlotNow(t.getTime()); }), 'other slot active today');
  await ev(() => { openSettings(); });
  for (const d of [0, 1, 2, 3, 4, 5, 6]) { const btn = c.locator('#brkRows .brkrow').nth(1).locator(`[data-wd="${d}"]`); if (await btn.evaluate(e => e.classList.contains('on'))) await btn.click(); }
  await c.click('#saveSettingsBtn');
  ok((await c.textContent('#settingsError')).includes('曜日'), 'no weekday selected → error');
  await ev(() => closeSettings());

  // ===== 10. 生産計画 =====
  await ev(() => openPlan());
  ok(await c.isVisible('#planOverlay') && (await c.textContent('#planBody')).includes('まだありません'), 'plan screen opens (empty)');
  await c.setInputFiles('#planFile', 'plan/plan.xlsx'); await c.waitForTimeout(800);
  const pv = await c.textContent('#planPreview');
  ok(pv.includes('表（横に日付）') && /読み取れた計画 8件/.test(pv) && !pv.includes('合計'), 'xlsx: picks sheet 生産計画, matrix form, 8 items (合計 row skipped): ' + pv.slice(0, 160));
  ok(pv.includes('試作Z'), 'unknown product warned');
  await c.selectOption('#planSheet', 'メモ'); await c.waitForTimeout(500);
  ok(/読み取れた計画 3件/.test(await c.textContent('#planPreview')) && (await c.textContent('#planPreview')).includes('1行に1件'), 'switch sheet → list form 3 items (code 101 + real dates)');
  await c.selectOption('#planSheet', '生産計画'); await c.waitForTimeout(500);
  await c.click('#planApply'); await c.waitForTimeout(300);
  const today = await ev(() => dkey(Date.now()));
  ok(await ev(t => hist.pl[t + '|製品A'] === 1200 && hist.pl[t + '|製品B'] === 500 && hist.pl[daddDays(t, 4) + '|製品A'] === 0 && hist.pl[daddDays(t, 1) + '|製品B'] === 600, today), 'plan stored (incl. text number and 0)');
  ok(await ev(t => hist.pl[daddDays(t, 2) + '|製品A'] === undefined, today), 'empty cell skipped, 合計 row/column ignored');
  await c.setInputFiles('#planFile', 'plan/plan_sjis.csv'); await c.waitForTimeout(500);
  ok(/読み取れた計画 2件/.test(await c.textContent('#planPreview')), 'Shift_JIS CSV read');
  await c.click('#planApply');
  ok(await ev(t => hist.pl[t + '|製品C'] === 300, today), 'CSV plan stored');
  // 貼り付け（タブ区切り、縦に日付）
  await c.click('#planOverlay summary');
  await c.fill('#planPaste', `日付\t製品A\t製品B\n${today.replace(/-/g, '/')}\t1300\t\n`);
  await c.click('#planPasteBtn');
  ok((await c.textContent('#planPreview')).includes('表（縦に日付）') && /読み取れた計画 1件/.test(await c.textContent('#planPreview')), 'paste: dates down, products across');
  await c.click('#planApply');
  ok(await ev(t => hist.pl[t + '|製品A'] === 1300, today), 'paste overwrote 製品A today = 1300');
  // 表で直す
  const cell = c.locator(`#planBody .plan-in[data-k="${today}"][data-sh="製品B"]`);
  await cell.fill('550'); await cell.press('Enter');
  ok(await ev(t => hist.pl[t + '|製品B'] === 550, today), 'edit in week table');
  await keys('Escape');
  ok(!(await ev(() => planOpen)), 'Esc closes plan screen');
  // 表示：作業中の帯・選ぶ画面・作業終了
  ok((await c.textContent('#jobBar')).includes('今日の計画 1,300'), 'job bar shows today plan');
  await keys('NumpadAdd'); await c.waitForTimeout(300); await keys('NumpadAdd');
  await keys('Numpad8', 'Numpad6', 'Numpad0'); 
  ok((await c.textContent('#jobScreen')).includes('今日の計画 1,300') && (await c.textContent('#jobScreen')).includes('860'), 'end screen shows plan while typing');
  await keys('NumpadEnter');
  ok((await c.textContent('#jobScreen')).includes('（66%）') && (await c.textContent('#jobScreen')).includes('あと 440'), 'end screen: 860/1300 = 66%, あと 440');
  await keys('NumpadAdd');
  const sec = await c.locator('.pk-sec').first().textContent();
  ok(sec.includes('今日の計画') && (await c.locator('.pk-item.hit').first().textContent()).includes('製品A'), 'picker: 今日の計画 first, highlighted');
  ok((await c.locator('.pk-item').first().textContent()).includes('計画 1,300（済 860）'), 'picker shows plan/done');
  await keys('Escape');

  // ===== 6. 日報 =====
  await keys('NumpadDivide', 'Numpad6');
  ok(await ev(() => dayOpen), 'menu 6 opens 日報');
  const dr = await c.textContent('#dayPaper');
  ok(dr.includes('日報') && dr.includes('作業ごとの実績') && dr.includes('品種別の実績') && dr.includes('設備停止') && dr.includes('特記事項'), 'daily report sections');
  ok(dr.includes('12') && dr.includes('目標 10件以下') && dr.includes('✗ 未達'), 'KPI judgement in tiles (12 defects > 10)');
  ok(dr.includes('計画 2,200'), 'total plan today in tile (1300+550+300+50): ' + (dr.match(/計画 [\d,]+/) || [''])[0]);
  await keys('Numpad4'); ok(await ev(t => dayKey === daddDays(t, -1), today), 'numpad 4 = previous day');
  await keys('Numpad6'); ok(await ev(t => dayKey === t, today), 'numpad 6 = next day');
  await ev(() => { window.print = () => { window.__printed = document.body.classList.contains('printing') && document.getElementById('printArea').textContent.includes('作業ごとの実績'); }; });
  await c.click('#dayPrint'); await c.waitForTimeout(200);
  ok(await ev(() => window.__printed === true), 'print puts the report into the print area');
  await c.emulateMedia({media:'print'});
  await c.pdf({path:'plan/day.pdf', preferCSSPageSize:true, printBackground:true});
  await c.emulateMedia({media:'screen'});
  await ev(() => { document.body.classList.remove('printing'); }); await keys('Escape');
  ok(!(await ev(() => dayOpen)), 'Esc closes daily report');

  // ===== 実績グラフ・Excel =====
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push('report: ' + e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(500);
  const res = await r.evaluate(() => { rp.preset = '7d'; rpReload(); const sh = rpExportSheets().sheets;
    const ds = sh.find(s => s.name === '日別×品種'), fl = sh.find(s => s.name === '転記用');
    const today = dkey(Date.now()), row = ds.rows.find(x => x[2] === '製品A' && dkey(x[0].date) === today);
    return {head:ds.header, row, flat:fl.rows.filter(x => x[1] === '製品A' && dkey(x[0].date) === today && /計画数|達成率/.test(x[2])).map(x => [x[2], x[3]]), slide:RENDER.plan(null).html, avail:slideAvailable({feature:'plan'})}; });
  const pi = res.head.indexOf('計画数');
  ok(pi > 0 && res.row[pi] === 1300 && res.row[pi + 1].dec === 66.2, 'Excel 日別×品種: 計画数 1300, 達成率 66.2 ' + JSON.stringify(res.row && [res.row[pi], res.row[pi + 1]]));
  ok(JSON.stringify(res.flat) === JSON.stringify([['計画数', 1300], ['達成率(%)', {dec:66.2}]]), 'Excel 転記用 has 計画数・達成率 ' + JSON.stringify(res.flat));
  ok(res.avail && res.slide.includes('製品A') && res.slide.includes('期間の達成率'), 'plan slide available and rendered');
  await r.click('#rpPanelBtn').catch(() => {});
  ok(await r.locator('#rpDay').count() === 1 && await r.locator('#rpPlan').count() === 1, 'report panel has 日報 and 生産計画 buttons');
  console.log('errors', JSON.stringify(errs));
  await b.close();
})();
