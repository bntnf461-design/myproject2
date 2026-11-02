// 不良の種類が7つ以上：テンキーと同じ並びの3×3
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1366, height:768}}); await ctx.addInitScript(require('./nojobs.js'));
  const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); await c.goto(URL);
  const setTypes = n => c.evaluate(n => { state.types = Array.from({length:n}, (_, i) => ({id:'t' + (i + 1), key:i + 1, name:'種類' + (i + 1), color:COLORS[i % 9]})); saveState(); renderAll(); }, n);
  await setTypes(9);
  const box = async k => c.locator(`.tile[data-type-id="t${k}"]`).boundingBox();
  const b7 = await box(7), b9 = await box(9), b1 = await box(1), b5 = await box(5);
  ok(await c.evaluate(() => $("grid").classList.contains('pad')), '9 types → 3x3 layout');
  ok(b7.y < b5.y && b5.y < b1.y && Math.abs(b7.x - b1.x) < 2 && b9.x > b5.x, 'arranged like the numpad (7 8 9 top, 1 2 3 bottom)');
  ok(b1.height > 120, 'tiles are tall: ' + Math.round(b1.height) + 'px');
  const fs = await c.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.tile .count')).fontSize));
  ok(fs >= 50, 'count font large: ' + fs + 'px');
  const nf = await c.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.tile .name')).fontSize));
  ok(nf >= 28, 'type name font large at 1366x768: ' + nf + 'px');
  // 押したら正しい種類に入る（キーもクリックも）
  await c.mouse.click(5, 5); await c.keyboard.press('Numpad7');
  await c.click('.tile[data-type-id="t3"]');
  ok(await c.evaluate(() => state.counts.t7 === 1 && state.counts.t3 === 1), 'key 7 and click on tile 3 count the right types');
  await setTypes(7);
  ok(await c.evaluate(() => $("grid").classList.contains('pad')) && await c.locator('.tile').count() === 7, '7 types also use 3x3');
  await setTypes(5);
  ok(!(await c.evaluate(() => $("grid").classList.contains('pad'))), '5 types keep the row layout');
  // スマホの幅ではいつもの縦並び
  await setTypes(9); await c.setViewportSize({width:390, height:800});
  const w = await c.evaluate(() => document.querySelector('.tile').getBoundingClientRect().width);
  ok(w > 300, 'phone width: tiles stay full-width rows (' + Math.round(w) + 'px)');
  console.log('errors', errs);
  await b.close();
})();
