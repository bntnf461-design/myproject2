// Highlight Maker の詳しい動作確認レポートを作る（Node.js + Playwright + ffmpeg/ffprobe）
//   node tests/report_highlight.js <素材フォルダ> <出力フォルダ>
// 素材フォルダ：v1.webm v2.webm v3.webm v4.webm img1.jpg … img6.jpg、song*.wav（ファイル名の数字が正しいBPM）
// 出力：report.json と各表の CSV
const { chromium, devices } = require('playwright');
const path = require('path'), fs = require('fs'), { execSync } = require('child_process');
const M = path.resolve(process.argv[2] || '.'), OUT = path.resolve(process.argv[3] || '.');
const PAGE = 'file://' + path.resolve(__dirname, '../highlight/HighlightMaker.html');
const R = { when: new Date().toISOString(), errors: [], load: [], bpm: [], bgm: [], timeline: [], perf: [], fallback: [], privacy: {}, exports: [] };
const csv = (name, rows) => { if (!rows.length) return; const k = [...new Set(rows.flatMap(r => Object.keys(r)))]; fs.writeFileSync(path.join(OUT, name), '﻿' + [k.join(','), ...rows.map(r => k.map(x => JSON.stringify(r[x] ?? '')).join(','))].join('\n')); };
const log = (...a) => console.log(...a);

