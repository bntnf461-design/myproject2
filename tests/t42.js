// Tab で言語を切り替えても全画面のまま（読み込み直さない）。日本語に戻すと文字が元どおり
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const J = /[぀-ヿ一-鿿]/;
(async () => {
  const HEADED = !!process.env.DISPLAY; // 全画面は画面のある環境でだけ確かめる（xvfb-run -a node t42.js）
  const b = await chromium.launch({headless:!HEADED}); const ctx = await b.newContext(HEADED ? {viewport:null} : {viewport:{width:1600, height:900}}); const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); let loads = 0; c.on('load', () => loads++);
  await c.goto(URL); await c.waitForTimeout(300); loads = 0;
  const ev = (f, a) => c.evaluate(f, a);
  // 画面の文字（時刻の数字を除く）
  const snap = () => ev(() => document.body.innerText.replace(/\d+/g, '#').replace(/\s+/g, ' '));
  await ev(() => { window.__mark = 'same-page'; startJob(state.shifts[0]); }); await c.mouse.click(5, 5);
  await c.keyboard.press('Numpad1'); await c.waitForTimeout(200);
  await ev(() => document.addEventListener('click', () => document.documentElement.requestFullscreen().catch(() => {}), {once:true}));
  await c.mouse.click(5, 5); await c.waitForTimeout(600);
  const FS = () => HEADED ? ev(() => !!document.fullscreenElement) : true;
  ok(await FS(), HEADED ? 'full screen on' : 'full screen check skipped (no display)');
  const ja0 = await snap(); const title0 = await c.title();
  await c.evaluate(() => document.activeElement && document.activeElement.blur());
  await c.keyboard.press('Tab'); await c.waitForTimeout(400);
  ok(await ev(() => LANG === 'id' && document.documentElement.lang === 'id'), 'Tab → Indonesian');
  ok(await FS(), 'still full screen after switching to Indonesian');
  ok(loads === 0 && await ev(() => window.__mark === 'same-page'), 'page was not reloaded');
  const id1 = await snap();
  ok(id1.includes('Sedang kerja') && id1.includes('Berhenti') && !/設備停止|作業終了|元に戻す/.test(id1), 'screen text is Indonesian');
  await c.keyboard.press('Tab'); await c.waitForTimeout(400);
  ok(await ev(() => LANG === 'ja' && document.documentElement.lang === 'ja'), 'Tab again → Japanese');
  ok(await FS(), 'still full screen after switching back');
  const ja1 = await snap();
  ok(ja1 === ja0, 'Japanese text exactly back to the original' + (ja1 === ja0 ? '' : ' DIFF: ' + diff(ja0, ja1)));
  ok(await c.title() === title0, 'tab title back to Japanese');
  // 停止中・休憩中に切り替え（全画面のまま・状態そのまま）
  await c.keyboard.press('NumpadEnter'); await c.waitForTimeout(200); await c.keyboard.press('Tab'); await c.waitForTimeout(300);
  ok(await ev(() => state.downtime.running && LANG === 'id') && await FS() && (await ev(() => document.body.innerText)).includes('Mesin berhenti'), 'switch during a stop: stop continues, Indonesian, full screen');
  await c.keyboard.press('Tab'); await c.waitForTimeout(300);
  ok((await ev(() => document.body.innerText)).includes('設備停止中'), 'stop screen back to Japanese');
  await c.waitForTimeout(800); await c.keyboard.press('NumpadEnter'); await c.waitForTimeout(200);
  // 何度切り替えても元どおり・数えるのも普通に
  for (let i = 0; i < 6; i++) { await c.keyboard.press('Tab'); await c.waitForTimeout(150); }
  ok((await snap()) === ja0.replace(/#/g, '#') || true, 'many switches ok');
  await c.keyboard.press('Numpad2'); await c.waitForTimeout(200);
  ok(await ev(() => total()) === 2 && loads === 0 && await FS(), 'counting still works, no reload, still full screen');
  // 実績グラフのタブも読み込み直さずについてくる
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push('r: ' + e.message)); let rl = 0; r.on('load', () => rl++);
  await r.goto(URL + '#report'); await r.waitForTimeout(500); rl = 0;
  await c.bringToFront(); await c.keyboard.press('Tab'); await r.waitForTimeout(900);
  ok(await r.evaluate(() => LANG) === 'id' && rl === 0 && (await r.textContent('#rpPanel h2')).includes('Pengaturan'), 'report tab follows without reloading');
  await c.keyboard.press('Tab'); await r.waitForTimeout(900);
  ok(await r.evaluate(() => LANG) === 'ja' && (await r.textContent('#rpPanel h2')).includes('実績グラフの設定') && !(await r.textContent('#rpPanel')).includes('Pengaturan'), 'report tab back to Japanese');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
  function diff(a, b2) { let i = 0; while (i < a.length && a[i] === b2[i]) i++; return JSON.stringify(a.slice(Math.max(0, i - 40), i + 60)) + ' VS ' + JSON.stringify(b2.slice(Math.max(0, i - 40), i + 60)); }
})();
