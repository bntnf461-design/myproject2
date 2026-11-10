// Copyright © 2026. All rights reserved.
// 入庫: 一覧から品物を探して、入庫数を入れて Enter で記録する
(function () {
  "use strict";
  const table = document.getElementById("rcv-table");
  if (!table) return;
  const base = location.pathname.replace(/receive\/?$/, "");
  const rows = Array.from(table.querySelectorAll("tbody tr[data-code]"));
  const filter = document.getElementById("rcv-filter");
  const onlyLow = document.getElementById("rcv-only-low");
  const userInput = document.getElementById("rcv-user");
  const STATUS = { empty: T("在庫切れ"), low: T("要補充"), ok: T("適正") };

  // 担当者は、この端末に覚えておく (スキャン画面の担当者とは別)
  try { userInput.value = localStorage.getItem("stock.receiveUser") || ""; } catch (e) { /* 使えない時は毎回入れる */ }
  userInput.addEventListener("change", () => {
    try { localStorage.setItem("stock.receiveUser", userInput.value.trim()); } catch (e) { /* 無視 */ }
  });
  const user = () => userInput.value.trim() || table.dataset.office;

  // 全角数字を半角に、空白・桁区切りを除く
  function toHalf(s) {
    return String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[\s,，]/g, "");
  }
  function visibleInputs() {
    return rows.filter((r) => !r.hidden).map((r) => r.querySelector(".rcv-input"));
  }
  function setResult(row, cls, text, txId) {
    const cell = row.querySelector(".rcv-result");
    cell.textContent = "";
    const span = document.createElement("span");
    span.className = cls;
    span.textContent = text;
    cell.appendChild(span);
    if (txId) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "link"; b.textContent = T("取り消し");
      b.addEventListener("click", () => undo(row, txId, b));
      cell.appendChild(b);
    }
  }
  function setStock(row, stock, status) {
    row.querySelector(".rcv-stock").textContent = stock;
    if (status) {
      row.dataset.status = status;
      const badge = row.querySelector(".rcv-badge");
      badge.className = "badge badge-" + status + " rcv-badge";
      badge.textContent = STATUS[status];
    }
  }

  async function post(path, body) {
    const res = await fetch(base + path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
    });
    return res.json().catch(() => ({ ok: false }));
  }

  const busy = new WeakSet();  // Enter の連打で二重に記録しない
  async function save(input) {
    const row = input.closest("tr");
    const v = toHalf(input.value);
    if (v === "") return false;
    if (!/^\d+$/.test(v) || parseInt(v, 10) < 1) {
      row.classList.add("rcv-error");
      setResult(row, "rcv-ng", T("1以上の数字で入れてください"));
      return false;
    }
    if (busy.has(row)) return false;
    busy.add(row);
    row.classList.add("rcv-saving");
    try {
      const body = { code: row.dataset.code, mode: "IN", qty: parseInt(v, 10), user: user() };
      let data = await post("api/scan", body);
      // いつもより大幅に多い数は、打ち間違いでないか確かめてから記録する
      if (!data.ok && data.need_confirm) {
        if (!confirm(row.dataset.name + "\n" + data.error)) { input.select(); return false; }
        data = await post("api/scan", Object.assign(body, { confirm: true }));
      }
      if (!data.ok) throw new Error(data.error || "error");
      input.value = "";
      row.classList.remove("rcv-error");
      row.classList.add("rcv-done");
      setStock(row, data.item.stock, data.status);
      setResult(row, "rcv-ok", T("+{n}{unit} 入庫しました（在庫 {stock}{unit}）")
        .replace(/\{n\}/g, data.qty).replace(/\{unit\}/g, row.dataset.unit).replace(/\{stock\}/g, data.item.stock), data.tx_id);
      return true;
    } catch (e) {
      row.classList.add("rcv-error");
      const why = e instanceof TypeError ? T("サーバに接続できません") : (e.message !== "error" ? e.message : "");
      setResult(row, "rcv-ng", T("記録できません") + (why ? ": " + why : ""));
      return false;
    } finally {
      busy.delete(row);
      row.classList.remove("rcv-saving");
    }
  }

  async function undo(row, txId, btn) {
    if (!confirm(T("この入庫を取り消しますか？") + "\n" + row.dataset.name)) return;
    btn.disabled = true;
    try {
      const data = await post("api/void/" + txId);
      if (!data.ok) throw new Error(data.error || "error");
      const rp = parseInt(row.dataset.rp, 10) || 0;
      setStock(row, data.stock, data.stock <= 0 ? "empty" : data.stock <= rp ? "low" : "ok");
      row.classList.remove("rcv-done");
      setResult(row, "muted", T("取り消しました（在庫 {stock}{unit}）")
        .replace(/\{stock\}/g, data.stock).replace(/\{unit\}/g, row.dataset.unit));
    } catch (e) {
      btn.disabled = false;
      const why = e instanceof TypeError ? T("サーバに接続できません") : (e.message !== "error" ? e.message : "");
      alert(T("取り消せませんでした") + (why ? ": " + why : ""));
    }
  }

  rows.forEach((row) => {
    const input = row.querySelector(".rcv-input");
    input.addEventListener("focus", () => input.select());
    // スマホの数字キーには Enter がないので、ボタンでも記録できるようにする
    row.querySelector(".rcv-btn").addEventListener("click", async () => {
      if (toHalf(input.value) === "") { input.focus(); return; }
      await save(input);
    });
    input.addEventListener("keydown", async (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      const list = visibleInputs();
      const i = list.indexOf(input);
      if (e.key === "ArrowUp") { e.preventDefault(); (i > 0 ? list[i - 1] : filter).focus(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); if (i + 1 < list.length) list[i + 1].focus(); return; }
      if (e.key === "Escape") { e.preventDefault(); input.value = ""; filter.focus(); return; }
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (toHalf(input.value) === "") { filter.focus(); return; }
      // 記録できたら、次の品物を探せるように検索欄へ戻る
      if (await save(input)) { filter.focus(); filter.select(); }
    });
  });

  // 絞り込み: 品名・コード・読み方などで探す
  function applyFilter() {
    const q = filter.value.trim().toLowerCase();
    let shown = 0;
    rows.forEach((r) => {
      r.hidden = (q && !r.dataset.search.includes(q)) || (onlyLow.checked && r.dataset.status === "ok");
      if (!r.hidden) shown++;
    });
    document.getElementById("rcv-none").hidden = shown > 0 || !rows.length;
  }
  filter.addEventListener("input", applyFilter);
  onlyLow.addEventListener("change", applyFilter);
  filter.addEventListener("keydown", (e) => {
    if (e.isComposing || e.keyCode === 229) return;  // 日本語の変換を確定する Enter では動かない (Safari は keyCode 229)
    if (e.key !== "Enter" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const first = visibleInputs()[0];
    if (first) first.focus();
  });

  if (window.matchMedia("(min-width: 700px)").matches) filter.focus();
})();
