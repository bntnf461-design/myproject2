const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1600, height:1000}, acceptDownloads:true}); await ctx.addInitScript(require('./nojobs.js'));
  { const n = new Date(); await ctx.clock.install({time:new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 0)}); } // 夜中に動かしても「2時間前」が前の日にならないよう、今日の正午から始める
  const errs = [];
  const mk = async u => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(p.url().slice(-7) + ': ' + e.message)); await p.goto(u); return p; };
  const spy = p => p.evaluate(() => { window.__tones = []; const orig = window.playTone; window.playTone = (...a) => { window.__tones.push(a); orig(...a); }; });
  const c = await mk(URL); await c.click('h1'); await spy(c);

  // ---- sound ----
  await c.keyboard.press('Numpad1');
  let tones = await c.evaluate(() => window.__tones);
  ok(tones.length === 1 && tones[0][0] === 880 && tones[0][3] === 0.12, 'count plays tone at mid volume: ' + JSON.stringify(tones));
  ok(await c.evaluate(() => audioCtx && audioCtx.state), 'audio context created: ' + await c.evaluate(() => audioCtx && audioCtx.state));
  await c.keyboard.press('NumpadEnter'); await c.keyboard.press('NumpadEnter');
  tones = await c.evaluate(() => window.__tones.slice(1));
  ok(tones.length === 3 && tones[2][2] === 0.12, 'resume chime scheduled in audio time (no setTimeout)');
  // settings: volume high, test button
  await c.evaluate(() => openSettings());
  ok(await c.isChecked('#soundOnInput') && await c.inputValue('#volumeInput') === 'mid', 'settings show sound on / 中');
  await c.selectOption('#volumeInput', 'high');
  await c.evaluate(() => { window.__tones = []; });
  await c.click('#soundTestBtn');
  ok((await c.evaluate(() => window.__tones)).length === 3 && (await c.evaluate(() => window.__tones[0][3])) === 0.25, 'test button plays at chosen volume');
  await c.click('#saveSettingsBtn');
  await c.evaluate(() => { window.__tones = []; }); await c.click('h1'); await c.keyboard.press('Numpad2');
  ok((await c.evaluate(() => window.__tones[0][3])) === 0.25, 'counts use saved volume (大)');
  // sound off
  await c.evaluate(() => { openSettings(); }); await c.uncheck('#soundOnInput'); await c.click('#saveSettingsBtn');
  await c.evaluate(() => { window.__tones = []; }); await c.click('h1'); await c.keyboard.press('Numpad2');
  ok((await c.evaluate(() => window.__tones)).length === 0 && (await c.textContent('#soundBtn')) === '🔇', 'sound off: silent, icon 🔇');
  await c.click('#soundBtn');

  // forwarded keys: the graph tab plays the tone
  const r = await mk(URL + '#report'); await r.waitForTimeout(300); await spy(r);
  await c.evaluate(() => { window.__tones = []; });
  await r.keyboard.press('Numpad3'); await r.waitForTimeout(500);
  ok((await r.evaluate(() => window.__tones)).length === 1 && (await c.evaluate(() => window.__tones)).length === 0, 'count sent from graph tab beeps in graph tab (not counter)');
  await r.keyboard.press('Numpad9'); await r.waitForTimeout(500);
  ok((await r.textContent('#rpKeyNote')).includes('割り当てられていません'), 'counter message shown in graph tab: ' + await r.textContent('#rpKeyNote'));

  // ---- optional features: off by default ----
  ok(await c.isHidden('#rateLabel'), 'rate label hidden by default');
  await c.click('h1'); await c.keyboard.press('NumpadEnter');
  ok(await c.isHidden('#ssReasons'), 'stop reasons hidden by default');
  await c.keyboard.press('NumpadEnter');
  ok(!(await r.evaluate(() => SLIDES.filter(slideAvailable).some(s => s.feature))), 'feature slides not offered by default');

  // turn both on
  await c.evaluate(() => openSettings());
  await c.check('#featRate'); await c.check('#featReasons');
  await c.evaluate(() => { draftReasons = draftReasons.slice(0, 3); renderReasonRows(); });
  await c.click('#saveSettingsBtn');
  ok(await c.isVisible('#rateLabel') && (await c.textContent('#rateLabel')).includes('未入力'), 'rate label appears: ' + await c.textContent('#rateLabel'));

  // production entry via label -> production input screen (today / current product), Enter saves and closes
  await c.click('#rateLabel');
  await c.keyboard.type('1000'); await c.keyboard.press('Enter');
  const tot = await c.evaluate(() => total());
  ok((await c.textContent('#rateLabel')).includes(`不良率 ${(tot / 1000 * 100).toFixed(2)}%`), 'counter shows defect rate: ' + await c.textContent('#rateLabel'));
  await c.evaluate(() => openFix(dkey(Date.now())));
  ok((await c.textContent('#fixBody')).includes('%'), 'editor shows rate per product');
  await c.click('#fixClose');

  // stop with reason
  await c.click('h1'); await c.keyboard.press('NumpadEnter');
  ok(await c.isVisible('#ssReasons') && (await c.$$('#ssReasons button')).length === 3, 'stop screen shows 3 reason buttons');
  await c.click('#ssReasons button[data-reason="故障"]');
  ok(await c.evaluate(() => state.downtime.reason) === '故障' && await c.getAttribute('#ssReasons button[data-reason="故障"]', 'class') === 'on', 'reason 故障 selected');
  await c.waitForTimeout(1200); // timer ticks must not rebuild/lose selection
  ok(await c.getAttribute('#ssReasons button[data-reason="故障"]', 'class') === 'on', 'selection survives timer refresh');
  await c.keyboard.press('NumpadEnter');
  ok(await c.evaluate(() => { const w = loadHist().w; return w[w.length - 1][5]; }) === '故障', 'reason stored in history');
  // change reason in editor + add stop with reason
  await c.click('#fixBtn');
  await c.locator('#fixBody tr[data-di] select[data-dr]').last().selectOption('段取り');
  ok(await c.evaluate(() => { const w = loadHist().w; return w[w.length - 1][5]; }) === '段取り', 'reason changed in editor');
  const hh = off => c.evaluate(o => { const d = new Date(Date.now() - o * 60000); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }, off);
  await c.fill('#fxAddS', await hh(200)); await c.fill('#fxAddE', await hh(170)); await c.selectOption('#fxAddR', '材料待ち'); await c.click('#fxAddBtn');
  ok(await c.evaluate(() => loadHist().w.some(w => w[5] === '材料待ち')), 'added stop keeps reason');
  await c.click('#fixClose');

  // report slides
  await r.bringToFront(); await r.reload(); await r.waitForTimeout(400);
  const ids = await r.evaluate(() => rpBuildSlides().map(s => s.id));
  ok(ids.includes('rate') && ids.includes('reasons'), 'report offers rate and reasons slides: ' + ids.join(','));
  const txt = {};
  for (const id of ['summary', 'rate', 'reasons']) {
    txt[id] = await r.evaluate(id => { rpPlaying = false; rpShow(rpSlides.findIndex(s => s.id === id), false); return document.querySelector('#rpSlide').innerText.replace(/\s+/g, ' '); }, id);
    await r.screenshot({path:`feat_${id}.png`});
  }
  ok(txt.summary.includes('不良率'), 'summary shows 不良率 card');
  ok(txt.reasons.includes('段取り') && txt.reasons.includes('材料待ち'), 'reasons slide lists reasons');
  await r.evaluate(() => { rp.shifts = null; rp.preset = '7d'; });
  const [dl] = await Promise.all([r.waitForEvent('download'), r.click('#rpExcel')]);
  await dl.saveAs('xl_out/features.xlsx');

  // turn off -> hidden again, data kept
  await c.bringToFront(); await c.evaluate(() => openSettings()); await c.uncheck('#featRate'); await c.uncheck('#featReasons'); await c.click('#saveSettingsBtn');
  ok(await c.isHidden('#rateLabel'), 'turning off hides rate label');
  ok(await c.evaluate(() => Object.keys(loadHist().p).length === 1 && loadHist().w.some(w => w[5])), 'production and reasons kept when turned off');
  console.log('errors', errs);
  await b.close();
})();
