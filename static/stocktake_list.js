// Copyright © 2026. All rights reserved.
// 棚卸し: 一覧に数を打ち込んで保存する (Enter で次の行へ)
(function () {
  "use strict";
  const table = document.getElementById("stl-table");
  if (!table) return;
  const stId = table.dataset.id;
  const base = location.pathname.replace(/stocktake\/\d+\/list\/?$/, "");
  const rows = Array.from(table.querySelectorAll("tbody tr[data-code]"));
  const user = (() => { try { return localStorage.getItem("stock.user") || ""; } catch (e) { return ""; } })();

  // 全角数字を半角に、空白・桁区切りを除く (小数点や「-」は数字ではないので残して、あとで弾く)
  function toHalf(s) {
    return String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[\s,，]/g, "");
  }
  function visibleInputs() {
    return rows.filter((r) => !r.hidden).map((r) => r.querySelector(".stl-input"));
  }
  function setDiff(row, diff) {
    const cell = row.querySelector(".stl-diff");
    cell.textContent = "";
    const span = document.createElement("span");
    span.className = diff ? "stl-diff-ng" : "stl-diff-ok";
    span.textContent = diff ? (diff > 0 ? "+" : "") + diff : "✓";
    cell.appendChild(span);
  }
  // 金額 (数えた数 × 単価・税込)。単価の無い品目は出さない
  function yen(v) {
    const r = Math.round(v * 100) / 100;
    return "¥" + r.toLocaleString("ja-JP", { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 });
  }
  function setValue(row, counted) {
    const price = parseFloat(row.dataset.price || "0");
    row.querySelector(".stl-value").textContent = price ? yen(counted * price) : "";
  }
  function updateTotal() {
    const el = document.getElementById("stl-value");
    if (!el) return;
    let sum = 0;
    rows.forEach((r) => {
      const v = r.querySelector(".stl-input").dataset.saved;
      if (v !== undefined && v !== "") sum += parseInt(v, 10) * parseFloat(r.dataset.price || "0");
    });
    el.textContent = yen(sum);
  }
  function setProgress(done, total) {
    document.getElementById("stl-done").textContent = done;
    document.getElementById("stl-total").textContent = total;
    document.getElementById("stl-fill").style.width = (done / (total || 1) * 100).toFixed(1) + "%";
  }

  // 同じ欄の保存は1つずつ順に行う (Enter の連打や Enter のあとの change で二重に送らない)
  const inflight = new WeakMap();
  function save(input) {
    const p = (inflight.get(input) || Promise.resolve()).then(() => saveNow(input));
    inflight.set(input, p);
    return p;
  }

  async function saveNow(input) {
    const row = input.closest("tr");
    const v = toHalf(input.value);
    if (v === "") { input.value = input.dataset.saved; return true; }  // 空欄にしても保存済みの数は消えないので、元に戻す
    if (!/^\d+$/.test(v)) {
      row.classList.add("stl-error");
      row.querySelector(".stl-diff").textContent = T("数字で入れてください");
      return false;
    }
    input.value = v;
    if (v === input.dataset.saved) return true;  // 変わっていない時は何もしない
    row.classList.add("stl-saving");
    try {
      const res = await fetch(base + "api/stocktake/" + stId + "/count", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: row.dataset.code, counted: parseInt(v, 10), user }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!data.ok) throw new Error(data.error || "error");
      input.dataset.saved = v;
      row.classList.remove("stl-error");
      row.classList.add("stl-done");
      setDiff(row, data.diff);
      setValue(row, parseInt(v, 10));
      updateTotal();
      setProgress(data.done, data.total);
      return true;
    } catch (e) {
      row.classList.add("stl-error");
      const why = e instanceof TypeError ? T("サーバに接続できません") : (e.message !== "error" ? e.message : "");
      row.querySelector(".stl-diff").textContent = T("保存できません") + (why ? ": " + why : "");
      return false;
    } finally {
      row.classList.remove("stl-saving");
    }
  }

  rows.forEach((row) => {
    const input = row.querySelector(".stl-input");
    input.dataset.saved = input.value;
    input.addEventListener("focus", () => input.select());
    input.addEventListener("change", () => save(input));
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const list = visibleInputs();
      const i = list.indexOf(input);
      if (e.key === "ArrowUp") { if (i > 0) list[i - 1].focus(); return; }
      const ok = await save(input);
      if (ok && i >= 0 && i + 1 < list.length) list[i + 1].focus();
    });
  });

  // 絞り込み
  const filter = document.getElementById("stl-filter");
  const onlyTodo = document.getElementById("stl-only-todo");
  const folder = document.getElementById("stl-folder");  // フォルダ (中のフォルダも含む) で絞り込む
  function applyFilter() {
    const q = filter.value.trim().toLowerCase();
    const f = folder ? folder.value : "";
    rows.forEach((r) => {
      const cat = r.dataset.cat || "";
      r.hidden = (q && !r.dataset.search.includes(q)) || (onlyTodo.checked && r.classList.contains("stl-done")) ||
        (f && cat !== f && !cat.startsWith(f + "/"));
    });
  }
  filter.addEventListener("input", applyFilter);
  onlyTodo.addEventListener("change", applyFilter);
  if (folder) folder.addEventListener("change", applyFilter);
  updateTotal();

  const first = visibleInputs().find((i) => i.value === "") || visibleInputs()[0];
  if (first && window.matchMedia("(min-width: 700px)").matches) first.focus();
})();
