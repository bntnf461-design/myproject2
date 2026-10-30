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
  var flags = {};     // すぐ絞り込み（noVideo: 動画がまだ／review: 見直し時期）

  WI.initTextSize(document.getElementById("textSize"));

  var cat = window.CATALOG || { files: [] };
  var conf = WI.catConfig(cat);
  var levels = conf.levels;
  var LABEL = conf.labels;

  document.getElementById("siteName").innerHTML = WI.orgHtml(cat) + '<span class="org-sep">＞</span><span class="org-part">一覧</span>';
  document.title = WI.orgName(cat) + " 一覧";

  // 前回の絞り込みを復元（要領書を見て戻ってきたときに、同じ一覧に戻れるように）
  try {
    var saved = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
    sel = saved.sel || {};
    flags = saved.flags || {};
    qEl.value = saved.q || "";
  } catch (e) {}

  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify({ sel: sel, q: qEl.value, flags: flags })); } catch (e) {}
  }

  if (!cat.files || !cat.files.length) {
    statusEl.innerHTML = "要領書が登録されていません。Excel の要領書は、フォルダに置いただけでは出ません。" +
      '<a href="bulk.html">Excel まとめて取り込み</a>で取り込んで保存してください。';
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
      return WI.compareText(a.docNo, b.docNo);
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

  // 全角・半角、大文字・小文字の違いを無視して探す（「ＧＫ」でも「gk」でも見つかる）
  function fold(s) { return String(s || "").normalize("NFKC").toLowerCase(); }

  function matchQuery(m) {
    var q = fold(qEl.value.trim());
    if (!q) return true;
    // 手順・急所の文字も対象（「トルク」「保存ボタン」などでも探せる）
    if (m._text === undefined) {
      var parts = [m.docNo, m.title, m.process, m.line, m.product, m.category, m.purpose, m._file,
        m.author, m.checker, m.inspector, m.approver];
      (m.steps || []).forEach(function (s) {
        parts.push(s.title, s.detail);
        (s.points || []).forEach(function (p) { parts.push(p.text, p.reason); });
      });
      m._text = fold(parts.join(" "));
    }
    var t = m._text;
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
    var byQuery = items.filter(matchQuery);
    var base = byQuery.filter(matchFlags);

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

    // ---- すぐ絞り込み（動画がまだ・見直し時期） ----
    var inSel = byQuery.filter(function (m) { return matchSel(m, null); });
    var nNo = inSel.filter(noVideo).length, nRev = inSel.filter(WI.needsReview).length;
    document.getElementById("quick").innerHTML =
      '<button type="button" class="chip toggle' + (flags.noVideo ? " on" : "") + '" data-flag="noVideo" aria-pressed="' + !!flags.noVideo + '">' +
        (flags.noVideo ? "✓ " : "") + '動画がまだの手順がある<span class="n">' + nNo + '</span></button>' +
      '<button type="button" class="chip toggle' + (flags.review ? " on" : "") + '" data-flag="review" aria-pressed="' + !!flags.review + '">' +
        (flags.review ? "✓ " : "") + '見直し時期（1 年以上 改訂なし）<span class="n">' + nRev + '</span></button>' +
      '<span style="flex:1"></span>' +
      '<button type="button" class="btn small" id="exportCsv" title="表示している要領書の一覧を、Excel で開けるファイルにします">⇩ 台帳を Excel で書き出す</button>';

    // ---- 結果 ----
    var list = base.filter(function (m) { return matchSel(m, null); });
    var path = levels.filter(function (k) { return sel[k] !== undefined; }).map(function (k) {
      return '<b>' + esc(label(sel[k])) + '</b>';
    });
    if (flags.noVideo) path.push("<b>動画がまだ</b>");
    if (flags.review) path.push("<b>見直し時期</b>");
    var filtered = path.length || qEl.value.trim();
    shown = list;
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

    listEl.innerHTML = (filtered ? "" : recentHtml()) + groups.map(function (g) {
      return (g ? '<h2 class="group-head">' + esc(g) + '</h2>' : '') +
        '<ul class="manual-list">' + byKey[g].map(card).join("") + '</ul>';
    }).join("") || (items.length ? '<div class="notice">該当する要領書がありません。<br>' +
      '<small>Excel の要領書は、フォルダに置いただけでは一覧に出ません。<a href="bulk.html">Excel まとめて取り込み</a>で取り込んで保存すると、一覧に出て探せるようになります。</small></div>' : "");
  }

  // 30 日以内に作られた・改訂された要領書に印を付ける（変更に気付けるように）
  var today = new Date();
  function badge(m) {
    if (WI.needsReview(m)) return ' <span class="tag review" title="最後の改訂から 1 年以上たっています">見直し時期</span>';
    var d = Date.parse(m.updated || m.issued || "");
    if (isNaN(d) || (today - d) / 86400000 > 30) return "";
    var isNew = !m.updated || m.updated === m.issued;
    return ' <span class="tag ' + (isNew ? "new" : "rev") + '">' + (isNew ? "新規" : "改訂") + '</span>';
  }

  // 最近見た要領書（絞り込み・検索をしていないときだけ表示）
  function recentHtml() {
    var files = [];
    try { files = JSON.parse(localStorage.getItem("wi.recent") || "[]"); } catch (e) {}
    var list = files.map(function (f) {
      for (var i = 0; i < items.length; i++) if (items[i]._file === f) return items[i];
      return null;
    }).filter(Boolean);
    if (!list.length) return "";
    return '<div class="recent"><span class="recent-label">最近見た要領書</span>' + list.map(function (m) {
      return '<a class="chip" href="manual.html?file=' + encodeURIComponent(m._file) + '">' + esc(m.title) + '</a>';
    }).join("") + '</div>';
  }

  function card(m) {
    var vs = WI.videoStats(m), steps = vs.all, videos = vs.done;
    var meta = levels.filter(function (k) { return m[k]; }).map(function (k) { return esc(m[k]); }).join(" ／ ");
    var thumb = (m.steps || []).filter(function (s) { return s.image; })[0];
    return '<li><a class="manual-card' + (thumb ? ' with-thumb' : '') + '" href="manual.html?file=' + encodeURIComponent(m._file) + '">' +
      (thumb ? '<img class="card-thumb" loading="lazy" decoding="async" src="' + esc(thumb.image) + '" alt="" onerror="this.remove()">' : '') +
      '<div class="no">' + esc(m.docNo) + (m.revision ? "　改訂 " + esc(m.revision) : "") + badge(m) + '</div>' +
      '<div class="title">' + esc(m.title) + '</div>' +
      '<div class="meta">' +
        (m.category && levels.indexOf("category") === -1 ? '<span class="tag">' + esc(m.category) + '</span> ' : '') +
        meta + '<br>' +
        '手順 ' + steps + ' 件・動画 ' + (videos < steps ? '<b class="warn-text">' + videos + ' / ' + steps + '</b>' : videos + ' / ' + steps) +
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

  function noVideo(m) { var v = WI.videoStats(m); return v.all > v.done; }
  function matchFlags(m) {
    return (!flags.noVideo || noVideo(m)) && (!flags.review || WI.needsReview(m));
  }

  var shown = [];
  document.getElementById("quick").addEventListener("click", function (ev) {
    var b = ev.target.closest("button");
    if (!b) return;
    if (b.id === "exportCsv") { exportCsv(shown); return; }
    var f = b.getAttribute("data-flag");
    if (!f) return;
    flags[f] = !flags[f];
    saveState();
    render();
  });

  // 表示している要領書の台帳（Excel で開ける CSV。文字化けしないよう BOM 付き UTF-8）
  function exportCsv(list) {
    var head = ["管理番号", "作業名", LABEL.line, LABEL.product, LABEL.process, LABEL.category, "改訂", "制定日", "改訂日", "手順数", "動画あり", "見直し時期", "作成", "確認", "点検", "承認", "ファイル"];
    var q = function (v) { v = String(v == null ? "" : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var rows = list.map(function (m) {
      var v = WI.videoStats(m);
      return [m.docNo, m.title, m.line, m.product, m.process, m.category, m.revision, m.issued, m.updated, v.all, v.done,
        WI.needsReview(m) ? "要" : "", m.author, m.checker, m.inspector, m.approver, m._file].map(q).join(",");
    });
    var csv = "\ufeff" + [head.map(q).join(",")].concat(rows).join("\r\n");
    var t = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "作業要領書_台帳_" + t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate()) + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  barEl.addEventListener("click", function (ev) {
    if (ev.target.id !== "clearFilter") return;
    sel = {};
    flags = {};
    qEl.value = "";
    saveState();
    render();
  });

  qEl.addEventListener("input", function () { saveState(); render(); });
})();