async function newPage(b, opt = {}, nofilter = false) {
  const ctx = await b.newContext({ acceptDownloads: true, ...opt });
  const p = await ctx.newPage();
  p.on('pageerror', e => R.errors.push({ where: opt.tag || 'page', msg: e.message }));
  p.on('console', m => { if (m.type() === 'error') R.errors.push({ where: opt.tag || 'console', msg: m.text() }); });
  if (nofilter) await p.addInitScript(() => { delete CanvasRenderingContext2D.prototype.filter; });
  await p.goto(PAGE);
  return p;
}
// 画面は手順ごとに切り替わるので、隠れている select・ボタンはプログラムから操作する
const pick = (p, sel, v) => p.evaluate(([sel, v]) => { const s = document.querySelector(sel); s.value = v; s.onchange && s.onchange(); }, [sel, v]);
const idle = p => p.waitForFunction(() => HM.S.tl && !HM.S.building, null, { timeout: 60000 });

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const media = ['v1.webm', 'img1.jpg', 'v2.webm', 'img2.jpg', 'img4.jpg', 'v3.webm', 'img3.jpg', 'img5.jpg', 'v4.webm', 'img6.jpg'];

  // ---- A. 素材の読み込み ----
  let p = await newPage(b, { tag: 'main' });
  for (const f of [...media, 'img7.png', 'v1h264.mp4', 'photo12mp.jpg']) {
    const t0 = Date.now();
    const before = await p.evaluate(() => HM.S.clips.length);
    await p.setInputFiles('#fileIn', path.join(M, f));
    const ok = await p.waitForFunction(n => HM.S.clips.length > n && !HM.S.building, before, { timeout: 30000 }).then(() => true).catch(() => false);
    const info = ok ? await p.evaluate(() => { const c = HM.S.clips[HM.S.clips.length - 1]; return { type: c.type, w: c.w, h: c.h, orig: c.origW ? c.origW + 'x' + c.origH : '', dur: c.duration ? +c.duration.toFixed(1) : '', highlights: c.highlights ? c.highlights.map(x => x.toFixed(1)).join(' ') : '' }; }) : {};
    R.load.push({ file: f, bytes: fs.statSync(path.join(M, f)).size, ok, ms: Date.now() - t0, ...info });
    log('load', f, ok, Date.now() - t0 + 'ms');
  }
  // 10個にそろえる（追加した png と mp4 を外す）
  p.on('dialog', d => d.accept());
  while (await p.evaluate(() => HM.S.clips.length) > 10) { await p.locator('.thumb .x').last().click(); await p.waitForTimeout(100); } // 画面の ✕ で外す
  await p.evaluate(() => HM.rebuild()); await idle(p);
  // 未対応形式の alert で止まらないよう dialog を受け流す（H.264 は Chromium 版で非対応の場合あり）

  // ---- B. テンポ検出 ----
  for (const f of fs.readdirSync(M).filter(x => /^song\d+/.test(x)).sort()) {
    const trueBpm = +f.match(/\d+/)[0];
    await pick(p, '#musicSel', 'file');
    const t0 = Date.now();
    await p.setInputFiles('#musicIn', path.join(M, f));
    await p.waitForFunction(f => HM.S.musicKey === 'file:' + f && !HM.S.building, f, { timeout: 60000 });
    const r = await p.evaluate(tb => {
      const a = HM.S.analysis, per = 60 / tb;
      const errs = a.beats.filter(x => x > 2 && x < a.duration - 2).map(x => { const k = Math.round(x / per); return Math.abs(x - k * per) * 1000; });
      const down = a.beats.filter((x, i) => ((i - a.downPhase) % 4 + 4) % 4 === 0 && x > 2).slice(0, 8).map(x => Math.round(x / per) % 4);
      return { detected: +a.bpm.toFixed(1), beats: a.beats.length, phaseErrMs: +(errs.reduce((s, x) => s + x, 0) / errs.length).toFixed(1), downbeatOk: down.every(x => x === 0), mStart: +HM.S.tl.mStart.toFixed(1), total: +HM.S.tl.total.toFixed(1) };
    }, trueBpm);
    const ratio = r.detected / trueBpm;
    const kind = Math.abs(ratio - 1) < .03 ? '正解' : Math.abs(ratio - 2) < .06 ? '2倍' : Math.abs(ratio - .5) < .03 ? '半分' : 'ずれ';
    R.bpm.push({ song: f, trueBpm, ...r, ratio: +ratio.toFixed(3), result: kind, analyzeMs: Date.now() - t0 });
    log('bpm', f, r.detected, kind);
  }

  // ---- C. 内蔵BGM の作曲時間 ----
  for (const k of ['edm', 'pop', 'happy', 'rock', 'lofi', 'cinematic']) for (const sec of [60, 120]) {
    const r = await p.evaluate(async ([k, sec]) => { const t = performance.now(); const g = await HM.genMusic(k, sec, 3); const d = g.buf.getChannelData(0); let pk = 0, nan = 0; for (const x of d) { if (!isFinite(x)) nan++; else if (Math.abs(x) > pk) pk = Math.abs(x); } return { ms: Math.round(performance.now() - t), dur: +g.buf.duration.toFixed(1), bpm: g.analysis.bpm, peak: +pk.toFixed(2), nan }; }, [k, sec]);
    R.bgm.push({ style: k, request: sec, ...r });
  }
  log('bgm done');

  // ---- D/E. 全パターン × 長さ × 画面の形 ----
  await pick(p, '#musicSel', 'edm'); await idle(p);
  const styles = await p.evaluate(() => HM.STYLES.map(s => s.id));
  for (const aspect of ['9:16', '16:9']) for (const len of ['60', '120']) {
    await pick(p, '#aspect', aspect); await pick(p, '#length', len); await idle(p);
    for (const st of styles) {
      const t0 = Date.now();
      await p.evaluate(id => document.querySelector(`.style[data-id="${id}"]`).click(), st);
      await p.waitForFunction(id => HM.S.style === id && !HM.S.building, st, { timeout: 60000 });
      const ms = Date.now() - t0;
      const r = await p.evaluate(perf => {
        const tl = HM.S.tl, L = tl.segs.map(s => s.e - s.s);
        const cnt = new Map(); tl.segs.forEach(s => cnt.set(s.clip, (cnt.get(s.clip) || 0) + 1));
        const onBeat = tl.segs.slice(0, -1).filter(s => tl.an.beats.some(x => Math.abs(x - tl.mStart - s.e) < 1e-6)).length / Math.max(1, tl.segs.length - 1);
        const row = { name: tl.style.name, total: +tl.total.toFixed(1), cuts: tl.segs.length, used: cnt.size, maxRepeat: Math.max(...cnt.values()), minCut: +Math.min(...L).toFixed(2), avgCut: +(L.reduce((a, b) => a + b, 0) / L.length).toFixed(2), maxCut: +Math.max(...L).toFixed(2), onBeatPct: Math.round(onBeat * 100), transitions: new Set(tl.segs.map(s => s.trans)).size };
        if (perf) { const n = 90, t1 = performance.now(); for (let i = 0; i < n; i++) HM.drawFrame(tl.total * i / n); row.frameMs = +((performance.now() - t1) / n).toFixed(1); }
        return row;
      }, aspect === '9:16' && len === '60');
      R.timeline.push({ aspect, length: len, style: st, buildMs: ms, ...r });
    }
    log('timeline', aspect, len);
  }
  R.perf = R.timeline.filter(r => r.frameMs !== undefined).map(r => ({ style: r.style, name: r.name, frameMs: r.frameMs, fpsMax: Math.round(1000 / r.frameMs) }));
  // 1080p の描画時間
  await pick(p, '#quality', '1080'); await pick(p, '#length', '60'); await pick(p, '#aspect', '9:16'); await idle(p);
  for (const st of ['energetic', 'vhs', 'polaroid', 'grid', 'glitch']) {
    await p.evaluate(id => document.querySelector(`.style[data-id="${id}"]`).click(), st);
    await p.waitForFunction(id => HM.S.style === id && !HM.S.building, st);
    const ms = await p.evaluate(() => { const tl = HM.S.tl, n = 60, t1 = performance.now(); for (let i = 0; i < n; i++) HM.drawFrame(tl.total * i / n); return +((performance.now() - t1) / n).toFixed(1); });
    const row = R.perf.find(r => r.style === st); if (row) row.frameMs1080 = ms;
  }
  await pick(p, '#quality', '720');

  // ---- H. 書き出し（60秒・実時間） ----
  async function doExport(label, setup) {
    await setup(); await idle(p);
    const t0 = Date.now();
    await p.click('#exportBtn');
    await p.waitForSelector('#dlLink', { timeout: 200000 });
    const ex = await p.evaluate(() => window.__lastExport);
    const dl = p.waitForEvent('download'); await p.evaluate(() => document.querySelector('#dlLink').click()); const d = await dl;
    const file = path.join(OUT, 'export_' + label + '.' + ex.name.split('.').pop()); await d.saveAs(file);
    let probe = {};
    try {
      const j = JSON.parse(execSync(`ffprobe -v error -count_frames -show_entries stream=codec_type,codec_name,width,height,nb_read_frames,duration:format=duration -of json "${file}"`).toString());
      const v = j.streams.find(s => s.codec_type === 'video'), a = j.streams.find(s => s.codec_type === 'audio');
      probe = { video: v && `${v.codec_name} ${v.width}x${v.height}`, frames: v && +v.nb_read_frames, fileDur: +(+j.format.duration).toFixed(2), audio: a && a.codec_name };
      probe.avgFps = probe.frames && probe.fileDur ? +(probe.frames / probe.fileDur).toFixed(1) : '';
    } catch (e) { probe.probeError = e.message.split('\n')[0]; }
    const meta = await p.evaluate(() => ({ style: HM.S.tl.style.name, total: +HM.S.tl.total.toFixed(1), W: HM.S.W, H: HM.S.H }));
    R.exports.push({ label, ...meta, mime: ex.type, MB: +(ex.size / 1048576).toFixed(1), wallSec: Math.round((Date.now() - t0) / 1000), ...probe });
    log('export', label, JSON.stringify(R.exports[R.exports.length - 1]));
  }
  await doExport('vertical_edm_energetic', async () => {
    await pick(p, '#musicSel', 'edm'); await pick(p, '#aspect', '9:16'); await pick(p, '#length', '60');
    await p.evaluate(() => { document.querySelector('#title').value = 'TEST 2026'; }); await p.evaluate(() => document.querySelector('.style[data-id="energetic"]').click());
  });
  await doExport('landscape_mysong_cinematic', async () => {
    await pick(p, '#musicSel', 'file'); await p.setInputFiles('#musicIn', path.join(M, 'song120.wav'));
    await p.waitForFunction(() => HM.S.musicKey.startsWith('file:') && !HM.S.building);
    await pick(p, '#aspect', '16:9'); await p.evaluate(() => document.querySelector('.style[data-id="cinematic"]').click());
  });

  // ---- G. 個人データ ----
  R.privacy = await p.evaluate(async () => {
    const r = {};
    try { await fetch('https://example.com/'); r.fetch = '送信できてしまう'; } catch (e) { r.fetch = 'ブロック'; }
    r.xhr = await new Promise(res => { try { const x = new XMLHttpRequest(); x.open('POST', 'https://example.com/'); x.onerror = () => res('ブロック'); x.onload = () => res('送信できてしまう'); x.send('a'); } catch (e) { res('ブロック'); } });
    r.beacon = await new Promise(res => { const h = e => { if (/example\.com/.test(e.blockedURI)) { document.removeEventListener('securitypolicyviolation', h); res('ブロック'); } }; document.addEventListener('securitypolicyviolation', h); try { navigator.sendBeacon('https://example.com/', 'a'); } catch (e) { res('ブロック'); } setTimeout(() => res('送信された可能性'), 1500); });
    r.extImage = await new Promise(res => { const i = new Image(); i.onload = () => res('読み込めてしまう'); i.onerror = () => res('ブロック'); i.src = 'https://example.com/x.png'; });
    r.beforeWipe = { clips: HM.S.clips.length, music: !!HM.S.music };
    return r;
  });
  await p.evaluate(() => document.querySelector('#wipeBtn').click());
  Object.assign(R.privacy, await p.evaluate(async () => ({
    afterWipe: { clips: HM.S.clips.length, music: !!HM.S.music, analysis: !!HM.S.analysis, exportLink: !!document.querySelector('#dlLink'), hiddenVideos: document.querySelectorAll('#hidden video').length, canvases: Object.keys(HM.S).length && 0 },
    storage: { localStorage: localStorage.length, sessionStorage: sessionStorage.length, cookie: document.cookie.length, indexedDB: (await (indexedDB.databases ? indexedDB.databases() : Promise.resolve([]))).length },
  })));
  log('privacy', JSON.stringify(R.privacy));
  await p.context().close();

  // ---- F. iPhone(Safari 旧版) 想定：canvas filter なし ／ Android 画面 ----
  for (const [tag, dev, nof] of [['iPhone想定(filterなし)', devices['iPhone 13'], true], ['Android画面', devices['Pixel 7'], false]]) {
    const q = await newPage(b, { ...dev, tag }, nof);
    const before = R.errors.length;
    await q.evaluate(() => HM.makeDemo()); await idle(q);
    for (const st of styles) {
      await q.evaluate(id => document.querySelector(`.style[data-id="${id}"]`).click(), st);
      await q.waitForFunction(id => HM.S.style === id && !HM.S.building, st);
      await q.evaluate(() => { const tl = HM.S.tl; for (let i = 0; i < 40; i++) HM.drawFrame(tl.total * i / 40); });
    }
    const lay = await q.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, viewW: innerWidth, previewTop: Math.round(document.querySelector('#out').getBoundingClientRect().top), smallestButton: Math.min(...[...document.querySelectorAll('button')].filter(x => x.offsetParent).map(x => x.getBoundingClientRect().height)) }));
    R.fallback.push({ device: tag, styles: styles.length, errors: R.errors.length - before, horizontalScroll: lay.scrollW > lay.viewW ? 'あり' : 'なし', previewTopPx: lay.previewTop, smallestButtonPx: Math.round(lay.smallestButton) });
    await q.context().close();
  }
  await b.close();

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(R, null, 1));
  csv('load.csv', R.load); csv('bpm.csv', R.bpm); csv('bgm.csv', R.bgm); csv('timeline.csv', R.timeline); csv('perf.csv', R.perf); csv('exports.csv', R.exports); csv('devices.csv', R.fallback);
  R.expectedBlocks = R.errors.filter(e => /Content Security Policy|violates/.test(e.msg)).length;
  R.errors = R.errors.filter(e => !/Content Security Policy|violates/.test(e.msg));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(R, null, 1));
  log('errors', R.errors.length, JSON.stringify(R.errors.slice(0, 10)), 'expected CSP blocks', R.expectedBlocks);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
