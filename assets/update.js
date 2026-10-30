/* =========================================================
   新しい版に入れ替える
   - ① 今使っているフォルダ（書き込み）と ② 新しい版のフォルダ（読み取り）を選ぶ
   - 新しい版の「画面の仕組み」（html・assets など）だけを、今のフォルダへ上書きする
   - manuals・images・videos と、_ で始まるフォルダ（_backup・_old_version など）には触らない
   - 上書きする前のファイルは _old_version/日時/ に残す
   ========================================================= */
(function () {
  "use strict";
  var esc = WI.esc;
  var KEEP = { manuals: true, images: true, videos: true }; // 利用者のデータ（入れ替えない）
  var oldDir = null, newDir = null, oldVer = "", newVer = "", files = [];

  function $(id) { return document.getElementById(id); }

  if (!window.showDirectoryPicker) {
    $("msg").className = "notice error";
    $("msg").innerHTML = "このブラウザでは使えません。<b>Chrome</b> か <b>Edge</b> で開いてください。";
    $("pickOld").disabled = $("pickNew").disabled = true;
    return;
  }

  function has(dir, path) {
    var parts = path.split("/");
    var step = function (d, i) {
      if (i === parts.length - 1) return d.getFileHandle(parts[i]).then(function () { return true; });
      return d.getDirectoryHandle(parts[i]).then(function (c) { return step(c, i + 1); });
    };
    return step(dir, 0).catch(function () { return false; });
  }
  function readFile(dir, path) {
    var parts = path.split("/");
    var step = function (d, i) {
      if (i === parts.length - 1) return d.getFileHandle(parts[i]).then(function (fh) { return fh.getFile(); });
      return d.getDirectoryHandle(parts[i]).then(function (c) { return step(c, i + 1); });
    };
    return step(dir, 0);
  }
  // 版の番号（assets/common.js の VERSION）。無ければ古い版
  function versionOf(dir) {
    return readFile(dir, "assets/common.js").then(function (f) { return f.text(); }).then(function (t) {
      var m = /var VERSION = "([^"]+)"/.exec(t);
      return m ? m[1] : "";
    }, function () { return ""; });
  }
  // 選んだフォルダの中に、もう 1 段フォルダがある場合（ZIP を展開したときによくある）はその中を使う
  function findApp(dir, need) {
    return has(dir, need).then(function (ok) {
      if (ok) return dir;
      var subs = [], it = dir.values();
      var next = function () {
        return it.next().then(function (r) {
          if (r.done) return;
          if (r.value.kind !== "directory") return next();
          return has(r.value, need).then(function (ok2) { if (ok2) subs.push(r.value); return next(); });
        });
      };
      return next().then(function () { return subs.length === 1 ? subs[0] : null; });
    });
  }
  function countManuals(dir) {
    return ownManuals(dir).then(function (r) { return r.all; });
  }
  // 目録に載っている要領書の数と、見本（sample-）以外の数
  function ownManuals(dir) {
    return readFile(dir, "manuals/catalog.js").then(function (f) { return f.text(); }).then(function (t) {
      var m = /files:\s*\[([\s\S]*?)\]/.exec(t);
      var list = m ? (m[1].match(/"[^"]+\.js"/g) || []) : [];
      return { all: list.length, own: list.filter(function (x) { return !/^"sample-/.test(x); }).length };
    }, function () { return { all: 0, own: 0 }; });
  }
  function err(id, html) { $(id).innerHTML = '<div class="notice error">' + html + '</div>'; }

  $("pickOld").addEventListener("click", function () {
    window.showDirectoryPicker({ id: "wi-root", mode: "readwrite" }).then(function (d) {
      return findApp(d, "manuals/catalog.js").then(function (app) {
        if (!app) { err("oldInfo", "選んだフォルダ「" + esc(d.name) + "」に、要領書のデータ（manuals フォルダ）が見つかりません。index.html と manuals フォルダがあるフォルダを選んでください。"); oldDir = null; return; }
        oldDir = app;
        return Promise.all([versionOf(app), countManuals(app)]).then(function (r) {
          oldVer = r[0];
          $("oldInfo").innerHTML = '<div class="up-ok">✓ <b>' + esc(app.name) + '</b>（版 ' + esc(oldVer || "古い版") + '・要領書 ' + r[1] + ' 件）</div>';
        });
      });
    }).then(plan).catch(function (e) { if (!e || e.name !== "AbortError") err("oldInfo", esc(e.message || e)); });
  });

  $("pickNew").addEventListener("click", function () {
    window.showDirectoryPicker({ id: "wi-new", mode: "read" }).then(function (d) {
      return findApp(d, "assets/common.js").then(function (app) {
        if (!app || !app.name) { err("newInfo", "選んだフォルダ「" + esc(d.name) + "」に、新しい版の画面（assets フォルダ）が見つかりません。ZIP を展開したフォルダを選んでください。"); newDir = null; return; }
        newDir = app;
        return versionOf(app).then(function (v) {
          newVer = v;
          $("newInfo").innerHTML = '<div class="up-ok">✓ <b>' + esc(app.name) + '</b>（版 ' + esc(newVer || "不明") + '）</div>';
        });
      });
    }).then(plan).catch(function (e) { if (!e || e.name !== "AbortError") err("newInfo", esc(e.message || e)); });
  });

  // 新しい版の中の、入れ替えるファイルの一覧
  function listFiles(dir, prefix, out) {
    var it = dir.entries();
    var next = function () {
      return it.next().then(function (r) {
        if (r.done) return out;
        var name = r.value[0], h = r.value[1];
        if (name.charAt(0) === "." || name.charAt(0) === "_" || (!prefix && KEEP[name])) return next();
        if (h.kind === "directory") return listFiles(h, prefix + name + "/", out).then(next);
        out.push({ path: prefix + name, handle: h });
        return next();
      });
    };
    return next();
  }

  function plan() {
    $("run").disabled = true;
    if (!oldDir || !newDir) return;
    return oldDir.isSameEntry(newDir).then(function (same) {
      if (same) { $("plan").innerHTML = '<div class="notice error">①と②に同じフォルダが選ばれています。②には、新しく展開したフォルダを選んでください。</div>'; return; }
      return Promise.all([listFiles(newDir, "", []), ownManuals(oldDir), ownManuals(newDir)]).then(function (res) {
        var list = res[0];
        files = list;
        // ①と②が逆かもしれない：②の方が古い版、または①には見本しか無く②に自分たちの要領書がある
        var older = (oldVer && newVer && newVer < oldVer) || (oldVer && !newVer) || (res[1].own === 0 && res[2].own > 0);
        $("plan").innerHTML =
          '<p>版 <b>' + esc(oldVer || "古い版") + '</b> → <b>' + esc(newVer || "不明") + '</b>　（入れ替えるファイル ' + files.length + ' 個）</p>' +
          (older ? '<div class="notice error">①と②が<b>逆</b>になっているかもしれません（②の方が古い版か、②の方に自分たちの要領書があります）。①はいつも使っているフォルダ、②は新しく展開したフォルダです。確かめてから入れ替えてください。</div>' : '') +
          (oldVer && oldVer === newVer ? '<p class="hint">同じ版です。入れ替える必要はありませんが、入れ替えることもできます。</p>' : '') +
          '<ul class="up-list"><li>✓ そのまま：manuals（要領書・設定）、images（写真）、videos（動画）</li>' +
          '<li>↻ 新しくする：' + esc(summary(files)) + '</li>' +
          '<li>📁 入れ替える前のファイルは「_old_version」フォルダに残ります</li></ul>';
        $("run").disabled = false;
      });
    });
  }
  function summary(list) {
    var top = {};
    list.forEach(function (f) { var k = f.path.indexOf("/") === -1 ? f.path : f.path.split("/")[0] + "/"; top[k] = 1; });
    return Object.keys(top).sort().join("、");
  }

  function stamp() {
    var t = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate()) + "-" + p(t.getHours()) + p(t.getMinutes()) + p(t.getSeconds());
  }
  function dirFor(root, path, create) {
    var parts = path.split("/");
    parts.pop();
    return parts.reduce(function (pr, name) {
      return pr.then(function (d) { return d.getDirectoryHandle(name, { create: create }); });
    }, Promise.resolve(root));
  }

  $("run").addEventListener("click", function () {
    if (!confirm("新しい版に入れ替えますか？\n要領書・写真・動画・設定はそのままです。")) return;
    if (document.querySelector("#plan .notice.error") && !confirm("①と②が逆かもしれないと表示されています。本当にこのまま入れ替えますか？")) return;
    $("run").disabled = true;
    var done = 0, saved = 0;
    var bk = null;
    oldDir.getDirectoryHandle("_old_version", { create: true }).then(function (o) {
      return o.getDirectoryHandle(stamp() + "_" + (oldVer || "old"), { create: true });
    }).then(function (b) {
      bk = b;
      return files.reduce(function (pr, f) {
        return pr.then(function () {
          $("progress").textContent = "入れ替え中… " + (done + 1) + " / " + files.length + "　" + f.path;
          var name = f.path.split("/").pop();
          // 今のファイルを _old_version に残す
          return readFile(oldDir, f.path).then(function (cur) {
            return dirFor(bk, f.path, true).then(function (d) { return WIFolder.writeFile(d, name, cur); }).then(function () { saved++; });
          }, function () {}).then(function () {
            return Promise.all([f.handle.getFile(), dirFor(oldDir, f.path, true)]);
          }).then(function (r) {
            return WIFolder.writeFile(r[1], name, r[0]);
          }).then(function () { done++; });
        });
      }, Promise.resolve());
    }).then(function () {
      $("progress").innerHTML = '<div class="notice"><b>入れ替えました（' + done + ' 個）。</b>' +
        '今使っているフォルダ「' + esc(oldDir.name) + '」の <b>index.html を開き直してください</b>（開いている画面は、F5 で読み直してください）。<br>' +
        '<small>入れ替える前のファイル ' + saved + ' 個は「_old_version」フォルダにあります。元に戻すときは、その中のファイルを元の場所に戻します。</small></div>';
    }).catch(function (e) {
      $("run").disabled = false;
      $("progress").innerHTML = '<div class="notice error">入れ替えの途中で止まりました（' + esc(WIFolder.errorMessage ? WIFolder.errorMessage(e) : e) + '）。<br>' +
        'もう一度「入れ替える」を押してください。入れ替えた分の前のファイルは「_old_version」に残っています。</div>';
    });
  });
})();
