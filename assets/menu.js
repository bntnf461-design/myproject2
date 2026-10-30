/* =========================================================
   ホーム（最初の画面）
   - 最近見た要領書、登録の状況、最近更新された要領書、はじめての方への流れ
   ========================================================= */
(function () {
  "use strict";
  var esc = WI.esc;
  var cat = window.CATALOG || { files: [] };

  WI.initTextSize(document.getElementById("textSize"));
  document.getElementById("siteName").innerHTML = WI.orgHtml(cat);
  document.title = WI.orgName(cat) + " 作業要領書";

  // 作業者用（かんたん画面を最初に開く PC）の切り替え
  var worker = false;
  try { worker = localStorage.getItem("wi.mode") === "worker"; } catch (e) {}
  document.getElementById("workerBanner").hidden = !worker;
  document.getElementById("easyPanel").hidden = worker;
  document.getElementById("workerOn").addEventListener("click", function () {
    if (!confirm("この PC を作業者用にしますか？\n次からは、最初に「かんたん画面」が開きます。\n（作る・管理する画面へは、かんたん画面の下の「リーダー・管理者の方へ」から戻れます）")) return;
    try { localStorage.setItem("wi.mode", "worker"); } catch (e) {}
    location.href = "easy.html";
  });
  document.getElementById("workerOff").addEventListener("click", function () {
    try { localStorage.removeItem("wi.mode"); } catch (e) {}
    location.href = "index.html";
  });

  var recentFiles = [];
  try { recentFiles = JSON.parse(localStorage.getItem("wi.recent") || "[]"); } catch (e) {}

  var today = new Date();
  var ym = today.getFullYear() + "-" + ("0" + (today.getMonth() + 1)).slice(-2);

  var videoCount = WI.videoStats;

  WI.loadManualFiles(cat.files || [], function (results) {
    var list = results.filter(function (r) { return r.data; }).map(function (r) { return r.data; });
    var errors = results.length - list.length;

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

    // 状況
    var noVideo = list.filter(function (m) { var v = videoCount(m); return v.all && v.done < v.all; });
    var stepsAll = 0, stepsDone = 0;
    list.forEach(function (m) { var v = videoCount(m); stepsAll += v.all; stepsDone += v.done; });
    var thisMonth = list.filter(function (m) { return String(m.updated || "").slice(0, 7) === ym; });
    var review = list.filter(WI.needsReview);
    var lines = {}, procs = {};
    list.forEach(function (m) {
      WI.splitCat(m.line).forEach(function (x) { lines[x] = 1; });
      WI.splitCat(m.process).forEach(function (x) { procs[x] = 1; });
    });
    var pct = stepsAll ? Math.round(stepsDone / stepsAll * 100) : 0;
    document.getElementById("kpis").innerHTML =
      kpi("登録されている要領書", list.length, "件", (Object.keys(lines).length ? "ライン " + Object.keys(lines).length + " ／ " : "") + "工程 " + Object.keys(procs).length) +
      kpi("動画がまだ付いていない", noVideo.length, "件", "手順の動画 " + stepsDone + " / " + stepsAll + "（" + pct + "%）", noVideo.length ? "warn" : "", pct, "noVideo") +
      kpi("今月の改訂・新規", thisMonth.length, "件", thisMonth.length ? "最新：" + esc(latest(thisMonth).title) : "") +
      (errors ? kpi("読み込めない要領書", errors, "件", "ファイルを確認してください", "err")
        : kpi("見直し時期（1 年以上 改訂なし）", review.length, "件", review.length ? "押すと一覧で確認できます" : "すべて 1 年以内に見直し済み", review.length ? "err" : "", undefined, "review"));

    // 最近更新された要領書
    var rows = list.slice().sort(function (a, b) { return String(b.updated || b.issued || "").localeCompare(String(a.updated || a.issued || "")); }).slice(0, 6);
    document.getElementById("recentTable").innerHTML = rows.length ? '<table class="home-table"><thead><tr><th>作業名</th><th class="hide-sp">ライン ／ 工程</th><th>動画</th><th class="hide-sp">更新</th><th></th></tr></thead><tbody>' +
      rows.map(function (m) {
        var v = videoCount(m);
        var p = v.all ? Math.round(v.done / v.all * 100) : 0;
        var d = Date.parse(m.updated || m.issued || "");
        var fresh = !isNaN(d) && (today - d) / 86400000 <= 30;
        var chip = v.done < v.all ? '<span class="st warn">動画不足</span>' : fresh ? '<span class="st ok">' + (m.updated && m.updated !== m.issued ? "改訂" : "新規") + '</span>' : '';
        return '<tr><td><a href="manual.html?file=' + encodeURIComponent(m._file) + '"><small>' + esc(m.docNo) + '</small><br><b>' + esc(m.title) + '</b></a></td>' +
          '<td class="hide-sp">' + esc([m.line, m.process].filter(Boolean).join(" ／ ")) + '</td>' +
          '<td><span class="mini-bar"><i style="width:' + p + '%"></i></span> ' + v.done + '/' + v.all + '</td>' +
          '<td class="hide-sp">' + esc(String(m.updated || m.issued || "").slice(5).replace("-", "/")) + '</td><td>' + chip + '</td></tr>';
      }).join("") + '</tbody></table>'
      : '<p class="hint" style="padding:0 18px">まだ要領書がありません。「Excel から取り込む」か「＋ 新しく作る」から始めてください。</p>';

    // はじめての方へ：済んだところに ✓
    var imported = list.some(function (m) { return !/^sample-/.test(m._file); });
    mark("import", imported, imported ? "取り込み済み：" + list.length + " 件" : "");
    mark("video", list.length && !noVideo.length, noVideo.length ? "あと " + noVideo.length + " 件" : "");
  });

  function latest(arr) { return arr.slice().sort(function (a, b) { return String(b.updated).localeCompare(String(a.updated)); })[0]; }

  // flag を付けると、押したときにその条件で絞り込んだ一覧を開く
  function kpi(label, value, unit, sub, cls, bar, flag) {
    var tag = flag ? 'a href="list.html" data-flag="' + flag + '"' : 'div';
    return '<' + tag + ' class="kpi ' + (cls || "") + (flag ? " link" : "") + '"><div class="l">' + label + '</div><div class="v">' + value + (unit ? '<small>' + unit + '</small>' : '') + '</div>' +
      (bar !== undefined ? '<div class="mini-bar wide"><i style="width:' + bar + '%"></i></div>' : '') +
      (sub ? '<div class="s">' + sub + '</div>' : '') + '</' + (flag ? 'a' : 'div') + '>';
  }
  document.getElementById("kpis").addEventListener("click", function (ev) {
    var a = ev.target.closest("[data-flag]");
    if (!a) return;
    var f = {};
    f[a.getAttribute("data-flag")] = true;
    try { localStorage.setItem("wi.filter", JSON.stringify({ sel: {}, q: "", flags: f })); } catch (e) {}
  });

  function mark(key, done, note) {
    var li = document.querySelector('#check [data-c="' + key + '"]');
    if (!li) return;
    if (done) { li.classList.add("done"); li.querySelector(".n").textContent = "✓"; }
    if (note) li.querySelector("small").textContent = note;
  }
})();
