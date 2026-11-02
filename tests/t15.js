const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1600, height:1000}, acceptDownloads:true}); await ctx.addInitScript(require('./nojobs.js'));
  const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); await c.goto(URL); await c.click('h1');
  const snap = () => c.evaluate(() => JSON.stringify({counts:state.counts, shifts:state.shifts, cur:state.currentShift, d:loadHist().d.length, w:loadHist().w.length, p:loadHist().p, rp:localStorage.getItem('defectCounterReport')}));

  // some data: counts, a stop, product settings, production, a report exclusion
  for (const k of ['Numpad1', 'Numpad1', 'Numpad2']) await c.keyboard.press(k);
  await c.evaluate(() => {
    const H = loadHist(); const t = Math.round(Date.now() / 1000) - 3600; H.w.push([t, t + 600, 0, 'wx', 0, '']); H.p[dkey(Date.now()) + '|製品A'] = 500;
    localStorage.setItem('defectCounterHistory', JSON.stringify(H)); hist = H;
    state.shifts = ['ラインA', 'ラインB']; state.currentShift = 'ラインB'; saveState();
    localStorage.setItem('defectCounterReport', JSON.stringify({preset:'7d', exDefect:['2026-09-01'], exDown:[]}));
  });
  const original = await snap();

  // backup from counter settings
  await c.evaluate(() => openSettings());
  ok((await c.textContent('#backupNote')).includes('まだバックアップしていません'), 'note says no backup yet');
  const [dl] = await Promise.all([c.waitForEvent('download'), c.click('#backupBtn')]);
  const bpath = 'xl_out/backup.json'; await dl.saveAs(bpath);
  const bk = JSON.parse(fs.readFileSync(bpath, 'utf8'));
  ok(bk.app === 'defect-counter-backup' && bk.hist.d.length === 3 && bk.state.currentShift === 'ラインB' && bk.report.exDefect[0] === '2026-09-01', 'backup file has history, settings and report settings');
  ok(/不良カウンター_バックアップ_\d{8}_\d{4}\.json/.test(dl.suggestedFilename()) || dl.suggestedFilename() === 'download', 'file name: ' + dl.suggestedFilename());
  ok((await c.textContent('#backupNote')).includes('今日'), 'note now shows today: ' + (await c.textContent('#backupNote')).slice(0, 40));
  await c.click('#cancelSettingsBtn');

  // wipe / change everything
  await c.evaluate(() => { localStorage.clear(); });
  await c.reload(); await c.click('h1'); await c.keyboard.press('Numpad3');
  ok(await snap() !== original, 'data changed after wipe');

  // invalid file is rejected
  fs.writeFileSync('xl_out/bad.json', '{"hello":1}');
  await c.evaluate(() => openSettings());
  let [fc] = await Promise.all([c.waitForEvent('filechooser'), c.click('#restoreBtn')]);
  await fc.setFiles('xl_out/bad.json'); await c.waitForTimeout(400);
  ok((await c.textContent('#toast')).includes('バックアップファイルではありません'), 'invalid file rejected: ' + await c.textContent('#toast'));

  // cancel at the confirmation keeps current data
  const before = await snap();
  c.once('dialog', d => d.dismiss());
  [fc] = await Promise.all([c.waitForEvent('filechooser'), c.click('#restoreBtn')]);
  await fc.setFiles(bpath); await c.waitForTimeout(500);
  ok(await snap() === before, 'cancel keeps current data');

  // restore: confirm -> auto-save of current data -> replace -> reload
  const dialogs = [];
  c.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  const downloads = []; c.on('download', d => downloads.push(d.suggestedFilename()));
  [fc] = await Promise.all([c.waitForEvent('filechooser'), c.click('#restoreBtn')]);
  await Promise.all([c.waitForEvent('load'), fc.setFiles(bpath)]);
  await c.waitForTimeout(300);
  ok(dialogs[0].includes('不良 3件') && dialogs[0].includes('設備停止 1件'), 'confirmation shows what will be restored');
  ok(downloads.length === 1, 'current data auto-saved before restore (' + downloads.join(',') + ')');
  ok(await snap() === original, 'restored data matches the backup exactly');
  ok(await c.inputValue('#shiftSelect') === 'ラインB', 'restored product selection shown');

  // report tab: backup + restore entry points
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push(e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(300);
  ok(/前回のバックアップ|まだバックアップしていません/.test(await r.textContent('#rpPanel')), 'report panel shows backup status: ' + ((await r.textContent('#rpPanel')).match(/(前回のバックアップ[^　]*|まだバックアップしていません)/) || [''])[0]);
  const [dl2] = await Promise.all([r.waitForEvent('download'), r.click('#rpBackup')]);
  ok(JSON.parse(fs.readFileSync(await dl2.path(), 'utf8')).hist.d.length === 3, 'report tab backup works');
  const [fc2] = await Promise.all([r.waitForEvent('filechooser'), r.click('#rpRestore')]);
  ok(!!fc2, 'report tab restore opens file picker');
  console.log('errors', errs);
  await b.close();
})();
