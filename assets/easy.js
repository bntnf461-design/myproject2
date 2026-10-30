/* =========================================================
   作業者用のかんたん画面
   - 大きなボタンを押していくだけ（例：ライン → 工程 → 作業）で要領書を開く
   - ボタンの段（ライン・製品・工程 など）と順番・名前は、設定画面の「一覧で絞り込む項目」に合わせる
   - 選ぶものが 1 つしか無い段は自動で飛ばす（押す回数を減らす）
   ========================================================= */
(function () {
  "use strict";
  var esc = WI.esc;
  var cat = window.CATALOG || { files: [] };
  var conf = WI.catConfig(cat);
  var levels = conf.levels;
  var NONE = "\u0000"; // 「その他（指定なし）」

  var lang = "ja";
  try { lang = localStorage.getItem("wi.lang") === "id" ? "id" : "ja"; } catch (e) {}
  var ID = {
    "どの作業ですか？": "Pekerjaan yang mana?", "◀ もどる": "◀ Kembali", "さいきん見た作業": "Terakhir dilihat",
    "その他": "Lainnya", "件": "", "作業": "pekerjaan", "改訂あり": "Ada revisi", "要領書がありません": "Belum ada instruksi kerja"
  };
  function L(t) { return lang === "id" && ID[t] != null ? ID[t] : t; }

  document.getElementById("org").innerHTML = WI.orgHtml(cat);
  document.title = WI.orgName(cat) + " 作業要領書";

  var all = [];
  var path = []; // [{ k, v, auto }]
  var grid = document.getElementById("grid");

  WI.loadManualFiles(cat.files || [], function (results) {
    all = results.filter(function (r) { return r.data; }).map(function (r) { return r.data; });
    // 訳がある要領書があれば、言語の切り替えを出す
    var hasTr = all.some(function (m) { return m.tr && m.tr.id && Object.keys(m.tr.id).length; });
    var lb = document.getElementById("lang");
    lb.hidden = !hasTr;
    if (!hasTr) lang = "ja";
    lb.addEventListener("click", function () {
      lang = lang === "id" ? "ja" : "id";
      try { localStorage.setItem("wi.lang", lang); } catch (e) {}
      render();
    });
    // 前に選んでいた場所に戻る（要領書から「もどる」で来たとき）
    try { path = JSON.parse(sessionStorage.getItem("wi.easyPath") || "[]"); } catch (e) { path = []; }
    path = path.filter(function (p) { return levels.indexOf(p.k) !== -1; });
    render();
  });

  function valuesOf(m, k) {
    var v = WI.splitCat(m[k]);
    return v.length ? v : [NONE];
  }
  function subset() {
    return all.filter(function (m) {
      return path.every(function (p) { return valuesOf(m, p.k).indexOf(p.v) !== -1; });
    });
  }
  function choices(list, k) {
    var count = {};
    list.forEach(function (m) { valuesOf(m, k).forEach(function (v) { count[v] = (count[v] || 0) + 1; }); });
    var order = conf.categories[k] || [];
    var keys = Object.keys(count).filter(function (v) { return v !== NONE; }).sort(WI.catSorter(order));
    if (count[NONE]) keys.push(NONE);
    return keys.map(function (v) { return { v: v, n: count[v] }; });
  }

  function save() { try { sessionStorage.setItem("wi.easyPath", JSON.stringify(path)); } catch (e) {} }

  function render() {
    document.documentElement.classList.toggle("lang-id", lang === "id");
    document.getElementById("lang").textContent = lang === "id" ? "🌐 日本語" : "🌐 Bahasa Indonesia";
    document.getElementById("back").textContent = L("◀ もどる");

    // 選ぶものが 1 つしか無い段は飛ばす
    var list = subset();
    while (path.length < levels.length) {
      var ch = choices(list, levels[path.length]);
      if (ch.length > 1) break;
      if (!ch.length) break;
      path.push({ k: levels[path.length], v: ch[0].v, auto: true });
      list = subset();
    }
    save();

    var back = document.getElementById("back");
    back.hidden = !path.some(function (p) { return !p.auto; });
    document.getElementById("path").innerHTML = path.filter(function (p) { return p.v !== NONE || !p.auto; }).map(function (p) {
      return '<span>' + esc(p.v === NONE ? L("その他") : p.v) + '</span>';
    }).join('<i>＞</i>');
    document.querySelector(".easy-nav").hidden = back.hidden && !document.getElementById("path").innerHTML;

    var q = document.getElementById("q");
    if (!all.length) { q.textContent = L("要領書がありません"); grid.innerHTML = ""; return; }

    if (path.length < levels.length) {
      var k = levels[path.length];
      q.textContent = lang === "id" ? "Pilih " + conf.labels[k] : "どの" + conf.labels[k] + "ですか？";
      grid.className = "easy-grid";
      grid.innerHTML = choices(list, k).map(function (c) {
        return '<button type="button" class="easy-tile" data-v="' + esc(c.v) + '">' +
          '<span class="t">' + esc(c.v === NONE ? L("その他") : c.v) + '</span>' +
          '<span class="n">' + c.n + (lang === "id" ? " " + L("作業") : " 件") + '</span></button>';
      }).join("");
    } else {
      q.textContent = L("どの作業ですか？");
      grid.className = "easy-grid docs";
      list.sort(function (a, b) { return WI.compareText(a.docNo || a.title, b.docNo || b.title); });
      grid.innerHTML = list.map(docTile).join("");
    }
    recent();
  }

  function title(m) {
    var e = lang === "id" && WI.trLookup(m, "id", "title", m.title);
    return e ? e.t : m.title;
  }
  function docTile(m) {
    var img = (m.steps || []).filter(function (s) { return s.image; })[0];
    var d = Date.parse(m.updated || "");
    var revised = WI.revChanges(m).count && !isNaN(d) && (Date.now() - d) / 86400000 <= 60;
    return '<a class="easy-doc" href="manual.html?file=' + encodeURIComponent(m._file) + '&from=easy">' +
      (img ? '<img src="' + esc(img.image) + '" alt="" loading="lazy" onerror="this.remove()">' : '<span class="noimg">▶</span>') +
      '<span class="t">' + esc(title(m)) + (lang === "id" && title(m) !== m.title ? '<small>' + esc(m.title) + '</small>' : '') + '</span>' +
      '<span class="no">' + esc(m.docNo || "") + (revised ? ' <b class="rev-badge">' + L("改訂あり") + '</b>' : '') + '</span>' +
    '</a>';
  }

  function recent() {
    var box = document.getElementById("recent");
    if (path.some(function (p) { return !p.auto; })) { box.innerHTML = ""; return; }
    var files = [];
    try { files = JSON.parse(localStorage.getItem("wi.recent") || "[]"); } catch (e) {}
    var list = files.map(function (f) { return all.filter(function (m) { return m._file === f; })[0]; }).filter(Boolean).slice(0, 4);
    box.innerHTML = list.length ? '<h2>' + L("さいきん見た作業") + '</h2><div class="easy-grid docs small">' + list.map(docTile).join("") + '</div>' : "";
  }

  grid.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-v]");
    if (!b) return;
    path.push({ k: levels[path.length], v: b.getAttribute("data-v") });
    render();
    window.scrollTo(0, 0);
  });
  document.getElementById("back").addEventListener("click", function () {
    // 自動で飛ばした段も一緒に戻る
    while (path.length && path[path.length - 1].auto) path.pop();
    path.pop();
    while (path.length && path[path.length - 1].auto) path.pop();
    render();
  });
  document.getElementById("admin").addEventListener("click", function (ev) {
    if (!confirm("要領書を作る・直すなど、リーダー・管理者の方向けの画面です。開きますか？")) ev.preventDefault();
  });
})();
