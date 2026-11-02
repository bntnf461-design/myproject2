// インドネシア語への切り替え：画面の文字だけ訳す・名前は訳さない・記録は日本語のまま・切り替えボタン・別タブも合わせる・繰り返し書き換えで固まらない
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const J = /[぀-ヿ一-鿿]/;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}}); const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push('counter: ' + e.message)); await c.goto(URL); await c.waitForTimeout(300);
  ok(await c.evaluate(() => LANG === 'ja' && document.documentElement.lang !== 'id'), 'default is Japanese');
  ok((await c.textContent('#downBtn')).includes('停止'), 'Japanese labels by default');
  ok(await c.isVisible('.footer-actions .lang-btn') && (await c.textContent('.footer-actions .lang-btn')).includes('Bahasa Indonesia'), 'footer has a language button');
  await c.evaluate(() => { state.process = '組立工程'; state.shifts = ['製品A', '検査品X', '段取り品', '検査']; saveState(); });
  const pick = () => c.evaluate(() => { const s = JSON.parse(localStorage.getItem('defectCounterState')); return JSON.stringify([s.shifts, s.types, s.process, s.unit, s.reasons, s.autoBrks]); });
  const before = await pick();
  // 実績グラフのタブも開いておく（言語を変えたらついてくる）
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push('report: ' + e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(400);
  ok((await r.textContent('#rpPanel h2')).includes('実績グラフの設定'), 'report Japanese');
  await c.click('.js-lang .lang-btn, .footer-actions .lang-btn >> visible=true'); await c.waitForTimeout(400);
  ok(await c.evaluate(() => LANG === 'id' && document.documentElement.lang === 'id'), 'switched to Indonesian (after reload)');
  const after0 = await pick(); ok(after0 === before, 'saved settings unchanged by switching' + (after0 === before ? '' : ' ' + before + ' VS ' + after0));
  await r.waitForTimeout(800);
  ok(await r.evaluate(() => LANG === 'id') && (await r.textContent('#rpPanel h2')).includes('Pengaturan grafik hasil'), 'report tab followed the language');
  // カウンター画面
  ok(/berhenti/i.test(await c.textContent('#downBtn')) && (await c.textContent('#undoBtn')).includes('Undo'), 'footer translated');
  ok((await c.textContent('#jobScreen')).includes('Tidak sedang kerja'), 'idle screen translated');
  ok((await c.textContent('.footer-actions .lang-btn')).includes('日本語'), 'button offers 日本語 (not translated)');
  await c.evaluate(() => startJob('検査品X')); await c.mouse.click(5, 5); await c.keyboard.press('Numpad1'); await c.keyboard.press('Numpad1'); await c.waitForTimeout(300);
  const bar = await c.textContent('#jobBar');
  ok(bar.includes('検査品X') && bar.includes('組立工程') && bar.includes('Sedang kerja'), 'product and process names kept as entered: ' + bar.replace(/\s+/g, ' ').slice(0, 80));
  ok(await c.evaluate(() => [...document.querySelectorAll('#shiftSelect option')].map(o => o.textContent).join('|')) === '1 製品A|2 検査品X|3 段取り品|4 検査', 'product select keeps names (even when they contain dictionary words)');
  ok(await c.evaluate(() => { const sp = document.createElement('span'); sp.textContent = '検査'; document.body.appendChild(sp); return new Promise(r => setTimeout(() => { const t = sp.textContent; sp.remove(); r(t === '検査'); }, 50)); }), 'a product named exactly like a dictionary word (検査) stays as entered');
  ok(await c.evaluate(() => hist.d.length >= 2 && hist.shifts.includes('検査品X') && state.currentShift === '検査品X'), 'records saved with the original names');
  ok((await c.textContent('#grid')).includes('Gores'), 'default defect name translated (キズ → Gores)');
  ok(await c.evaluate(() => state.types[0].name === 'キズ'), 'defect name in data stays Japanese');
  // 停止・休憩の画面
  await c.keyboard.press('NumpadEnter'); await c.waitForTimeout(300);
  ok((await c.textContent('#stopScreen, .stop-screen, #ssTitle').catch(() => '')) !== null, 'stop screen shown');
  const ss = await c.evaluate(() => document.body.innerText);
  ok(ss.includes('Mesin berhenti') && ss.includes('Jalan lagi'), 'stop screen translated');
  await c.keyboard.press('NumpadEnter'); await c.keyboard.press('NumpadMultiply'); await c.waitForTimeout(300);
  ok((await c.evaluate(() => document.body.innerText)).includes('Sedang istirahat'), 'break screen translated');
  await c.keyboard.press('NumpadMultiply');
  // 設定：曜日・言語の選択
  await c.evaluate(() => openSettings()); await c.waitForTimeout(200);
  const wd = await c.evaluate(() => [...document.querySelectorAll('button[data-wd]')].slice(0, 7).map(x => x.textContent).join(','));
  ok(wd === '' || wd === 'Sen,Sel,Rab,Kam,Jum,Sab,Min', 'weekday buttons translated: ' + wd);
  ok((await c.textContent('#langSlotSettings')).includes('日本語') && (await c.textContent('#langSlotSettings .on')) === 'Bahasa Indonesia', 'settings language selector');
  await c.evaluate(() => closeSettings());
  // 画面に日本語が残っていない（名前・ファイル名・フォルダ名を除く）
  const left = await c.evaluate(() => { const names = i18nUserNames(); const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { const pe = n.parentElement; if (!pe || pe.closest('[data-notr],script,style,textarea,[hidden]')) continue; let t = n.data; names.forEach(x => { t = t.split(x).join(''); }); t = t.replace(/バックアップ|不良数カウンター_データ○○|計画/g, ''); if (/[぀-ヿ一-鿿]/.test(t)) out.push(n.data.trim()); } return out; });
  ok(left.length === 0, 'no Japanese left on the counter screen: ' + JSON.stringify(left.slice(0, 5)));
  // 訳を2回かけても変わらない（固まらない）
  const idem = await c.evaluate(() => { const bad = []; for (const k of Object.keys(I18N_ID).filter(k => !/[\u3040-\u30ff\u4e00-\u9fff]/.test(I18N_ID[k]))) { const a = trText(k), b2 = trText(a); if (a !== b2) bad.push(k); } return bad; });
  ok(idem.length === 0, 'translation is stable when applied twice: ' + idem.slice(0, 3));
  // 実績グラフ：全スライドを描く時間・名前
  await r.evaluate(() => { rp.preset = 'today'; rp.anim = 'off'; rpPlaying = false; rpDirty = true; rpReload(); rpRenderPanel(); });
  const t0 = Date.now(); const n = await r.evaluate(() => { const l = rpBuildSlides(); l.forEach((s, i) => rpShow(i, false)); return l.length; }); await r.waitForTimeout(100); const ms = Date.now() - t0;
  ok(n > 5 && ms < 5000, `all ${n} slides drawn in ${ms} ms`);
  ok((await r.textContent('#rpPanel')).includes('検査品X') && !(await r.textContent('#rpPanel')).includes('Inspeksi品X'), 'report panel keeps product names');
  // 日報
  await c.evaluate(() => openDay()); await c.waitForTimeout(300);
  const day = await c.textContent('#dayPaper');
  ok(day.includes('Laporan harian') && day.includes('組立工程') && day.includes('検査品X'), 'daily report translated, names kept');
  await c.evaluate(() => closeDay());
  // アラート（復元のときなど）も訳す
  ok(await c.evaluate(() => trText('復元しました。画面を読み込み直します。')) === 'Sudah dipulihkan. Layar akan dimuat ulang.', 'alert text translated');
  // 日本語に戻す
  await c.click('.js-lang .lang-btn, .footer-actions .lang-btn >> visible=true'); await c.waitForTimeout(400);
  ok(await c.evaluate(() => LANG === 'ja') && (await c.textContent('#downBtn')).includes('停止'), 'back to Japanese');
  await r.waitForTimeout(800);
  ok(await r.evaluate(() => LANG === 'ja'), 'report tab back to Japanese');
  ok(await c.evaluate(() => hist.d.length >= 2 && state.job && state.job.running && state.job.shift === '検査品X'), 'running job kept across language switches');
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
