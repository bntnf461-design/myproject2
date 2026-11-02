// Random stress test ("monkey test"): random keys and clicks on the counter and graph tabs,
// checking for JS errors and data invariants after every batch.
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const SEED = Number(process.argv[2] || 1), STEPS = Number(process.argv[3] || 1500);
let seed = SEED; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1600, height:1000}, acceptDownloads:true});
  const errs = [];
  const watch = (p, tag) => {
    p.on('pageerror', e => errs.push(`${tag} pageerror: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') errs.push(`${tag} console: ${m.text()}`); });
    p.on('dialog', d => (rnd() < 0.5 ? d.accept() : d.dismiss()).catch(() => {}));
  };
  const c = await ctx.newPage(); watch(c, 'counter'); await c.goto(URL);
  await c.evaluate(() => { state.features = {rate:true, reasons:true}; saveState(); }); await c.reload();
  const r = await ctx.newPage(); watch(r, 'report'); await r.goto(URL + '#report'); await r.waitForTimeout(300);
  const KEYS = ['Numpad1','Numpad2','Numpad3','Numpad4','Numpad5','Numpad6','Numpad9','Numpad0','NumpadEnter','NumpadSubtract',
    'NumpadMultiply','NumpadDecimal','NumpadDivide','NumpadAdd','Escape','Digit1','Enter','Shift+Digit8','Control+Minus','Space'];
  const bad = [];
  const check = async (step) => {
    const v = await c.evaluate(() => {
      const neg = Object.values(state.counts).some(n => n < 0);
      const replay = replayLog().filter(it => state.types.some(t => t.id === it.typeId)).length;
      let parsed = true; try { JSON.parse(localStorage.getItem('defectCounterState')); JSON.parse(localStorage.getItem('defectCounterHistory')); } catch (e) { parsed = false; }
      return {neg, total:total(), replay, parsed, nan:/NaN/.test(document.body.innerText)};
    }).catch(e => ({err:e.message}));
    if (v.err) { bad.push(`step ${step}: evaluate failed ${v.err}`); return; }
    if (v.neg) bad.push(`step ${step}: negative count`);
    if (v.total !== v.replay) bad.push(`step ${step}: total ${v.total} != replay ${v.replay}`);
    if (!v.parsed) bad.push(`step ${step}: storage not parseable`);
    if (v.nan) bad.push(`step ${step}: NaN on screen`);
  };
  for (let step = 1; step <= STEPS; step++) {
    try {
      const x = rnd();
      if (x < 0.62) { await c.bringToFront(); await c.keyboard.press(pick(KEYS)); }
      else if (x < 0.80) { // click a random visible button on the counter
        const btns = await c.$$('button:visible:not([data-lang])');
        if (btns.length) await pick(btns).click({timeout:500}).catch(() => {});
      } else if (x < 0.83) { // type into a visible input
        const ins = await c.$$('input[type=text]:visible, input[type=number]:visible, input[type=time]:visible');
        if (ins.length) await pick(ins).fill(pick(['', '0', '5', '123', 'テスト', '12:30', 'あ, い'])).catch(() => {});
      } else if (x < 0.95) { // report tab: random button or key (forwarded)
        await r.bringToFront();
        if (rnd() < 0.5) { const btns = await r.$$('#rpPanel button:visible:not([data-lang]):not(#rpView), .rp-controls button:visible'); if (btns.length) await pick(btns).click({timeout:500}).catch(() => {}); }
        else await r.keyboard.press(pick(KEYS));
      } else { // report tab: toggle a random checkbox / select
        const els = await r.$$('#rpPanel input[type=checkbox]:visible');
        if (els.length) await pick(els).click({timeout:500}).catch(() => {});
      }
    } catch (e) { bad.push(`step ${step}: action threw ${e.message.split('\n')[0]}`); }
    if (step % 50 === 0) await check(step);
  }
  await c.waitForTimeout(500); await check('end');
  const info = await c.evaluate(() => ({total:total(), hist:loadHist().d.length, stops:loadHist().w.length, running:state.downtime.running}));
  console.log(`seed ${SEED}, ${STEPS} steps -> counter total ${info.total}, history ops ${info.hist}, stops ${info.stops}`);
  console.log('invariant problems:', bad.length ? bad.slice(0, 10) : 'none');
  console.log('JS errors:', errs.length ? [...new Set(errs)].slice(0, 10) : 'none');
  await b.close();
})();
