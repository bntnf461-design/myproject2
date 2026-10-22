/* =========================================================
   共通処理
   - 要領書データは manuals/*.js に registerManual({...}) の形で記述
   - <script> 読み込みなので、サーバー無し（ファイルを直接開く）でも動作
   ========================================================= */
(function () {
  "use strict";

  var registry = {};
  var lastRegistered = null;
  var seq = 0;

  // 要領書データファイルから呼ばれる。どの読み込みのデータかは、実行中の <script> で判断する
  // （同時にいくつ読み込んでもデータが混ざらない）
  window.registerManual = function (data) {
    if (!data) return;
    lastRegistered = data;
    var sc = document.currentScript;
    if (sc && sc._wiResolve) sc._wiData = data;
    if (data.id) registry[data.id] = data;
  };

  // manuals/ 以下の .js を読み込む。完了時に callback(data or null, error)
  function loadManualFile(file, callback) {
    if (!/^[\w\-.\/]+\.js$/.test(file) || file.indexOf("..") !== -1) {
      callback(null, "ファイル名が不正です: " + file);
      return;
    }
    var s = document.createElement("script");
    s._wiResolve = true;
    s.src = "manuals/" + file + "?v=" + Date.now() + "-" + (seq++); // 更新がすぐ反映されるよう毎回読み直す
    s.onload = function () {
      var d = s._wiData || null;
      s.remove(); // 読み終わった <script> は残さない（メモリを節約）
      if (d) d._file = file;
      callback(d, d ? null : "データが登録されていません: " + file);
    };
    s.onerror = function () {
      s.remove();
      callback(null, "ファイルを読み込めません: manuals/" + file);
    };
    document.head.appendChild(s);
  }

  // 複数ファイルを読み込む（8 件ずつ同時に読み、結果は files と同じ順番で返す）
  function loadManualFiles(files, done) {
    var results = new Array(files.length);
    var next = 0, finished = 0, PARALLEL = 8;
    if (!files.length) { done([]); return; }
    function start() {
      if (next >= files.length) return;
      var i = next++;
      loadManualFile(files[i], function (data, err) {
        results[i] = { file: files[i], data: data, error: err };
        finished++;
        if (finished === files.length) done(results);
        else start();
      });
    }
    for (var k = 0; k < Math.min(PARALLEL, files.length); k++) start();
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // "1:23" / "83" / "1:02:03" → 秒
  function parseTime(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var parts = String(v).trim().split(":");
    var sec = 0;
    for (var i = 0; i < parts.length; i++) {
      var n = parseFloat(parts[i]);
      if (isNaN(n)) return null;
      sec = sec * 60 + n;
    }
    return sec;
  }

  function formatTime(sec) {
    if (sec === null || sec === undefined || isNaN(sec)) return "";
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function getParam(name) {
    var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : null;
  }

  // 文字サイズ（標準 / 大）の切替。設定は端末ごとに保存
  function initTextSize(button) {
    var key = "wi.largeText";
    var on = false;
    try { on = localStorage.getItem(key) === "1"; } catch (e) {}
    function apply() {
      document.documentElement.classList.toggle("large-text", on);
      if (button) {
        button.classList.toggle("active", on);
        button.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }
    apply();
    if (button) {
      button.addEventListener("click", function () {
        on = !on;
        try { localStorage.setItem(key, on ? "1" : "0"); } catch (e) {}
        apply();
      });
    }
  }

  var KIND_LABEL = { safety: "安全", quality: "品質", ease: "やりやすさ" };

  // ---------- カテゴリー（一覧の絞り込み） ----------
  var CAT_KEYS = ["line", "product", "process", "category"];
  var CAT_DEFAULT_LABEL = { line: "ライン", product: "製品", process: "工程", category: "作業区分" };

  // catalog.js の設定（無い項目は初期値）
  function catConfig(cat) {
    cat = cat || {};
    var levels = (cat.levels && cat.levels.length ? cat.levels : ["line", "product", "process"])
      .filter(function (k) { return CAT_KEYS.indexOf(k) !== -1; });
    var labels = {};
    CAT_KEYS.forEach(function (k) { labels[k] = (cat.labels && cat.labels[k]) || CAT_DEFAULT_LABEL[k]; });
    var categories = {};
    CAT_KEYS.forEach(function (k) { categories[k] = ((cat.categories && cat.categories[k]) || []).slice(); });
    return { levels: levels, labels: labels, categories: categories };
  }

  // 「Aライン、Bライン」→ ["Aライン", "Bライン"]
  function splitCat(v) {
    return String(v || "").split(/[、,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  // 名前順の比べ方（日本語・数字の大小を考慮）。毎回作ると遅いので 1 つを使い回す
  var collator = (window.Intl && Intl.Collator) ? new Intl.Collator("ja", { numeric: true }) : null;
  function compareText(a, b) {
    a = String(a == null ? "" : a); b = String(b == null ? "" : b);
    return collator ? collator.compare(a, b) : (a < b ? -1 : a > b ? 1 : 0);
  }

  // 設定画面で決めた並び順を優先し、それ以外は名前順
  function catSorter(order) {
    return function (a, b) {
      var i = order.indexOf(a), j = order.indexOf(b);
      if (i !== -1 || j !== -1) return (i === -1 ? 1e9 : i) - (j === -1 ? 1e9 : j);
      return compareText(a, b);
    };
  }

  // ---------- 見出し・項目名（社内フォーマットに合わせて変えられる） ----------
  // 要領書ごとの指定 → 設定画面の指定（catalog.js の terms）→ 初期値 の順に使う
  var DEFAULT_TERMS = {
    docNo: "文書番号", title: "作業名", process: "工程", line: "ライン", product: "品番・品名",
    step: "主なステップ（何を）", point: "急所（どのように）", reason: "理由"
  };
  var TERM_KEYS = Object.keys(DEFAULT_TERMS);
  function terms(manual, cat) {
    var t = {};
    TERM_KEYS.forEach(function (k) {
      // 設定画面で絞り込みの項目名（ライン → 職場 など）を変えていれば、それも使う
      var lab = cat && cat.labels && cat.labels[k];
      if (lab === CAT_DEFAULT_LABEL[k]) lab = "";
      t[k] = (manual && manual.terms && manual.terms[k]) || (cat && cat.terms && cat.terms[k]) || lab || DEFAULT_TERMS[k];
    });
    return t;
  }

  // 手順の印（✚ 安全・◆ 品質 など）
  var KIND_MARK = { safety: "✚", quality: "◆", ease: "★" };
  function kindBadge(k) {
    return KIND_LABEL[k] ? '<span class="kind ' + k + '">' + KIND_MARK[k] + " " + KIND_LABEL[k] + '</span>' : "";
  }

  // ---------- 工場・課・工程などの名前（設定画面で自由に変えられる） ----------
  // catalog.js の org: ["○○工場", "○○課", "○○工程"]。無ければ siteName
  function orgParts(cat) {
    cat = cat || {};
    var parts = (cat.org || []).map(function (x) { return String(x || "").trim(); }).filter(Boolean);
    if (!parts.length && cat.siteName) parts = [cat.siteName];
    return parts;
  }
  function orgName(cat) { return orgParts(cat).join(" ") || "作業要領書"; }
  // 画面上部の表示（○○工場 ＞ ○○課 ＞ ○○工程）
  function orgHtml(cat) {
    var p = orgParts(cat);
    if (!p.length) return "作業要領書";
    return p.map(function (x) { return '<span class="org-part">' + esc(x) + '</span>'; }).join('<span class="org-sep">＞</span>');
  }

  // 手順のうち動画が付いている数
  function videoStats(m) {
    var steps = (m && m.steps) || [];
    return { done: steps.filter(function (s) { return s.video && s.video.src; }).length, all: steps.length };
  }
  // 見直しの時期（最後の改訂・制定から 1 年以上たっている）
  var REVIEW_DAYS = 365;
  function needsReview(m) {
    var d = Date.parse((m && (m.updated || m.issued)) || "");
    return !isNaN(d) && (Date.now() - d) / 86400000 > REVIEW_DAYS;
  }

  window.WI = {
    loadManualFile: loadManualFile,
    loadManualFiles: loadManualFiles,
    esc: esc,
    parseTime: parseTime,
    formatTime: formatTime,
    getParam: getParam,
    initTextSize: initTextSize,
    KIND_LABEL: KIND_LABEL,
    CAT_KEYS: CAT_KEYS,
    catConfig: catConfig,
    splitCat: splitCat,
    catSorter: catSorter,
    compareText: compareText,
    videoStats: videoStats,
    needsReview: needsReview,
    DEFAULT_TERMS: DEFAULT_TERMS,
    TERM_KEYS: TERM_KEYS,
    terms: terms,
    kindBadge: kindBadge,
    orgParts: orgParts,
    orgName: orgName,
    orgHtml: orgHtml
  };
})();
