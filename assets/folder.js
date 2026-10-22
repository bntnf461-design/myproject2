/* =========================================================
   テンプレートのフォルダへの直接保存（Chrome / Edge。ネット接続不要）
   - エディタ・設定画面で共通に使う
   - 一度選んだフォルダはこの PC のブラウザに記憶し、次回から選び直し不要
   ========================================================= */
(function () {
  "use strict";

  var supported = !!window.showDirectoryPicker;
  var rootDir = null;

  function idb(mode, fn) {
    return new Promise(function (resolve) {
      try {
        var rq = indexedDB.open("wi-editor", 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore("kv"); };
        rq.onsuccess = function () {
          var tx = rq.result.transaction("kv", mode);
          var r = fn(tx.objectStore("kv"));
          tx.oncomplete = function () { resolve(r && r.result); };
          tx.onerror = function () { resolve(null); };
        };
        rq.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  var remembered = supported ? idb("readonly", function (st) { return st.get("rootDir"); }) : Promise.resolve(null);

  var matchesPage = false; // 選んだフォルダが、いま開いている画面のフォルダと同じか

  // フォルダを取得
  // - 記憶しているフォルダが、いま開いている画面と同じフォルダなら、許可の確認だけ
  // - 違う（新しい版を別の場所に展開した・フォルダを移動した など）場合は、選び直してもらう
  function getRoot() {
    return (rootDir ? Promise.resolve(rootDir) : remembered).then(function (d) {
      if (!d) return pick();
      return permit(d).then(function (ok) {
        if (!ok) return pick();
        return samePage(d).then(function (same) {
          if (same === true) { matchesPage = true; return use(d); }
          return pick();
        });
      });
    });
  }

  // 保存先を選び直す（「変更」ボタン用）
  function forget() {
    rootDir = null;
    remembered = Promise.resolve(null);
    return idb("readwrite", function (st) { return st.delete("rootDir"); });
  }

  function permit(d) {
    if (!d.requestPermission) return Promise.resolve(false);
    return d.requestPermission({ mode: "readwrite" }).then(function (p) { return p === "granted"; }, function () { return false; });
  }

  function use(d) {
    rootDir = d;
    remembered = Promise.resolve(d);
    idb("readwrite", function (st) { return st.put(d, "rootDir"); });
    return d;
  }

  function readCatalogOf(dir) {
    return dir.getDirectoryHandle("manuals").then(function (md) { return readText(md, "catalog.js"); }).then(parseCatalog);
  }

  // 画面を開いたときに読み込んだ catalog.js と、フォルダの catalog.js が同じものか
  // （保存すると folderId という目印を書き込むので、それで見分ける）
  function samePage(dir) {
    var page = window.CATALOG;
    if (!page) return Promise.resolve(true);
    return readCatalogOf(dir).then(function (c) {
      if (page.folderId || c.folderId) return page.folderId === c.folderId;
      return JSON.stringify([page.siteName || "", page.files]) === JSON.stringify([c.siteName || "", c.files]);
    }, function () { return false; });
  }

  // フォルダを選んでもらう
  function pick() {
    return window.showDirectoryPicker({ id: "wi-root", mode: "readwrite" }).then(findTemplateDir).then(function (dir) {
      return samePage(dir).then(function (same) {
        matchesPage = same;
        if (!same && !confirm("選んだフォルダ「" + dir.name + "」は、いま開いている画面とは別のフォルダのようです。\n" +
          "このフォルダに保存すると、いま開いている一覧には表示されません。\n\nこのフォルダに保存しますか？\n" +
          "（いま開いている画面のフォルダに保存する場合は［キャンセル］を押して、index.html があるフォルダを選び直してください）")) {
          var e = new Error("cancel");
          e.name = "AbortError";
          throw e;
        }
        return use(dir);
      });
    });
  }

  // index.html と manuals があるフォルダを探す
  // ZIP を展開すると「sagyo-youryousho の中に sagyo-youryousho」ができるので、1 つ下のフォルダも探す
  function findTemplateDir(dir) {
    var isTemplate = function (d) {
      return d.getDirectoryHandle("manuals").then(function (md) { return md.getFileHandle("catalog.js"); }).then(function () { return true; }, function () { return false; });
    };
    return isTemplate(dir).then(function (ok) {
      if (ok) return dir;
      return dir.getFileHandle("catalog.js").then(function () {
        throw new Error("「" + dir.name + "」フォルダではなく、その 1 つ上の（index.html がある）フォルダを選んでください。");
      }, function () {
        var subs = [];
        var it = dir.values();
        var next = function () {
          return it.next().then(function (r) {
            if (r.done) return null;
            if (r.value.kind !== "directory") return next();
            return isTemplate(r.value).then(function (ok2) { if (ok2) subs.push(r.value); return next(); });
          });
        };
        return next().then(function () {
          if (subs.length === 1) return subs[0];
          throw new Error("選んだフォルダ「" + dir.name + "」に、要領書のデータ（manuals フォルダ）が見つかりません。index.html があるフォルダを選んでください。");
        });
      });
    });
  }

  // 保存できなかったときの説明（ブラウザの英語のメッセージを分かりやすく）
  function errorMessage(e) {
    var n = e && e.name;
    if (n === "NotAllowedError") return "フォルダへの書き込みが許可されませんでした。もう一度保存し、表示される確認で「ファイルを編集」（許可）を選んでください。";
    if (n === "NotFoundError") { forget(); return "保存先のフォルダが見つかりません（移動・名前の変更・削除された可能性があります）。もう一度保存して、フォルダを選び直してください。"; }
    if (n === "SecurityError") return "このフォルダには保存できません（Windows のシステムのフォルダなど）。テンプレートを「ドキュメント」などの中に置いてから選んでください。";
    if (n === "NoModificationAllowedError" || n === "InvalidModificationError" || n === "InvalidStateError") return "ファイルに書き込めませんでした。読み取り専用のフォルダか、ほかのソフトでファイルを開いていないか確認してください。";
    if (n === "QuotaExceededError") return "ディスクの空きが足りません。";
    return (e && e.message) ? e.message : String(e);
  }

  function currentName() { return rootDir ? rootDir.name : ""; }

  function writeFile(dir, name, data) {
    return dir.getFileHandle(name, { create: true }).then(function (fh) {
      return fh.createWritable();
    }).then(function (w) {
      return w.write(data).then(function () { return w.close(); });
    });
  }

  function readText(dir, name) {
    return dir.getFileHandle(name).then(function (fh) { return fh.getFile(); }).then(function (f) { return f.text(); });
  }

  // ---------- 目録（catalog.js） ----------
  function parseCatalog(text) {
    var w = {};
    new Function("window", text)(w); // 自分のフォルダの catalog.js を読むだけ
    if (!w.CATALOG || !w.CATALOG.files) throw new Error("manuals/catalog.js の形式が読み取れません。");
    return w.CATALOG;
  }

  function catalogText(c) {
    var j = function (v) { return JSON.stringify(v); };
    var cats = WI.CAT_KEYS.filter(function (k) { return c.categories && c.categories[k] && c.categories[k].length; })
      .map(function (k) { return "    " + k + ": " + j(c.categories[k]); });
    return "/* =========================================================\n" +
      "   要領書の目録・設定\n" +
      "   ※ 設定画面（settings.html）から編集できます。手で編集してもかまいません\n" +
      "   - siteName   : 画面上部に表示する工場名・部署名\n" +
      "   - levels     : 一覧で絞り込む項目と順番（line / product / process / category）\n" +
      "   - labels     : 項目の表示名\n" +
      "   - categories : カテゴリーの名前と並び順（エディタの候補にも出ます）\n" +
      "   - terms      : 要領書の見出しの名前（社内フォーマットに合わせる。空なら標準の名前）\n" +
      "   - files      : manuals フォルダに置いた要領書ファイル名\n" +      "   - folderId   : このフォルダの目印（自動で付きます。変更しないでください）\n" +
      "   ========================================================= */\n" +
      "window.CATALOG = {\n" +
      "  folderId: " + j(c.folderId || "") + ",\n" +
      "  siteName: " + j(c.siteName || "") + ",\n" +
      "  levels: " + j(c.levels || []) + ",\n" +
      "  labels: " + j(c.labels || {}) + ",\n" +
      "  terms: " + j(c.terms || {}) + ",\n" +
      "  categories: {\n" + cats.join(",\n") + (cats.length ? "\n" : "") + "  },\n" +
      "  files: [\n" + (c.files || []).map(function (f) { return "    " + j(f); }).join(",\n") + "\n  ]\n" +
      "};\n";
  }

  // catalog.js を読み、change(catalog) で書き換えて保存する。change が false を返したら保存しない
  function updateCatalog(root, change) {
    return root.getDirectoryHandle("manuals").then(function (md) {
      return readText(md, "catalog.js").then(function (text) {
        var c = parseCatalog(text);
        var changed = change(c) !== false;
        // 目印が無ければ付ける（次から「いま開いている画面と同じフォルダか」を確実に見分けるため）
        if (!c.folderId) { c.folderId = "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); changed = true; }
        if (matchesPage && window.CATALOG) window.CATALOG.folderId = c.folderId;
        if (!changed) return false;
        return writeFile(md, "catalog.js", catalogText(c)).then(function () { return true; });
      });
    });
  }

  // ---------- 要領書ファイル ----------
  function parseManual(text) {
    var a = text.indexOf("("), b = text.lastIndexOf(")");
    var json = /^\s*registerManual\s*\(/.test(text) ? text.slice(a + 1, b) : text;
    return JSON.parse(json);
  }
  function manualText(d) {
    return "registerManual(" + JSON.stringify(d, null, 2) + ");\n";
  }

  // 上書き・削除の前に、今のファイルを manuals/<folder> に日時付きで残す（間違えて保存しても戻せるように）
  function backup(md, name, folder) {
    var t = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    var stamp = t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate()) + "-" + p(t.getHours()) + p(t.getMinutes()) + p(t.getSeconds());
    return md.getFileHandle(name).then(function (fh) {
      return fh.getFile().then(function (f) { return f.text(); }).then(function (text) {
        return md.getDirectoryHandle(folder, { create: true }).then(function (bd) {
          return writeFile(bd, name.replace(/\.js$/, "") + "_" + stamp + ".js", text);
        });
      });
    }, function () { /* まだ無いファイル（新規）なので何もしない */ });
  }

  window.WIFolder = {
    supported: supported,
    getRoot: getRoot,
    forget: forget,
    currentName: currentName,
    errorMessage: errorMessage,
    writeFile: writeFile,
    readText: readText,
    parseCatalog: parseCatalog,
    catalogText: catalogText,
    updateCatalog: updateCatalog,
    parseManual: parseManual,
    manualText: manualText,
    backup: backup
  };
})();
