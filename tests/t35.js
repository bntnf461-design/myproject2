// 実績グラフ：作業の実績がない品種は、品種ごとのスライド・品種の比較に出さない（設定の一覧には「実績なし」で残す）
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}}); const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push('counter: ' + e.message)); await c.goto(URL); await c.waitForTimeout(300);
  const ev = (f, a) => c.evaluate(f, a);
  await ev(() => { state.shifts = ['製品A', '製品B', '製品C', '製品D']; saveState(); });
  await ev(() => startJob('製品A')); await c.mouse.click(5, 5);
  await c.keyboard.press('Numpad1'); await c.keyboard.press('Numpad2'); await c.waitForTimeout(200);
  await ev(() => endJob(true));
  await ev(() => startJob('製品B')); await ev(() => endJob(true));            // 作業だけ（不良なし）
  await ev(() => { const k = dkey(Date.now()); hist.p[k + '|製品D'] = 50; saveHist(); }); // 生産数だけ
  const keys = await ev(() => Object.keys(hist.p));
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push('report: ' + e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(500);
  const re = (f, a) => r.evaluate(f, a);
  const info = await re(() => { rp.preset = 'today'; rp.shifts = null; rp.split = true; rp.withAll = true; rpReload(); rpRenderPanel();
    const sl = rpBuildSlides();
    return {worked:[...rpWorkedShifts()], scopes:[...new Set(sl.map(s => s.scope))], cmp:sl.filter(s => SLIDES.find(x => x.id === s.id).scope === 'cmp').map(s => s.id),
      norec:[...document.querySelectorAll('#rpPanel .rp-check.norec')].map(l => l.textContent), checkedC:document.querySelector('#rpPanel input[data-shift="製品C"]').checked,
      cmpDefect:RENDER.cmpDefect().html, cmpDown:RENDER.cmpDown().html, cmpRate:RENDER.cmpRate().html, name:scopeName(null)}; });
  console.log(JSON.stringify({keys, worked:info.worked, scopes:info.scopes, norec:info.norec, name:info.name}));
  const prodKey = keys.find(k => k.includes('製品D'));
  ok(info.worked.includes('製品A') && info.worked.includes('製品B') && !info.worked.includes('製品C'), 'worked = A (defects), B (job); not C');
  ok(info.worked.includes('製品D') === !!prodKey, 'production count counts as a record');
  ok(!info.scopes.includes('製品C') && info.scopes.includes('製品A') && info.scopes.includes('製品B') && info.scopes.includes(null), 'per-product slides skip C');
  ok(!info.cmpDefect.includes('製品C') && !info.cmpDown.includes('製品C') && !info.cmpRate.includes('製品C'), 'comparison charts skip C');
  ok(info.cmpDefect.includes('製品A') && info.cmpDefect.includes('製品B'), 'comparison charts keep A and B');
  ok(info.norec.length === 1 && info.norec[0].includes('製品C') && info.norec[0].includes('実績なし') && info.checkedC, 'panel marks C as 実績なし (still checked)');
  ok(info.name === '全品種', 'all-selected scope still reads 全品種: ' + info.name);
  const nm = await re(() => { rp.shifts = ['製品A', '製品B', '製品D']; const a = scopeName(null); rp.shifts = ['製品A', '製品B']; return [a, scopeName(null)]; });
  ok(nm[0] === '全品種' && nm[1] === '製品A・製品B', 'scope name: unchecking a product with no records still reads 全品種: ' + nm);
  // 実績のない品種だけを選んだとき：空のスライドが出る（エラーにならない）
  const only = await re(() => { rp.shifts = ['製品C']; rpShow(0, false); return {n:rpSlides.length, txt:document.querySelector('#rpSlide').textContent, sub:document.querySelector('#rpSub').textContent, title:document.querySelector('#rpTitle').textContent}; });
  console.log(JSON.stringify(only).slice(0,300)); ok(only.n === 0 && only.txt.includes('実績がある品種はありません') && only.sub.includes('製品C') && only.title === '作業の実績がありません', 'only C selected → no slides, message');
  // 品種を1つ外しても、残りの実績のある品種だけ
  const two = await re(() => { rp.shifts = ['製品A', '製品C']; return [...new Set(rpBuildSlides().map(s => s.scope))]; });
  ok(two.length === 1 && two[0] === null, 'A + C selected → only one worked product, no split/cmp: ' + JSON.stringify(two));
  // 期間を昨日にすると、全部「実績なし」
  const y = await re(() => { rp.shifts = null; rp.preset = 'yesterday'; rpRenderPanel(); return {w:rpWorkedShifts().size, n:document.querySelectorAll('#rpPanel .rp-check.norec').length}; });
  ok(y.w === 0 && y.n === 4, 'yesterday: no worked products, all marked: ' + JSON.stringify(y));
  // 全スライドを描いてもエラーなし
  await re(() => { rp.preset = 'today'; rp.shifts = null; Object.keys(RENDER).forEach(id => { RENDER[id](null); RENDER[id]('製品A'); }); });
  // 再生中に「実績がありません」→ カウンターで記録したら、再生中でもスライドが出る
  const ctx2 = await b.newContext({viewport:{width:1400, height:800}});
  const r2 = await ctx2.newPage(); r2.on('pageerror', e => errs.push('report2: ' + e.message)); await r2.goto(URL + '#report'); await r2.waitForTimeout(400);
  await r2.evaluate(() => { rp.preset = 'today'; rp.shifts = null; rpPlaying = true; rpShow(0, false); });
  ok(await r2.textContent('#rpTitle') === '作業の実績がありません', 'playing with no records → message');
  const c2 = await ctx2.newPage(); await c2.goto(URL); await c2.evaluate(() => startJob(state.shifts[0])); await c2.mouse.click(5, 5); await c2.keyboard.press('Numpad1');
  await r2.waitForTimeout(1800);
  const after = await r2.evaluate(() => ({n:rpSlides.length, playing:rpPlaying, title:document.querySelector('#rpTitle').textContent}));
  ok(after.n > 0 && after.playing && after.title !== '作業の実績がありません', 'first record arrives while playing → slides start: ' + JSON.stringify(after));
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
