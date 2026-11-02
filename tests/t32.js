// 共有フォルダへの自動保存（カウンター）と閲覧用（#view）。フォルダはブラウザ内のファイル領域（OPFS）で代用
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const http = require('http'), fs = require('fs');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const srv = http.createServer((q, r) => { const f = '/home/user/myproject2/defect-counter.html'; r.writeHead(200, {'content-type':'text/html; charset=utf-8'}); r.end(fs.readFileSync(f)); }).listen(8765);
const URL = 'http://localhost:8765/defect-counter.html';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}}); const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push('counter: ' + e.message)); await c.goto(URL); await c.waitForTimeout(500);
  const ev = (f, a) => c.evaluate(f, a);
  ok(await ev(() => SHARE_OK), 'directory API available');
  // 設定：オンでフォルダ未選択はエラー
  await ev(() => openSettings()); await c.check('#shareOn'); await c.click('#saveSettingsBtn');
  ok((await c.textContent('#settingsError')).includes('フォルダを選んで'), 'on without folder → error');
  // フォルダの代わりに OPFS を使う（許可は常に granted）
  await ev(async () => { const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle('share', {create:true});
    d.queryPermission = async () => 'granted'; d.requestPermission = async () => 'granted'; shareDir = d; $('shareDirName').textContent = d.name; });
  await c.fill('#shareName', 'ライン1'); await c.selectOption('#shareEvery', '1');
  await c.click('#saveSettingsBtn'); await c.waitForTimeout(800);
  ok(await ev(() => state.share.on && state.share.name === 'ライン1' && state.share.every === 1), 'share settings saved');
  const readShare = () => ev(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('share');
    const f = await (await d.getFileHandle(shareFileName())).getFile(); const j = JSON.parse(await f.text());
    const bk = []; for await (const [n] of (await d.getDirectoryHandle(shareAscii ? 'backup' : 'バックアップ')).entries()) bk.push(n);
    return {name:j.name, kind:j.kind, app:j.app, n:j.hist.d.length, at:j.exportedAt, mod:f.lastModified, bk}; });
  let f1 = await readShare();
  ok(f1.app === 'defect-counter-backup' && f1.kind === 'share' && f1.name === 'ライン1', 'data file written (backup format, line name)');
  ok(f1.bk.length === 1 && /^(不良数カウンター_ライン1|defect-counter_[0-9a-f1]+)_\d{8}\.json$/.test(f1.bk[0]), 'daily backup file in バックアップ: ' + f1.bk);
  ok(await ev(() => !!localStorage.getItem('defectCounterLastBackup')), 'counts as a backup (reminder reset)');
  // 変わらなければ書かない、変わったら書く
  const w1 = await ev(() => shareLast.wroteAt);
  await ev(async () => { shareLast.at = 0; await shareTick(false); });
  ok(await ev(w => shareLast.wroteAt === w, w1), 'unchanged data → not rewritten');
  await ev(() => startJob('製品A')); await c.mouse.click(5, 5);
  for (const k of ['Numpad1', 'Numpad1', 'Numpad2']) await c.keyboard.press(k);
  await ev(async () => { shareLast.at = 0; await shareTick(false); });
  const f2 = await readShare();
  ok(f2.n === f1.n + 3, 'changed data → rewritten (3 more defects)');
  // 許可が切れた・書けないときの案内
  await ev(async () => { shareDir.queryPermission = async () => 'prompt'; shareDir.requestPermission = async () => { shareDir.queryPermission = async () => 'granted'; return 'granted'; }; shareLast.at = 0; await shareTick(false); });
  ok(await c.isVisible('#shareBanner') && (await c.textContent('#shareBanner')).includes('クリックすると再開'), 'permission lost → banner asks for a click');
  await c.click('#shareBanner'); await c.waitForTimeout(300);
  ok(!(await c.isVisible('#shareBanner')), 'click resumes (requestPermission) and hides banner');
  await c.keyboard.press('Numpad4');
  await ev(async () => { const real = shareDir; window.__real = real; shareDir = {name:'x', queryPermission:async () => 'granted', getFileHandle:async () => { throw new Error('ネットワークのパスが見つかりません'); }}; shareLast.at = 0; await shareTick(false); });
  ok((await c.textContent('#shareBanner')).includes('保存できません'), 'write error → banner');
  await ev(async () => { shareDir = window.__real; shareLast.at = 0; await shareTick(false); });
  ok(!(await c.isVisible('#shareBanner')), 'recovers after error');

  // バックアップの整理：このラインのものは60個まで、ほかのラインのものは消さない
  const pr = await ev(async () => {
    const sub = await shareDir.getDirectoryHandle(shareAscii ? 'backup' : 'バックアップ', {create:true});
    for (let i = 1; i <= 70; i++) { const d = new Date(2025, 0, i); const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; await writeTextFile(sub, shareBackupName(day), '{}'); }
    const other = shareAscii ? 'defect-counter_9_20250101.json' : '不良数カウンター_ライン9_20250101.json'; await writeTextFile(sub, other, '{}');
    await c_tick(); async function c_tick() { await c_key(); shareLast.at = 0; await shareTick(false); } async function c_key() { state.counts.t1 = (state.counts.t1 || 0) + 0; hist.d.push([Math.round(Date.now() / 1000), 't1', 1, 0, 0]); saveHist(); }
    const pre = shareBackupName('').replace(/\.json$/, ''); let mine = 0, oth = false;
    for await (const [n] of sub.entries()) { if (n === other) oth = true; else if (n.startsWith(pre)) mine++; }
    return {mine, oth};
  });
  ok(pr.mine === 60 && pr.oth, 'backup pruning keeps 60 of this line, other line untouched ' + JSON.stringify(pr));
  // 同時に書かない
  ok(await ev(async () => { shareLast.at = 0; const a = shareTick(true), b2 = shareTick(true); await a; await b2; await new Promise(r => setTimeout(r, 1800)); return !shareBusy && !shareLast.err; }), 'concurrent ticks serialized, no error');
  // ===== 閲覧用 =====
  const f3 = await readShare();
  const v = await ctx.newPage(); v.on('pageerror', e => errs.push('view: ' + e.message)); await v.goto(URL + '#view'); await v.waitForTimeout(500);
  ok(await v.isVisible('#viewGate') && (await v.textContent('#viewGate')).includes('データファイルを選ぶ'), 'view mode starts with the file gate');
  // カウンター側で、ファイルに保存しないまま数を増やす（閲覧用はファイルの数を見るはず）
  for (const k of ['Numpad3', 'Numpad3']) await c.keyboard.press(k);
  const lsN = await ev(() => JSON.parse(localStorage.getItem('defectCounterHistory')).d.length);
  await v.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('share'); const fn = []; for await (const [n, x] of d.entries()) if (x.kind === 'file') fn.push(n); const h = await d.getFileHandle(fn.find(n => /data|データ/.test(n)));
    h.queryPermission = async () => 'granted'; h.requestPermission = async () => 'granted'; viewHandle = h; await viewRead(await h.getFile()); });
  await v.waitForTimeout(500);
  ok(await v.isHidden('#viewGate') && await v.isVisible('#report'), 'file opened → report shown');
  ok(await v.evaluate(() => hist.d.length) === f3.n && f3.n !== lsN, 'viewer shows file data, not this PC localStorage (' + f3.n + ' vs ' + lsN + ')');
  ok((await v.textContent('#viewBox')).includes('閲覧用') && (await v.textContent('#viewBox')).includes('ライン1'), 'panel shows 閲覧用：ライン1');
  ok(await v.evaluate(() => document.title.includes('閲覧用')), 'title 閲覧用');
  ok(!(await v.locator('#rpBackup, #rpRestore, #rpProd, #rpPlan, #rpView').count()) && (await v.textContent('#rpPanel')).includes('読むだけ'), 'view panel hides backup/restore/edit buttons');
  // 読むだけ：直す画面は開かない・保存しない
  await v.evaluate(() => openFix());
  ok(!(await v.evaluate(() => fixOpen)) && (await v.textContent('#rpKeyNote, .rp-keynote, body')).includes('閲覧用の画面では記録を直せません'), 'fix screen blocked in view');
  const before = await ev(() => localStorage.getItem('defectCounterHistory'));
  await v.evaluate(() => { hist.d.push([1, 't1', 1, 0, 0]); saveHist(); state.counts = {}; saveState(); });
  ok(await ev(() => localStorage.getItem('defectCounterHistory')) === before, 'saveHist/saveState do nothing in view');
  // カウンターが新しく保存 → 閲覧用が読み直す
  await ev(async () => { shareLast.at = 0; await shareTick(false); });
  await v.waitForTimeout(50);
  await v.evaluate(async () => { await viewPoll(); });
  ok(await v.evaluate(() => hist.d.length) === lsN, 'viewer poll picks up the new file (' + lsN + ')');
  // 日報・Excel は使える
  await v.evaluate(() => openDay());
  ok(await v.evaluate(() => dayOpen) && (await v.textContent('#dayPaper')).includes('日報'), 'daily report works in view');
  await v.evaluate(() => closeDay());
  ok(await v.evaluate(() => rpExportSheets().sheets.length > 5), 'Excel export works in view');
  // 古いデータの警告
  await v.evaluate(() => { VIEW_RAW.exportedAt = new Date(Date.now() - 40 * 60000).toISOString(); renderViewBox(); });
  ok((await v.textContent('#viewBox')).includes('20分以上') && await v.isVisible('#viewBadge'), 'stale data warning in panel and on stage');
  // テンキーはカウンターへ送らない
  ok(await v.evaluate(() => { localStorage.removeItem('defectCounterKeyForward'); document.dispatchEvent(new KeyboardEvent('keydown', {code:'Numpad1', key:'1', bubbles:true})); return localStorage.getItem('defectCounterKeyForward') === null; }), 'numpad not forwarded from view');
  // カウンターの画面から閲覧用へ（ハッシュで切り替え）
  const sw = await ctx.newPage(); await sw.goto(URL); await sw.waitForTimeout(300);
  await sw.evaluate(() => { location.hash = '#view'; }); await sw.waitForTimeout(700);
  ok(await sw.evaluate(() => VIEW_MODE) && await sw.isVisible('#viewGate'), 'hash #view switches the tab to view mode');
  console.log('errors', JSON.stringify(errs));
  await b.close(); srv.close();
})();
