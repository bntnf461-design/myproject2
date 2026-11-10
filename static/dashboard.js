// Copyright © 2026. All rights reserved.
// ダッシュボードの自動更新と、補充タイミングになった品目のお知らせ (色・音・音声)
(function () {
  "use strict";

  const N = window.StockNotify;
  const POLL_SECONDS = 15;        // 要補充品目の確認間隔
  const REFRESH_SECONDS = 60;     // 変化が無くても画面を更新する間隔
  const REMIND_MINUTES = 10;      // 確認ボタンが押されるまで繰り返し知らせる間隔

  const banner = document.getElementById("live-banner");
  const soundBtn = document.getElementById("sound-btn");
  const liveStatus = document.getElementById("live-status");
  const base = location.pathname.replace(/\/$/, "") + "/";

  let soundOn = false;
  let known = null;               // id → status (前回確認時の要補充品目)
  let fresh = new Map();          // 新しく要補充になった、未確認の品目 id → item
  let lastRefresh = Date.now();
  let remindTimer = null;

  // ブラウザの制約で、音を出すには画面を一度操作する必要がある
  function enableSound() {
    N.unlock();
    soundOn = true;
    soundBtn.hidden = true;
    liveStatus.textContent = T("音声お知らせ: オン");
  }
  soundBtn.addEventListener("click", () => {
    enableSound();
    N.sound("ok");
    N.speak(T("補充のお知らせを、音声でお伝えします。"));
  });
  document.addEventListener("pointerdown", () => { if (!soundOn) enableSound(); }, { once: true });

  async function fetchAlerts() {
    const res = await fetch(base + "api/alerts", { cache: "no-store" });
    return res.json();
  }

  async function refreshArea() {
    const res = await fetch(location.href, { cache: "no-store" });
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const next = doc.getElementById("live-area");
    if (next) document.getElementById("live-area").replaceWith(next);
    lastRefresh = Date.now();
    markFresh();
  }

  function markFresh() {
    fresh.forEach((_, id) => {
      const tile = document.querySelector('.stock-tile[data-item-id="' + id + '"]');
      if (tile) tile.classList.add("tile-new");
    });
  }

  function bannerLabel(i) { return window.itemLabel(i) + (i.spec ? "（" + i.spec + "）" : ""); }

  function announce(items) {
    const anyEmpty = items.some((i) => i.status === "empty");
    const list = Array.from(fresh.values());
    banner.className = "live-banner" + (list.some((i) => i.status === "empty") ? " is-empty" : "");
    banner.replaceChildren();
    banner.append((anyEmpty ? T("在庫切れ: ") : T("補充してください: ")) +
      list.map((i) => bannerLabel(i) + " " + T("残り{n}{unit}", { n: i.stock, unit: T(i.unit) })).join(" / "));
    const small = document.createElement("small");
    small.textContent = T("タッチで確認済みにする");
    banner.appendChild(small);
    banner.hidden = false;
    document.body.classList.add("has-banner");
    if (soundOn) {
      N.sound(anyEmpty ? "empty" : "alarm");
      const sep = window.LANG === "id" ? " " : "";  // インドネシア語は文の間を空ける
      const text = items.map((i) => (i.status === "empty"
        ? T("{name}が、在庫切れになりました。", { name: N.itemName(i) })
        : T("{name}が、発注点を下回りました。残りは{n}{unit}です。", { name: N.itemName(i), n: i.stock, unit: T(i.unit) })))
        .join(sep) + sep + T("補充をお願いします。");
      N.speak(text, { delay: anyEmpty ? 1300 : 1650 });
    }
    clearInterval(remindTimer);
    remindTimer = setInterval(() => {
      if (!fresh.size) return;
      announceRepeat();
    }, REMIND_MINUTES * 60000);
  }
  function announceRepeat() {
    const list = Array.from(fresh.values());
    if (!soundOn || !list.length) return;
    N.sound("alarm");
    N.speak(T("補充が必要な品目があります。{names}。補充をお願いします。", { names: list.map((i) => N.itemName(i)).join(T("。")) }), { delay: 1650 });
  }

  banner.addEventListener("click", () => {
    fresh.clear();
    banner.hidden = true;
    document.body.classList.remove("has-banner");
    clearInterval(remindTimer);
    document.querySelectorAll(".tile-new").forEach((t) => t.classList.remove("tile-new"));
  });

  async function poll() {
    try {
      const data = await fetchAlerts();
      const now = new Map(data.items.map((i) => [i.id, i]));
      let changed = known === null || now.size !== known.size;
      const newly = [];
      if (known !== null) {
        now.forEach((item, id) => {
          const before = known.get(id);
          if (before !== item.status) changed = true;
          // 新たに要補充になった品目、または要補充から在庫切れになった品目を知らせる
          if (!before || (before === "low" && item.status === "empty")) newly.push(item);
        });
      }
      // 補充されて解消した品目はお知らせからも外す
      fresh.forEach((_, id) => { if (!now.has(id)) fresh.delete(id); });
      newly.forEach((i) => fresh.set(i.id, i));
      if (!fresh.size && !banner.hidden) banner.click();
      known = new Map(Array.from(now, ([id, i]) => [id, i.status]));

      if (changed || Date.now() - lastRefresh > REFRESH_SECONDS * 1000) await refreshArea();
      if (newly.length) announce(newly);
      liveStatus.textContent = soundOn ? T("音声お知らせ: オン") : "";
    } catch (e) {
      liveStatus.textContent = T("サーバに接続できません（再試行します）");
    }
  }

  poll();
  setInterval(poll, POLL_SECONDS * 1000);
})();
