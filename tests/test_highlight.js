// Highlight Maker の動作確認（Node.js + Playwright が必要）
//   node tests/test_highlight.js
// サンプル素材＋内蔵BGMで、全パターンの組み立て・描画と、動画ファイルへの書き出しを確認します。
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.resolve(__dirname, '../highlight/HighlightMaker.html'));
  await p.click('#demoBtn');
  await p.waitForFunction(() => HM.S.clips.length === 10 && HM.S.tl && !HM.S.building, null, { timeout: 30000 });
  let fail = 0;
  const ids = await p.evaluate(() => HM.STYLES.map(s => s.id));
  for (const id of ids) {
    await p.click(`.style[data-id="${id}"]`);
    await p.waitForFunction(id => HM.S.style === id && !HM.S.building, id);
    const r = await p.evaluate(() => {
      const tl = HM.S.tl;
      for (let t = 0; t < tl.total; t += 0.25) HM.drawFrame(t);
      const used = new Set(tl.segs.map(s => s.clip)).size;
      const onBeat = tl.segs.slice(0, -1).every(s => tl.an.beats.some(b => Math.abs(b - tl.mStart - s.e) < 1e-6));
      return { cuts: tl.segs.length, used, total: tl.total, onBeat };
    });
    const ok = r.used === 10 && r.onBeat && r.cuts >= 10;
    if (!ok) fail++;
    console.log(`${ok ? 'OK ' : 'NG '} ${id.padEnd(10)} カット${r.cuts} 素材${r.used}/10 ${r.total.toFixed(1)}秒 拍に合う:${r.onBeat}`);
  }
  await p.selectOption('#length', '15');
  await p.waitForFunction(() => !HM.S.building && HM.S.tl.total <= 15.01);
  const dl = p.waitForEvent('download', { timeout: 60000 });
  await p.click('#exportBtn');
  await dl;
  const ex = await p.evaluate(() => window.__lastExport);
  const exOk = ex && ex.size > 100000;
  if (!exOk) fail++;
  console.log(`${exOk ? 'OK ' : 'NG '} 書き出し ${ex && ex.name} ${ex && (ex.size / 1048576).toFixed(1)}MB`);
  if (errs.length) { fail++; console.log('エラー:', errs); }
  await b.close();
  console.log(fail ? `失敗 ${fail} 件` : 'すべて成功');
  process.exit(fail ? 1 : 0);
})();
