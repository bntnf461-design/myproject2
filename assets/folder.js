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
  // opt.noGuide: 案内を先に画面に出してあるので、すぐフォルダ選択を開く（はじめての案内から）
  function getRoot(opt) {
    var noGuide = opt && opt.noGuide;
    return (rootDir ? Promise.resolve(rootDir) : remembered).then(function (d) {
      if (!d) return pick(noGuide);
      return permit(d).then(function (ok) {
        if (!ok) return pick(noGuide);
        return samePage(d).then(function (same) {
          if (same === true) { matchesPage = true; return use(d); }
          return pick(noGuide);
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
  // いま開いているページがあるフォルダ（例：デスクトップ ＞ sagyo-youryousho-2 ＞ sagyo-youryousho）
  var KNOWN = {
    desktop: ["デスクトップ", "desktop"], "デスクトップ": ["デスクトップ", "desktop"],
    documents: ["ドキュメント", "documents"], "ドキュメント": ["ドキュメント", "documents"],
    downloads: ["ダウンロード", "downloads"], "ダウンロード": ["ダウンロード", "downloads"]
  };
  function pageFolder() {
    if (location.protocol !== "file:") return null;
    var path = decodeURIComponent(location.pathname);
    var unc = /^\/\//.test(path) || location.host; // 共有フォルダ（\\サーバー\共有）
    var parts = path.split("/").filter(Boolean);
    if (location.host) parts.unshift(location.host);
    parts.pop(); // editor.html など
    var startIn, crumbs = parts.slice();
    for (var i = parts.length - 1; i >= 0; i--) {
      var k = parts[i].toLowerCase();
      if (KNOWN[k]) {
        startIn = KNOWN[k][1];
        crumbs = [KNOWN[k][0]].concat(parts.slice(i + 1));
        break;
      }
      if (/^onedrive/.test(k)) { crumbs = parts.slice(i); break; }
    }
    return { full: (unc ? "\\\\" : "") + parts.join("\\"), crumbs: crumbs, startIn: startIn };
  }

  // フォルダを選ぶ前に、どのフォルダを選べばよいかを画面に出す
  // （ボタンを押したときにフォルダ選択の画面を開く。ブラウザの決まりで、ボタン操作から開く必要がある）
  function openPicker() {
    var pf = pageFolder();
    var opt = { id: "wi-root", mode: "readwrite" };
    if (pf && pf.startIn) opt.startIn = pf.startIn;
    return window.showDirectoryPicker(opt);
  }

  // フォルダを選ぶときに出るブラウザの画面を、絵で見せる（押すボタンに赤い丸）
  function pictures() {
    return '<div class="fg-pics" aria-hidden="true">' +
      '<figure><div class="fg-win">' +
          '<div class="fg-bar">フォルダーの選択</div>' +
          '<div class="fg-files"><span>📁 assets</span><span>📁 images</span><span>📁 manuals</span><span>📁 videos</span><span>📄 index.html</span></div>' +
          '<div class="fg-btns"><span class="fg-hit">フォルダーの選択</span><span>キャンセル</span></div>' +
        '</div><figcaption>① index.html が見えるフォルダを開いて「<b>フォルダーの選択</b>」</figcaption></figure>' +
      '<figure><div class="fg-win small">' +
          '<div class="fg-q">このサイトに「…」内のファイルの<b>表示</b>を許可しますか？</div>' +
          '<div class="fg-btns"><span class="fg-hit">ファイルを表示</span><span>キャンセル</span></div>' +
          '<div class="fg-q">このサイトにファイルの<b>編集</b>を許可しますか？</div>' +
          '<div class="fg-btns"><span class="fg-hit">ファイルを編集</span><span>キャンセル</span></div>' +
        '</div><figcaption>② 確認が出たら「<b>ファイルを表示</b>」「<b>ファイルを編集</b>」（許可）を押す。キャンセルは押さない</figcaption></figure>' +
    '</div>';
  }

  // どのフォルダを選べばよいか（場所の表示と手順）
  function guideBody() {
    var pf = pageFolder();
    return '<p>次に開く画面で、<b>この画面のファイル（index.html・editor.html など）があるフォルダ</b>を選んでください。</p>' +
      (pf ? '<div class="crumbs">' + pf.crumbs.map(function (c) { return '<span>' + WI.esc(c) + '</span>'; }).join('<i>＞</i>') + '</div>' +
        '<p class="hint">場所：' + WI.esc(pf.full) + '</p>' : '') +
      '<ol>' +
        '<li>上のフォルダを順に開く（' + (pf && pf.crumbs.length ? '最後の「<b>' + WI.esc(pf.crumbs[pf.crumbs.length - 1]) + '</b>」を開いた状態' : 'index.html が見える状態') + '）</li>' +
        '<li>「<b>フォルダーの選択</b>」を押す</li>' +
        '<li>「ファイルの表示（編集）を許可しますか」と出たら、<b>許可</b>のボタン（「ファイルを表示」「ファイルを編集」）を押す</li>' +
      '</ol>' + pictures() +
      '<p class="hint">一度選ぶと覚えるので、次からはこの手順はいりません（ブラウザを開き直したときは、許可の確認だけ出ます）。</p>';
  }

  function guide() {
    return new Promise(function (resolve, reject) {
      var box = document.createElement("div");
      box.className = "folder-guide";
      box.setAttribute("role", "dialog");
      box.innerHTML =
        '<div class="folder-guide-box">' +
          '<h2>保存先のフォルダを選びます</h2>' + guideBody() +
          '<div class="actions"><button type="button" class="btn" data-g="cancel">やめる</button>' +
          '<button type="button" class="btn primary" data-g="ok">フォルダを選ぶ</button></div>' +
        '</div>';
      document.body.appendChild(box);
      box.querySelector('[data-g="ok"]').focus();
      box.addEventListener("click", function (ev) {
        var g = ev.target.getAttribute && ev.target.getAttribute("data-g");
        if (!g) return;
        box.remove();
        if (g === "ok") {
          // ボタンを押した操作の中でフォルダ選択を開く
          resolve(openPicker());
        } else {
          var e = new Error("cancel");
          e.name = "AbortError";
          reject(e);
        }
      });
    });
  }

  function pick(noGuide) {
    return (noGuide ? openPicker() : guide()).then(findTemplateDir).then(function (dir) {
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
      "   - siteName   : 画面上部に表示する名前（org をつなげたもの）\n" +
      "   - org        : 工場・課・工程などの名前（上から順に「○○工場 ＞ ○○課 ＞ ○○工程」と表示）\n" +
      "   - levels     : 一覧で絞り込む項目と順番（line / product / process / category）\n" +
      "   - labels     : 項目の表示名\n" +
      "   - categories : カテゴリーの名前と並び順（エディタの候補にも出ます）\n" +
      "   - terms      : 要領書の見出しの名前（社内フォーマットに合わせる。空なら標準の名前）\n" +
      "   - speech     : 読み上げの声（natural=自然な声を使う、voice=言語ごとの声の名前）\n" +
      "   - readings   : 読み上げの読み方（w の言葉を y の読みで読む）\n" +
      "   - glossary   : 翻訳の用語集（日本語 ja → インドネシア語 id の決まった訳語）\n" +
      "   - formats    : 覚えた Excel の様式（取り込みで列の対応を直して「この様式を覚える」を押したもの）\n" +
      "   - files      : manuals フォルダに置いた要領書ファイル名\n" +      "   - folderId   : このフォルダの目印（自動で付きます。変更しないでください）\n" +
      "   ========================================================= */\n" +
      "window.CATALOG = {\n" +
      "  folderId: " + j(c.folderId || "") + ",\n" +
      "  siteName: " + j(c.siteName || "") + ",\n" +
      "  org: " + j(c.org || []) + ",\n" +
      "  levels: " + j(c.levels || []) + ",\n" +
      "  labels: " + j(c.labels || {}) + ",\n" +
      "  terms: " + j(c.terms || {}) + ",\n" +
      (c.formats && c.formats.length ? "  formats: " + j(c.formats) + ",\n" : "") +
      (c.glossary && c.glossary.length ? "  glossary: " + j(c.glossary) + ",\n" : "") +
      (c.readings && c.readings.length ? "  readings: " + j(c.readings) + ",\n" : "") +
      (c.speech && (c.speech.natural || Object.keys(c.speech.voice || {}).length) ? "  speech: " + j(c.speech) + ",\n" : "") +
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
    guideBody: guideBody,
    pictures: pictures,
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
