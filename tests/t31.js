// 生産計画・生産数の表（1日に複数の品種・キー操作・貼り付け・削除）、良品率、日報の品種別
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}, permissions:['clipboard-read', 'clipboard-write']}); const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); await c.goto(URL);
  const ev = (f, a) => c.evaluate(f, a);
  const keys = async (...ks) => { for (const k of ks) { await c.keyboard.press(k); await c.waitForTimeout(60); } };
  await c.mouse.click(5, 5);
  await ev(() => { state.shiftCodes = {'製品A':'101', '製品B':'102', '製品C':'103'}; saveState(); });
  const today = await ev(() => dkey(Date.now()));
  // 不良の記録：製品A 3件、製品B 2件
  await ev(() => { startJob('製品A'); });
  await keys('Numpad1', 'Numpad1', 'Numpad2');
  await ev(() => { endJob(true); saveJobProd(500); startJob('製品B'); });
  await keys('Numpad3', 'Numpad3');
  await ev(() => { endJob(true); });

  // ===== 表を開く（メニュー4）=====
  await keys('Escape');
  await ev(() => { state.lastJob.prod = 0; saveState(); });
  await keys('NumpadDivide', 'Numpad4');
  ok(await ev(() => planOpen), 'menu 4 opens the sheet');
  const rowTxt = sh => c.locator(`#planBody tr[data-k="${today}"][data-sh="${sh}"]`).textContent();
  ok(await c.locator(`#planBody tr[data-k="${today}"][data-sh]`).count() >= 2, 'today shows rows for products with records (A, B)');
  ok((await rowTxt('製品A')).includes('99.40%'), '製品A: 生産 500, 不良 3 → 良品率 99.40%: ' + (await rowTxt('製品A')).replace(/\s+/g, ' '));
  // 「＋」の行に番号を入れて行を増やす（1日に3品種）
  const add = c.locator(`#planBody tr.add[data-k="${today}"] .add-sh`);
  await add.click(); await c.keyboard.type('103'); await keys('Enter');
  ok(await c.locator(`#planBody tr[data-k="${today}"][data-sh="製品C"]`).count() === 1, '+ row: code 103 adds 製品C row');
  ok(await ev(() => document.activeElement.dataset.f === 'pl' && document.activeElement.dataset.sh === '製品C'), 'focus moves to 製品C plan cell');
  await c.keyboard.type('300'); await keys('ArrowRight');
  ok(await ev(() => document.activeElement.dataset.f === 'p' && document.activeElement.dataset.sh === '製品C'), '→ at end moves to 生産数 cell');
  await c.keyboard.type('280'); await keys('Enter');
  ok(await ev(t => hist.pl[t + '|製品C'] === 300 && hist.p[t + '|製品C'] === 280, today), '製品C plan 300 / prod 280 saved');
  ok((await rowTxt('製品C')).includes('-20') && (await rowTxt('製品C')).includes('93%'), 'diff -20 and 達成率 93%');
  // 計画を上下で入れる
  await c.locator(`#planBody tr[data-k="${today}"][data-sh="製品A"] [data-f="pl"]`).click();
  await c.keyboard.type('600'); await keys('ArrowDown'); await c.keyboard.type('400'); await keys('Enter');
  ok(await ev(t => hist.pl[t + '|製品A'] === 600 && hist.pl[t + '|製品B'] === 400, today), 'ArrowDown/Enter move down and save (A 600, B 400)');
  // テンキー（NumLock オフ）の数字
  await c.locator(`#planBody tr[data-k="${today}"][data-sh="製品B"] [data-f="p"]`).click();
  await c.keyboard.press('Control+a'); await c.keyboard.press('Delete');
  await c.evaluate(() => { const i = document.activeElement; ['Numpad3', 'Numpad9', 'Numpad5'].forEach((code, n) => i.dispatchEvent(new KeyboardEvent('keydown', {code, key:['PageDown', 'PageDown', 'Clear'][n], bubbles:true, cancelable:true}))); });
  await keys('Enter');
  ok(await ev(t => hist.p[t + '|製品B'] === 395, today), 'NumLock-off numpad digits typed 395');
  // 明日：Excel から3行×3列を「＋」の行に貼り付け
  const tm = await ev(t => daddDays(t, 1), today);
  if (await ev(t => weekStart(t) !== planWeek, tm)) await c.click('#planNext');
  const addT = c.locator(`#planBody tr.add[data-k="${tm}"] .add-sh`);
  await addT.click();
  await c.evaluate(() => navigator.clipboard.writeText('101\t1,200\t\n製品B\t600\t\nXYZ\tabc\t\n'));
  await c.keyboard.press('Control+v'); await c.waitForTimeout(200);
  ok(await ev(t => hist.pl[t + '|製品A'] === 1200 && hist.pl[t + '|製品B'] === 600, tm), 'paste into + row creates rows with plans');
  ok((await c.textContent('#planError')).includes('貼り付けました') , 'paste message: ' + await c.textContent('#planError'));
  // 既存の行の計画・生産数の列に2行×2列を貼る
  await c.locator(`#planBody tr[data-k="${tm}"][data-sh="製品A"] [data-f="pl"]`).click();
  await c.evaluate(() => navigator.clipboard.writeText('1100\t1050\n650\t640'));
  await c.keyboard.press('Control+v'); await c.waitForTimeout(200);
  ok(await ev(t => hist.pl[t + '|製品A'] === 1100 && hist.p[t + '|製品A'] === 1050 && hist.pl[t + '|製品B'] === 650 && hist.p[t + '|製品B'] === 640, tm), 'paste 2x2 block into existing rows');
  // 行を消す（2回押し）
  const del = c.locator(`#planBody tr[data-k="${tm}"][data-sh="製品B"] [data-del]`);
  await del.click(); await del.click();
  ok(await ev(t => hist.pl[t + '|製品B'] === undefined && hist.p[t + '|製品B'] === undefined, tm), '× twice deletes the row values');
  ok((await c.textContent('#planBody tfoot')).includes('週の計'), 'week total row');
  await keys('Escape');
  ok(!(await ev(() => planOpen)), 'Esc closes');

  // ===== 良品率：作業終了の画面・ラベル =====
  await ev(() => { state.features.rate = true; saveState(); startJob('製品A'); });
  await keys('Numpad1');
  await ev(() => endJob(true));
  await keys('Numpad2', 'Numpad0', 'Numpad0', 'NumpadEnter');
  ok((await c.textContent('#jobScreen')).includes('良品 199') && (await c.textContent('#jobScreen')).includes('良品率 99.50%'), 'job end shows 良品 199 / 良品率 99.50%');

  // ===== 日報：品種別 =====
  await ev(() => openDay());
  const t1 = await c.textContent('#dayPaper');
  ok(t1.includes('品種別の実績') && t1.includes('良品数・良品率') && t1.includes('作業時間'), 'daily report: product table and 8 tiles');
  const opts = await c.locator('#dayOnly option').allTextContents();
  ok(opts[0] === '全品種' && opts.some(o => o.includes('製品C')), 'product selector: ' + JSON.stringify(opts));
  await c.selectOption('#dayOnly', '製品A');
  const t2 = await c.textContent('#dayPaper');
  ok(t2.includes('101 製品A') && !t2.includes('品種別の実績') && !t2.includes('102 製品B'), 'filtered to 製品A only');
  ok(t2.includes('計画と実績'), 'product report shows plan vs actual');
  await ev(() => { window.print = () => { window.__pages = document.querySelectorAll('#printArea .dr').length; }; });
  await c.click('#dayPrintAll'); await c.waitForTimeout(200);
  ok(await ev(() => window.__pages) >= 4, 'print all: overall + each product pages: ' + await ev(() => window.__pages));
  await c.emulateMedia({media:'print'}); await c.pdf({path:'plan/day_all.pdf', preferCSSPageSize:true, printBackground:true}); await c.emulateMedia({media:'screen'});
  await ev(() => document.body.classList.remove('printing'));
  await keys('Escape');

  // ===== Excel：良品数・良品率 =====
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push('report: ' + e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(400);
  const x = await r.evaluate(() => { rp.preset = 'today'; rpReload(); const sh = rpExportSheets().sheets; const ds = sh.find(s => s.name === '日別×品種'), js = sh.find(s => s.name === '作業一覧'), fl = sh.find(s => s.name === '転記用');
    const row = ds.rows.find(r => r[2] === '製品C'); return {head:ds.header, row, jh:js.header, flat:fl.rows.filter(r => r[1] === '製品C' && /良品/.test(r[2])).map(r => [r[2], r[3]])}; });
  const gi = x.head.indexOf('良品率(%)');
  ok(gi > 0 && x.row[x.head.indexOf('良品数')] === 280 && x.row[gi].dec === 100, 'Excel 日別×品種: 良品数・良品率 ' + JSON.stringify([x.row && x.row[gi - 1], x.row && x.row[gi]]));
  ok(x.jh.includes('良品率(%)'), 'Excel 作業一覧 has 良品率');
  ok(JSON.stringify(x.flat) === JSON.stringify([['良品数', 280], ['良品率(%)', {dec:100}]]), '転記用 has 良品数・良品率 ' + JSON.stringify(x.flat));
  console.log('errors', JSON.stringify(errs));
  await b.close();
})();
