// Copyright © 2026. All rights reserved.
// 棚卸し画面: ラベルを読む → 数えた数を入れる → 決定
(function () {
  "use strict";

  const N = window.StockNotify;
  const root = document.getElementById("st-root");
  const stId = root.dataset.id;
  const box = document.getElementById("st-box");
  const entry = document.getElementById("st-entry");
  const valueEl = document.getElementById("st-value");
  const codeInput = document.getElementById("st-code");
  const IDLE_MS = 120;      // この時間キー入力が止まったら、ひとまとまりの入力とみなす
  const FAST_AVG_MS = 45;   // スキャナは1文字をこれより速く送る (人の手入力はもっと遅い)
  const CODE_MIN = 4;       // 数字だけのコード (JAN など) とみなす最小の長さ

  let current = null;   // 今数えている品目のコード
  let value = "";
  let busy = false;

  function base() { return location.pathname.replace(/stocktake\/\d+\/?$/, ""); }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function user() {
    try { return localStorage.getItem("stock.user") || ""; } catch (e) { return ""; }
  }

  function showBox(kind, title, body) {
    box.className = "result st-box result-" + kind;
    const text = el("div", "result-text");
    text.appendChild(el("div", "result-title", title));
    if (body) text.appendChild(el("div", "result-body", body));
    const row = el("div", "result-row");
    row.appendChild(text);
    box.replaceChildren(row);
  }

  function render() {
    valueEl.textContent = value === "" ? "0" : value;
    valueEl.classList.toggle("is-empty", value === "");
  }
  function input(key) {
    if (!current) return;
    if (/^\d$/.test(key)) { if (value === "0") value = ""; if (value.length < 6) value += key; }
    else if (key === "back") value = value.slice(0, -1);
    else if (key === "clear") value = "";
    render();
  }

  async function openItem(code) {
    code = (code || "").trim().toUpperCase();
    if (!code) return;
    // 数を入力中に別のラベルを読んだ時は、入力を捨てずに知らせる
    if (current && value !== "" && !busy) {
      if (code.replace(/\.Q\d+$/, "") === current) return;  // 数量入りのラベル (例 .Q5) も同じ品目
      N.sound("error");
      showBox("error", T("先に［決定］を押してください"),
        T("いま数えている品目に {value} と入力中です。やめる時は［やめる］を押してから読んでください", { value: value }));
      return;
    }
    try {
      const res = await fetch(base() + "api/stocktake/" + stId + "/item?code=" + encodeURIComponent(code));
      const data = await res.json();
      if (!data.ok) { N.sound("error"); showBox("error", data.error); return; }
      const it = data.item;
      current = it.code;
      value = "";
      document.getElementById("st-name").textContent = itemLabel(it);
      document.getElementById("st-sub").textContent = [it.spec, it.location ? T("棚") + " " + it.location : ""].filter(Boolean).join(" ・ ");
      document.getElementById("st-unit").textContent = T(it.unit);
      const sys = document.getElementById("st-system");
      sys.hidden = data.system === undefined || data.system === null;
      sys.textContent = sys.hidden ? "" : T("今の在庫（記録）: {n}", { n: data.system + T(it.unit) });
      const prev = document.getElementById("st-prev");
      prev.hidden = data.counted === null;
      prev.textContent = data.counted === null ? "" : T("この棚卸しで前に数えた数: {n}（数え直すと上書きします）", { n: data.counted + T(it.unit) });
      render();
      entry.hidden = false;
      N.sound("ok");
      showBox("info", T("「{name}」を数えてください", { name: itemLabel(it) }), T("数えた数を入れて［決定］。棚が空なら 0 で決定"));
    } catch (e) {
      N.sound("error");
      showBox("error", T("サーバに接続できません"), T("ネットワークを確認してください"));
    }
  }

  async function submit() {
    if (!current || busy) return;
    if (value === "") { N.sound("error"); valueEl.classList.remove("shake"); void valueEl.offsetWidth; valueEl.classList.add("shake"); return; }
    busy = true;
    const code = current;
    try {
      const res = await fetch(base() + "api/stocktake/" + stId + "/count", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, counted: parseInt(value, 10), user: user() }),
      });
      const data = await res.json();
      if (!data.ok) { N.sound("error"); showBox("error", data.error); return; }
      const it = data.item;
      const diffText = data.diff === 0 ? T("ズレなし") : T("記録とのズレ {d}", { d: (data.diff > 0 ? "+" : "") + data.diff + T(it.unit) });
      N.sound(data.diff === 0 ? "ok" : "warn");
      showBox(data.diff === 0 ? "good" : "bad",
        T("{name}  {n} で記録しました", { name: itemLabel(it), n: data.counted + T(it.unit) }),
        T("{diff}。次のラベルを読んでください", { diff: diffText }));
      addToList(it, data);
      progress(data.done, data.total);
      if (current === code) {  // 記録中に次のラベルを読んでいたら、そちらはそのまま
        current = null;
        entry.hidden = true;
      }
    } catch (e) {
      N.sound("error");
      showBox("error", T("サーバに接続できません"), T("記録されていません。もう一度［決定］を押してください"));
    } finally {
      busy = false;
    }
  }

  function addToList(it, data) {
    const list = document.getElementById("st-list");
    const li = el("li", data.diff ? "st-diff" : "");
    const text = el("div", "recent-text");
    text.appendChild(el("div", "recent-name", itemLabel(it)));
    text.appendChild(el("div", "recent-meta", [it.spec, it.location ? T("棚") + " " + it.location : ""].filter(Boolean).join(" ・ ")));
    const q = el("span", "recent-qty", data.counted + T(it.unit));
    if (data.diff) q.appendChild(el("small", "", T("ズレ") + " " + (data.diff > 0 ? "+" : "") + data.diff));
    li.append(text, q);
    // 数え直しの時は前の行を消す
    list.querySelectorAll("li").forEach((x) => { if (x.dataset.code === it.code) x.remove(); });
    li.dataset.code = it.code;
    list.prepend(li);
    document.querySelectorAll("#st-remaining li").forEach((x) => { if (x.dataset.code === it.code) x.remove(); });
  }
  function progress(done, total) {
    document.getElementById("st-done").textContent = done;
    document.getElementById("st-total").textContent = total;
    const rest = Math.max(0, total - done);
    document.getElementById("st-remaining-count").textContent = rest;
    document.getElementById("st-remaining-count2").textContent = rest;
    document.getElementById("st-fill").style.width = (done / (total || 1) * 100) + "%";
  }

  entry.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-key]");
    if (b) input(b.dataset.key);
  });
  document.getElementById("st-ok").addEventListener("click", submit);
  document.getElementById("st-cancel").addEventListener("click", () => {
    current = null; entry.hidden = true;
    showBox("idle", T("棚のラベルを読んでください"), T("読んだ品目の数を数えて、数字を入れて［決定］"));
  });
  document.getElementById("st-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const v = codeInput.value;
    codeInput.value = "";
    codeInput.blur();
    openItem(v);
  });

  // キー入力: スキャナの速い連続入力はラベルの読み取り、ゆっくりの数字は数えた数として扱う
  let buf = "", first = 0, last = 0, timer = null, lastCodeAt = -1e9, typedSinceCode = false;
  function isCode() {
    if (/[^0-9]/.test(buf)) return true;  // 英字などを含む = 手では打たないのでラベル
    const avg = buf.length > 1 ? (last - first) / (buf.length - 1) : Infinity;
    return buf.length >= CODE_MIN && avg <= FAST_AVG_MS;
  }
  function flush() {
    clearTimeout(timer);
    if (!buf) return null;
    const code = isCode();
    const typed = buf;
    buf = "";
    if (code) { lastCodeAt = performance.now(); typedSinceCode = false; openItem(typed); return "code"; }
    typedSinceCode = true;
    for (const ch of typed) input(ch);
    return "digits";
  }
  document.addEventListener("keydown", (ev) => {
    if (ev.target === codeInput || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
    const now = performance.now();
    const k = ev.key;
    if (k.length === 1) {
      ev.preventDefault();
      if (buf && now - last > IDLE_MS) flush();
      if (!buf) first = now;
      buf += k;
      last = now;
      clearTimeout(timer);
      timer = setTimeout(flush, IDLE_MS);
    } else if (k === "Enter") {
      ev.preventDefault();
      const kind = flush();
      // ラベルの読み取り (Enter が少し遅れて届くスキャナも) では［決定］にしない
      if (kind === "code" || (kind === null && !typedSinceCode && now - lastCodeAt < 500)) return;
      submit();
    } else if (k === "Backspace") { ev.preventDefault(); flush(); input("back"); }
    else if (k === "Delete") { ev.preventDefault(); flush(); input("clear"); }
    else if (k === "Escape") { document.getElementById("st-cancel").click(); }
  });
})();
