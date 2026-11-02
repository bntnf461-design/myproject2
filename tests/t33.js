// 全体の点検：30日分の現実的なデータで、すべての画面とExcelに NaN・undefined などが出ないか、数字が画面どうしで食い違わないかを確かめる
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const URL = 'file:///home/user/myproject2/defect-counter.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const BAD = /NaN|undefined|Infinity|\[object Object\]|\bnull\b/;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1600, height:900}}); const errs = [];
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push('counter: ' + e.message)); await c.goto(URL); await c.waitForTimeout(300);
  // ---- データを作る（作業・不良・停止（24時またぎ含む）・休憩・計画・生産数・稼働時間・修正・取消）
  await c.evaluate(() => {
    const shifts = ['製品A', '製品B', '製品C'];
    state.shifts = shifts; state.shiftCodes = {'製品A':'101', '製品B':'102', '製品C':'103'};
    state.features = {rate:true, reasons:true, avail:true, jobs:true}; saveState();
    const H = newHist(); state.types.forEach(t => { H.types[t.id] = {n:t.name, c:t.color}; }); H.shifts = shifts.slice();
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const reasons = state.stopReasons;
    for (let day = 30; day >= 1; day--) {
      const k = daddDays(dkey(Date.now()), -day);
      if (day % 7 === 0) { H.op[k] = 0; continue; } // 休み
      if (day % 5 === 0) H.op[k] = 450;
      const plan = [[0, '08:00', '12:00'], [1, '13:00', '17:00'], ...(day % 3 === 0 ? [[2, '17:00', '23:30']] : [])];
      plan.forEach(([si, a, z], pi) => {
        const s0 = atDay(k, a) / 1000, e0 = atDay(k, z) / 1000 + (si === 2 && day % 6 === 0 ? 3 * 3600 : 0); // 24時をまたぐ作業
        const prod = 400 + Math.round(rnd() * 500);
        H.j.push([s0, e0, si, 'j' + day + si, day % 4 === 0 && si === 1 ? null : prod]);
        if (!(day % 4 === 0 && si === 1)) H.p[k + '|' + shifts[si]] = (H.p[k + '|' + shifts[si]] || 0) + prod;
        if (day % 2) H.pl[k + '|' + shifts[si]] = 500;
        const n = Math.round(prod * (0.005 + rnd() * 0.02));
        for (let i = 0; i < n; i++) H.d.push([Math.round(s0 + rnd() * (e0 - s0)), 't' + (1 + Math.floor(rnd() * 5)), 1, si, 0]);
        if (rnd() < 0.3) H.d.push([Math.round(s0 + 600), 't1', -1, si, 0]); // 取消
        if (rnd() < 0.2) H.d.push([atDay(k, '12:00') / 1000, 't2', 1, si, 2]); // 修正で追加
        for (let j = 0; j < Math.floor(rnd() * 3); j++) { const st = Math.round(s0 + 900 + rnd() * (e0 - s0 - 4000)); H.w.push([st, st + Math.round((3 + rnd() * 40) * 60), si, 'w' + day + si + j, 0, rnd() < 0.8 ? reasons[Math.floor(rnd() * reasons.length)] : '']); }
        H.b.push([s0 + 7200, s0 + 7200 + 600, si, 'b' + day + si]);
        if (si === 2 && day % 6 === 0) H.w.push([atDay(k, '23:40') / 1000, atDay(k, '23:40') / 1000 + 50 * 60, si, 'wm' + day, 0, '故障']); // 24時またぎの停止
      });
    }
    H.d.sort((a, x) => a[0] - x[0]); H.w.sort((a, x) => a[0] - x[0]);
    localStorage.setItem('defectCounterHistory', JSON.stringify(H)); hist = loadHist();
    localStorage.setItem('defectCounterReport', JSON.stringify({kpi:{defDay:20, rate:2, downDay:30, avail:90}}));
    // 今日：作業中・不良・停止中
    startJob('製品A'); state.job.start = new Date(Date.now() - 2 * 3600000).toISOString(); saveState();
  });
  await c.mouse.click(5, 5);
  for (const k of ['Numpad1', 'Numpad2', 'Numpad2', 'Numpad3', 'NumpadSubtract', 'Numpad2', 'Numpad0', 'Numpad1']) { await c.keyboard.press(k); await c.waitForTimeout(40); }
  await c.keyboard.press('NumpadEnter'); await c.waitForTimeout(1100);
  // カウンター画面
  const ctext = await c.evaluate(() => document.body.innerText);
  ok(!BAD.test(ctext), 'counter screen text clean' + (BAD.test(ctext) ? ': ' + ctext.match(new RegExp('.{0,30}(' + BAD.source + ').{0,30}'))[0] : ''));
  await c.keyboard.press('NumpadEnter');
  // 今日の目標の不良数 ＝ 日報の不良数 ＝ 画面の合計（今日の作業のみ）
  const t = await c.evaluate(() => { kpiSig = ''; renderKpi(); const k = dkey(Date.now()); return {kpi:todayStats().def, day:dayData(k).items.length, tot:total()}; });
  ok(t.kpi === t.day && t.day === t.tot, 'today: KPI defects = daily report = counter total: ' + JSON.stringify(t));

  // ---- 実績グラフ：すべての期間 × スライド
  const r = await ctx.newPage(); r.on('pageerror', e => errs.push('report: ' + e.message)); await r.goto(URL + '#report'); await r.waitForTimeout(500);
  const slideBad = await r.evaluate(async () => {
    const bad = [];
    for (const preset of ['today', 'yesterday', '7d', '30d', 'thisMonth', 'all']) for (const split of [true, false]) {
      rp.preset = preset; rp.split = split; rpReload(); rpBuildSlides();
      for (let i = 0; i < rpSlides.length; i++) { rpShow(i, false); const el = document.getElementById('rpSlide') || document.querySelector('.rp-slide'); const tx = el ? el.innerText : ''; if (/NaN|undefined|Infinity|\[object Object\]|\bnull\b/.test(tx)) bad.push(preset + '/' + split + '/' + (rpSlides[i].id || i) + ': ' + tx.match(/.{0,25}(NaN|undefined|Infinity|\[object Object\]|\bnull\b).{0,25}/)[0]); }
    }
    rpRenderPanel(); const pt = document.getElementById('rpPanel').innerText; if (/NaN|undefined|Infinity/.test(pt)) bad.push('panel');
    return bad;
  });
  ok(!slideBad.length, 'all report slides × 6 periods × split clean ' + slideBad.slice(0, 3).join(' | '));

  // ---- Excel：中身の点検と、表どうしの一致
  const xl = await r.evaluate(() => {
    rp.preset = '30d'; rp.split = true; rpReload();
    const sh = rpExportSheets().sheets, bad = [], val = v => v && typeof v === 'object' ? (v.dec ?? v.date ?? v.dt ?? null) : v;
    sh.forEach(s => s.rows.forEach((row, i) => row.forEach((v, j) => { const x = val(v); if (x === undefined || (typeof x === 'number' && !Number.isFinite(x)) || /NaN|undefined|Infinity/.test(String(x))) bad.push(`${s.name} ${i + 2}行 ${s.header[j]}=${x}`); if (typeof x === 'number' && x < 0) bad.push(`${s.name} ${i + 2}行 ${s.header[j]} が負 ${x}`); if (row.length !== s.header.length) bad.push(`${s.name} ${i + 2}行 列数 ${row.length}≠${s.header.length}`); })));
    const D = sh.find(s => s.name === '日別集計'), S = sh.find(s => s.name === '日別×品種'), F = sh.find(s => s.name === '転記用');
    const mism = [], col = (s, n) => s.header.indexOf(n), num = v => typeof val(v) === 'number' ? val(v) : 0;
    D.rows.forEach(dr => {
      const k = dkey(dr[0].date), rows = S.rows.filter(x => dkey(x[0].date) === k);
      ['不良合計(件)', '停止回数', '停止時間(分)', '休憩(分)', '生産数', '良品数', '計画数'].forEach(n => {
        const a = num(dr[col(D, n)]), b2 = Math.round(rows.reduce((t, x) => t + num(x[col(S, n)]), 0) * 10) / 10;
        if (col(D, n) >= 0 && Math.abs(a - b2) > 0.11) mism.push(`${k} ${n}: 日別${a} ≠ 品種計${b2}`);
      });
      const p = num(dr[col(D, '生産数')]), g = num(dr[col(D, '良品数')]);
      if (p && dr[col(D, '良品数')] !== '' && g > p) mism.push(`${k} 良品数>生産数`);
      // 転記用（全品種）＝日別集計
      ['不良合計', '生産数', '良品数', '停止回数'].forEach(n => { const fr = F.rows.find(x => dkey(x[0].date) === k && x[1] === '全品種' && x[2] === n); const dv = dr[col(D, n === '不良合計' ? '不良合計(件)' : n)]; if (fr && num(fr[3]) !== num(dv)) mism.push(`${k} 転記用 ${n} ${num(fr[3])}≠${num(dv)}`); });
    });
    // 良品数 ＝ 生産数 − 不良（生産数のある日・品種）
    S.rows.forEach(x => { const p = num(x[col(S, '生産数')]), g = x[col(S, '良品数')], d = num(x[col(S, '不良合計(件)')]); if (p > 0 && g !== '' && num(g) !== Math.max(0, p - d)) mism.push(`${dkey(x[0].date)} ${x[2]} 良品数 ${num(g)}≠${p}-${d}`); });
    return {bad, mism, days:D.rows.length};
  });
  ok(!xl.bad.length, 'Excel cells clean (no NaN/undefined/negative, column counts match) ' + xl.bad.slice(0, 4).join(' | '));
  ok(!xl.mism.length, `Excel sheets agree (日別集計 = Σ日別×品種, 転記用, 良品数) over ${xl.days} days ` + xl.mism.slice(0, 4).join(' | '));

  // ---- 日報（10日分 × 全品種・品種ごと）と Excel の一致
  const dr = await r.evaluate(() => {
    const bad = [], mism = [];
    rp.preset = '30d'; rpReload();
    const S = rpExportSheets().sheets.find(s => s.name === '日別集計'), col = n => S.header.indexOf(n), num = v => v && typeof v === 'object' ? (v.dec ?? 0) : (typeof v === 'number' ? v : 0);
    for (let i = 1; i <= 12; i++) {
      const k = daddDays(dkey(Date.now()), -i), D = dayData(k);
      [''].concat(dayProducts(D)).forEach(o => { const tx = (() => { const d = document.createElement('div'); d.innerHTML = dayHtml(k, o); return d.textContent; })(); if (/NaN|undefined|Infinity|\[object Object\]|\bnull\b/.test(tx)) bad.push(k + '/' + (o || '全') + ': ' + tx.match(/.{0,25}(NaN|undefined|Infinity|\bnull\b).{0,25}/)[0]); });
      const row = S.rows.find(x => dkey(x[0].date) === k); if (!row) continue;
      if (num(row[col('不良合計(件)')]) !== D.items.length) mism.push(`${k} 不良 日報${D.items.length}≠Excel${num(row[col('不良合計(件)')])}`);
      if (num(row[col('停止回数')]) !== D.downCount) mism.push(`${k} 停止回数 日報${D.downCount}≠Excel${num(row[col('停止回数')])}`);
      if (Math.abs(num(row[col('停止時間(分)')]) - Math.round(D.downMs / 6000) / 10) > 0.11) mism.push(`${k} 停止時間 ${num(row[col('停止時間(分)')])}≠${Math.round(D.downMs / 6000) / 10}`);
      if (col('生産数') >= 0 && num(row[col('生産数')]) !== D.prod) mism.push(`${k} 生産数 日報${D.prod}≠Excel${num(row[col('生産数')])}`);
      // 品種別を足すと全品種
      const sum = dayProducts(D).reduce((a, o) => { const x = dayData(k, o); return {d:a.d + x.items.length, p:a.p + x.prod, w:a.w + x.downCount}; }, {d:0, p:0, w:0});
      if (sum.d !== D.items.length || sum.p !== D.prod || sum.w !== D.downCount) mism.push(`${k} 品種別の合計≠全品種 ${JSON.stringify(sum)} vs ${D.items.length}/${D.prod}/${D.downCount}`);
    }
    return {bad, mism};
  });
  ok(!dr.bad.length, 'daily reports (12 days × all/each product) clean ' + dr.bad.slice(0, 3).join(' | '));
  ok(!dr.mism.length, 'daily report = Excel, Σ products = all ' + dr.mism.slice(0, 4).join(' | '));

  // ---- 生産計画・生産数の表（5週）と記録の修正（10日）
  const sh = await c.evaluate(() => {
    const bad = [], mism = []; openPlan();
    for (let w = 0; w < 5; w++) {
      const tx = document.getElementById('planBody').innerText; if (/NaN|undefined|Infinity|\bnull\b/.test(tx)) bad.push('week ' + planWeek);
      // 表の日の合計 ＝ 記録
      document.querySelectorAll('#planBody tbody').forEach(tb => { const k = tb.querySelector('tr').dataset.k; const D = dayData(k);
        const rows = [...tb.querySelectorAll('tr[data-sh]')]; const p = rows.reduce((a, r) => a + (Number(r.querySelector('[data-f="p"]').value) || 0), 0);
        if (p !== D.prod) mism.push(`${k} 表の生産数${p}≠${D.prod}`); });
      document.getElementById('planPrev').click();
    }
    closePlan();
    for (let i = 0; i < 10; i++) { openFix(daddDays(dkey(Date.now()), -i)); const tx = document.getElementById('fixBody').innerText; if (/NaN|undefined|Infinity|\bnull\b/.test(tx)) bad.push('fix ' + i); closeFix(); }
    return {bad, mism};
  });
  ok(!sh.bad.length, 'plan sheet (5 weeks) and fix screen (10 days) clean ' + sh.bad.join(' | '));
  ok(!sh.mism.length, 'sheet day totals = records ' + sh.mism.slice(0, 3).join(' | '));
  console.log('errors', JSON.stringify(errs));
  await b.close();
})();
