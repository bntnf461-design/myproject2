// 不良の種類・停止理由にインドネシア語の名前を登録できる（インドネシア語の画面で使う。日本語の画面・記録・Excel は日本語のまま）
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}, acceptDownloads:true}); const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push('c: ' + e.message)); c.on('dialog', d => { errs.push('dialog: ' + d.message()); d.dismiss(); }); await c.goto(URL); await c.waitForTimeout(300);
  const ev = (f, a) => c.evaluate(f, a);
  // 初めて開いた状態（保存した設定なし）でも設定が開ける
  await ev(() => openSettings()); await c.waitForTimeout(200);
  const fields = await c.$$('#typeRows .name-id');
  ok(fields.length === 5 && (await fields[0].getAttribute('placeholder')).includes('Gores'), 'each defect has an Indonesian-name field (placeholder shows the automatic name)');
  // 種類を追加して日本語とインドネシア語の名前を入れる
  await c.click('#addTypeBtn');
  const rows = await c.$$('#typeRows .typerow');
  const last = rows[rows.length - 1];
  await (await last.$('input:not(.name-id)')).fill('バリ');
  await (await last.$('.name-id')).fill('Burr');
  await (await c.$$('#typeRows .name-id'))[0].fill('Goresan');                     // 初期の名前（キズ）も自分の訳に変えられる
  await ev(() => { state.features.reasons = true; $('featReasons').checked = true; renderReasonRows(); });
  await c.click('#addReasonBtn');
  const rr = await c.$$('#reasonRows .reasonrow'); const lr = rr[rr.length - 1];
  await (await lr.$('input:not(.name-id)')).fill('金型交換'); await (await lr.$('.name-id')).fill('Ganti cetakan');
  await c.click('#saveSettingsBtn'); await c.waitForTimeout(200);
  const st = await ev(() => ({t:state.types.map(t => [t.name, t.nameId]), r:state.reasonNamesId, settingsClosed:!$('settingsOverlay').classList.contains('show')}));
  ok(st.settingsClosed && st.t.some(([n, i]) => n === 'バリ' && i === 'Burr') && st.t[0][1] === 'Goresan' && st.r['金型交換'] === 'Ganti cetakan', 'Indonesian names saved: ' + JSON.stringify(st));
  // 日本語の画面ではそのまま
  ok((await c.textContent('#grid')).includes('バリ') && !(await c.textContent('#grid')).includes('Burr'), 'Japanese screen shows Japanese names');
  // 記録
  await ev(() => startJob(state.shifts[0])); await c.mouse.click(5, 5);
  const bariKey = await ev(() => state.types.find(t => t.name === 'バリ').key);
  await c.keyboard.press('Numpad' + bariKey); await c.waitForTimeout(150); await c.keyboard.press('Numpad1'); await c.waitForTimeout(150);
  await c.keyboard.press('NumpadEnter'); await c.waitForTimeout(300);
  const rk = await ev(() => state.stopReasons.indexOf('金型交換') + 1); await c.keyboard.press('Numpad' + rk); await c.waitForTimeout(1200); await c.keyboard.press('NumpadEnter'); await c.waitForTimeout(200);
  ok(await ev(() => hist.w.length === 1 && hist.w[0][5] === '金型交換'), 'stop reason saved in Japanese');
  // インドネシア語に切り替え
  await c.mouse.click(5, 5); await c.keyboard.press('Tab'); await c.waitForTimeout(500);
  const grid = await c.textContent('#grid');
  ok(grid.includes('Burr') && grid.includes('Goresan') && !grid.includes('バリ') && !grid.includes('キズ'), 'Indonesian screen uses the registered names (Burr, Goresan)');
  ok(grid.includes('Kotor'), 'defects without an Indonesian name still use the automatic translation (汚れ → Kotor)');
  ok((await c.textContent('#recentInputs')).includes('Burr'), 'recent inputs use the Indonesian name');
  // 停止理由の画面
  await c.keyboard.press('NumpadEnter'); await c.waitForTimeout(300);
  const ss = await ev(() => document.body.innerText);
  ok(ss.includes('Ganti cetakan') && !ss.includes('金型交換'), 'stop screen shows the Indonesian stop reason');
  await c.waitForTimeout(1200); await c.keyboard.press('NumpadEnter'); await c.waitForTimeout(200);
  // 実績グラフ
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push('r: ' + e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(500);
  const slidesText = async p => { await p.evaluate(() => { rp.preset = 'today'; rp.anim = 'off'; rpPlaying = false; rpReload(); }); const n = await p.evaluate(() => rpBuildSlides().length); let t = '';
    for (let i = 0; i < n; i++) { await p.evaluate(i => rpShow(i, false), i); await p.waitForTimeout(30); t += await p.evaluate(() => document.querySelector('#rpSlide').innerText) + '\n'; } return t; };
  const all2 = await slidesText(r);
  ok(all2.includes('Burr') && all2.includes('Ganti cetakan') && !all2.includes('バリ') && !all2.includes('金型交換'), 'report slides use the Indonesian names');
  // 日報
  await ev(() => openDay()); await c.waitForTimeout(300);
  const day = await c.textContent('#dayPaper');
  ok(day.includes('Burr') && !day.includes('バリ'), 'daily report uses the Indonesian name');
  await ev(() => closeDay());
  // Excel は日本語のまま
  const x = await r.evaluate(() => JSON.stringify(rpExportSheets().sheets));
  ok(x.includes('バリ') && x.includes('金型交換') && !x.includes('Burr') && !x.includes('Ganti cetakan'), 'Excel keeps Japanese names');
  // 設定画面：インドネシア語の画面でも日本語の名前とインドネシア語の名前の両方が見える
  await ev(() => openSettings()); await c.waitForTimeout(200);
  const vals = await c.evaluate(() => [...document.querySelectorAll('#typeRows input[type=text]')].map(i => i.value));
  ok(vals.includes('バリ') && vals.includes('Burr'), 'settings show both names');
  // 名前を変える：インドネシア語の名前を消すと自動の訳に戻る
  await c.evaluate(() => { const f = document.querySelectorAll('#typeRows .name-id')[0]; f.value = ''; f.dispatchEvent(new Event('input')); });
  await c.click('#saveSettingsBtn'); await c.waitForTimeout(1300);
  ok((await c.textContent('#grid')).includes('Gores') && !(await c.textContent('#grid')).includes('Goresan'), 'clearing the Indonesian name goes back to the automatic one (Gores)');
  // 停止理由の名前を変えても、インドネシア語の名前はついてくる
  await ev(() => openSettings()); await c.waitForTimeout(200);
  await c.evaluate(() => { const rows = [...document.querySelectorAll('#reasonRows .reasonrow')]; const row = rows.find(r => r.querySelector('input').value === '金型交換'); const f = row.querySelector('input:not(.name-id)'); f.value = '金型の交換'; f.dispatchEvent(new Event('input')); });
  await c.click('#saveSettingsBtn'); await c.waitForTimeout(200);
  ok(await ev(() => state.reasonNamesId['金型の交換'] === 'Ganti cetakan' && !('金型交換' in state.reasonNamesId) && hist.w[0][5] === '金型の交換'), 'renamed stop reason keeps its Indonesian name');
  // 閲覧用：ファイルのインドネシア語の名前を使う
  const data = await ev(() => JSON.stringify(backupData()));
  const v = await ctx.newPage(); v.on('pageerror', e => errs.push('v: ' + e.message)); await v.goto(URL + '#view'); await v.waitForTimeout(300);
  await v.evaluate(async j => { await viewRead(new File([j], 'x.json')); }, data); await v.waitForTimeout(600);
  const vt2 = await slidesText(v);
  ok(vt2.includes('Burr') && !vt2.includes('バリ'), 'view mode uses the Indonesian names from the file');
  // 日本語に戻すと日本語の名前
  await c.evaluate(() => closeSettings && closeSettings()); await c.mouse.click(5, 5); await c.keyboard.press('Tab'); await c.waitForTimeout(400);
  ok((await c.textContent('#grid')).includes('バリ') && !(await c.textContent('#grid')).includes('Burr'), 'back to Japanese names');
  console.log('errors:', JSON.stringify(errs.filter(e => !e.startsWith('dialog'))), 'dialogs:', JSON.stringify(errs.filter(e => e.startsWith('dialog'))));
  await b.close();
})();
