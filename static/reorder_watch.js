// Copyright © 2026. All rights reserved.
// 補充リスト: 担当者で絞り込み、自分の担当の品目が新しく発注点を下回ったら音と音声で知らせる
(function () {
  "use strict";
  const sel = document.getElementById("buyer-filter");
  if (!sel) return;
  const KEY = "stock.buyer";
  const N = window.StockNotify;
  try { sel.value = localStorage.getItem(KEY) || ""; } catch (e) { /* 保存できなくても動く */ }
  if (sel.selectedIndex < 0) sel.value = "";  // 削除された担当者が保存されていた時

  // ブラウザの制約で、音を出すには画面を一度操作する必要がある
  function unlock() { if (N && N.unlock) N.unlock(); }
  document.addEventListener("pointerdown", unlock, { once: true });

  function apply() {
    const v = sel.value;
    document.querySelectorAll("tbody tr[data-buyer]").forEach((tr) => {
      tr.hidden = v !== "" && tr.dataset.buyer !== v;
    });
  }

  // 1分ごとに確かめ、選んだ担当者の品目が新しく増えたら知らせて、一覧を新しくする
  let known = null;
  sel.addEventListener("change", () => {
    try { localStorage.setItem(KEY, sel.value); } catch (e) { /* 無視 */ }
    apply();
    unlock();
    known = null;  // 担当者を変えたら、その人の今の品目を基準にし直す (前の人との差で知らせない)
    check();
  });
  apply();

  // 画面を読み直すと音の許可が消え、入力中の数も消えるため、一覧の部分だけを入れ替える
  async function refreshArea() {
    const area = document.getElementById("reorder-area");
    if (!area || (area.contains(document.activeElement) && document.activeElement.tagName === "INPUT")) return;
    const res = await fetch(location.href, { cache: "no-store" });
    const next = new DOMParser().parseFromString(await res.text(), "text/html").getElementById("reorder-area");
    if (next) { area.replaceWith(next); apply(); }
  }

  async function check() {
    const v = sel.value;
    if (!v || v === "none") return;
    try {
      const res = await fetch(location.pathname.replace(/reorder\/?$/, "") + "api/alerts", { cache: "no-store" });
      const data = await res.json();
      if (v !== sel.value) return;  // 読み込み中に担当者が変わった
      const mine = data.items.filter((i) => String(i.buyer_id) === v);
      const codes = new Set(mine.map((i) => i.code));
      if (known) {
        const added = mine.filter((i) => !known.has(i.code));
        if (added.length) {
          if (N) {
            N.sound("alarm");
            N.speak(T("発注の担当の品目が、発注点を下回りました。{names}。", { names: added.map((i) => N.itemName(i)).join("、") }), { delay: 1700 });
          }
          refreshArea().catch(() => { /* 次の回に */ });
        }
      }
      known = codes;
    } catch (e) { /* つながらない時は次の回に */ }
  }
  check();
  setInterval(check, 60000);
})();
