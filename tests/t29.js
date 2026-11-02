// 作業終了で作業数を入れる（不良率の機能がオフでも）・入れずに進むときの確認・Excel/実績グラフ
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}}); const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); await c.goto(URL);
  const ev = f => c.evaluate(f);
  const keys = async (...ks) => { for (const k of ks) { await c.keyboard.press(k); await c.waitForTimeout(80); } };
  await c.mouse.click(5, 5);
  ok(await ev(() => !state.features.rate), 'rate feature is off');
  await ev(() => startJob('製品A')); await keys('Numpad1', 'Numpad2');
  await keys('NumpadAdd'); await c.waitForTimeout(300); await keys('NumpadAdd');
  const t = await c.textContent('#jobScreen');
  ok(t.includes('作業数') && t.includes('作業数を入れてください') && !t.includes('不良率'), 'end screen asks for 作業数 (no rate when off)');
  ok(await ev(() => document.querySelector('#jobScreen .js-prodin.need') !== null), 'yellow frame while empty');
  await keys('Numpad8', 'Numpad6', 'Numpad1', 'NumpadSubtract', 'Numpad0');
  ok((await c.textContent('#jobScreen .js-prodin .box')).includes('860'), 'typing shows 860 (− deletes one digit)');
  await keys('NumpadEnter');
  ok(await ev(() => state.lastJob.prod === 860 && hist.j[hist.j.length - 1][4] === 860), '作業数 860 saved to the job');
  ok((await c.textContent('#jobScreen')).includes('保存しました'), 'saved mark shown');
  await keys('NumpadAdd');
  ok(await ev(() => pickOpen && !confirmState), 'with 作業数 entered, + goes straight to the picker');
  await keys('Escape');
  // 入れかけで ＋ → 保存してから次へ
  await ev(() => startJob('製品B')); await keys('NumpadAdd'); await c.waitForTimeout(300); await keys('NumpadAdd');
  await keys('Numpad5', 'Numpad0', 'NumpadAdd');
  ok(await ev(() => pickOpen && hist.j[hist.j.length - 1][4] === 50), 'typed but not saved: + saves 50 and continues');
  await keys('Escape');
  // 入れずに：ボタンのクリックでも確認
  await ev(() => startJob('製品C')); await keys('NumpadAdd'); await c.waitForTimeout(300); await keys('NumpadAdd');
  await c.click('#jobScreen [data-go]');
  ok(await ev(() => !!confirmState && !pickOpen), 'clicking 作業開始 without 作業数 asks to confirm');
  await c.waitForTimeout(300); await c.click('#confirmYes');
  ok(await ev(() => pickOpen && hist.j[hist.j.length - 1][4] === null), 'confirm yes: next job without 作業数 (null)');
  await keys('Escape');
  // 0 を作業数として入れられる
  await keys('Numpad0', 'NumpadEnter');
  ok(await ev(() => state.lastJob.prod === 0), '0 can be saved as 作業数');
  // 実績グラフ・Excel
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push('report: ' + e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(400);
  const res = await r.evaluate(() => { rp.preset = 'today'; rpReload(); const sh = rpExportSheets().sheets.find(s => s.name === '作業一覧');
    return {head:sh.header, rows:sh.rows.map(x => x[sh.header.indexOf('作業数')]), slide:RENDER.jobs(null).html}; });
  ok(res.head.includes('作業数') && !res.head.includes('不良率(%)'), 'Excel job sheet has 作業数 column (rate off) ' + JSON.stringify(res.head.slice(-4)));
  ok(JSON.stringify(res.rows) === JSON.stringify([860, 50, 0]), 'Excel 作業数 values ' + JSON.stringify(res.rows));
  ok(res.slide.includes('>作業数<') && res.slide.includes('860'), 'jobs slide shows 作業数');
  console.log('errors', JSON.stringify(errs));
  await b.close();
})();
