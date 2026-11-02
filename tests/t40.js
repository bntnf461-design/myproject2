// スライドの言語：画面の言語とは別に、スライド（見出しとグラフ）だけ日本語／インドネシア語にできる
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const J = /[぀-ヿ一-鿿]/;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}}); const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push('c: ' + e.message)); await c.goto(URL); await c.waitForTimeout(300);
  await c.evaluate(() => setLang('id')); await c.waitForTimeout(300); // インドネシア語の画面にする
  await c.evaluate(() => startJob(state.shifts[0])); await c.mouse.click(5, 5); await c.keyboard.press('Numpad1');
  await c.waitForFunction(() => total() === 1 && JSON.parse(localStorage.getItem('defectCounterState')).job.running); // 記録が保存されてから実績グラフを開く
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push('r: ' + e.message)); await r.goto(URL + '#report');
  await r.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('defectCounterState') || 'null'); return s && s.job && s.job.running; }, null, {timeout:6000}).catch(async e => { console.log('TIMEOUT r:', await r.evaluate(() => (localStorage.getItem('defectCounterState') || 'null').slice(0, 300))); console.log('c:', await c.evaluate(() => JSON.stringify({job:state.job, ls:(localStorage.getItem('defectCounterState')||'').slice(0, 200), url:location.href, lang:LANG}))); process.exit(1); }); // 別のタブに保存が届くまで待つ
  await r.waitForTimeout(300);
  await r.evaluate(() => { rp.preset = 'today'; rp.anim = 'off'; rpPlaying = false; rpReload(); rpRenderPanel(); rpShow(0, false); }); await r.waitForTimeout(400);
  const look = async () => { await r.waitForTimeout(150); return r.evaluate(() => ({title:$('rpTitle').textContent, sub:$('rpSub').textContent, slide:$('rpSlide').innerText, panel:$('rpPanel').querySelector('h2').textContent, prev:$('rpPrev').textContent})); };
  let x = await look();
  ok(x.title === 'Ringkasan hasil' && x.panel.includes('Pengaturan') && !J.test(x.slide), 'Indonesian screen: slides in Indonesian by default');
  ok(await r.evaluate(() => [...document.querySelectorAll('[data-slidelang]')].map(b => b.textContent).join('|')) === 'Sama dengan layar|日本語|Bahasa Indonesia', 'slide language choices shown (same as screen / 日本語 / Bahasa Indonesia)');
  // スライドだけ日本語
  await r.click('[data-slidelang="ja"]'); x = await look();
  ok(x.title === '実績サマリー' && J.test(x.slide) && x.slide.includes('不良'), 'slides switched to Japanese: ' + x.title);
  ok(x.panel.includes('Pengaturan') && x.prev.includes('Sebelumnya'), 'settings panel and buttons stay Indonesian');
  ok(x.sub.includes('全品種') || x.sub.includes('製品'), 'slide subtitle in Japanese: ' + x.sub);
  // 次のスライドへ進んでも日本語
  await r.click('#rpNext'); x = await look();
  ok(J.test(x.title) && !/[a-z]{4,}/.test(x.title), 'next slide also Japanese: ' + x.title);
  // 再読み込みしても残る
  await r.reload(); await r.waitForTimeout(500); await r.evaluate(() => { rp.preset = 'today'; rpPlaying = false; rpShow(0, false); }); x = await look();
  ok(x.title === '実績サマリー' && x.panel.includes('Pengaturan'), 'slide language kept after reload');
  ok(await r.evaluate(() => rp.slideLang) === 'ja' && await r.evaluate(() => JSON.parse(localStorage.getItem('defectCounterReport')).slideLang) === 'ja', 'saved in report settings');
  // カウンターの画面はインドネシア語のまま
  ok(/berhenti/i.test(await c.textContent('#downBtn')), 'counter screen unaffected');
  // 画面を日本語にして、スライドだけインドネシア語
  await c.mouse.click(5, 5); await c.keyboard.press('Tab'); await r.waitForTimeout(1200);
  await r.evaluate(() => { rpPlaying = false; rpShow(0, false); }); x = await look();
  ok(x.panel.includes('実績グラフの設定') && x.title === '実績サマリー', 'Japanese screen + slides Japanese');
  await r.click('[data-slidelang="id"]'); x = await look();
  ok(x.title === 'Ringkasan hasil' && !J.test(x.slide) && x.panel.includes('実績グラフの設定') && x.prev.includes('前へ'), 'Japanese screen, slides only in Indonesian');
  await r.click('#rpNext'); x = await look();
  ok(!J.test(x.title + x.slide), 'next slide also Indonesian: ' + x.title);
  ok(await r.evaluate(() => document.documentElement.lang !== 'id'), 'page language stays Japanese (only slide area is Indonesian)');
  // 画面と同じに戻す
  await r.click('[data-slidelang=""]'); x = await look();
  ok(x.title === '実績サマリー' || J.test(x.title), 'back to "same as screen" → Japanese: ' + x.title);
  // 全スライドでエラーなし（両方の組み合わせ）
  for (const sl of ['ja', 'id']) await r.evaluate(sl => { rp.slideLang = sl; setSlideLang(sl); rp.preset = '30d'; rpReload(); rpBuildSlides().forEach((s, i) => rpShow(i, false)); }, sl);
  await r.waitForTimeout(200);
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
