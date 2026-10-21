/* =========================================================
   要領書の一覧
   - ライン・製品・工程などのカテゴリーをタップして絞り込む
   - どの項目で絞り込むか・順番は manuals/catalog.js の levels で設定
   ========================================================= */
(function () {
  "use strict";
  var esc = WI.esc;
  var listEl = document.getElementById("list");
  var statusEl = document.getElementById("status");
  var filtersEl = document.getElementById("filters");
  var barEl = document.getElementById("resultBar");
  var qEl = document.getElementById("q");
  var STATE_KEY = "wi.filter";
  var NONE = "__none__"; // 「未設定」を表す値
  var MAX_CHIPS = 12;  // これより多い場合は「すべて表示」で開く

  var items = [];
  var sel = {};       // 選んでいるカテゴリー { line: "Aライン", ... }
  var expanded = {};  // 「すべて表示」を開いている行

  WI.initTextSize(document.getElementById("textSize"));

  var cat = window.CATALOG || { files: [] };
  var conf = WI.catConfig(cat);
  var levels = conf.levels;
  var LABEL = conf.labels;

  if (cat.siteName) {
    document.getElementById("siteName").textContent = cat.siteName;
    document.title = cat.siteName;
  }

  // 前回の絞り込みを復元（要領書を見て戻ってきたときに、同じ一覧に戻れるように）
  try {
    var saved = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
    sel = saved.sel || {};
    qEl.value = saved.q || "";
  } catch (e) {}

  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify({ sel: sel, q: qEl.value })); } catch (e) {}
  }

  if (!cat.files || !cat.files.length) {
    statusEl.textContent = "要領書が登録されていません。エディタで作成して「フォルダに保存」してください。";
    return;
  }

  WI.loadManualFiles(cat.files, function (results) {
    var errors = [];
    results.forEach(function (r) {
      if (r.data) items.push(r.data); else errors.push(r.error);
    });
    if (errors.length) {
      statusEl.className = "notice error";
      statusEl.innerHTML = errors.map(esc).join("<br>");
    } else {
      statusEl.style.display = "none";
    }
    items.sort(function (a, b) {
      for (var i = 0; i < levels.length; i++) {
        var x = valuesOf(a, levels[i])[0], y = valuesOf(b, levels[i])[0];
        if (x !== y) return cmp(levels[i])(x, y);
      }
      return String(a.docNo || "").localeCompare(String(b.docNo || ""), "ja", { numeric: true });
    });
    render();
  });

  // 1 つの要領書が複数のラインで使われる場合は「Aライン、Bライン」のように区切って書ける
  function valuesOf(m, key) {
    var v = WI.splitCat(m[key]);
    return v.length ? v : [NONE];
  }
  // 「未設定」は最後、それ以外は設定画面の並び順 → 名前順
  function cmp(key) {
    var s = WI.catSorter(conf.categories[key]);
    return function (a, b) { return a === NONE ? (b === NONE ? 0 : 1) : b === NONE ? -1 : s(a, b); };
  }

  function matchQuery(m) {
    var q = qEl.value.trim().toLowerCase();
    if (!q) return true;
    var t = [m.docNo, m.title, m.process, m.line, m.product, m.category, m.purpose].join(" ").toLowerCase();
    return q.split(/\s+/).every(function (w) { return t.indexOf(w) !== -1; });
  }

  // except 以外の選択条件に合うか
  function matchSel(m, except) {
    return levels.every(function (k) {
      if (k === except || sel[k] === undefined) return true;
      return valuesOf(m, k).indexOf(sel[k]) !== -1;
    });
  }

  function label(v) { return v === NONE ? "（未設定）" : v; }

  function render() {
    var base = items.filter(matchQuery);

    // ---- 絞り込みの行 ----
    var html = "";
    levels.forEach(function (k) {
      var counts = {};
      var order = [];
      base.forEach(function (m) {
        if (!matchSel(m, k)) return;
        valuesOf(m, k).forEach(function (v) {
          if (!counts[v]) { counts[v] = 0; order.push(v); }
          counts[v]++;
        });
      });
      // 選んでいる値が他の条件で 0 件になっても、外せるように表示は残す
      if (sel[k] !== undefined && !counts[sel[k]]) { counts[sel[k]] = 0; order.push(sel[k]); }
      if (!order.length) return;
      order.sort(cmp(k));
      var many = order.length > MAX_CHIPS && !expanded[k];
      var shown = many ? order.slice(0, MAX_CHIPS) : order;
      if (many && sel[k] !== undefined && shown.indexOf(sel[k]) === -1) shown.push(sel[k]);

      html += '<div class="filter-row"><div class="filter-label">' + LABEL[k] + '</div><div class="chips">' +
        '<button type="button" class="chip' + (sel[k] === undefined ? " on" : "") + '" data-k="' + k + '" data-all="1">すべて</button>' +
        shown.map(function (v) {
          return '<button type="button" class="chip' + (sel[k] === v ? " on" : "") + '" data-k="' + k + '" data-v="' + esc(v) + '"' +
            (sel[k] === v ? ' aria-pressed="true"' : '') + '>' + esc(label(v)) + '<span class="n">' + counts[v] + '</span></button>';
        }).join("") +
        (many ? '<button type="button" class="chip more" data-more="' + k + '">すべて表示（' + order.length + '）</button>' : '') +
      '</div></div>';
    });
    filtersEl.innerHTML = html;

    // ---- 結果 ----
    var list = base.filter(function (m) { return matchSel(m, null); });
    var path = levels.filter(function (k) { return sel[k] !== undefined; }).map(function (k) {
      return '<b>' + esc(label(sel[k])) + '</b>';
    });
    var filtered = path.length || qEl.value.trim();
    barEl.innerHTML = (path.length ? path.join(' <span class="sep">＞</span> ') + '　' : '') +
      '<span>' + list.length + ' 件</span>' +
      (filtered ? ' <button type="button" class="btn small" id="clearFilter">絞り込みを解除</button>' : '');

    // 絞り込んでいない上位の項目ごとに見出しを付けて並べる
    var groupKeys = levels.slice(0, -1).filter(function (k) { return sel[k] === undefined; });
    var groups = [];
    var byKey = {};
    list.forEach(function (m) {
      var g = groupKeys.map(function (k) { return label(valuesOf(m, k)[0]); }).join("　／　");
      if (!byKey[g]) { byKey[g] = []; groups.push(g); }
      byKey[g].push(m);
    });

    listEl.innerHTML = groups.map(function (g) {
      return (g ? '<h2 class="group-head">' + esc(g) + '</h2>' : '') +
        '<ul class="manual-list">' + byKey[g].map(card).join("") + '</ul>';
    }).join("") || (items.length ? '<div class="notice">該当する要領書がありません。</div>' : "");
  }

  function card(m) {
    var steps = (m.steps || []).length;
    var videos = (m.steps || []).filter(function (s) { return s.video && s.video.src; }).length;
    var meta = levels.filter(function (k) { return m[k]; }).map(function (k) { return esc(m[k]); }).join(" ／ ");
    return '<li><a class="manual-card" href="manual.html?file=' + encodeURIComponent(m._file) + '">' +
      '<div class="no">' + esc(m.docNo) + (m.revision ? "　改訂 " + esc(m.revision) : "") + '</div>' +
      '<div class="title">' + esc(m.title) + '</div>' +
      '<div class="meta">' +
        (m.category && levels.indexOf("category") === -1 ? '<span class="tag">' + esc(m.category) + '</span> ' : '') +
        meta + '<br>' +
        '手順 ' + steps + ' 件・動画 ' + videos + ' 件' +
        (m.updated ? '・更新 ' + esc(m.updated) : '') +
      '</div></a></li>';
  }

  filtersEl.addEventListener("click", function (ev) {
    var b = ev.target.closest("button");
    if (!b) return;
    var more = b.getAttribute("data-more");
    if (more) { expanded[more] = true; render(); return; }
    var k = b.getAttribute("data-k");
    if (b.getAttribute("data-all")) delete sel[k];
    else {
      var v = b.getAttribute("data-v");
      if (sel[k] === v) delete sel[k]; else sel[k] = v; // もう一度タップで解除
    }
    saveState();
    render();
  });

  barEl.addEventListener("click", function (ev) {
    if (ev.target.id !== "clearFilter") return;
    sel = {};
    qEl.value = "";
    saveState();
    render();
  });

  qEl.addEventListener("input", function () { saveState(); render(); });
})();
