/* =========================================================
   メニュー（最初の画面）
   - 工場名、最近見た要領書、登録件数・動画の付いていない要領書の数を表示
   ========================================================= */
(function () {
  "use strict";
  var esc = WI.esc;
  var cat = window.CATALOG || { files: [] };

  WI.initTextSize(document.getElementById("textSize"));

  if (cat.siteName) {
    document.getElementById("siteName").textContent = cat.siteName;
    document.title = cat.siteName + " メニュー";
  }

  var recentFiles = [];
  try { recentFiles = JSON.parse(localStorage.getItem("wi.recent") || "[]"); } catch (e) {}

  WI.loadManualFiles(cat.files || [], function (results) {
    var list = results.filter(function (r) { return r.data; }).map(function (r) { return r.data; });

    // 最近見た要領書（作業者がすぐ開けるように）
    var recent = recentFiles.map(function (f) {
      for (var i = 0; i < list.length; i++) if (list[i]._file === f) return list[i];
      return null;
    }).filter(Boolean).slice(0, 4);
    if (recent.length) {
      document.getElementById("recent").innerHTML = '<span class="recent-label">最近見た要領書</span>' + recent.map(function (m) {
        return '<a class="chip" href="manual.html?file=' + encodeURIComponent(m._file) + '">' + esc(m.title) + '</a>';
      }).join("");
    }

    // 登録の状況（管理する方向け）
    var noVideo = list.filter(function (m) {
      return (m.steps || []).length && !(m.steps || []).some(function (s) { return s.video && s.video.src; });
    }).length;
    var errors = results.length - list.length;
    document.getElementById("status").innerHTML =
      '登録されている要領書：<b>' + list.length + ' 件</b>' +
      (noVideo ? '　／　動画がまだ付いていない要領書：<b>' + noVideo + ' 件</b>' : '') +
      (errors ? '　／　<span style="color:var(--safety)">読み込めない要領書：' + errors + ' 件</span>' : '');
  });
})();
