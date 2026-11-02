const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const snap = p => p.evaluate(() => JSON.stringify({shifts:state.shifts, cur:state.currentShift, types:state.types.map(t => [t.key, t.name, t.color]), unit:state.unit, sound:state.soundOn}));
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext(); await ctx.addInitScript(require('./nojobs.js'));
  await ctx.clock.install({time: new Date('2026-10-01T23:50:00')});
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.click('h1');
  // configure through the real settings screen
  await p.evaluate(() => openSettings());
  await p.fill('#shiftNamesInput', 'ライン1-製品X, ライン1-製品Y, 試作品Z');
  await p.fill('#unitInput', '個');
  await p.fill('#typeRows .typerow:first-child input[type=text]:not(.name-id)', 'キズ（外観）');
  await p.click('#saveSettingsBtn');
  await p.selectOption('#shiftSelect', '試作品Z');
  await p.click('#soundBtn'); // sound off
  const before = await snap(p);
  await p.click('h1');
  await p.keyboard.press('Numpad1'); await p.keyboard.press('Numpad2');
  // 1) manual reset
  await p.click('#resetBtn'); await p.waitForTimeout(300); await p.keyboard.press('NumpadMultiply');
  ok(await p.evaluate(() => total()) === 0, 'manual reset cleared counts');
  ok(await snap(p) === before, 'manual reset keeps products, current product, types, unit, sound');
  // 2) midnight auto reset
  await p.keyboard.press('Numpad1');
  await ctx.clock.runFor(12 * 60 * 1000);
  ok(await p.evaluate(() => total()) === 0, 'midnight reset cleared counts');
  ok(await snap(p) === before, 'midnight reset keeps settings');
  // 3) reload / next-day open
  await p.reload(); await p.waitForTimeout(200);
  ok(await snap(p) === before, 'settings still there after reopening');
  ok(await p.inputValue('#shiftSelect') === '試作品Z' && (await p.textContent('#shiftLabel')) === '試作品Z', 'selected product shown after reset');
  console.log('  settings:', before);
  console.log('errors', errs); await b.close();
})();
