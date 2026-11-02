// 稼働率と、生産数・稼働時間の入力画面
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1600, height:900}, acceptDownloads:true}); await ctx.addInitScript(require('./nojobs.js'));
  const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push('counter: ' + e.message)); await c.goto(URL);
  // 10日分：製品A・B 毎日 不良8件ずつ、製品Aが毎日20分停止（3日前だけ60分）
  await c.evaluate(() => {
    const H = {v:1, shifts:['製品A', '製品B'], types:{}, d:[], w:[], p:{}};
    state.types.forEach(t => { H.types[t.id] = {n:t.name, c:t.color}; });
    for (let day = 9; day >= 1; day--) {
      const k = daddDays(dkey(Date.now()), -day);
      [0, 1].forEach(si => { for (let i = 0; i < 8; i++) H.d.push([atDay(k, '09:00') / 1000 + i * 60 + si, i < 5 ? 't1' : 't2', 1, si, 0]); });
      const st = atDay(k, '11:00') / 1000; H.w.push([st, st + (day === 3 ? 60 : 20) * 60, 0, 'w' + day, 0, '段取り']);
    }
    H.d.sort((a, z) => a[0] - z[0]);
    localStorage.setItem('defectCounterHistory', JSON.stringify(H));
    state.shifts = ['製品A', '製品B']; state.features = {rate:true, reasons:true, avail:false}; saveState();
    localStorage.setItem('defectCounterReport', JSON.stringify({preset:'custom', from:daddDays(dkey(Date.now()), -7), to:daddDays(dkey(Date.now()), -1), split:false, anim:'off'}));
  });
  await c.reload(); await c.click('h1');

  // --- 設定：稼働率をオン、計画稼働時間の入力チェック
  await c.evaluate(() => openSettings());
  await c.check('#featAvail'); await c.fill('#planMinInput', '2000'); await c.click('#saveSettingsBtn');
  ok((await c.textContent('#settingsError')).includes('1440'), 'plan minutes over 1440 rejected');
  await c.fill('#planMinInput', '480'); await c.click('#saveSettingsBtn');
  ok(await c.evaluate(() => state.features.avail && state.planMin === 480), 'availability feature on, plan 480 min');

  // --- カウンター：メニュー4 → 今日の今の品種に入力 → テンキー Enter で保存して閉じる（設備停止にはならない）
  await c.keyboard.press('NumpadDivide'); await c.keyboard.press('Numpad4');
  ok(await c.evaluate(() => planOpen), 'menu 4 opens the plan/production sheet');
  await c.keyboard.press('Escape');
  await c.click('#rateLabel');
  ok(await c.evaluate(() => prodOpen), 'rate label opens the quick production input');
  const today = await c.evaluate(() => dkey(Date.now()));
  ok(await c.evaluate(t => document.activeElement.dataset.k === t && document.activeElement.dataset.sh === '製品A', today), 'cursor on today / current product');
  await c.keyboard.press('NumpadSubtract'); await c.keyboard.press('NumpadDecimal'); await c.keyboard.press('NumpadMultiply');
  for (const k of ['Numpad1', 'Numpad2', 'Numpad5', 'Numpad0']) await c.keyboard.press(k);
  ok(await c.inputValue('#prodBody input:focus') === '1250', 'numpad digits type into the field; - . * ignored');
  ok(await c.evaluate(() => total()) === 0 && !(await c.evaluate(() => minusMode)), 'typing did not count defects or arm minus');
  await c.keyboard.press('NumpadEnter');
  ok(!(await c.evaluate(() => prodOpen)), 'Enter on today closes the screen');
  ok(!(await c.evaluate(() => state.downtime.running)), 'Enter did NOT start a stop');
  ok(await c.evaluate(t => hist.p[t + '|製品A'], today) === 1250, 'production saved to history');
  ok((await c.textContent('#rateLabel')).includes('1,250'), 'rate label shows production');
  // ラベルのクリックでも開く、/ で閉じる
  await c.click('#rateLabel'); ok(await c.evaluate(() => prodOpen), 'rate label click opens input');
  await c.keyboard.press('NumpadDivide'); ok(!(await c.evaluate(() => prodOpen)), '/ closes input');

  // --- 実績グラフ：入力ボタン → 表に Excel から貼り付け
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push('report: ' + e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(400);
  await r.click('#rpProd');
  ok(await r.evaluate(() => prodOpen) && (await r.textContent('#prodTitle')) === '生産数・稼働時間の入力', 'report: input screen opens with both columns');
  ok(await r.locator('#prodBody tr[data-day]').count() === 14, '14 days shown');
  // 7日前の製品A欄に 7行×2列（製品A・製品B）を貼り付け。1か所は数字でない
  const d7 = await r.evaluate(() => daddDays(dkey(Date.now()), -7));
  const tsv = ['400\t400', '400\t400', '400\t400', '400\t400', '400\tabc', '400\t400', '1,200\t４００'].join('\r\n') + '\r\n';
  await r.evaluate(([k, text]) => {
    const el = document.querySelector(`#prodBody input[data-k="${k}"][data-sh="製品A"]`);
    const dt = new DataTransfer(); dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', {clipboardData:dt, bubbles:true, cancelable:true}));
  }, [d7, tsv]);
  const pv = await r.evaluate(k => [hist.p[k + '|製品A'], hist.p[daddDays(k, 6) + '|製品A'], hist.p[daddDays(k, 6) + '|製品B'], hist.p[daddDays(k, 4) + '|製品B']], d7);
  ok(JSON.stringify(pv) === '[400,1200,400,null]', 'paste: block filled, comma & full-width digits ok, bad cell skipped ' + JSON.stringify(pv));
  ok((await r.textContent('#prodError')).includes('1 か所'), 'paste reports the bad cell');
  ok((await r.evaluate(k => document.querySelector(`#prodBody tr[data-day="${k}"] .prod-sub`).textContent, d7)).includes('不良 8・2.00%'), 'row shows defects and rate');
  // 計画稼働：2日前を休み（0）、Enter で下へ
  const d2 = await r.evaluate(() => daddDays(dkey(Date.now()), -2));
  await r.fill(`#prodBody input[data-op="${d2}"]`, '0'); await r.press(`#prodBody input[data-op="${d2}"]`, 'Enter');
  ok(await r.evaluate(k => hist.op[k], d2) === 0, 'plan 0 (holiday) saved');
  ok(await r.evaluate(() => document.activeElement.dataset.op) === await r.evaluate(() => daddDays(dkey(Date.now()), -1)), 'Enter moved down');
  await r.keyboard.type('abc'); await r.keyboard.press('Enter');
  ok((await r.textContent('#prodError')).includes('数字だけ') && await r.evaluate(() => prodOpen), 'non-number rejected and stays open');
  await r.keyboard.press('Control+a'); await r.keyboard.press('Backspace'); await r.keyboard.press('Escape');
  ok(!(await r.evaluate(() => prodOpen)), 'Esc closes');

  // --- 稼働率：休みの日を元に戻して計算を確認（7日：計画 480×7、停止 20×6＋60）
  await r.evaluate(k => { delete hist.op[k]; saveHist(); rpReload(); }, d2);
  const A = await r.evaluate(() => { const A = rpAgg(null); return {plan:A.planMs / 60000, down:A.availDown / 60000, pct:availPct(A.planMs, A.availDown)}; });
  ok(A.plan === 3360 && A.down === 180 && A.pct === 94.6, 'availability = (3360-180)/3360 = 94.6% ' + JSON.stringify(A));
  // 休みにすると、その日は計画にも停止にも入らない
  await r.evaluate(k => { hist.op[k] = 0; saveHist(); rpReload(); }, d2);
  ok(await r.evaluate(() => rpAgg(null).planMs / 60000) === 2880, 'holiday day excluded from plan');
  await r.evaluate(k => { delete hist.op[k]; saveHist(); rpReload(); }, d2);

  // KPI 稼働率 95%以上：6日達成（95.8%）、1日未達（87.5%）、期間 94.6% は未達
  await r.fill('input[data-kpi="avail"]', '95'); await r.dispatchEvent('input[data-kpi="avail"]', 'change');
  ok((await r.textContent('.rp-kpi')).includes('以上'), 'availability KPI shown as 以上');
  await r.evaluate(() => rpShow(rpSlides.findIndex(x => x.id === 'avail'), false));
  const h = await r.evaluate(() => $("rpSlide").innerHTML);
  ok(/目標達成 <b[^>]*>6<\/b> \/ 7日/.test(h), 'avail slide with 6/7 days achieved ' + (h.match(/目標達成.{0,60}/) || [''])[0]);
  ok(h.includes('95.8') && h.includes('87.5'), 'daily availability values 95.8 / 87.5');
  ok(/fill:var\(--red\)[^>]*>87.5/.test(h), 'below-target day shown in red');
  await r.screenshot({path:'avail_slide.png'});
  await r.evaluate(() => rpShow(rpSlides.findIndex(x => x.id === 'summary'), false));
  const cards = await r.$$eval('.kpi', els => els.map(e => e.textContent.replace(/\s+/g, ' ')));
  ok(cards.some(t => t.includes('稼働率') && t.includes('未達') && t.includes('95%以上')), 'summary has availability card with badge');
  await r.screenshot({path:'avail_summary.png'});

  // --- Excel
  const [dl] = await Promise.all([r.waitForEvent('download'), r.click('#rpExcel')]);
  await dl.saveAs('xl_out/avail.xlsx');

  // --- 停止記録のリセットは停止一覧の中のボタンへ移動
  await c.bringToFront();
  await c.evaluate(() => { state.downtime.events = [{start:new Date(Date.now() - 600000).toISOString(), end:new Date(Date.now() - 300000).toISOString(), shift:'製品A'}]; saveState(); });
  await c.keyboard.press('NumpadDivide'); await c.keyboard.press('Numpad3');
  await c.click('#dlReset');
  ok(await c.evaluate(() => !!confirmState), 'downlog reset button asks for confirmation');
  await c.keyboard.press('NumpadMultiply'); await c.waitForTimeout(300); await c.keyboard.press('NumpadMultiply');
  ok(await c.evaluate(() => state.downtime.events.length) === 0, 'stop records reset from the list screen');
  // 機能が両方オフならメニュー4は案内だけ
  await c.keyboard.press('Escape');
  await c.evaluate(() => { state.features.rate = false; state.features.avail = false; saveState(); });
  await c.keyboard.press('NumpadDivide'); await c.keyboard.press('Numpad4');
  ok(await c.evaluate(() => planOpen && !prodOpen), 'menu 4 opens the sheet even when features are off');
  await c.keyboard.press('Escape');
  console.log('errors', errs);
  await b.close();
})();
