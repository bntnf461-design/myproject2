// 工程名：設定・カウンター画面・停止/休憩・テンキー配置表・実績グラフ・日報・Excel・ファイル名・共有フォルダ・閲覧用
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}, acceptDownloads:true}); const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push('counter: ' + e.message)); await c.goto(URL); await c.waitForTimeout(300);
  const ev = (f, a) => c.evaluate(f, a);
  ok(await c.isHidden('#procName') && await ev(() => document.title === '不良数カウンター'), 'no process name by default');
  ok(!(await c.textContent('#jobScreen')).includes('工程'), 'idle screen has no process line by default');
  await ev(() => openSettings()); await c.fill('#processInput', '  組立工程/A  '); await c.click('#saveSettingsBtn');
  ok(await ev(() => state.process === '組立工程/A'), 'saved and trimmed');
  ok((await c.textContent('#procName')) === '組立工程/A' && await c.isVisible('#procName'), 'shown next to the title');
  ok(await ev(() => document.title.startsWith('組立工程/A')), 'tab title');
  ok((await c.textContent('#jobScreen .js-proc')) === '組立工程/A', 'idle screen shows process');
  await ev(() => startJob('製品A'));
  ok((await c.textContent('#jobBar .jb-proc')) === '組立工程/A', 'job bar shows process');
  await c.mouse.click(5, 5); await c.keyboard.press('Numpad1'); await c.keyboard.press('NumpadEnter'); await c.waitForTimeout(300);
  ok((await c.textContent('#ssInfo')).includes('組立工程/A'), 'stop screen shows process');
  await c.keyboard.press('NumpadEnter'); await c.keyboard.press('NumpadMultiply'); await c.waitForTimeout(300);
  ok((await c.textContent('#bsInfo')).includes('組立工程/A'), 'break screen shows process');
  await c.keyboard.press('NumpadMultiply');
  await ev(() => openKeymap()); ok((await c.textContent('#keymapSheet')).includes('組立工程/A'), 'key sheet shows process'); await ev(() => closeKeymap());
  await ev(() => openDay()); ok((await c.textContent('#dayPaper .dr-proc')) === '組立工程/A', 'daily report header shows process'); await ev(() => closeDay());
  // バックアップのファイル名（使えない文字は除く）
  await ctx.addInitScript(() => { const o = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { window.__dl = this.download; return o.call(this); }; });
  await ev(() => { const o = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { window.__dl = this.download; return o.call(this); }; });
  const [d1] = await Promise.all([c.waitForEvent('download'), ev(() => saveBackup())]);
  const n1 = await ev(() => window.__dl);
  ok(/^不良カウンター_組立工程A_バックアップ_\d{8}_\d{4}\.json$/.test(n1), 'backup file name: ' + n1);
  const bk = JSON.parse(require('fs').readFileSync(await d1.path(), 'utf8'));
  ok(bk.state.process === '組立工程/A', 'backup contains process');
  // 共有フォルダ：名前が空なら工程名をファイル名に
  ok(await ev(() => { state.share.name = ''; return shareFileName(); }) === '不良数カウンター_データ_組立工程A.json', 'share file name uses process when name empty');
  ok(await ev(() => { state.share.name = 'L1'; return shareFileName(); }) === '不良数カウンター_データ_L1.json', 'share name overrides');
  // 実績グラフ・Excel
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push('report: ' + e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(500);
  ok((await r.textContent('#rpSub')).includes('組立工程/A') && (await r.textContent('#rpPanel h2')).includes('組立工程/A'), 'report slide header and panel show process');
  ok(await r.evaluate(() => document.title.startsWith('組立工程/A')), 'report tab title');
  const x = await r.evaluate(() => { rp.preset = 'today'; rpReload(); const sh = rpExportSheets().sheets; const cond = sh.find(s => s.name === '条件'), fl = sh.find(s => s.name === '転記用');
    return {cond:cond.rows.find(r => r[0] === '工程名'), head:fl.header, row:fl.rows[0]}; });
  ok(x.cond && x.cond[1] === '組立工程/A', 'Excel 条件 has 工程名');
  ok(x.head.join() === '日付,品種,項目,値,工程名' && x.row[4] === '組立工程/A', 'Excel 転記用: A-D unchanged, E = 工程名');
  const [d2] = await Promise.all([r.waitForEvent('download'), r.click('#rpExcel')]);
  const n2 = await r.evaluate(() => window.__dl);
  ok(/^不良実績_組立工程A_\d{8}-\d{8}_出力\d{8}_\d{4}\.xlsx$/.test(n2), 'Excel file name: ' + n2);
  // 閲覧用：ファイルの工程名を出す
  const v = await ctx.newPage(); v.on('pageerror', e => errs.push('view: ' + e.message)); await v.goto(URL + '#view'); await v.waitForTimeout(300);
  await v.evaluate(async j => { await viewRead(new File([j], 'x.json')); }, JSON.stringify({...bk, kind:'share', name:''}));
  await v.waitForTimeout(400);
  ok((await v.textContent('#viewBox')).includes('組立工程/A') && (await v.textContent('#rpSub')).includes('組立工程/A') && await v.evaluate(() => document.title.includes('組立工程/A')), 'view shows the file process name');
  // 工程名を消すと表示も消える
  await ev(() => { openSettings(); }); await c.fill('#processInput', ''); await c.click('#saveSettingsBtn');
  ok(await c.isHidden('#procName') && !(await c.locator('#jobBar .jb-proc').count()), 'clearing hides it again');
  console.log('errors', JSON.stringify(errs));
  await b.close();
})();
