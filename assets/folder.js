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

  // フォルダを取得（記憶していれば許可の確認だけ、無ければ選んでもらう）
  function getRoot() {
    return (rootDir ? Promise.resolve(rootDir) : remembered).then(function (d) {
      rootDir = d || null;
      var ok = rootDir && rootDir.requestPermission
        ? rootDir.requestPermission({ mode: "readwrite" }).then(function (p) { return p === "granted"; }, function () { return false; })
        : Promise.resolve(false);
      return ok;
    }).then(function (granted) {
      if (granted) return rootDir;
      return window.showDirectoryPicker({ id: "wi-root", mode: "readwrite" }).then(function (dir) {
        // 正しいフォルダ（index.html と manuals があるフォルダ）か確認
        return dir.getDirectoryHandle("manuals").then(function (md) {
          return md.getFileHandle("catalog.js");
        }).then(function () {
          rootDir = dir;
          idb("readwrite", function (st) { return st.put(dir, "rootDir"); });
          return dir;
        }, function () {
          throw new Error("選んだフォルダに manuals/catalog.js がありません。index.html があるフォルダを選んでください。");
        });
      });
    });
  }

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
      "   - files      : manuals フォルダに置いた要領書ファイル名\n" +
      "   ========================================================= */\n" +
      "window.CATALOG = {\n" +
      "  siteName: " + j(c.siteName || "") + ",\n" +
      "  levels: " + j(c.levels || []) + ",\n" +
      "  labels: " + j(c.labels || {}) + ",\n" +
      "  categories: {\n" + cats.join(",\n") + (cats.length ? "\n" : "") + "  },\n" +
      "  files: [\n" + (c.files || []).map(function (f) { return "    " + j(f); }).join(",\n") + "\n  ]\n" +
      "};\n";
  }

  // catalog.js を読み、change(catalog) で書き換えて保存する。change が false を返したら保存しない
  function updateCatalog(root, change) {
    return root.getDirectoryHandle("manuals").then(function (md) {
      return readText(md, "catalog.js").then(function (text) {
        var c = parseCatalog(text);
        if (change(c) === false) return false;
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

  window.WIFolder = {
    supported: supported,
    getRoot: getRoot,
    writeFile: writeFile,
    readText: readText,
    parseCatalog: parseCatalog,
    catalogText: catalogText,
    updateCatalog: updateCatalog,
    parseManual: parseManual,
    manualText: manualText
  };
})();
