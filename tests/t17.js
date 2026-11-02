const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1600, height:1000}}); await ctx.addInitScript(require('./nojobs.js'));
  const errs = [];
  const c = await ctx.newPage(); await c.goto(URL);
  await c.evaluate(() => { // 7 days of data
    const H = {v:1, shifts:['製品A'], types:{}, d:[], w:[], p:{}};
    for (let d = 0; d < 7; d++) { const t = atDay(daddDays(dkey(Date.now()), -d), '09:00') / 1000; for (let i = 0; i < 20 + d; i++) H.d.push([t + i * 60, ['t1', 't2', 't3'][i % 3], 1, 0, 0]); }
    localStorage.setItem('defectCounterHistory', JSON.stringify(H));
  });
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push(e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(300);
  await r.click('#rpPlay'); // pause auto-advance
  const show = id => r.evaluate(id => rpShow(rpBuildSlides().findIndex(s => s.id === id)), id);
  const anims = () => r.evaluate(() => { const a = document.getElementById('rpSlide').getAnimations({subtree:true}); return {n:a.length, rates:[...new Set(a.map(x => x.playbackRate))]}; });

  ok(await r.evaluate(() => rp.anim) === 'normal', 'default is あり (normal)');
  ok(await r.getAttribute('button[data-anim="normal"]', 'class') === 'on', 'あり button highlighted');
  await show('daily');
  let a = await anims();
  ok(a.n > 0 && a.rates.join() === '1', `normal: bars animate at normal speed (${a.n} animations)`);

  await r.click('button[data-anim="slow"]');
  a = await anims();
  ok(a.n > 0 && a.rates.join() === '0.5', 'ゆっくり: current slide replays at half speed');
  await show('pie'); a = await anims();
  ok(a.rates.join() === '0.5', 'ゆっくり applies to next slides too (donut)');
  const midSlow = await r.evaluate(() => new Promise(res => setTimeout(() => res(Number(document.querySelector('#rpSlide [data-count]') ? 0 : -1)), 10)));

  await r.click('button[data-anim="off"]');
  ok(await r.evaluate(() => document.getElementById('rpSlide').classList.contains('no-anim')), 'なし: slide rendered without motion');
  await show('summary');
  const first = await r.evaluate(() => document.querySelector('#rpSlide [data-count]').textContent);
  const target = await r.evaluate(() => document.querySelector('#rpSlide [data-count]').dataset.count);
  ok(first === target, `なし: numbers show final value immediately (${first})`);
  await show('daily');
  const running = await r.evaluate(() => document.getElementById('rpSlide').getAnimations({subtree:true}).filter(x => x.playState === 'running').length);
  ok(running === 0, 'なし: no running animations on bar chart');
  await r.screenshot({path:'anim_off.png'});

  await r.reload(); await r.waitForTimeout(300);
  ok(await r.evaluate(() => rp.anim) === 'off' && await r.getAttribute('button[data-anim="off"]', 'class') === 'on', 'setting remembered after reopening');
  // back to normal: summary count-up starts from 0
  await r.click('#rpPlay');
  await r.click('button[data-anim="normal"]');
  await show('summary');
  const early = await r.evaluate(() => document.querySelector('#rpSlide [data-count]').textContent);
  ok(Number(early) < Number(target), `あり: numbers count up again (starts at ${early})`);
  await r.evaluate(() => { document.querySelector('#rpPanel').scrollTop = 0; });
  await r.locator('.rp-sec', {hasText:'グラフの動き'}).screenshot({path:'anim_setting.png'});
  console.log('errors', errs);
  await b.close();
})();
