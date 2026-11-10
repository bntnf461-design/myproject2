// Copyright © 2026. All rights reserved.
// 音と音声読み上げ (スキャン画面・ダッシュボード共通)
window.StockNotify = (function () {
  "use strict";

  let ctx = null;
  function audio() {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // notes: [周波数Hz, 長さ秒, 波形] の並び
  function play(notes, volume) {
    try {
      const a = audio();
      let t = a.currentTime + 0.02;
      notes.forEach(([freq, dur, type]) => {
        if (freq) {
          const o = a.createOscillator();
          const g = a.createGain();
          o.type = type || "sine";
          o.frequency.value = freq;
          g.gain.setValueAtTime(volume || 0.2, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + dur);
          o.connect(g); g.connect(a.destination);
          o.start(t); o.stop(t + dur);
        }
        t += dur;
      });
    } catch (e) { /* 音が出せない環境 */ }
  }

  const SOUNDS = {
    ok: [[1320, 0.1]],                                     // ピッ
    in: [[880, 0.08], [1320, 0.12]],                       // ピロッ
    error: [[300, 0.35, "square"]],                        // ブー
    warn: [[988, 0.15, "triangle"], [0, 0.05], [988, 0.15, "triangle"]],
    // 補充タイミング: ピンポーン×2
    alarm: [[1047, 0.25, "triangle"], [784, 0.45, "triangle"], [0, 0.15],
            [1047, 0.25, "triangle"], [784, 0.45, "triangle"]],
    // 在庫切れ: 強めの警報
    empty: [[880, 0.18, "square"], [660, 0.18, "square"], [880, 0.18, "square"],
            [660, 0.18, "square"], [880, 0.18, "square"], [660, 0.3, "square"]],
  };

  function sound(name) { play(SOUNDS[name] || SOUNDS.ok, name === "empty" ? 0.12 : 0.2); }

  // ---- 音声読み上げ
  // 端末に入っている日本語音声のうち、なるべく自然に話す声を選ぶ
  // インドネシア語の画面では、インドネシア語の声で話す
  const IS_ID = window.LANG === "id";
  const VOICE_KEY = IS_ID ? "stock.voice.id" : "stock.voice";
  const RATE_KEY = "stock.rate";
  function pref(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
  }
  function setPref(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 保存できなくても動作は継続 */ }
  }
  function voiceScore(v) {
    const n = v.name;
    if (IS_ID) {
      if (/Natural/i.test(n)) return 100;          // Edge: Gadis / Ardi Online (Natural)
      if (/Online/i.test(n)) return 90;
      if (/Google/i.test(n)) return 80;            // Chrome: Google Bahasa Indonesia
      if (/Damayanti/i.test(n)) return 70;         // iPhone / Mac
      return v.localService ? 40 : 50;             // Windows: Andika など
    }
    if (/Natural/i.test(n)) return 100;            // Edge: Microsoft Nanami Online (Natural) など
    if (/Online/i.test(n)) return 90;
    if (/Google/i.test(n)) return 80;              // Chrome: Google 日本語
    if (/Kyoko|O-ren|Otoya|Hattori/i.test(n)) return 70;  // iPhone / Mac
    if (/Nanami|Keita|Mayu|Naoki|Shiori/i.test(n)) return 60;
    if (/Haruka|Ayumi|Ichiro|Sayaka/i.test(n)) return 30; // Windows 標準 (やや機械的)
    return v.localService ? 40 : 50;
  }
  function voices() {
    if (!("speechSynthesis" in window)) return [];
    return speechSynthesis.getVoices()
      .filter((v) => (IS_ID ? /^(id|in)\b/i : /^ja/i).test(v.lang))
      .sort((a, b) => voiceScore(b) - voiceScore(a));
  }
  // ネットにつながっていないPCでは、ネットを使う声 (Online・Natural など) は話せない。
  // 一度失敗したら、このPCに入っている声だけを使う
  let onlineFailed = false;
  function currentVoice() {
    let list = voices();
    if (onlineFailed) list = list.filter((v) => v.localService);
    const chosen = pref(VOICE_KEY, "");
    return list.find((v) => v.name === chosen) || list[0] || null;
  }
  function rate() {
    const r = parseFloat(pref(RATE_KEY, "1.05"));
    return Number.isFinite(r) ? r : 1.05;
  }

  let speakTimer = null;
  let speakSeq = 0;  // 新しい読み上げを頼まれるたびに増える (古い読み上げの言い直しで、新しいものを消さないため)
  function speak(text, opts) {
    if (!("speechSynthesis" in window) || !text) return;
    opts = opts || {};
    const seq = ++speakSeq;
    clearTimeout(speakTimer);
    try { speechSynthesis.cancel(); } catch (e) { /* 無視 */ }
    // cancel 直後に話し始めると途切れる環境があるため、少し間をあける
    speakTimer = setTimeout(() => {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "ja-JP";
        const v = currentVoice();
        if (IS_ID && !v) return;  // インドネシア語の声が入っていない端末では話さない (音と画面で知らせる)
        if (IS_ID) u.lang = "id-ID";
        if (v) u.voice = v;
        u.rate = opts.rate || rate();
        u.pitch = 1.0;
        u.volume = 1;
        if (v && !v.localService) {
          u.onerror = (e) => {
            // ネットを使う声が使えない時だけ (一時的な失敗・取り消しでは切り替えない)
            if (onlineFailed || !e || !/^(network|synthesis-failed|synthesis-unavailable)$/.test(e.error)) return;
            onlineFailed = true;  // → このPCの声に切り替える
            if (seq !== speakSeq) return;  // もう次の読み上げを頼まれている時は、古い文は言い直さない
            speak(text, Object.assign({}, opts, { delay: 0 }));
          };
        }
        speechSynthesis.speak(u);
      } catch (e) { /* 読み上げ非対応 */ }
    }, Math.max(opts.delay || 0, 80));
  }

  // 規格や単位を自然に読めるように整える
  //   "50mm×25m" → "50ミリかける25メートル"、"Mサイズ 100枚" → "Mサイズ100枚"
  function readable(s) {
    return String(s || "")
      .replace(/\s*[×＊]\s*/g, "かける")
      .replace(/(\d)\s*[xX*]\s*(?=\d)/g, "$1かける")
      .replace(/(\d)\s*mm\b/gi, "$1ミリ")
      .replace(/(\d)\s*cm\b/gi, "$1センチ")
      .replace(/(\d)\s*ml\b/gi, "$1ミリリットル")
      .replace(/(\d)\s*kg\b/gi, "$1キロ")
      .replace(/(\d)\s*g\b/g, "$1グラム")
      .replace(/(\d)\s*m\b/g, "$1メートル")
      .replace(/(\d)\s*L\b/g, "$1リットル")
      .replace(/[()（）「」\[\]]/g, " ")
      .replace(/(\d)\s+(?=\d)/g, "$1、")   // 数字どうしは区切って読む ("A4 500枚")
      .replace(/\s+/g, "")
      .trim();
  }

  // 品名と規格をつなげて読み上げ用の名前にする ("ニトリル手袋、Mサイズ100枚")
  function itemName(item) {
    if (IS_ID) return item.name_id ? String(item.name_id).trim() : "barang ini";  // 日本語の品名は読めないため
    if (item.reading && String(item.reading).trim()) return String(item.reading).trim();  // 登録した読み方を優先
    const name = readable(item.name);
    const spec = readable(item.spec);
    return spec ? name + "、" + spec : name;
  }

  return {
    sound, speak, readable, itemName, unlock: audio,
    voices, currentVoice, rate,
    setVoice: (name) => setPref(VOICE_KEY, name || ""),
    setRate: (r) => setPref(RATE_KEY, String(r)),
    savedVoice: () => pref(VOICE_KEY, ""),
  };
})();
