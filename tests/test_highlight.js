// Highlight Maker の動作確認（Node.js + Playwright が必要）
//   node tests/test_highlight.js
// サンプル素材＋内蔵BGMで、全パターンの組み立て・描画（1分）、2分の組み立て、動画の書き出し、全消去を確認します。
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.resolve(__dirname, '../highlight/HighlightMaker.html'));
  // 画面は「手順」ごとに切り替わるので、隠れている部品はプログラムから操作する
  const pick = (sel, v) => p.evaluate(([sel, v]) => { const s = document.querySelector(sel); s.value = v; s.onchange(); }, [sel, v]);
  const tap = sel => p.evaluate(sel => document.querySelector(sel).click(), sel);
  await p.click('#demoBtn');
  await p.waitForFunction(() => HM.S.clips.length === 10 && HM.S.tl && !HM.S.building, null, { timeout: 30000 });
  let fail = 0;
  const ids = await p.evaluate(() => HM.STYLES.map(s => s.id));
  for (const id of ids) {
    await tap(`.style[data-id="${id}"]`);
    await p.waitForFunction(id => HM.S.style === id && !HM.S.building, id);
    const r = await p.evaluate(() => {
      const tl = HM.S.tl;
      for (let t = 0; t < tl.total; t += 0.25) HM.drawFrame(t);
      const used = new Set(tl.segs.map(s => s.clip)).size;
      if (tl.total < 59) return { cuts: tl.segs.length, used, total: tl.total, onBeat: false };
      const onBeat = tl.segs.slice(0, -1).every(s => tl.an.beats.some(b => Math.abs(b - tl.mStart - s.e) < 1e-6));
      return { cuts: tl.segs.length, used, total: tl.total, onBeat };
    });
    const ok = r.used === 10 && r.onBeat && r.cuts >= 10;
    if (!ok) fail++;
    console.log(`${ok ? 'OK ' : 'NG '} ${id.padEnd(10)} カット${r.cuts} 素材${r.used}/10 ${r.total.toFixed(1)}秒 拍に合う:${r.onBeat}`);
  }
  // オープニングタイトル：全パターンを描いてエラーが出ないこと
  const tOk = await p.evaluate(() => { document.querySelector('#title').value = '夏の思い出'; document.querySelector('#subtitle').value = '2026.08'; let n = 0;
    for (const ts of HM.TITLE_STYLES) { HM.S.titleStyle = ts.id; const D = ts.id === 'auto' ? 4 : HM.titleDuration(ts.id, HM.S.tl.per); for (let t = 0; t < D; t += .2) HM.drawFrame(t); n++; } HM.S.titleStyle = 'auto'; return n; });
  console.log(`OK  タイトル ${tOk} パターン`);
  // 2分の長さ
  await pick('#length', '120');
  await p.waitForFunction(() => !HM.S.building && Math.abs(HM.S.tl.total - 120) < 1);
  console.log('OK  2分', await p.evaluate(() => HM.S.tl.segs.length), 'カット');
  // 書き出し（1分・実時間）
  await pick('#length', '60');
  await p.waitForFunction(() => !HM.S.building && Math.abs(HM.S.tl.total - 60) < 1);
  await p.click('#exportBtn');
  await p.waitForSelector('#dlLink', { timeout: 120000 });
  const ex = await p.evaluate(() => window.__lastExport);
  const exOk = ex && ex.size > 100000;
  if (!exOk) fail++;
  console.log(`${exOk ? 'OK ' : 'NG '} 書き出し ${ex && ex.name} ${ex && (ex.size / 1048576).toFixed(1)}MB`);
  // 全部消す（個人データが残らないこと）
  p.on('dialog', d => d.accept());
  await tap('#wipeBtn');
  const left = await p.evaluate(() => ({ clips: HM.S.clips.length, music: !!HM.S.music, dl: !!document.querySelector('#dlLink'), vids: document.querySelectorAll('#hidden video').length, storage: localStorage.length + sessionStorage.length + document.cookie.length }));
  const wipeOk = !left.clips && !left.music && !left.dl && !left.vids && !left.storage;
  if (!wipeOk) fail++;
  console.log(`${wipeOk ? 'OK ' : 'NG '} 全部消す ${JSON.stringify(left)}`);
  if (errs.length) { fail++; console.log('エラー:', errs); }
  await b.close();
  console.log(fail ? `失敗 ${fail} 件` : 'すべて成功');
  process.exit(fail ? 1 : 0);
})();
