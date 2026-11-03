// 製造種類の一覧・番号で選ぶ画面・作業開始/終了（＋キー）・入力の大きな表示
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1600, height:900}, acceptDownloads:true});
  const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push('counter: ' + e.message)); await c.goto(URL);
  const ev = f => c.evaluate(f);
  const keys = async (...ks) => { for (const k of ks) await c.keyboard.press(k); };

  // --- 待機画面（初めて開いたとき）
  ok(await ev(() => document.body.classList.contains('job-idle')) && await c.isVisible('#jobScreen'), 'opens on the full-screen waiting screen');
  ok((await c.textContent('#jobScreen')).includes('作業していません'), 'waiting screen says not working');
  await c.mouse.click(5, 5); await keys('Numpad1');
  ok(await ev(() => total()) === 0 && (await c.textContent('#toast')).includes('＋キーで作業を開始'), 'counting blocked while not working, with message');
  await keys('NumpadEnter');
  ok(!(await ev(() => state.downtime.running)), 'stop not started while not working');

  // --- 製造種類を一覧で登録（番号つき・番号なし・Excelのタブ区切り）
  await ev(() => openSettings());
  const list = ['101 部品A', '102\t部品B', '103：部品C', '試作品', ...Array.from({length:40}, (_, i) => `${200 + i} 量産品${i + 1}`)].join('\n');
  await c.fill('#shiftNamesInput', list + '\n105 部品A2\n105 重複');
  await c.click('#saveSettingsBtn');
  ok((await c.textContent('#settingsError')).includes('105'), 'duplicate number rejected');
  await c.fill('#shiftNamesInput', list);
  ok((await c.textContent('#shiftCount')).includes('44'), 'settings shows count of products (44)');
  await c.press('#shiftNamesInput', 'Enter');
  ok(await ev(() => settingsOpen), 'Enter in the list makes a new line (does not save)');
  await c.fill('#shiftNamesInput', list);
  await c.click('#saveSettingsBtn');
  const codes = await ev(() => shiftCodeMap());
  ok(codes['部品A'] === '101' && codes['部品B'] === '102' && codes['部品C'] === '103' && codes['試作品'] === '1' && codes['量産品40'] === '239', 'codes parsed, auto number for unnumbered ' + JSON.stringify([codes['試作品'], codes['量産品40']]));
  ok(await ev(() => state.shifts.length) === 44, '44 products saved');

  // --- ＋ → 番号で選ぶ → 作業開始
  await keys('NumpadAdd');
  ok(await ev(() => pickOpen) && await c.isVisible('#pickScreen'), '+ opens the full-screen picker');
  await keys('Numpad1', 'Numpad0');
  ok(await c.inputValue('#pkSearch') === '10' && await c.locator('.pk-item.hit').count() === 1, 'typed number shown, one highlighted');
  await keys('Numpad9', 'NumpadSubtract', 'Numpad2');
  ok((await c.textContent('.pk-item.hit')).includes('部品B'), '− deletes a digit; 102 highlights 部品B');
  await keys('NumpadEnter');
  ok(await ev(() => !state.job.running && nextShift === '部品B'), 'choosing only selects 部品B (job not started yet)');
  await keys('NumpadAdd');
  ok(await ev(() => state.job.running && state.job.shift === '部品B' && state.currentShift === '部品B'), 'job started with 部品B');
  ok(!(await ev(() => document.body.classList.contains('job-idle'))) && (await c.textContent('#jobBar')).includes('102'), 'waiting screen gone, job bar shows 102 部品B');
  ok(!(await ev(() => state.downtime.running)), 'Enter in picker did not start a stop');

  // --- 入力すると大きく表示・最近の入力
  await keys('Numpad1', 'Numpad1', 'Numpad2');
  ok(await ev(() => total()) === 3, 'counting works during the job');
  ok(await ev(() => $("inFlash").classList.contains('show')) && (await c.textContent('#inFlash')).includes('汚れ ＋1'), 'big flash shows what was input: ' + await c.textContent('#inFlash'));
  ok((await c.textContent('#recentInputs')).includes('汚れ +1') && (await c.textContent('#recentInputs')).includes('キズ +1'), 'recent inputs listed');
  await keys('Numpad0');
  ok((await c.textContent('#inFlash')).includes('元に戻す'), 'undo also shown big');
  await keys('Numpad2');
  await c.screenshot({path:'job_running.png'});

  // --- 作業中は製造種類を変えない
  await keys('NumpadDecimal');
  ok(!(await ev(() => pickOpen)) && (await c.textContent('#toast')).includes('作業中は製造種類を変えられません'), '. during a job is refused with message');

  // --- 停止中に作業終了 → 停止も終わる。＋は2回押しで確定
  await keys('NumpadEnter');
  ok(await ev(() => state.downtime.running), 'stop started');
  await c.waitForTimeout(1100);
  await keys('NumpadAdd');
  ok(await ev(() => !!confirmState) && (await c.textContent('#confirmMsg')).includes('部品B'), 'first + asks to confirm end');
  await keys('NumpadEnter');
  ok(await ev(() => state.job.running) && await ev(() => state.downtime.running), 'Enter cancels end (job and stop continue)');
  await keys('NumpadAdd'); await c.waitForTimeout(300); await keys('NumpadAdd');
  ok(!(await ev(() => state.job.running)) && !(await ev(() => state.downtime.running)), 'second + ends the job and the stop');
  const hj = await ev(() => hist.j);
  ok(hj.length === 1 && hj[0][1] > hj[0][0], 'job recorded in history');
  ok(await ev(() => hist.w.length) === 1, 'stop recorded when ending the job');
  const js = await c.textContent('#jobScreen');
  ok(js.includes('作業終了') && js.includes('部品B') && js.includes('不良 合計 3'), 'end screen shows summary');
  await c.screenshot({path:'job_end.png'});

  // --- 不良率オン：作業終了の画面でテンキーで生産数
  await ev(() => { state.features.rate = true; saveState(); renderAll(); });
  await keys('Numpad1', 'Numpad2', 'Numpad0', 'Numpad0', 'Numpad5', 'NumpadSubtract');
  ok((await c.textContent('#jobScreen .box')).includes('1,200'), 'production typed on the end screen');
  await keys('NumpadEnter');
  const day = await ev(() => dkey(Date.now()));
  ok(await ev(() => state.lastJob.prod) === 1200 && await c.evaluate(d => hist.p[d + '|部品B'], day) === 1200 && await ev(() => hist.j[0][4]) === 1200, 'production saved to job and day');
  ok((await c.textContent('#jobScreen')).includes('不良率 0.25%'), 'end screen shows rate 3/1200');
  await keys('Numpad1', 'Numpad0', 'Numpad0', 'Numpad0', 'NumpadEnter');
  ok(await c.evaluate(d => hist.p[d + '|部品B'], day) === 1000, 're-entering replaces the production (not added twice)');
  await c.screenshot({path:'job_end_prod.png'});

  // --- 名前で探す（マウス＋文字）
  await keys('NumpadAdd');
  await c.click('#pkSearch'); await c.keyboard.type('量産品3');
  const hits = await c.locator('.pk-item').count();
  ok(hits === 11, 'name search 量産品3 → 11 hits (3, 30-39): ' + hits);
  await c.keyboard.press('Enter'); await keys('NumpadAdd');
  ok(await ev(() => state.job.running && state.job.shift === '量産品3'), 'Enter in name box chooses the highlighted one, + starts it');
  ok(await ev(() => total()) === 0, 'new job starts counting from 0');
  await keys('Numpad3');
  await keys('NumpadAdd'); await c.waitForTimeout(300); await keys('NumpadAdd');
  // 作業数を入れずに ＋ → 1回目は知らせるだけ、2回目で次の作業へ
  ok((await c.textContent('#jobScreen')).includes('作業数を入れてください'), 'end screen asks for 作業数');
  await keys('NumpadAdd');
  ok(!(await ev(() => pickOpen)) && await ev(() => !!confirmState) && (await c.textContent('#confirmTitle')).includes('作業数'), 'first + without 作業数 asks to confirm');
  // いつもの「＋ 1 0 1 Enter」：確認中の数字は効かず、作業数に入らない
  await keys('Numpad1', 'Numpad0', 'Numpad1', 'NumpadEnter');
  ok(await ev(() => !confirmState && state.lastJob.prod == null && !pickOpen), 'digits in the confirm are ignored; Enter goes back (作業数 not set)');
  await keys('NumpadAdd'); await c.waitForTimeout(300); await keys('NumpadAdd');
  ok(await ev(() => pickOpen), '+ + skips 作業数 and opens the picker');
  await keys('Escape');
  // マウスでクリックして選ぶ
  await keys('NumpadAdd'); await c.waitForTimeout(300); await keys('NumpadAdd');
  ok((await c.textContent('.pk-sec')).includes('最近使った'), 'recently used shown first');
  await c.click('.pk-item[data-pick="部品C"]'); await c.click('.js-go');
  ok(await ev(() => state.job.shift) === '部品C', 'click on a product, then 作業開始 starts it');
  await keys('NumpadDivide');
  ok(await ev(() => menuOpen), '/ menu still works during a job');
  await keys('NumpadDivide');
  await keys('NumpadAdd'); await c.waitForTimeout(300); await keys('NumpadAdd');

  // --- 実績グラフ：作業ごとの一覧、Excelの作業一覧、テンキーの転送で作業開始
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push('report: ' + e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(400);
  await r.evaluate(() => { rp.preset = 'today'; rpSave(); rpReload(); rpShow(rpBuildSlides().findIndex(x => x.id === 'jobs'), false); });
  const jh = await r.evaluate(() => $("rpSlide").innerHTML);
  ok((jh.match(/<tr class="fd"/g) || []).length === 3 && jh.includes('部品B') && jh.includes('1,000'), 'report jobs slide lists 3 jobs with production');
  await r.screenshot({path:'job_report.png'});
  const [dl] = await Promise.all([r.waitForEvent('download'), r.click('#rpExcel')]);
  await dl.saveAs('xl_out/jobs.xlsx');
  await r.click('#rpPanelBtn'); // フォーカスは実績グラフ側
  for (const k of ['NumpadAdd', 'NumpadAdd', 'Numpad1', 'Numpad0', 'Numpad1', 'NumpadEnter', 'NumpadAdd']) { await r.keyboard.press(k); await r.waitForTimeout(300); }
  await c.waitForTimeout(300);
  ok(await ev(() => state.job.running && state.job.shift === '部品A'), 'numpad on the report tab starts a job (forwarded)');

  // --- テンキー配置表に ＋ の説明
  await c.bringToFront();
  await keys('NumpadDivide', 'Numpad8');
  ok((await c.textContent('#keymapSheet')).includes('作業開始'), 'key sheet shows + = 作業開始/終了');
  await keys('Escape');

  // --- 作業の記録をオフ：. で番号で選ぶ（切り替え）
  await ev(() => openSettings()); await c.uncheck('#featJobs'); await c.click('#saveSettingsBtn');
  ok(!(await ev(() => state.job.running)) && await ev(() => hist.j.length) === 4, 'turning jobs off ends the running job and keeps it');
  ok(!(await ev(() => document.body.classList.contains('job-idle'))), 'no waiting screen when jobs are off');
  await keys('Numpad1');
  ok(await ev(() => total()) === 1, 'counting works without jobs');
  await keys('NumpadDecimal', 'Numpad1', 'Numpad0', 'Numpad3', 'NumpadEnter');
  ok(await ev(() => state.currentShift) === '部品C' && await ev(() => total()) === 1, '. picker switches product by number, counts kept');
  console.log('errors', errs);
  await b.close();
})();
