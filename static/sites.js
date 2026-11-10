// Copyright © 2026. All rights reserved.
// 全現場の在庫: 各現場のPCから「まとめ」を読み込んで、1つの画面に並べる
(function () {
  "use strict";
  const conf = JSON.parse(document.getElementById("sites-data").textContent);
  // https (スマホのカメラ用のアドレス) で開いた時は、ほかの現場 (http) を読めないので、ふつうのアドレスを案内する
  if (location.protocol === "https:") {
    const link = document.getElementById("sites-http-link");
    link.href = "http://" + location.hostname + ":" + conf.http_port + location.pathname;
    document.getElementById("sites-https").hidden = false;
  }
  // この現場 (このアプリ自身) + 設定で登録したほかの現場
  const self = location.pathname.replace(/sites\/?$/, "");
  const sites = [{ url: self, label: conf.self, isSelf: true }].concat(conf.others.map((u) => ({ url: u, label: u })));
  const STATUS = { empty: T("在庫切れ"), low: T("要補充"), ok: T("適正") };
  let results = [];
  let loading = null;  // 読み込み中の refresh (重ねて動かさない)
  const known = new Set(conf.known || []);  // 番号を覚えている現場 (アドレスが変わっても探し直せる)
  // 探し直した時刻 (画面を開いたままでも、つながらない現場は10分ごとに探し直す。毎分は探さない)
  const relocatedAt = new Map();
  const RELOCATE_EVERY = 10 * 60 * 1000;

  // つながらなくなった現場も、最後に読めた時の在庫を出せるように、この端末に覚えておく
  const CACHE_KEY = "stock.sites.cache";
  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function writeCache(list) {
    const old = readCache();
    const c = {};  // 今の現場の分だけ残す (登録を外した現場は忘れる)
    list.forEach((r) => {
      if (r.site.isSelf) return;
      const k = norm(r.site.url);
      if (r.data) c[k] = { data: r.data, at: Date.now() };
      else if (old[k]) c[k] = old[k];
    });
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) { /* いっぱいの時などは覚えない */ }
  }
  async function postJson(path, body) {
    try {
      const res = await fetch(self + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return await res.json();
    } catch (e) { return { ok: false }; }
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  };
  const name = (it) => (window.LANG === "id" && it.name_id) ? it.name_id : it.name;

  async function load(site) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(site.url + "api/summary", { signal: ctrl.signal, cache: "no-store" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "error");
      return { site, data };
    } catch (e) {
      return { site, error: e.name === "AbortError" ? T("時間内に返事がありません") : T("つながりません") };
    } finally {
      clearTimeout(timer);
    }
  }

  function siteLabel(r) { const d = r.data || r.stale; return (d && d.site) || r.site.label; }
  const view = (r) => r.data || r.stale;  // 表示に使うまとめ (つながらない時は、前回のもの)
  function openLink(r, path, text) {
    const a = el("a", "btn btn-small", text);
    a.href = r.site.url + path;
    if (!r.site.isSelf) a.target = "_blank";
    return a;
  }
  function troubleHelp() {
    const d = el("details", "site-help");
    d.appendChild(el("summary", "", T("つながらない時は")));
    const ol = el("ol");
    [T("その現場のPCの電源が入っていて、アプリの黒い画面が出ているか"),
     T("この画面のPCで、上のアドレスをブラウザで開けるか（開ければ、つながっています）"),
     T("その現場のPCで、Windows のファイアウォールが 5000番を許可しているか"),
     T("同じ社内のネットワーク（またはVPN）につながっているか")].forEach((t) => ol.appendChild(el("li", "", t)));
    d.appendChild(ol);
    return d;
  }

  function renderCards() {
    const box = document.getElementById("site-cards");
    box.textContent = "";
    results.forEach((r) => {
      const card = el("div", "card site-card" + (r.error ? " site-error" : ""));
      const head = el("div", "site-card-head");
      head.appendChild(el("strong", "", siteLabel(r)));
      const pv = view(r);
      if (pv && pv.prefix) head.appendChild(el("span", "badge mono", T("コード {p}", { p: pv.prefix })));
      if (r.site.isSelf) head.appendChild(el("span", "badge", T("この現場")));
      else if (r.site.found) head.appendChild(el("span", "muted small", T("ほかの現場の登録から")));
      card.appendChild(head);
      if (r.error) {
        card.appendChild(el("div", "site-card-msg", "⚠ " + r.error));
        card.appendChild(el("div", "muted small mono", r.site.url));
      }
      const d = view(r);
      if (d) {
        const c = d.counts;
        const nums = el("div", "site-card-nums");
        [[c.empty, T("在庫切れ"), "empty"], [c.low, T("要補充"), "low"], [c.total, T("品目"), "ok"]].forEach(([n, label, cls]) => {
          const b = el("div", "site-num site-num-" + cls + (n && cls !== "ok" ? " has" : ""));
          b.appendChild(el("strong", "", String(n)));
          b.appendChild(el("span", "", label));
          nums.appendChild(b);
        });
        card.appendChild(nums);
        card.appendChild(el("div", "muted small", r.data ? T("{t} 時点", { t: d.time })
          : T("前回つながった時（{t}）の在庫です", { t: d.time })));
        if (r.data && d.version && conf.version && d.version !== conf.version) {
          card.appendChild(el("div", "site-card-ver small", T("アプリの版が違います（{v}）", { v: d.version })));
        }
      }
      if (r.moved) card.appendChild(el("div", "site-card-moved small", T("PCのアドレスが変わっていたので、新しいアドレスに登録し直しました")));
      if (r.error) card.appendChild(troubleHelp());
      if (/^https?:\/\//i.test(r.site.url) || r.site.isSelf) {
        const acts = el("div", "site-card-acts");
        if (!r.site.isSelf) acts.appendChild(openLink(r, "", T("開く")));
        if (d) {  // 一度もつながっていない現場は、開いて確かめるボタンだけ
          acts.appendChild(openLink(r, "receive", T("入庫")));
          acts.appendChild(openLink(r, "reorder", T("補充リスト")));
        }
        card.appendChild(acts);
      }
      box.appendChild(card);
    });
  }

  // 拠点コードが同じ現場 (決めていない現場どうしも含む) があると、品目コードが被るので知らせる
  function renderPrefixWarn() {
    const box = document.getElementById("sites-prefix-warn");
    const groups = new Map();
    results.forEach((r) => {
      const d = view(r);
      if (!d || !d.items || !d.items.length) return;
      const k = d.prefix || "";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(siteLabel(r));
    });
    const dup = [...groups].filter(([, names]) => names.length > 1);
    box.hidden = !dup.length;
    box.textContent = dup.map(([p, names]) => p
      ? T("拠点コード「{p}」が同じ現場があります（{names}）。品目コードが被るので、「設定」→「現場名・ほかの現場」で別の文字にしてください。", { p, names: names.join("・") })
      : T("拠点コードを決めていない現場が複数あります（{names}）。品目コードが被ることがあるので、「設定」→「現場名・ほかの現場」で拠点ごとに別の文字を決めてください。", { names: names.join("・") })).join(" ");
  }

  function row(cells) {
    const tr = el("tr");
    cells.forEach(([text, cls]) => tr.appendChild(el("td", cls || "", text)));
    return tr;
  }

  function renderLow() {
    const body = document.querySelector("#sites-low tbody");
    body.textContent = "";
    const list = [];
    results.forEach((r) => view(r) && view(r).items.forEach((it) => { if (it.status !== "ok") list.push([r, it]); }));
    list.sort((a, b) => (a[1].status === b[1].status ? 0 : a[1].status === "empty" ? -1 : 1) || a[1].stock - b[1].stock);
    if (!list.length) { body.appendChild(row([[T("補充が必要な品目はありません"), "muted"]])).firstChild.colSpan = 8; return; }
    list.forEach(([r, it]) => {
      const tr = row([[siteLabel(r) + (r.data ? "" : " " + T("（前回の情報）"))], [name(it)], [it.spec, "opt"], [it.location, "opt"],
        [it.stock + T(it.unit), "r"], [String(it.reorder_point), "r"]]);
      const st = el("td");
      st.appendChild(el("span", "badge badge-" + it.status, STATUS[it.status]));
      if (it.ordered) st.appendChild(el("span", "muted small", " " + T("発注済み")));
      tr.appendChild(st);
      // 事務所で補充を受けた時など: その現場の補充リストを開いて、届いた数を記録する
      const act = el("td");
      const a = el("a", "btn btn-small", T("補充を記録"));
      a.href = r.site.url + "reorder";
      if (!r.site.isSelf) a.target = "_blank";
      act.appendChild(a);
      tr.appendChild(act);
      tr.className = "row-" + it.status + (r.data ? "" : " site-stale");
      body.appendChild(tr);
    });
  }

  function renderAll() {
    const body = document.querySelector("#sites-all tbody");
    const q = document.getElementById("sites-q").value.trim().toLowerCase();
    const only = document.getElementById("sites-filter").value;
    body.textContent = "";
    let n = 0;
    results.forEach((r) => {
      if (!view(r) || (only !== "" && siteKey(r) !== only)) return;
      view(r).items.forEach((it) => {
        const hay = [it.code, it.name, it.name_id, it.spec, it.location, it.category].join(" ").toLowerCase();
        if (q && !hay.includes(q)) return;
        const tr = row([[siteLabel(r)], [it.code, "mono opt"], [name(it)], [it.spec, "opt"], [it.location, "opt"],
          [it.stock + T(it.unit), "r"], [String(it.reorder_point), "r opt"]]);
        const st = el("td");
        st.appendChild(el("span", "badge badge-" + it.status, STATUS[it.status]));
        tr.appendChild(st);
        tr.className = "row-" + it.status + (r.data ? "" : " site-stale");
        body.appendChild(tr);
        n++;
      });
    });
    if (!n) { const tr = row([[T("品目がありません"), "muted"]]); tr.firstChild.colSpan = 8; body.appendChild(tr); }
  }

  // 絞り込みの値: 読み直して並び順が変わっても同じ現場を指すよう、番号ではなく現場の番号 (無ければアドレス) を使う
  function siteKey(r) { return (view(r) && view(r).id) || r.site.url; }

  function renderFilter() {
    const sel = document.getElementById("sites-filter");
    const keep = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    results.forEach((r) => { if (view(r)) sel.add(new Option(siteLabel(r), siteKey(r))); });
    sel.value = keep;
    if (sel.value !== keep) sel.value = "";  // 選んでいた現場が読めなくなった時は「すべての現場」に戻す
  }

  // 登録した現場の「ほかの現場」も順にたどって読む (どこか1つの現場を登録すれば、全部が出る)
  const MAX_SITES = 30;
  const norm = (u) => String(u || "").trim().toLowerCase().replace(/\/?$/, "/");
  // ほかの現場から届いたアドレスは http(s) のものだけ使う (javascript: などは開かない・読まない)
  const isWebUrl = (u) => /^https?:\/\/[^/]/i.test(String(u || "").trim());
  async function loadAll() {
    const seenUrl = new Set(sites.map((x) => norm(new URL(x.url, location.href).href)));
    const seenId = new Set();
    let queue = sites.slice();
    const out = [];
    while (queue.length && out.length < MAX_SITES) {
      const batch = await Promise.all(queue.map(load));
      queue = [];
      batch.forEach((r) => {
        if (r.data) {
          if (r.data.id && seenId.has(r.data.id)) return;  // 同じ現場を別のアドレスで読んだ (自分自身など)
          if (r.data.id) seenId.add(r.data.id);
          (r.data.sites || []).forEach((u) => {
            if (isWebUrl(u) && !seenUrl.has(norm(u))) { seenUrl.add(norm(u)); queue.push({ url: norm(u), label: u, found: true }); }
          });
        }
        out.push(r);
      });
    }
    const list = out.slice(0, MAX_SITES);
    const cache = readCache();
    list.forEach((r) => {
      if (!r.data && !r.site.isSelf) {
        const c = cache[norm(r.site.url)];
        if (c) r.stale = c.data;
      }
    });
    writeCache(list);
    return list;
  }

  // 登録した現場の番号を覚えてもらう / つながらない現場を探し直す
  async function maintain(list) {
    let changed = false;
    for (const r of list) {
      if (r.site.isSelf || r.site.found) continue;  // 自分と、ほかの現場の登録からたどった現場は対象外
      if (r.data && r.data.id && !known.has(r.site.url)) {
        known.add(r.site.url);
        postJson("api/sites/remember", { url: r.site.url, id: r.data.id });
      }
      if (r.error && known.has(r.site.url) && !(Date.now() - (relocatedAt.get(r.site.url) || 0) < RELOCATE_EVERY)) {
        relocatedAt.set(r.site.url, Date.now());
        const res = await postJson("api/sites/relocate", { url: r.site.url });
        if (res.ok && res.found) {
          const s = sites.find((x) => x.url === r.site.url);
          known.delete(s.url); known.add(res.url);
          s.url = res.url; s.label = res.url; s.moved = true;
          changed = true;
        }
      }
    }
    return changed;
  }

  async function refresh() {
    if (loading) return loading;
    loading = (async () => {
      let list = await loadAll();
      if (await maintain(list)) list = await loadAll();  // アドレスが変わっていた現場を、新しいアドレスで読み直す
      list.forEach((r) => { if (r.site.moved && r.data) r.moved = true; });
      return list;
    })();
    try {
      results = await loading;
    } finally {
      loading = null;
    }
    renderCards();
    renderPrefixWarn();
    renderLow();
    renderFilter();
    renderAll();
    const ok = results.filter((r) => r.data).length;
    document.getElementById("sites-updated").textContent =
      T("{ok} / {n} 現場から読み込みました（{t}）", { ok, n: results.length, t: new Date().toLocaleTimeString() });
  }

  document.getElementById("sites-reload").addEventListener("click", refresh);
  document.getElementById("sites-q").addEventListener("input", renderAll);
  document.getElementById("sites-filter").addEventListener("change", renderAll);
  refresh();
  setInterval(refresh, 60000);
})();
