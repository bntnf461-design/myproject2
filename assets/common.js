/* =========================================================
   共通処理
   - 要領書データは manuals/*.js に registerManual({...}) の形で記述
   - <script> 読み込みなので、サーバー無し（ファイルを直接開く）でも動作
   ========================================================= */
(function () {
  "use strict";

  var registry = {};
  var lastRegistered = null;

  // 要領書データファイルから呼ばれる
  window.registerManual = function (data) {
    if (!data) return;
    lastRegistered = data;
    if (data.id) registry[data.id] = data;
  };

  // manuals/ 以下の .js を読み込む。完了時に callback(data or null, error)
  function loadManualFile(file, callback) {
    if (!/^[\w\-.\/]+\.js$/.test(file) || file.indexOf("..") !== -1) {
      callback(null, "ファイル名が不正です: " + file);
      return;
    }
    lastRegistered = null;
    var s = document.createElement("script");
    s.src = "manuals/" + file + "?v=" + Date.now(); // 更新がすぐ反映されるよう毎回読み直す
    s.onload = function () {
      var d = lastRegistered;
      if (d) d._file = file;
      callback(d, d ? null : "データが登録されていません: " + file);
    };
    s.onerror = function () {
      callback(null, "ファイルを読み込めません: manuals/" + file);
    };
    document.head.appendChild(s);
  }

  // 複数ファイルを順番に読み込む（同時読み込みで lastRegistered が混ざらないよう直列）
  function loadManualFiles(files, done) {
    var results = [];
    var i = 0;
    (function next() {
      if (i >= files.length) { done(results); return; }
      var f = files[i++];
      loadManualFile(f, function (data, err) {
        results.push({ file: f, data: data, error: err });
        next();
      });
    })();
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

  window.WI = {
    loadManualFile: loadManualFile,
    loadManualFiles: loadManualFiles,
    esc: esc,
    parseTime: parseTime,
    formatTime: formatTime,
    getParam: getParam,
    initTextSize: initTextSize,
    KIND_LABEL: KIND_LABEL
  };
})();
