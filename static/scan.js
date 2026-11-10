// Copyright © 2026. All rights reserved.
// スキャン画面: USB/Bluetooth スキャナ(キーボード入力) とカメラ読み取りに対応
(function () {
  "use strict";

  const N = window.StockNotify;
  // 「Aさん」と登録されていても「Aさん さん」と出さない
  const bareName = (name) => String(name || "").trim().replace(/\s*(さん|様|さま|殿|氏|くん|君|ちゃん)$/, "") || name;
  const root = document.getElementById("scan-root");
  const codeInput = document.getElementById("code");
  const qtyBtn = document.getElementById("qty-btn");
  const keypad = document.getElementById("keypad");
  const userInput = document.getElementById("user");
  const resultBox = document.getElementById("result");
  const recentList = document.getElementById("recent");
  const undoBtn = document.getElementById("undo-btn");
  const modeNote = document.getElementById("mode-note");
  const alarm = document.getElementById("alarm");
  const alertStrip = document.getElementById("alert-strip");

  const AUTO_OUT_SECONDS = 30;  // 入庫後、この秒数操作がなければ出庫モードへ戻す
  const RESULT_IDLE_SECONDS = 20;  // 結果表示を待ち受け表示に戻すまでの秒数

  let mode = root.dataset.mode === "IN" ? "IN" : "OUT";
  let lastTxId = null;
  let busy = false;
  let autoOutTimer = null;
  let idleTimer = null;

  // ---- 端末ごとの設定 (localStorage)
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 保存できなくても動作は継続 */ }
  }
  userInput.value = load("stock.user", "");
  userInput.addEventListener("change", () => { save("stock.user", userInput.value.trim()); showWorker(); });
  const opts = {};
  [["voice", "opt-voice", "1"], ["voiceAll", "opt-voice-all", "0"], ["autoOut", "opt-auto-out", "1"],
   ["voiceError", "opt-voice-error", "0"], ["voiceOps", "opt-voice-ops", "0"]]
    .forEach(([key, id, def]) => {
      const box = document.getElementById(id);
      box.checked = load("stock.opt." + key, def) === "1";
      opts[key] = box.checked;
      box.addEventListener("change", () => { opts[key] = box.checked; save("stock.opt." + key, box.checked ? "1" : "0"); });
    });

  // ---- 画面を見ない現場向けの読み上げ (「設定（この端末）」で選ぶ)
  // 記録・取り消しができなかった時に、声でも知らせる
  function sayError(text) { if (opts.voiceError) N.speak(text, { delay: 450 }); }
  // モード・数量を切り替えた時に、声でも知らせる (数量は押し終わってから1回だけ言う)
  let opsTimer = null;
  function sayOp(text, wait) {
    if (!opts.voiceOps) return;
    clearTimeout(opsTimer);
    opsTimer = setTimeout(() => N.speak(text), wait || 0);
  }

  // ---- 担当者 (担当者カードを読むと切り替わる)
  const workerName = document.getElementById("worker-name");
  const workerPill = document.getElementById("worker-pill");
  const userClearSel = document.getElementById("opt-user-clear");
  let userClearTimer = null;
  userClearSel.value = load("stock.opt.userClear", "0");
  if (!userClearSel.value) userClearSel.value = "0";
  userClearSel.addEventListener("change", () => { save("stock.opt.userClear", userClearSel.value); scheduleUserClear(); });
  function showWorker() {
    const name = userInput.value.trim();
    workerName.textContent = name ? T("{name} さん", { name: bareName(name) }) : T("未設定");
    workerPill.classList.toggle("is-empty", !name);
  }
  function setWorker(name) {
    userInput.value = name;
    save("stock.user", name);
    showWorker();
    scheduleUserClear();
  }
  // 共用の端末では、しばらく操作がなければ担当者を外す (次の人が別の名前で記録しないように)
  function scheduleUserClear() {
    clearTimeout(userClearTimer);
    const min = parseInt(userClearSel.value, 10) || 0;
    if (!min || !userInput.value.trim()) return;
    userClearTimer = setTimeout(() => {
      setWorker("");
      if (resultBox.classList.contains("result-idle")) showIdle();
    }, min * 60000);
  }
  async function readWorkerCard(code) {
    try {
      const res = await fetch(rootPath() + "api/workers/" + encodeURIComponent(code));
      const data = await res.json();
      if (!data.ok) { N.sound("error"); showResult("error", data.error); return; }
      setWorker(data.name);
      N.sound("ok");
      showResult("info", T("担当者を「{name}」さんにしました", { name: bareName(data.name) }), [T("このあとの記録は {name} さんの名前で残ります", { name: bareName(data.name) })]);
      if (opts.voice) N.speak(T("{name}さん、お疲れさまです。", { name: data.name }), { delay: 200 });
    } catch (e) {
      N.sound("error");
      showResult("error", T("サーバに接続できません"), [T("担当者は切り替わっていません")]);
      sayError(T("サーバにつながりません。担当者は切り替わっていません。"));
    }
  }
  showWorker();
  scheduleUserClear();

  // ---- モード
  function setMode(next, note, quiet) {
    if (!quiet && next !== mode) sayOp(next === "IN" ? T("いれるモードです。") : T("とるモードです。"));
    mode = next;
    root.classList.remove("mode-OUT", "mode-IN");
    root.classList.add("mode-" + mode);
    document.querySelectorAll(".mode-btn").forEach((b) => {
      b.classList.toggle("selected", b.dataset.mode === mode);
      b.setAttribute("aria-pressed", b.dataset.mode === mode ? "true" : "false");
    });
    modeNote.hidden = !note;
    modeNote.textContent = note || "";
    scheduleAutoOut();
  }
  function scheduleAutoOut() {
    clearTimeout(autoOutTimer);
    if (mode === "IN" && opts.autoOut) {
      autoOutTimer = setTimeout(() => {
        // テンキーで入力中・記録中は戻さず、少し待ってからもう一度確かめる
        if (!keypad.hidden || busy || queue.length || confirmPending) { scheduleAutoOut(); return; }
        setMode("OUT", T("入庫のあと操作がなかったため、出庫モードに戻しました"), true);
        sayOp(T("とるモードに戻しました。"));
        showIdle();
      }, AUTO_OUT_SECONDS * 1000);
    }
  }
  document.querySelectorAll(".mode-btn").forEach((b) =>
    b.addEventListener("click", () => { setMode(b.dataset.mode); refocus(); }));
  setMode(mode, "", true);

  // ---- 数量
  // 数量を指定していない時は「ラベルの数」= 棚ラベルに印字した「1回 ○個」(品目ごとの設定) で記録する
  let qty = 1;
  let qtyExplicit = false;
  function getQty() { return qty; }
  function setQty(n) {
    qty = Math.min(9999, Math.max(1, n | 0));
    qtyExplicit = true;
    showQty();
    sayOp(T("数量、{n}。", { n: qty }), 700);
    scheduleAutoOut();  // 操作があったので、出庫モードへ戻すまでの時間を延ばす
  }
  function resetQty() {
    qty = 1;
    qtyExplicit = false;
    showQty();
  }
  function showQty() {
    qtyBtn.textContent = qtyExplicit ? qty : T("ラベルの数");
    qtyBtn.classList.toggle("qty-changed", qtyExplicit);
    qtyBtn.classList.toggle("qty-auto", !qtyExplicit);
    if (resultBox.classList.contains("result-idle")) showIdle();
  }
  document.querySelectorAll("[data-qty-step]").forEach((b) =>
    b.addEventListener("click", () => {
      const step = parseInt(b.dataset.qtyStep, 10);
      setQty(qtyExplicit ? qty + step : Math.max(1, 1 + step));
      refocus();
    }));

  // ---- 大きなテンキー (数量ボタンを押すと開く)
  const kpValueEl = document.getElementById("keypad-value");
  let kpValue = "1";
  let kpFresh = true;  // 開いた直後は、最初の数字で置き換える
  function openKeypad() {
    if (confirmPending) return;  // 数量の確認中は開かない
    kpValue = qtyExplicit ? String(qty) : "1";
    kpFresh = true;
    keypad.className = "keypad-overlay keypad-" + mode;
    document.getElementById("keypad-title").textContent = mode === "IN" ? T("いれる数量（補充）") : T("とる数量（出庫）");
    renderQuick();
    renderKeypad();
    keypad.hidden = false;
    scheduleAutoOut();
  }
  // ワンタッチの数量ボタン (設定画面で決めた数字を、モードに合わせて表示)
  const quickBox = document.getElementById("keypad-quick");
  function renderQuick() {
    const list = (mode === "IN" ? quickBox.dataset.in : quickBox.dataset.out) || "";
    quickBox.replaceChildren();
    list.split(",").filter(Boolean).forEach((n) => {
      const b = el("button", "", n);
      b.type = "button";
      b.dataset.quick = n;
      quickBox.appendChild(b);
    });
    quickBox.hidden = !quickBox.childElementCount;
  }
  function closeKeypad() {
    keypad.hidden = true;
    kpBuf = ""; clearTimeout(kpTimer);
    refocus();
  }
  function renderKeypad() {
    kpValueEl.textContent = kpValue === "" ? "0" : kpValue;
    kpValueEl.classList.toggle("is-empty", !(parseInt(kpValue, 10) >= 1));
  }
  function keypadInput(key) {
    if (/^\d$/.test(key)) {
      if (kpFresh || kpValue === "0") kpValue = "";
      if (kpValue.length < 4) kpValue += key;
      kpFresh = false;
    } else if (key === "back") {
      kpValue = kpFresh ? "" : kpValue.slice(0, -1);
      kpFresh = false;
    } else if (key === "clear") {
      kpValue = ""; kpFresh = false;
    } else if (key === "ok") {
      return confirmKeypad();
    } else if (key === "close") {
      return closeKeypad();
    }
    renderKeypad();
  }
  function confirmKeypad(silent) {
    const n = parseInt(kpValue, 10);
    if (!(n >= 1)) {
      if (silent) { closeKeypad(); return; }
      N.sound("error");
      kpValueEl.classList.remove("shake"); void kpValueEl.offsetWidth; kpValueEl.classList.add("shake");
      return;
    }
    applyQty(n, silent);
  }
  function applyQty(n, silent) {
    setQty(n);
    closeKeypad();
    if (!silent) {
      N.sound("ok");
      showResult(mode === "IN" ? "in" : "info", T("数量を {n} にしました", { n }),
        [mode === "IN" ? T("補充した品目のラベルを読んでください") : T("取る品目のラベルを読んでください")]);
    }
  }
  qtyBtn.addEventListener("click", openKeypad);
  document.querySelector(".qty-label").addEventListener("click", openKeypad);
  keypad.addEventListener("click", (ev) => {
    if (ev.target === keypad) return closeKeypad();  // 外側をタッチで閉じる
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.quick) return applyQty(parseInt(b.dataset.quick, 10));
    if (b.dataset.key) keypadInput(b.dataset.key);
  });

  // テンキー表示中のキーボード入力。スキャナは高速に文字を送るので、
  // 連続入力ならラベルの読み取りとみなし、数量を確定してそのまま記録する。
  let kpBuf = "", kpTimer = null;
  function flushAsScan(submit) {
    clearTimeout(kpTimer);
    const code = kpBuf;
    kpBuf = "";
    confirmKeypad(true);
    codeInput.value = code;
    if (submit) document.getElementById("scan-form").requestSubmit();
    else codeInput.focus({ preventScroll: true });
  }
  document.addEventListener("keydown", (ev) => {
    if (keypad.hidden || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (kpBuf) {
      if (k.length === 1) { kpBuf += k; clearTimeout(kpTimer); kpTimer = setTimeout(() => flushAsScan(false), 60); }
      else if (k === "Enter") flushAsScan(true);
      return;
    }
    if (k.length === 1) {
      kpBuf = k;
      kpTimer = setTimeout(() => {
        const c = kpBuf;
        if (c.length === 1 && /\d/.test(c)) { kpBuf = ""; keypadInput(c); }
        else flushAsScan(false);
      }, 60);
    } else if (k === "Backspace") keypadInput("back");
    else if (k === "Delete") keypadInput("clear");
    else if (k === "Enter") keypadInput("ok");
    else if (k === "Escape") closeKeypad();
  }, true);

  // ---- 表示
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  // 固定の SVG アイコン (利用者の入力は含めない)
  const ICONS = {
    scan: '<path d="M4 6v12"/><path d="M8 6v12"/><path d="M11 6v12"/><path d="M15 6v12"/><path d="M20 6v12"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
    warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  };
  function icon(name, size, cls) {
    const span = el("span", cls || "icon");
    span.setAttribute("aria-hidden", "true");
    span.innerHTML = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + "</svg>";
    return span;
  }
  function restartIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(showIdle, RESULT_IDLE_SECONDS * 1000);
  }

  // お知らせ・エラーなどの表示
  function showResult(kind, title, lines) {
    resultBox.className = "result result-" + kind;
    const text = el("div", "result-text");
    text.appendChild(el("div", "result-title", title));
    (lines || []).forEach((l) => {
      if (l) text.appendChild(el("div", "result-body " + (l.cls || ""), l.text || l));
    });
    const iconName = kind === "error" ? "warn" : kind === "info" || kind === "in" ? "info" : "check";
    resultBox.replaceChildren(el("div", "result-row"));
    resultBox.firstChild.append(icon(iconName, 40, "result-icon"), text);
    restartIdleTimer();
  }
  function showIdle() {
    resultBox.className = "result result-idle";
    const text = el("div", "result-text");
    text.appendChild(el("div", "result-title",
      mode === "IN" ? T("補充した品目のラベルを読み取ってください") : T("ラベルを読み取ってください")));
    text.appendChild(el("div", "result-body", qtyExplicit
      ? T("次に読む品目は 数量 {n} で記録されます", { n: qty })
      : T("ラベルに書いてある「1回 ○個」の数で記録されます。違う数の時は［数量］で選んでから読む")));
    resultBox.replaceChildren(el("div", "result-row"));
    resultBox.firstChild.append(icon("scan", 48, "result-icon"), text);
  }

  // 記録した品目の表示: 品名・数量を大きく、のこりをゲージで
  function showRecord(data) {
    const it = data.item;
    const out = data.kind === "OUT";
    resultBox.className = "result result-record result-" + (out ? "out" : "in");
    const status = el("div", "result-status");
    status.append(icon("check", 22), out ? T("とりました（出庫）") : T("補充しました（入庫）"));

    const main = el("div", "result-main");
    const name = el("div", "result-name");
    name.appendChild(el("div", "result-title", itemLabel(it)));
    name.appendChild(el("div", "result-sub", [it.spec, it.location ? T("棚 {loc}", { loc: it.location }) : ""].filter(Boolean).join(" ・ ")));
    const qtyBox = el("div", "result-qty-box");
    const qtyEl = el("div", "result-qty", (out ? "−" : "＋") + data.qty);
    qtyEl.appendChild(el("small", "", T(it.unit)));
    qtyBox.appendChild(qtyEl);
    // どの数で記録したかを、数のすぐ下に出す (ラベルの「1回 ○個」か、数量ボタンで選んだ数か)
    const perLabel = data.label_qty || (out ? it.out_qty : it.in_qty);  // 数量入りのラベル (例 .Q5) ならその数
    if (data.qty_auto) {
      qtyBox.appendChild(el("div", "result-qty-src src-label",
        T("ラベルの数（1回 {n}{unit}）", { n: data.qty, unit: T(it.unit) })));
    } else {
      const src = el("div", "result-qty-src src-manual", T("数量ボタンで指定"));
      if (perLabel && perLabel !== data.qty) {
        src.appendChild(el("span", "src-note", T("ラベルは 1回 {n}{unit}", { n: perLabel, unit: T(it.unit) })));
      }
      qtyBox.appendChild(src);
    }
    main.append(icon("box", 52, "result-icon"), name, qtyBox);

    const level = data.status;  // ok / low / empty
    const remain = el("div", "result-remain remain-" + level);
    remain.appendChild(el("span", "remain-label", T("のこり")));
    const num = el("strong", "remain-num", String(it.stock));
    num.appendChild(el("small", "", T(it.unit)));
    remain.appendChild(num);
    const track = el("div", "remain-track");
    const fill = el("div", "remain-fill");
    const base = Math.max(it.reorder_point * 2, 1);
    fill.style.width = Math.max(0, Math.min(100, Math.round(it.stock / base * 100))) + "%";
    track.appendChild(fill);
    remain.appendChild(track);
    const msg = level === "empty" ? T("在庫切れです") : level === "low"
      ? (it.ordered ? T("発注済みです") : T("そろそろ補充を")) : T("じゅうぶんあります");
    remain.appendChild(el("span", "remain-msg", msg));

    resultBox.replaceChildren(status, main, remain);
    if (data.warning && data.short > 0) {  // 記録上の在庫より多く取った (在庫は0にした)
      resultBox.appendChild(el("div", "result-body result-warning", data.warning));
      if (opts.voice || opts.voiceError) N.speak(T("記録上の在庫が足りません。棚卸しで数を確かめてください。"), { delay: 900 });
    }
    restartIdleTimer();
  }

  // ---- 補充タイミングのお知らせ (全画面表示 + 音 + 音声)
  let alarmTimer = null;
  function showAlarm(kind, item) {
    const empty = kind === "empty";
    alarm.className = "alarm alarm-" + (empty ? "empty" : "low");
    document.getElementById("alarm-head").textContent = empty ? T("在庫切れです") : T("補充してください");
    document.getElementById("alarm-name").textContent = itemLabel(item) + (item.spec ? "  " + item.spec : "");
    document.getElementById("alarm-detail").textContent =
      T("残り {n}{unit}（発注点 {rp}）", { n: item.stock, unit: T(item.unit), rp: item.reorder_point }) +
      (item.location ? "  " + T("棚 {loc}", { loc: item.location }) : "") + (item.ordered ? "  " + T("※発注済み") : "");
    alarm.hidden = false;
    document.body.classList.add("alarm-on");
    N.sound(empty ? "empty" : "alarm");
    if (opts.voice) {
      const name = N.itemName(item);
      const text = empty
        ? T("{name}が、在庫切れになりました。補充をお願いします。", { name })
        : T("{name}が、発注点を下回りました。残りは{n}{unit}です。補充をお願いします。", { name, n: item.stock, unit: T(item.unit) });
      // チャイムが鳴り終わってから話し始める
      N.speak(text + (item.ordered ? T("発注は済んでいます。") : ""), { delay: empty ? 1300 : 1650 });
    }
    clearTimeout(alarmTimer);
    alarmTimer = setTimeout(hideAlarm, 12000);
  }
  function hideAlarm() {
    alarm.hidden = true;
    document.body.classList.remove("alarm-on");
    clearTimeout(alarmTimer);
    refocus();
  }
  alarm.addEventListener("click", hideAlarm);
  document.getElementById("test-alarm").addEventListener("click", () =>
    showAlarm("crossed", { name: T("テスト品目"), spec: "", stock: 3, unit: "個", reorder_point: 3, location: "A-1" }));

  // ---- 要補充件数 (画面上部の帯)
  function updateAlertStrip(count, names) {
    alertStrip.hidden = !count;
    document.getElementById("alert-count").textContent = count;
    if (names !== undefined) document.getElementById("alert-names").textContent = names;
  }
  async function loadAlerts() {
    try {
      const data = await (await fetch(rootPath() + "api/alerts")).json();
      const names = data.items.slice(0, 4).map((i) => itemLabel(i) + (i.spec ? "(" + i.spec + ")" : "")).join(T("、"))
        + (data.items.length > 4 ? T(" ほか") : "");
      updateAlertStrip(data.count, names);
    } catch (e) { /* 取得失敗は無視 */ }
  }

  async function loadRecent() {
    try {
      const rows = await (await fetch(rootPath() + "api/recent")).json();
      recentList.replaceChildren();
      rows.forEach((r) => {
        const li = el("li", "kind-row-" + r.kind + (r.voided ? " voided" : ""));
        // 担当者名の頭文字 (無ければ区分の1文字目)
        li.appendChild(el("span", "recent-avatar", (r.user || r.kind_label).slice(0, 1)));
        const text = el("div", "recent-text");
        text.appendChild(el("div", "recent-name", itemLabel(r)));
        const when = r.ts.slice(0, 10) === today() ? r.ts.slice(11, 16) : r.ts.slice(5, 16);
        text.appendChild(el("div", "recent-meta", (r.user ? T("{name}さん", { name: r.user }) + " ・ " : "") + when +
          (r.kind === "ADJ" ? " ・ " + T("棚卸") : "") + (r.voided ? " ・ " + T("取消") : "")));
        li.appendChild(text);
        li.appendChild(el("span", "recent-qty", (r.kind === "OUT" ? "−" : r.kind === "IN" ? "＋" : "±") + r.qty));
        recentList.appendChild(li);
      });
    } catch (e) { /* 一覧の取得失敗は無視 */ }
  }
  function today() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function rootPath() {
    // /scan からの相対で API を呼ぶ (サブパス配置にも対応)
    return location.pathname.replace(/scan\/?$/, "");
  }

  // ---- 操作用コード
  function handleCommand(code) {
    if (code === "CMD-OUT") { setMode("OUT"); showResult("info", T("出庫モードにしました")); return true; }
    if (code === "CMD-IN") { setMode("IN"); showResult("in", T("入庫(補充)モードにしました"), [T("補充した品目のラベルを読んでください")]); return true; }
    const m = /^CMD-Q(\d+)$/.exec(code);
    if (m) {
      setQty(parseInt(m[1], 10));
      showResult("info", T("数量を {n} にしました", { n: qty }), [T("次に読み取る品目に適用されます")]);
      return true;
    }
    return false;
  }

  // ---- 記録
  // 前の記録が終わる前に次のラベルを読んでも取りこぼさないよう、順番待ちにして1件ずつ記録する
  const queue = [];
  function submitCode(raw) {
    const code = (raw || "").trim().toUpperCase();
    if (!code) return;
    // 数量の確認中: 同じラベルなら「はい」、別のラベルなら「やめる」にして次へ進む
    if (confirmPending) {
      const same = code === confirmPending.code;
      answerConfirm(same);
      if (same || code === "CMD-UNDO") return;  // 確認中の「とりけし」は、やめるだけにする
    }
    // 操作用コードは、読んだ時点のモード・数量で処理されるよう順番待ちに入れる
    queue.push(code);
    if (!busy) drainQueue();
  }
  async function drainQueue() {
    busy = true;
    try {
      while (queue.length) await processCode(queue.shift());
    } finally {
      busy = false;
    }
  }
  async function processCode(code) {
    if (!alarm.hidden) hideAlarm();
    if (code === "CMD-UNDO") { await undo(); return; }
    if (/^CMD-U\d+$/.test(code)) { await readWorkerCard(code); return; }
    if (code.startsWith("CMD-")) {
      if (handleCommand(code)) N.sound("ok");
      else { N.sound("error"); showResult("error", T("不明な操作コード: {code}", { code })); }
      return;
    }
    try {
      const body = { code, mode, qty: qtyExplicit ? qty : null, user: userInput.value.trim() };
      let res = await fetch(rootPath() + "api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let data = await res.json();
      if (data.need_confirm) {
        // いつもより大幅に多い数: 打ち間違いでないか確かめてから記録する
        if (!(await askConfirm(code, data))) {
          resetQty();
          N.sound("error");
          showResult("error", T("記録しませんでした"), [T("数量を選び直してから、もう一度ラベルを読んでください")]);
          return;
        }
        body.confirm = true;
        res = await fetch(rootPath() + "api/scan", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        data = await res.json();
      }
      if (!data.ok) {
        N.sound("error");
        showResult("error", data.error || T("エラーが発生しました"));
        if (res.status === 404) {
          if (opts.voice || opts.voiceError) N.speak(data.other_site ? T("ほかの拠点のラベルです。") : T("登録されていないコードです。"), { delay: 450 });
        }
        else sayError(T("記録できませんでした。画面を確かめてください。"));
        return;
      }
      lastTxId = data.tx_id;
      undoBtn.disabled = false;
      const it = data.item;
      showRecord(data);

      if (data.alert === "crossed" || data.alert === "empty") {
        showAlarm(data.alert, it);
      } else {
        N.sound(data.alert === "low" ? "warn" : data.kind === "IN" ? "in" : "ok");
        if (opts.voiceAll) {
          const vars = { name: N.itemName(it), n: data.qty, unit: T(it.unit) };
          N.speak((data.kind === "OUT" ? T("{name}を、{n}{unit}出庫しました。", vars) : T("{name}を、{n}{unit}補充しました。", vars)) +
            (data.alert === "low" ? T("残りは{n}{unit}です。補充をお願いします。", { n: it.stock, unit: T(it.unit) }) : ""), { delay: 250 });
        } else if (data.alert === "low" && opts.voice) {
          N.speak(T("残りは{n}{unit}です。補充をお願いします。", { n: it.stock, unit: T(it.unit) }), { delay: 550 });
        }
      }
      resetQty();
      if (mode === "IN") scheduleAutoOut();
      scheduleUserClear();
      updateAlertStrip(data.alert_count);
      loadAlerts();
      loadRecent();
    } catch (e) {
      N.sound("error");
      showResult("error", T("サーバに接続できません"), [T("ネットワークを確認してください。記録されていません。")]);
      sayError(T("サーバにつながりません。記録できませんでした。もう一度読んでください。"));
    }
  }

  // ---- 数量の確認 (いつもより大幅に多い時)
  const confirmBox = document.getElementById("confirm");
  let confirmPending = null;
  function askConfirm(code, data) {
    const it = data.item;
    const out = data.kind === "OUT";
    if (!keypad.hidden) closeKeypad();
    confirmBox.className = "confirm-overlay confirm-" + data.kind;
    document.getElementById("confirm-name").textContent = itemLabel(it) + (it.spec ? "  " + it.spec : "");
    document.getElementById("confirm-qty").textContent = T(out ? "とる数 {n}{unit}" : "いれる数 {n}{unit}", { n: data.qty, unit: T(it.unit) });
    document.getElementById("confirm-usual").textContent = T("いつもは {n}{unit} です。この数で合っていますか？", { n: data.usual, unit: T(it.unit) });
    confirmBox.hidden = false;
    N.sound("warn");
    if (opts.voice) N.speak(T("{n}{unit}で、合っていますか？", { n: data.qty, unit: T(it.unit) }), { delay: 400 });
    return new Promise((resolve) => { confirmPending = { code, resolve }; });
  }
  function answerConfirm(yes) {
    if (!confirmPending) return;
    const p = confirmPending;
    confirmPending = null;
    confirmBox.hidden = true;
    p.resolve(yes);
    refocus();
  }
  document.getElementById("confirm-yes").addEventListener("click", () => answerConfirm(true));
  document.getElementById("confirm-no").addEventListener("click", () => answerConfirm(false));
  document.addEventListener("keydown", (ev) => { if (confirmPending && ev.key === "Escape") answerConfirm(false); });

  async function undo() {
    if (!lastTxId) { N.sound("error"); showResult("error", T("取り消せる記録がありません")); return; }
    let data;
    try {
      const res = await fetch(rootPath() + "api/void/" + lastTxId, { method: "POST" });
      data = await res.json();
    } catch (e) {
      N.sound("error");
      showResult("error", T("サーバに接続できません"), [T("取り消されていません。もう一度「とりけし」を押してください。")]);
      sayError(T("サーバにつながりません。取り消しできませんでした。"));
      return;
    }
    if (data.ok) {
      N.sound("ok");
      showResult("info", T("取り消しました: {name}", { name: itemLabel(data) }), [T("現在庫 {n}{unit}", { n: data.stock, unit: T(data.unit) })]);
      sayOp(T("{name}の記録を、取り消しました。", { name: N.itemName(data) }));
      lastTxId = null;
      undoBtn.disabled = true;
      loadAlerts();
      loadRecent();
    } else {
      N.sound("error");
      showResult("error", data.error);
      sayError(T("取り消しできませんでした。"));
    }
  }
  undoBtn.addEventListener("click", () => { submitCode("CMD-UNDO"); refocus(); });

  document.getElementById("scan-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const v = codeInput.value;
    codeInput.value = "";
    submitCode(v);
  });

  // ---- スキャナ入力の取りこぼし防止
  // 読み取り欄にフォーカスが無くても、スキャナからのキー入力を読み取り欄へ流し込む
  function isTextField(t) {
    return t && t !== codeInput && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }
  document.addEventListener("keydown", (ev) => {
    if (ev.target === codeInput || isTextField(ev.target) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === "Enter") {
      if (codeInput.value) { ev.preventDefault(); document.getElementById("scan-form").requestSubmit(); }
      return;
    }
    if (ev.key.length === 1) {
      ev.preventDefault();
      codeInput.value += ev.key;
      codeInput.focus({ preventScroll: true });
    }
  });
  function refocus() {
    if (isTextField(document.activeElement)) return;
    codeInput.focus({ preventScroll: true });
  }
  document.addEventListener("click", (ev) => {
    if (!ev.target.closest("input, a, select, textarea, summary")) setTimeout(refocus, 0);
  });
  userInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); codeInput.focus(); }
  });

  // ---- 読み上げの声と速さ (端末ごとに保存)
  const voiceSel = document.getElementById("opt-voice-name");
  const rateInput = document.getElementById("opt-rate");
  const rateLabel = document.getElementById("opt-rate-label");
  function fillVoices() {
    const list = N.voices();
    const saved = N.savedVoice();
    voiceSel.replaceChildren(new Option(T("自動（いちばん自然な声）"), ""));
    list.forEach((v) => voiceSel.appendChild(new Option(v.name, v.name, false, v.name === saved)));
    if (!list.length) voiceSel.appendChild(new Option(T("（この端末には日本語の声がありません）"), "", false, false));
  }
  function showRate() {
    const r = parseFloat(rateInput.value);
    rateLabel.textContent = r < 0.95 ? T("ゆっくり") : r <= 1.15 ? T("ふつう") : T("はやい");
  }
  fillVoices();
  if ("speechSynthesis" in window && speechSynthesis.addEventListener) speechSynthesis.addEventListener("voiceschanged", fillVoices);
  voiceSel.addEventListener("change", () => N.setVoice(voiceSel.value));
  rateInput.value = N.rate();
  showRate();
  rateInput.addEventListener("input", showRate);
  rateInput.addEventListener("change", () => N.setRate(rateInput.value));
  document.getElementById("test-voice").addEventListener("click", () => {
    N.setRate(rateInput.value);
    N.speak(T("ニトリル手袋、Mサイズ100枚が、発注点を下回りました。残りは5箱です。補充をお願いします。"));
  });

  // ---- カメラ読み取り
  const camBox = document.getElementById("camera-box");
  const video = document.getElementById("camera-video");
  let stream = null, detector = null, html5 = null, scanTimer = null;
  let lastCamCode = "", lastCamAt = 0;

  // カメラは同じラベルを何度も見つけるので、ラベルが画面から外れて2秒たつまで同じコードは記録しない
  // (外さずに向け続けても、1回しか記録されない)
  function onCameraCode(code) {
    const now = Date.now();
    const stillInView = code === lastCamCode && now - lastCamAt < 2000;
    lastCamCode = code;
    lastCamAt = now;
    if (confirmPending) return;  // 確認中はカメラで勝手に「はい」にしない (ボタンで答える)
    if (!stillInView) submitCode(code);
  }

  async function openCamera() {
    if (!window.isSecureContext) {
      N.sound("error");
      // スマホのカメラは https でしか使えないので、https のアドレスを案内する
      showResult("error", T("カメラを使うには、https のアドレスで開いてください"),
        [T("{url} （「設定」→「ほかのPCからつなぐ」のQRコードからも開けます）", { url: "https://" + location.hostname + ":5443/scan" })]);
      return;
    }
    camBox.hidden = false;
    if ("BarcodeDetector" in window) {
      try {
        detector = new window.BarcodeDetector({ formats: ["qr_code", "code_128"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.hidden = false;
        video.srcObject = stream;
        await video.play();
        scanTimer = setInterval(async () => {
          try {
            const codes = await detector.detect(video);
            if (codes.length) onCameraCode(codes[0].rawValue);
          } catch (e) { /* 次のフレームで再試行 */ }
        }, 250);
        return;
      } catch (e) { stopCamera(); camBox.hidden = false; }
    }
    // BarcodeDetector 非対応ブラウザ (iPhone など) は html5-qrcode を使う
    video.hidden = true;
    try {
      // アプリに同梱した読み取りライブラリ (インターネット接続は不要)
      await loadScript(rootPath() + "static/vendor/html5-qrcode.min.js");
      html5 = new window.Html5Qrcode("camera-fallback");
      // 読み取り枠は横長に (細長いバーコードも枠に収まるように)
      await html5.start({ facingMode: "environment" }, {
        fps: 8, qrbox: (w, h) => ({ width: Math.max(200, Math.floor(w * 0.9)), height: Math.max(150, Math.floor(h * 0.6)) }),
      }, onCameraCode);
    } catch (e) {
      showResult("error", T("カメラを起動できませんでした"), [String(e && e.message || e)]);
      stopCamera();
    }
  }
  function stopCamera() {
    if (scanTimer) clearInterval(scanTimer);
    scanTimer = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (html5) { html5.stop().catch(() => {}); html5 = null; }
    camBox.hidden = true;
    refocus();
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.Html5Qrcode) return resolve();
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(T("読み取りライブラリを読み込めませんでした")));
      document.head.appendChild(s);
    });
  }
  document.getElementById("camera-btn").addEventListener("click", openCamera);
  document.getElementById("camera-close").addEventListener("click", stopCamera);

  showQty();
  showIdle();
  loadRecent();
  loadAlerts();
  setInterval(loadAlerts, 60000);  // 他の端末での補充も反映
  refocus();
})();
