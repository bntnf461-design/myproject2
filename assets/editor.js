/* =========================================================
   要領書エディタ
   - 画面で入力 →「保存」で manuals フォルダに置く .js ファイルを書き出す
   - 入力途中の内容はこの PC のブラウザに自動保存
   ========================================================= */
(function () {
  "use strict";
  var esc = WI.esc;
  var formEl = document.getElementById("form");
  var draftState = document.getElementById("draftState");
  var DRAFT_KEY = "wi.draft";

  var m = null;          // 編集中のデータ
  var fileName = "";     // 書き出し時のファイル名（既存ファイルを開いた場合はその名前）
  var objectUrls = {};   // この画面で選んだ動画ファイル → 確認用の一時 URL
  var pickedFiles = {};  // この画面で選んだ動画・画像（"videos/a.mp4" → File）。フォルダ保存時にコピーする

  // ---------- 初期データ ----------
  function blankStep() {
    return { title: "", detail: "", points: [blankPoint()], time: "", image: "", video: { src: "", start: "", end: "" } };
  }
  function blankPoint() {
    return { text: "", reason: "", kind: "", video: { src: "", start: "", end: "" } };
  }
  function blankManual() {
    var today = new Date();
    var d = today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());
    return {
      id: "", docNo: "", title: "", category: "", process: "", line: "", product: "",
      revision: "1", issued: d, updated: d, author: "", checker: "", approver: "", purpose: "",
      cautions: [], ppe: [], tools: [], materials: [],
      steps: [blankStep()],
      revisions: [{ rev: "1", date: d, content: "新規制定", by: "" }]
    };
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // 古いデータや手書きのファイルでも編集できるよう、足りない項目を補う
  function normalize(d) {
    var b = blankManual();
    Object.keys(b).forEach(function (k) { if (d[k] === undefined || d[k] === null) d[k] = b[k]; });
    delete d._file;
    d.steps.forEach(function (s) {
      if (!s.points) s.points = [];
      if (!s.video) s.video = { src: "", start: "", end: "" };
      ["title", "detail", "time", "image"].forEach(function (k) { if (s[k] == null) s[k] = ""; });
      s.points.forEach(function (p) {
        if (!p.video) p.video = { src: "", start: "", end: "" };
        ["text", "reason", "kind"].forEach(function (k) { if (p[k] == null) p[k] = ""; });
      });
    });
    return d;
  }

  // ---------- 起動 ----------
  var paramFile = WI.getParam("file");
  if (paramFile) {
    WI.loadManualFile(paramFile, function (data, err) {
      if (!data) { formEl.innerHTML = '<div class="notice error">' + esc(err) + '</div>'; return; }
      fileName = paramFile;
      m = normalize(JSON.parse(JSON.stringify(data)));
      render();
      notice("「" + paramFile + "」を開きました。");
    });
  } else {
    var draft = loadDraft();
    if (draft) {
      m = normalize(draft.data);
      fileName = draft.file || "";
      render();
      if (WI.getParam("resume") !== "1") notice("前回の編集途中の内容を復元しました。最初から作る場合は「新規」を押してください。");
    } else {
      m = blankManual();
      render();
    }
  }

  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  var saveTimer = null;
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ data: m, file: fileName }));
        draftState.textContent = "自動保存 " + new Date().toLocaleTimeString().slice(0, 5);
      } catch (e) {
        draftState.textContent = "自動保存できません";
      }
    }, 400);
  }

  // ---------- 描画 ----------
  function field(label, path, opt) {
    opt = opt || {};
    var v = getPath(path);
    var input;
    if (opt.type === "textarea") {
      input = '<textarea data-path="' + path + '"' + (opt.ph ? ' placeholder="' + esc(opt.ph) + '"' : '') + '>' + esc(v) + '</textarea>';
    } else if (opt.type === "lines" || opt.type === "pairs") {
      var text = (v || []).map(function (x) {
        return typeof x === "object" ? x.name + (x.qty ? " | " + x.qty : "") : x;
      }).join("\n");
      input = '<textarea data-path="' + path + '" data-type="' + opt.type + '"' + (opt.ph ? ' placeholder="' + esc(opt.ph) + '"' : '') + '>' + esc(text) + '</textarea>';
    } else {
      input = '<input type="' + (opt.type || "text") + '" data-path="' + path + '" value="' + esc(v) + '"' +
        (opt.ph ? ' placeholder="' + esc(opt.ph) + '"' : '') + '>';
    }
    return '<label class="field' + (opt.wide ? " wide" : "") + '"><span>' + label + '</span>' + input +
      (opt.hint ? '<span class="hint">' + opt.hint + '</span>' : '') + '</label>';
  }

  function videoFields(base, label) {
    return '<div class="video-fields">' +
      field(label || "動画ファイル", base + ".src", { ph: "videos/xxx.mp4" }) +
      field("開始", base + ".start", { ph: "0:00" }) +
      field("終了", base + ".end", { ph: "空欄=最後まで" }) +
      '<div style="display:flex;gap:4px;flex-wrap:wrap">' +
        '<button type="button" class="btn small" data-act="pick-video" data-path="' + base + '">選ぶ</button>' +
        '<button type="button" class="btn small" data-act="seg" data-path="' + base + '">区間を設定</button>' +
      '</div></div>';
  }

  function render() {
    var y = window.scrollY;
    var h = "";

    h += '<div id="msgArea"></div>';

    h += '<section class="section"><h2>文書情報</h2><div class="form-grid">' +
      field("作業名（タイトル）＊", "title", { wide: true, ph: "例：ボルト締付け作業" }) +
      field("文書番号", "docNo", { ph: "例：WI-A-001" }) +
      field("改訂番号", "revision") +
      field("区分", "category", { ph: "例：組立／検査／点検" }) +
      field("工程", "process") +
      field("ライン・場所", "line") +
      field("品番・品名", "product") +
      field("制定日", "issued", { type: "date" }) +
      field("改訂日", "updated", { type: "date" }) +
      field("作成", "author") +
      field("確認", "checker") +
      field("承認", "approver") +
      field("目的", "purpose", { type: "textarea", wide: true }) +
    '</div></section>';

    h += '<section class="section"><h2>作業前の準備</h2><div class="form-grid lists">' +
      field("安全上の注意", "cautions", { type: "lines", hint: "1 行に 1 項目" }) +
      field("保護具", "ppe", { type: "lines", hint: "1 行に 1 項目" }) +
      field("使用する設備・治工具", "tools", { type: "pairs", ph: "トルクレンチ | 1本", hint: "1 行に 1 項目。数量は「|」の後ろに" }) +
      field("使用部品・材料", "materials", { type: "pairs", ph: "ボルト M8 | 4本", hint: "1 行に 1 項目。数量は「|」の後ろに" }) +
    '</div></section>';

    h += '<section class="section"><h2>作業手順</h2>';
    m.steps.forEach(function (s, i) {
      var b = "steps." + i;
      h += '<div class="edit-card" id="ed-step-' + i + '"><header>' +
        '<span class="ttl">手順 ' + (i + 1) + '</span>' +
        '<button type="button" class="btn on-navy small" data-act="step-up" data-i="' + i + '"' + (i === 0 ? " disabled" : "") + '>↑ 上へ</button>' +
        '<button type="button" class="btn on-navy small" data-act="step-down" data-i="' + i + '"' + (i === m.steps.length - 1 ? " disabled" : "") + '>↓ 下へ</button>' +
        '<button type="button" class="btn on-navy small" data-act="step-dup" data-i="' + i + '">複製</button>' +
        '<button type="button" class="btn on-navy small" data-act="step-del" data-i="' + i + '">削除</button>' +
      '</header><div class="body"><div class="form-grid">' +
        field("主なステップ（何をするか）", b + ".title", { wide: true, ph: "例：ボルトを仮締めする" }) +
        field("詳しい説明", b + ".detail", { type: "textarea", wide: true }) +
        field("標準時間（秒）", b + ".time", { type: "number" }) +
        '<div class="field"><span>写真・図（任意）</span><div style="display:flex;gap:4px">' +
          '<input type="text" data-path="' + b + '.image" value="' + esc(s.image) + '" placeholder="images/xxx.jpg" style="flex:1;min-width:0">' +
          '<button type="button" class="btn small" data-act="pick-image" data-path="' + b + '.image">選ぶ</button></div></div>' +
        '<div class="field wide"><span>この手順の動画</span>' + videoFields(b + ".video") + '</div>' +
      '</div>' +
      '<div class="sub-list"><b>急所（どのように）と理由</b>';
      s.points.forEach(function (p, j) {
        var pb = b + ".points." + j;
        h += '<div class="sub-row">' +
          '<label class="field"><span>種類</span><select data-path="' + pb + '.kind">' +
            opt("", "（なし）", p.kind) + opt("safety", "安全", p.kind) + opt("quality", "品質", p.kind) + opt("ease", "やりやすさ", p.kind) +
          '</select></label>' +
          field("急所", pb + ".text", { ph: "例：対角の順番で締める" }) +
          field("理由", pb + ".reason", { ph: "例：片締めを防ぐため" }) +
          '<button type="button" class="btn small danger" data-act="point-del" data-i="' + i + '" data-j="' + j + '" style="margin-top:22px">削除</button>' +
          '<details class="field wide" style="grid-column:1/-1"' + (p.video.src ? " open" : "") + '><summary class="hint">この急所だけの動画（任意）</summary>' +
            videoFields(pb + ".video", "動画ファイル") + '</details>' +
        '</div>';
      });
      h += '<button type="button" class="btn small" data-act="point-add" data-i="' + i + '">＋ 急所を追加</button></div>';
      h += '</div></div>';
    });
    h += '</section>';

    h += '<section class="section"><h2>改訂履歴</h2>';
    m.revisions.forEach(function (r, i) {
      var b = "revisions." + i;
      h += '<div class="sub-row" style="grid-template-columns:5em 10em 1fr 8em auto">' +
        field("改訂", b + ".rev") + field("日付", b + ".date", { type: "date" }) +
        field("内容", b + ".content") + field("担当", b + ".by") +
        '<button type="button" class="btn small danger" data-act="rev-del" data-i="' + i + '" style="margin-top:22px">削除</button></div>';
    });
    h += '<button type="button" class="btn small" data-act="rev-add">＋ 改訂を追加</button></section>';

    formEl.innerHTML = h;
    window.scrollTo(0, y);
  }

  function opt(v, label, cur) {
    return '<option value="' + v + '"' + (v === (cur || "") ? " selected" : "") + '>' + label + '</option>';
  }

  function notice(text, isError) {
    var a = document.getElementById("msgArea");
    if (a) a.innerHTML = '<div class="notice' + (isError ? " error" : "") + '" style="margin-bottom:16px">' + text + '</div>';
  }

  // ---------- データ操作 ----------
  function getPath(path) {
    var o = m;
    var ks = path.split(".");
    for (var i = 0; i < ks.length; i++) { if (o == null) return ""; o = o[ks[i]]; }
    return o == null ? "" : o;
  }
  function setPath(path, v) {
    var o = m;
    var ks = path.split(".");
    for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = v;
  }
  function setInput(path, v) {
    setPath(path, v);
    var el = formEl.querySelector('[data-path="' + path + '"]:not(button)');
    if (el) el.value = v;
    saveDraft();
  }

  formEl.addEventListener("input", function (ev) {
    var el = ev.target;
    var path = el.getAttribute("data-path");
    if (!path || el.tagName === "BUTTON") return;
    var type = el.getAttribute("data-type");
    var v = el.value;
    if (type === "lines") {
      v = v.split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
    } else if (type === "pairs") {
      v = v.split("\n").map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) {
        var k = x.search(/[|｜]/);
        return k === -1 ? { name: x, qty: "" } : { name: x.slice(0, k).trim(), qty: x.slice(k + 1).trim() };
      });
    } else if (el.type === "number") {
      v = v === "" ? "" : Number(v);
    }
    setPath(path, v);
    saveDraft();
  });
  formEl.addEventListener("change", function (ev) {
    if (ev.target.tagName === "SELECT") ev.target.dispatchEvent(new Event("input", { bubbles: true }));
  });

  formEl.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-act]");
    if (!b) return;
    var act = b.getAttribute("data-act");
    var i = parseInt(b.getAttribute("data-i"), 10);
    var j = parseInt(b.getAttribute("data-j"), 10);
    var path = b.getAttribute("data-path");
    var st = m.steps;
    switch (act) {
      case "step-up": swap(st, i, i - 1); break;
      case "step-down": swap(st, i, i + 1); break;
      case "step-dup": st.splice(i + 1, 0, JSON.parse(JSON.stringify(st[i]))); break;
      case "step-del":
        if (!confirm("手順 " + (i + 1) + " を削除しますか？")) return;
        st.splice(i, 1);
        if (!st.length) st.push(blankStep());
        break;
      case "point-add": st[i].points.push(blankPoint()); break;
      case "point-del": st[i].points.splice(j, 1); break;
      case "rev-add":
        var last = m.revisions[m.revisions.length - 1];
        var next = last && /^\d+$/.test(last.rev) ? String(Number(last.rev) + 1) : "";
        m.revisions.push({ rev: next, date: m.updated || "", content: "", by: "" });
        break;
      case "rev-del": m.revisions.splice(i, 1); break;
      case "pick-video": pick("video", path); return;
      case "pick-image": pick("image", path); return;
      case "seg": openSeg(path); return;
      default: return;
    }
    render();
    saveDraft();
  });

  function swap(a, x, y) {
    if (y < 0 || y >= a.length) return;
    var t = a[x]; a[x] = a[y]; a[y] = t;
  }

  // ---------- ファイル選択（動画・画像） ----------
  // 選んだファイルは videos / images フォルダに置く前提で、相対パスを入力する
  var picker = document.createElement("input");
  picker.type = "file";
  picker.hidden = true;
  document.body.appendChild(picker);
  var pickTarget = null;
  var pickKind = "";

  function pick(kind, path) {
    pickKind = kind;
    pickTarget = path;
    picker.value = "";
    picker.accept = kind === "video" ? "video/mp4,video/webm,.mp4,.webm,.m4v" : "image/*";
    picker.click();
  }
  picker.addEventListener("change", function () {
    var f = picker.files && picker.files[0];
    if (!f || !pickTarget) return;
    if (pickKind === "video") {
      var src = "videos/" + f.name;
      if (objectUrls[src]) URL.revokeObjectURL(objectUrls[src]);
      objectUrls[src] = URL.createObjectURL(f);
      pickedFiles[src] = f;
      setInput(pickTarget + ".src", src);
      if (!/\.mp4$|\.m4v$/i.test(f.name)) {
        notice("MP4（H.264）形式をおすすめします。他の形式は PC によって再生できない場合があります。");
      }
    } else {
      setInput(pickTarget, "images/" + f.name);
      pickedFiles["images/" + f.name] = f;
    }
  });

  // ---------- 区間設定 ----------
  var seg = document.getElementById("seg");
  var segVideo = document.getElementById("segVideo");
  var segInfo = document.getElementById("segInfo");
  var segMsg = document.getElementById("segMsg");
  var segBase = "";
  var segStopAt = null;

  function openSeg(base) {
    var src = getPath(base + ".src");
    if (!src) { alert("先に動画ファイルを選んでください。"); return; }
    segBase = base;
    segStopAt = null;
    segMsg.classList.remove("show");
    document.getElementById("segSrc").textContent = src;
    seg.classList.add("open");
    document.body.style.overflow = "hidden";
    segVideo.src = objectUrls[src] || src;
    segVideo.load();
    var st = WI.parseTime(getPath(base + ".start"));
    segVideo.onloadedmetadata = function () { if (st) segVideo.currentTime = st; };
    updateSegInfo();
  }
  function closeSeg() {
    segVideo.pause();
    segVideo.removeAttribute("src");
    segVideo.load();
    seg.classList.remove("open");
    document.body.style.overflow = "";
  }
  function updateSegInfo() {
    var s = getPath(segBase + ".start"), e = getPath(segBase + ".end");
    segInfo.textContent = "開始 " + (s || "0:00") + " ／ 終了 " + (e || "最後まで");
  }
  segVideo.addEventListener("timeupdate", function () {
    if (segStopAt != null && segVideo.currentTime >= segStopAt) { segVideo.pause(); segStopAt = null; }
  });
  segVideo.addEventListener("error", function () {
    if (!segVideo.getAttribute("src")) return;
    segMsg.innerHTML = "動画を開けません。videos フォルダにファイルがあるか確認するか、「選ぶ」から選び直してください。";
    segMsg.classList.add("show");
  });
  document.getElementById("segClose").addEventListener("click", closeSeg);
  document.getElementById("segSetStart").addEventListener("click", function () {
    setInput(segBase + ".start", WI.formatTime(segVideo.currentTime));
    updateSegInfo();
  });
  document.getElementById("segSetEnd").addEventListener("click", function () {
    setInput(segBase + ".end", WI.formatTime(segVideo.currentTime));
    updateSegInfo();
  });
  document.getElementById("segPlay").addEventListener("click", function () {
    segVideo.currentTime = WI.parseTime(getPath(segBase + ".start")) || 0;
    segStopAt = WI.parseTime(getPath(segBase + ".end"));
    segVideo.play();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && seg.classList.contains("open")) closeSeg();
  });

  // ---------- 書き出し ----------
  // 空の項目を取り除いた保存用データ
  function cleaned() {
    var d = JSON.parse(JSON.stringify(m));
    if (!d.id) d.id = d.docNo || ("WI-" + Date.now());
    d.steps.forEach(function (s) {
      s.points = s.points.filter(function (p) { return p.text || p.reason; });
    });
    return d;
  }

  function toFileText(d) {
    return "registerManual(" + JSON.stringify(d, null, 2) + ");\n";
  }

  function suggestName() {
    if (fileName) return fileName;
    var base = (m.docNo || m.title || "manual").replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "");
    return (base || "manual") + ".js";
  }

  document.getElementById("save").addEventListener("click", function () {
    if (!m.title) { notice("作業名（タイトル）を入力してください。", true); window.scrollTo(0, 0); return; }
    var name = suggestName();
    var blob = new Blob([toFileText(cleaned())], { type: "text/javascript;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    fileName = name;
    saveDraft();
    notice("<b>「" + esc(name) + "」を書き出しました。</b><br>" +
      "① ダウンロードしたファイルを <b>manuals</b> フォルダに入れる（同じ名前があれば上書き）<br>" +
      "② 新しい要領書の場合は <b>manuals/catalog.js</b> の files に <code>\"" + esc(name) + "\"</code> を追加<br>" +
      "③ 使った動画は <b>videos</b> フォルダ、写真は <b>images</b> フォルダに入れる");
    window.scrollTo(0, 0);
  });

  // ---------- フォルダに直接保存（Chrome / Edge。ネット接続不要） ----------
  // テンプレートのフォルダを選ぶと、要領書ファイルの保存・目録への追加・動画/写真のコピーを一度に行う
  var rootDir = null;
  var saveDirBtn = document.getElementById("saveDir");
  if (window.showDirectoryPicker) saveDirBtn.hidden = false;

  function getRootDir() {
    var ok = rootDir
      ? rootDir.requestPermission({ mode: "readwrite" }).then(function (p) { return p === "granted"; })
      : Promise.resolve(false);
    return ok.then(function (granted) {
      if (granted) return rootDir;
      return window.showDirectoryPicker({ id: "wi-root", mode: "readwrite" }).then(function (dir) {
        // 正しいフォルダ（index.html と manuals があるフォルダ）か確認
        return dir.getDirectoryHandle("manuals").then(function (md) {
          return md.getFileHandle("catalog.js");
        }).then(function () {
          rootDir = dir;
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

  // catalog.js の files に名前が無ければ追加（siteName など他の部分はそのまま残す）
  function addToCatalog(text, name) {
    var re = /(files\s*:\s*\[)([\s\S]*?)(\])/;
    var mt = re.exec(text);
    if (!mt) throw new Error("manuals/catalog.js の形式が読み取れません。files に手で追加してください。");
    var names = [];
    mt[2].replace(/["']([^"']+)["']/g, function (_, n) { names.push(n); return ""; });
    if (names.indexOf(name) !== -1) return null;
    names.push(name);
    var list = "\n" + names.map(function (n) { return '    "' + n + '"'; }).join(",\n") + "\n  ";
    return text.slice(0, mt.index) + mt[1] + list + mt[3] + text.slice(mt.index + mt[0].length);
  }

  // 選んだ動画・写真のうち、まだフォルダに無いものをコピー
  function copyMedia(root, d) {
    var srcs = [];
    d.steps.forEach(function (s) {
      srcs.push(s.image, s.video && s.video.src);
      s.points.forEach(function (p) { srcs.push(p.video && p.video.src); });
    });
    var todo = srcs.filter(function (x, i) { return x && pickedFiles[x] && srcs.indexOf(x) === i; });
    var copied = [];
    return todo.reduce(function (pr, src) {
      return pr.then(function () {
        var parts = src.split("/");
        return root.getDirectoryHandle(parts[0], { create: true }).then(function (dir) {
          return dir.getFileHandle(parts[1]).then(function () { /* 既にある */ }, function () {
            notice("動画・写真をコピー中… " + esc(src));
            return writeFile(dir, parts[1], pickedFiles[src]).then(function () { copied.push(src); });
          });
        });
      });
    }, Promise.resolve()).then(function () { return copied; });
  }

  saveDirBtn.addEventListener("click", function () {
    if (!m.title) { notice("作業名（タイトル）を入力してください。", true); window.scrollTo(0, 0); return; }
    var name = suggestName();
    var d = cleaned();
    var root, added = false, copied = [];
    saveDirBtn.disabled = true;
    getRootDir().then(function (r) {
      root = r;
      return root.getDirectoryHandle("manuals");
    }).then(function (md) {
      return writeFile(md, name, toFileText(d)).then(function () {
        return readText(md, "catalog.js");
      }).then(function (cat) {
        var next = addToCatalog(cat, name);
        if (next === null) return;
        added = true;
        return writeFile(md, "catalog.js", next);
      });
    }).then(function () {
      return copyMedia(root, d);
    }).then(function (c) {
      copied = c;
      fileName = name;
      saveDraft();
      notice("<b>保存しました：manuals/" + esc(name) + "</b>" +
        (added ? "<br>一覧（目録）に追加しました。" : "") +
        (copied.length ? "<br>コピーした動画・写真：" + copied.map(esc).join("、") : "") +
        '<br><a href="index.html">一覧で確認する</a>');
      window.scrollTo(0, 0);
    }).catch(function (e) {
      if (e && e.name === "AbortError") return; // フォルダ選択をキャンセル
      notice("保存できませんでした。" + esc(e && e.message ? e.message : e), true);
      window.scrollTo(0, 0);
    }).then(function () {
      saveDirBtn.disabled = false;
    });
  });

  document.getElementById("preview").addEventListener("click", function () {
    try {
      localStorage.setItem("wi.preview", JSON.stringify(cleaned()));
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ data: m, file: fileName }));
    } catch (e) {
      notice("プレビューを作成できませんでした（ブラウザの保存領域が使えません）。", true);
      return;
    }
    location.href = "manual.html?preview=1";
  });

  document.getElementById("addStep").addEventListener("click", function () {
    m.steps.push(blankStep());
    render();
    saveDraft();
    var el = document.getElementById("ed-step-" + (m.steps.length - 1));
    if (el) el.scrollIntoView();
  });

  document.getElementById("newDoc").addEventListener("click", function () {
    if (!confirm("入力中の内容を破棄して、新しい要領書を作りますか？")) return;
    m = blankManual();
    fileName = "";
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    history.replaceState(null, "", "editor.html");
    render();
    window.scrollTo(0, 0);
  });

  document.getElementById("openFile").addEventListener("change", function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var input = this;
    var r = new FileReader();
    r.onload = function () {
      var text = String(r.result);
      var a = text.indexOf("("), b = text.lastIndexOf(")");
      var json = /^\s*registerManual\s*\(/.test(text) ? text.slice(a + 1, b) : text;
      try {
        m = normalize(JSON.parse(json));
        fileName = f.name;
        render();
        saveDraft();
        notice("「" + esc(f.name) + "」を開きました。");
      } catch (e) {
        notice("このファイルは読み込めません（形式が違います）。", true);
      }
      input.value = "";
    };
    r.readAsText(f, "utf-8");
  });
})();
