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
  var dirty = false;     // ファイル（フォルダ）にまだ保存していない変更があるか
  var objectUrls = {};   // この画面で選んだ動画ファイル → 確認用の一時 URL
  var mediaChecks = {};  // 選んだ動画・写真のチェック結果（"videos/a.mp4" → {level, summary, items}）
  var pickedFiles = {};  // この画面で選んだ動画・画像（"videos/a.mp4" → File）。フォルダ保存時にコピーする
  var freshFiles = {};   // まだフォルダに書き出していない（または中身が変わった）もの

  function addPicked(src, f) {
    pickedFiles[src] = f;
    freshFiles[src] = true;
  }

  // ---------- 初期データ ----------
  function blankStep() {
    return { title: "", detail: "", points: [blankPoint()], kinds: [], time: "", image: "", video: { src: "", start: "", end: "" } };
  }
  function blankPoint() {
    return { text: "", reason: "", kind: "", video: { src: "", start: "", end: "" } };
  }
  function blankManual() {
    var today = new Date();
    var d = today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());
    return {
      id: "", docNo: "", title: "", category: "", process: "", line: "", product: "",
      revision: "1", issued: d, updated: d, author: "", checker: "", inspector: "", approver: "", purpose: "",
      cautions: [], ppe: [], tools: [], materials: [],
      terms: {},
      steps: [blankStep()],
      revisions: [{ rev: "1", date: d, content: "新規制定", by: "" }]
    };
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isoToday() {
    var t = new Date();
    return t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate());
  }


  // 古いデータや手書きのファイルでも編集できるよう、足りない項目を補う
  function normalize(d) {
    var b = blankManual();
    Object.keys(b).forEach(function (k) { if (d[k] === undefined || d[k] === null) d[k] = b[k]; });
    delete d._file;
    if (!d.terms) d.terms = {};
    d.steps.forEach(function (s) {
      if (!s.points) s.points = [];
      if (!s.kinds) s.kinds = [];
      if (!s.video) s.video = { src: "", start: "", end: "" };
      ["title", "detail", "time", "image"].forEach(function (k) { if (s[k] == null) s[k] = ""; });
      s.points.forEach(function (p) {
        if (!p.video) p.video = { src: "", start: "", end: "" };
        ["text", "reason", "kind"].forEach(function (k) { if (p[k] == null) p[k] = ""; });
      });
    });
    return d;
  }

  // ---------- 一覧の絞り込み（カテゴリー）用の入力候補 ----------
  // 登録済みの要領書で使っているライン名・製品名などを候補に出し、表記ゆれ（Aライン／A ライン など）を防ぐ
  var CAT_HINT = "一覧の絞り込みに使います。候補から選ぶと表記がそろいます。複数ある場合は「、」で区切る";
  var CAT_KEYS = WI.CAT_KEYS;
  var catConf = WI.catConfig(window.CATALOG);
  var dlBox = document.createElement("div");
  document.body.appendChild(dlBox);
  function loadSuggestions() {
    var files = (window.CATALOG && window.CATALOG.files) || [];
    WI.loadManualFiles(files, function (results) {
      // 設定画面で登録したカテゴリー → 要領書で使われている名前 の順
      var vals = {};
      CAT_KEYS.forEach(function (k) { vals[k] = catConf.categories[k].slice(); });
      results.forEach(function (r) {
        if (!r.data) return;
        CAT_KEYS.forEach(function (k) {
          String(r.data[k] || "").split(/[、,，]/).forEach(function (v) {
            v = v.trim();
            if (v && vals[k].indexOf(v) === -1) vals[k].push(v);
          });
        });
      });
      dlBox.innerHTML = CAT_KEYS.map(function (k) {
        return '<datalist id="dl-' + k + '">' + vals[k].sort(WI.catSorter(catConf.categories[k]))
          .map(function (v) { return '<option value="' + esc(v) + '">'; }).join("") + '</datalist>';
      }).join("");
    });
  }

  // 入力のしかた（かんたん入力／すべての項目）。起動時の表示より前に決めておく
  var editMode = "easy";
  try { editMode = localStorage.getItem("wi.editMode") || "easy"; } catch (e) {}
  var ep = 0;
  var ezWantPhoto = {}; // 「写真」を選んだが、まだ写真を選んでいない手順
  // 開いたとき（または最後に保存したとき）のファイルの中身。保存の前に比べて、別の人が保存していないかを確かめる
  var baseText = "";
  function canon(d) { var c = JSON.parse(JSON.stringify(d)); delete c._file; return JSON.stringify(c); }

  // ---------- 起動 ----------
  var paramFile = WI.getParam("file");
  if (paramFile) {
    WI.loadManualFile(paramFile, function (data, err) {
      if (!data) {
        // 読み込めないファイル：空の要領書を出し、どのボタンを押しても壊れないようにする（元のファイルには触らない）
        m = blankManual();
        fileName = "";
        history.replaceState(null, "", "editor.html");
        render();
        notice("<b>「" + esc(paramFile) + "」を読み込めませんでした。</b>" + esc(err) +
          "<br><small>ファイルが壊れている可能性があります。manuals/_backup に前の内容が残っていれば、そちらを「ファイルを開く」で開いてください。いまは新しい要領書の画面になっています。</small>", true);
        return;
      }
      fileName = paramFile;
      baseText = canon(data);
      m = normalize(JSON.parse(JSON.stringify(data)));
      render();
      notice("「" + paramFile + "」を開きました。");
      loadSuggestions(); // 読み込みは 1 つずつ行う必要があるので、開き終わってから
    });
  } else {
    var draft = loadDraft();
    if (draft) {
      m = normalize(draft.data);
      fileName = draft.file || "";
      baseText = draft.base || "";
      dirty = draft.dirty !== false;
      render();
      draftState.textContent = dirty ? "● 未保存" : "保存済み";
      if (WI.getParam("resume") !== "1") {
        notice(dirty
          ? "前回の編集途中の内容を復元しました。最初から作る場合は「新規」を押してください。"
          : "前回編集した「" + esc(fileName) + "」を開いています。新しく作る場合は「新規」を押してください。");
      }
    } else {
      m = blankManual();
      render();
    }
    loadSuggestions();
  }

  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  var saveTimer = null;
  function saveDraft() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ data: m, file: fileName, dirty: dirty, base: baseText }));
        draftState.textContent = dirty ? "● 未保存" : "保存済み";
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
        (opt.ph ? ' placeholder="' + esc(opt.ph) + '"' : '') + (opt.list ? ' list="dl-' + opt.list + '" autocomplete="off"' : '') + '>';
    }
    return '<label class="field' + (opt.wide ? " wide" : "") + '"><span>' + label + '</span>' + input +
      (opt.hint ? '<span class="hint">' + opt.hint + '</span>' : '') + '</label>';
  }

  // 承認・点検・確認・作成：名前と、判子の画像（Excel から取り込んだもの・選んだもの）
  function stampField(label, key) {
    var img = m.stamps && m.stamps[key];
    return '<div class="field stamp-field"><label class="field"><span>' + label + '</span>' +
      '<input type="text" data-path="' + key + '" value="' + esc(m[key]) + '"></label>' +
      '<div class="stamp-img">' + (img
        ? '<img src="' + esc(objectUrls[img] || img) + '" alt="' + label + 'の判子" onerror="this.style.visibility=\'hidden\'">' +
          '<button type="button" class="btn small" data-act="stamp-del" data-path="' + key + '">判子を外す</button>'
        : '<button type="button" class="btn small" data-act="pick-image" data-path="stamps.' + key + '" title="判子の画像（png・jpg）を選ぶ。無ければ名前を文字で表示します">判子の画像</button>') +
      '</div></div>';
  }

  function videoFields(base, label) {
    return '<div class="video-fields">' +
      field(label || "動画ファイル", base + ".src", { ph: "videos/xxx.mp4" }) +
      field("開始", base + ".start", { ph: "0:00" }) +
      field("終了", base + ".end", { ph: "空欄=最後まで" }) +
      '<div style="display:flex;gap:4px;flex-wrap:wrap">' +
        '<button type="button" class="btn small" data-act="pick-video" data-path="' + base + '">選ぶ</button>' +
        '<button type="button" class="btn small" data-act="seg" data-path="' + base + '">区間を設定</button>' +
      '</div></div>' + checkBox(getPath(base + ".src"));
  }

  // 動画・写真のチェック結果の表示
  function checkBox(src) {
    var c = src && mediaChecks[src];
    if (!c) return "";
    if (c.level === "checking") return '<div class="mcheck">確認中… ' + esc(src.split("/").pop()) + '</div>';
    return '<div class="mcheck ' + c.level + '">' +
      (c.level === "ok" ? "✓ 問題ありません" : c.level === "warn" ? "⚠ 注意" : "✕ 使えません") +
      '<span class="hint">（' + esc(c.summary) + '）</span>' +
      (c.items.length ? '<ul>' + c.items.map(function (x) { return "<li>" + x + "</li>"; }).join("") + '</ul>' : '') +
      (c.level !== "ok" ? '<a class="btn small" href="guide.html" target="_blank">スマホの撮影設定を見る</a>' : '') +
    '</div>';
  }

  // ---------- かんたん入力（1 画面に 1 つずつ） ----------
  // 0 = 作業の名前、1〜N = 手順、N+1 = 仕上げ。入力欄は「すべての項目」と同じ仕組み（data-path）で m を書き換える
  function modeSwitch() {
    return '<div class="mode-switch" role="group" aria-label="入力のしかた">' +
      '<button type="button" data-act="mode" data-v="easy" class="' + (editMode === "easy" ? "on" : "") + '">かんたん入力<small>1 つずつ順番に</small></button>' +
      '<button type="button" data-act="mode" data-v="full" class="' + (editMode === "full" ? "on" : "") + '">すべての項目<small>1 画面で全部</small></button>' +
    '</div>';
  }
  function mediaOf(s, i) { return s.noVideo ? (s.image || ezWantPhoto[i] ? "photo" : "none") : "video"; }
  function renderEasy() {
    var T = WI.terms(m, window.CATALOG);
    var N = m.steps.length;
    if (ep > N + 1) ep = N + 1;
    var h = '<div id="msgArea"></div>' + modeSwitch();
    // 進み具合（押すとその画面へ）
    h += '<ol class="ez-steps">' +
      '<li class="' + (ep === 0 ? "now" : "") + '"><button type="button" data-act="ez-go" data-i="0">① 作業の名前</button></li>' +
      m.steps.map(function (s, i) {
        return '<li class="' + (ep === i + 1 ? "now" : "") + (s.title ? " done" : "") + '"><button type="button" data-act="ez-go" data-i="' + (i + 1) + '" title="' + esc(s.title) + '">' + (i + 1) + '</button></li>';
      }).join("") +
      '<li class="' + (ep === N + 1 ? "now" : "") + '"><button type="button" data-act="ez-go" data-i="' + (N + 1) + '">③ 仕上げ</button></li>' +
    '</ol>';

    if (ep === 0) {
      h += '<section class="ez-page"><h2>① 作業の名前と場所</h2>' +
        '<div class="form-grid">' +
          field(esc(T.title) + "＊", "title", { wide: true, ph: "例：ボルト締付け作業" }) +
          field(esc(catConf.labels.line), "line", { list: "line", ph: "例：Aライン" }) +
          field(esc(catConf.labels.product), "product", { list: "product", ph: "例：BR-1024 ブラケット" }) +
          field(esc(catConf.labels.process), "process", { list: "process", ph: "例：第2組立工程" }) +
          field(esc(T.docNo), "docNo", { ph: "例：WI-A-001" }) +
          field("作成", "author", { ph: "あなたの名前" }) +
        '</div>' +
        '<p class="hint">保護具・安全上の注意・判子などは、上の「すべての項目」で入力できます。</p>' +
      '</section>';
    } else if (ep <= N) {
      var i = ep - 1, s = m.steps[i], b = "steps." + i, md = mediaOf(s, i);
      h += '<section class="ez-page edit-card" id="ed-step-' + i + '"><div class="ez-head"><h2>② 手順 ' + (i + 1) + ' <small>／ 全 ' + N + '</small></h2>' +
        '<span class="ez-tools">' +
          '<button type="button" class="btn small" data-act="step-up" data-i="' + i + '"' + (i === 0 ? " disabled" : "") + ' title="この手順を 1 つ前にする">↑ 前へ移す</button>' +
          '<button type="button" class="btn small" data-act="step-down" data-i="' + i + '"' + (i === N - 1 ? " disabled" : "") + ' title="この手順を 1 つ後にする">↓ 後へ移す</button>' +
          '<button type="button" class="btn small danger" data-act="step-del" data-i="' + i + '">この手順を消す</button>' +
        '</span></div>' +
        field(esc(T.step) + "（短く 1 行で）", b + ".title", { wide: true, ph: "例：ボルトを仮締めする" }) +
        '<div class="ez-points"><b>' + esc(T.point) + '</b><span class="hint">　うまくやるコツ・間違えやすいところ（無ければ空のままで OK）</span>';
      s.points.forEach(function (p, j) {
        h += '<div class="ez-point">' +
          field("", b + ".points." + j + ".text", { ph: "例：対角の順番で締める" }) +
          field("", b + ".points." + j + ".reason", { ph: "理由（例：片締めを防ぐため）" }) +
          '<button type="button" class="btn small danger" data-act="point-del" data-i="' + i + '" data-j="' + j + '" title="この急所を消す">✕</button></div>';
      });
      h += '<button type="button" class="btn small" data-act="point-add" data-i="' + i + '">＋ 急所を追加</button></div>' +
        '<div class="ez-kinds">' + ["safety", "quality"].map(function (k) {
          return '<label class="set-check"><input type="checkbox" data-kinds="' + i + '" value="' + k + '"' + ((s.kinds || []).indexOf(k) !== -1 ? " checked" : "") + '> ' + WI.kindBadge(k) + '</label>';
        }).join("") + '</div>' +
        '<div class="ez-media"><b>この手順の見せ方</b>' +
          '<div class="ez-choice" role="radiogroup">' +
            [["video", "🎬", "動画", "動きが大事な作業"], ["photo", "🖼", "写真", "場所・向き・見た目が大事"], ["none", "📝", "文字だけ", "見なくても分かる"]].map(function (c) {
              return '<button type="button" role="radio" aria-checked="' + (md === c[0]) + '" class="' + (md === c[0] ? "on" : "") + '" data-act="ez-media" data-i="' + i + '" data-v="' + c[0] + '">' +
                '<span class="ic">' + c[1] + '</span><b>' + c[2] + '</b><small>' + c[3] + '</small></button>';
            }).join("") +
          '</div>' +
          (md === "video" ? '<p class="hint">動画は、全部の手順を入れた後に「③ 仕上げ」の「🎬 動画を手順に分ける」で、1 本の動画からまとめて付けるのがかんたんです。</p>' +
            (s.video.src ? '<p class="ez-ok">✓ 動画：' + esc(s.video.src.split("/").pop()) + (s.video.start || s.video.end ? "（" + esc(s.video.start || "0:00") + "〜" + esc(s.video.end || "最後") + "）" : "") + '</p>' : '') : '') +
          (md === "photo" ? '<div class="ez-photo">' +
            (s.image ? '<img class="thumb" src="' + esc(objectUrls[s.image] || s.image) + '" alt="" onerror="this.style.display=\'none\'">' : '') +
            '<div><button type="button" class="btn primary" data-act="pick-image" data-path="' + b + '.image">' + (s.image ? "写真を変える" : "写真を選ぶ") + '</button>' +
            (s.image ? ' <button type="button" class="btn" data-act="annotate" data-i="' + i + '">✎ 丸・矢印を書き込む</button>' : '') +
            '<p class="hint">画面のコピー（Win＋Shift＋S）は、ここで Ctrl＋V でも貼り付けられます。</p></div></div>' : '') +
        '</div>' +
      '</section>';
    } else {
      var vs = WI.videoStats(m);
      h += '<section class="ez-page"><h2>③ 仕上げ</h2>' +
        '<ol class="ez-sum">' + m.steps.map(function (s, k) {
          var md2 = mediaOf(s);
          var st = md2 === "video" ? (s.video.src ? '<span class="ok">🎬 動画あり</span>' : '<span class="warn-text">🎬 動画がまだ</span>') :
            md2 === "photo" ? '<span class="ok">🖼 写真</span>' : '<span>📝 文字だけ</span>';
          return '<li><button type="button" class="linkish" data-act="ez-go" data-i="' + (k + 1) + '">' + esc(s.title || "（手順の名前がまだ）") + '</button>' + st + '</li>';
        }).join("") + '</ol>' +
        (vs.all > vs.done ? '<div class="cut-banner"><div><b>動画がまだの手順が ' + (vs.all - vs.done) + ' つあります。</b><span class="hint">作業を最初から最後まで 1 本で撮った動画から、見ながら区切るだけで付けられます。</span></div>' +
          '<button type="button" class="btn primary" data-act="cut">🎬 動画を手順に分ける</button></div>' : '<p class="ez-ok">✓ 動画が必要な手順には、すべて動画が付いています。</p>') +
        '<p>下の「<b>プレビュー</b>」で作業者の画面を確認して、「<b>フォルダに保存</b>」を押してください。</p>' +
      '</section>';
    }
    // 前へ・次へ
    h += '<div class="ez-nav">' +
      (ep > 0 ? '<button type="button" class="btn big" data-act="ez-go" data-i="' + (ep - 1) + '">◀ 前へ</button>' : '<span></span>') +
      (ep >= 1 && ep <= N ? '<button type="button" class="btn big" data-act="ez-add" data-i="' + ep + '">＋ この後に手順を追加</button>' : '<span></span>') +
      (ep <= N ? '<button type="button" class="btn primary big" data-act="ez-go" data-i="' + (ep + 1) + '">' + (ep === N ? "仕上げへ ▶" : ep === 0 ? "手順の入力へ ▶" : "次の手順へ ▶") + '</button>' : '<span></span>') +
    '</div>';
    formEl.innerHTML = h;
    if (transBtn) transLabel();
  }

  function render() {
    if (editMode === "easy") { renderEasy(); return; }
    var y = window.scrollY;
    var h = "";
    var T = WI.terms(m, window.CATALOG);

    h += '<div id="msgArea"></div>' + modeSwitch();

    h += '<section class="section"><h2>文書情報</h2><div class="form-grid">' +
      field(esc(T.title) + "＊", "title", { wide: true, ph: "例：ボルト締付け作業" }) +
      field(esc(T.docNo), "docNo", { ph: "例：WI-A-001" }) +
      field("改訂番号", "revision") +
      field(esc(catConf.labels.line), "line", { list: "line", ph: "例：Aライン", hint: CAT_HINT }) +
      field(esc(catConf.labels.product), "product", { list: "product", ph: "例：BR-1024 ブラケット", hint: CAT_HINT }) +
      field(esc(catConf.labels.process), "process", { list: "process", ph: "例：第2組立工程", hint: CAT_HINT }) +
      field(esc(catConf.labels.category), "category", { list: "category", ph: "例：組立／検査／点検" }) +
      field("制定日", "issued", { type: "date" }) +
      field("改訂日", "updated", { type: "date" }) +
      stampField("作成", "author") +
      stampField("確認", "checker") +
      stampField("点検", "inspector") +
      stampField("承認", "approver") +
      field("目的", "purpose", { type: "textarea", wide: true }) +
    '</div></section>';

    h += '<section class="section"><h2>作業前の準備</h2><div class="form-grid lists">' +
      field("安全上の注意", "cautions", { type: "lines", hint: "1 行に 1 項目" }) +
      field("保護具", "ppe", { type: "lines", hint: "1 行に 1 項目" }) +
      field("使用する設備・治工具", "tools", { type: "pairs", ph: "トルクレンチ | 1本", hint: "1 行に 1 項目。数量は「|」の後ろに" }) +
      field("使用部品・材料", "materials", { type: "pairs", ph: "ボルト M8 | 4本", hint: "1 行に 1 項目。数量は「|」の後ろに" }) +
    '</div></section>';

    var revCh = WI.revChanges(m);
    h += '<section class="section"><h2>作業手順</h2>' +
      '<div class="cut-banner"><div><b>動画は 1 本で撮るのがかんたんです。</b>' +
      '<span class="hint">作業を最初から最後まで続けて撮り、見ながら手順の切れ目で「区切る」を押すだけで、全部の手順に動画が付きます。</span></div>' +
      '<button type="button" class="btn primary" data-act="cut">🎬 動画を手順に分ける</button></div>';
    m.steps.forEach(function (s, i) {
      var b = "steps." + i;
      h += '<div class="edit-card" id="ed-step-' + i + '"><header>' +
        '<span class="ttl">手順 ' + (i + 1) + (revCh.steps[i] ? '<span class="rev-badge" title="前の版から変わった手順（作業者の画面に印が付きます）">改訂</span>' : '') + '</span>' +
        '<button type="button" class="btn on-navy small" data-act="step-up" data-i="' + i + '"' + (i === 0 ? " disabled" : "") + '>↑ 上へ</button>' +
        '<button type="button" class="btn on-navy small" data-act="step-down" data-i="' + i + '"' + (i === m.steps.length - 1 ? " disabled" : "") + '>↓ 下へ</button>' +
        '<button type="button" class="btn on-navy small" data-act="step-ins" data-i="' + i + '">＋ 下に追加</button>' +
        '<button type="button" class="btn on-navy small" data-act="step-dup" data-i="' + i + '">複製</button>' +
        '<button type="button" class="btn on-navy small" data-act="step-del" data-i="' + i + '">削除</button>' +
      '</header><div class="body"><div class="form-grid">' +
        field(esc(T.step), b + ".title", { wide: true, ph: "例：ボルトを仮締めする" }) +
        '<div class="field wide"><span>印</span><div style="display:flex;gap:16px;flex-wrap:wrap">' +
          ["safety", "quality", "ease"].map(function (k) {
            return '<label class="set-check"><input type="checkbox" data-kinds="' + i + '" value="' + k + '"' +
              ((s.kinds || []).indexOf(k) !== -1 ? " checked" : "") + '> ' + WI.kindBadge(k) + '</label>';
          }).join("") + '</div></div>' +
        field("詳しい説明", b + ".detail", { type: "textarea", wide: true }) +
        field("標準時間（秒）", b + ".time", { type: "number" }) +
        '<div class="field"><span>写真・図（任意）</span><div style="display:flex;gap:4px">' +
          '<input type="text" data-path="' + b + '.image" value="' + esc(s.image) + '" placeholder="images/xxx.jpg" style="flex:1;min-width:0">' +
          '<button type="button" class="btn small" data-act="pick-image" data-path="' + b + '.image">選ぶ</button></div>' +
          (s.image ? '<img class="thumb" src="' + esc(objectUrls[s.image] || s.image) + '" alt="" onerror="this.style.display=\'none\'">' +
            '<button type="button" class="btn small primary" data-act="annotate" data-i="' + i + '" style="align-self:flex-start;margin-top:4px">✎ 書き込み（丸・矢印・番号）</button>' : '') +
          '<span class="hint">画面のコピー（Win＋Shift＋S）をこの手順で Ctrl＋V でも貼り付けられます</span>' +
          checkBox(s.image) + '</div>' +
        '<div class="field wide"><span>この手順の動画</span>' +
          '<label class="set-check novideo"><input type="checkbox" data-novideo="' + i + '"' + (s.noVideo ? " checked" : "") + '> この手順は動画を使わない（写真や文字の方が分かりやすい）</label>' +
          (s.noVideo ? '<span class="hint">作業者の画面では、写真（無ければ文字）を大きく表示します。「動画がまだ」には数えません。</span>' : videoFields(b + ".video")) + '</div>' +
      '</div>' +
      '<div class="sub-list"><b>' + esc(T.point) + '</b>';
      s.points.forEach(function (p, j) {
        var pb = b + ".points." + j;
        h += '<div class="sub-row">' +
          '<label class="field"><span>種類</span><select data-path="' + pb + '.kind">' +
            opt("", "（なし）", p.kind) + opt("safety", "安全", p.kind) + opt("quality", "品質", p.kind) + opt("ease", "やりやすさ", p.kind) +
          '</select></label>' +
          field(esc(T.point.replace(/[（(].*$/, "")), pb + ".text", { ph: "例：対角の順番で締める" }) +
          field(esc(T.reason), pb + ".reason", { ph: "例：片締めを防ぐため" }) +
          '<button type="button" class="btn small danger" data-act="point-del" data-i="' + i + '" data-j="' + j + '" style="margin-top:22px">削除</button>' +
          '<details class="field wide" style="grid-column:1/-1"' + (p.video.src ? " open" : "") + '><summary class="hint">この急所だけの動画（任意）</summary>' +
            videoFields(pb + ".video", "動画ファイル") + '</details>' +
        '</div>';
      });
      h += '<button type="button" class="btn small" data-act="point-add" data-i="' + i + '">＋ 急所を追加</button></div>';
      h += '</div></div>';
    });
    h += '</section>';

    var D = WI.terms(null, window.CATALOG);
    h += '<details class="section"' + (Object.keys(m.terms || {}).some(function (k) { return m.terms[k]; }) ? " open" : "") + '><summary class="hint" style="cursor:pointer">' +
      '見出しの名前（社内フォーマットに合わせる。空欄なら「' + esc(D.step) + '」などの標準の名前）</summary><div class="form-grid" style="margin-top:8px">' +
      WI.TERM_KEYS.map(function (k) {
        return field(esc(WI.DEFAULT_TERMS[k]) + " の表示名", "terms." + k, { ph: D[k] });
      }).join("") + '</div></details>';

    h += '<section class="section"><h2>改訂履歴</h2>';
    m.revisions.forEach(function (r, i) {
      var b = "revisions." + i;
      h += '<div class="sub-row rev-row">' +
        field("改訂", b + ".rev") + field("日付", b + ".date", { type: "date" }) +
        field("内容", b + ".content") + field("担当", b + ".by") +
        '<button type="button" class="btn small danger" data-act="rev-del" data-i="' + i + '" style="margin-top:22px">削除</button></div>';
    });
    h += '<button type="button" class="btn small" data-act="rev-add">＋ 改訂する（改訂番号を上げ、改訂日を今日に）</button></section>';

    // 既存の要領書を開いているときだけ
    if (fileName && WIFolder.supported) {
      h += '<section class="section"><h2>この要領書の削除</h2>' +
        '<p class="hint" style="margin-top:0">一覧から外し、ファイルは manuals/_trash フォルダに移します（動画・写真は残ります）。</p>' +
        '<button type="button" class="btn small danger" data-act="delete-doc">この要領書を削除する</button></section>';
    }

    formEl.innerHTML = h;
    if (transBtn) transLabel();
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
    for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]] || (o[ks[i]] = {});
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
    if (el.hasAttribute("data-kinds")) {
      var si = +el.getAttribute("data-kinds");
      m.steps[si].kinds = Array.prototype.filter.call(formEl.querySelectorAll('[data-kinds="' + si + '"]'), function (x) { return x.checked; })
        .map(function (x) { return x.value; });
      saveDraft();
      return;
    }
    if (el.hasAttribute("data-novideo")) {
      var st = m.steps[+el.getAttribute("data-novideo")];
      if (el.checked) st.noVideo = true; else delete st.noVideo;
      saveDraft();
      render();
      return;
    }
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
      case "step-up": swap(st, i, i - 1); if (editMode === "easy" && i > 0) ep = i; break;
      case "step-down": swap(st, i, i + 1); if (editMode === "easy" && i < st.length - 1) ep = i + 2; break;
      case "step-ins": insertStep(i + 1); return;
      case "step-dup": st.splice(i + 1, 0, JSON.parse(JSON.stringify(st[i]))); break;
      case "step-del":
        if (!confirm("手順 " + (i + 1) + " を削除しますか？")) return;
        st.splice(i, 1);
        if (!st.length) st.push(blankStep());
        if (editMode === "easy") ep = Math.min(ep, st.length);
        break;
      case "point-add": st[i].points.push(blankPoint()); break;
      case "point-del": st[i].points.splice(j, 1); break;
      case "rev-add":
        // 改訂番号を 1 つ上げ、改訂日を今日にして、改訂履歴に行を追加
        var cur = /^\d+$/.test(String(m.revision)) ? Number(m.revision) : 0;
        m.revisions.forEach(function (r) { if (/^\d+$/.test(String(r.rev))) cur = Math.max(cur, Number(r.rev)); });
        var today = isoToday();
        // 改訂する前の文を覚えておく（作業者の画面で、変わったところに印を付けるため）
        m.prevRev = WI.revSnapshot(m);
        // 承認し直す場合は判子を外す
        if ((m.stamps && Object.keys(m.stamps).length) || m.approver || m.inspector || m.checker) {
          if (confirm("改訂したので、承認・点検・確認の判子（名前）を外しますか？\n（改訂後に承認し直す場合は「OK」。そのまま残す場合は「キャンセル」）")) {
            ["approver", "inspector", "checker"].forEach(function (k) { m[k] = ""; if (m.stamps) delete m.stamps[k]; });
            if (m.stamps && !Object.keys(m.stamps).length) delete m.stamps;
          }
        }
        m.revision = String(cur + 1);
        m.updated = today;
        m.revisions.push({ rev: m.revision, date: today, content: "", by: m.author || "" });
        render();
        saveDraft();
        var inp = formEl.querySelector('[data-path="revisions.' + (m.revisions.length - 1) + '.content"]');
        if (inp) { inp.focus(); inp.placeholder = "改訂の内容を入力（例：手順3の急所を追加）"; }
        return;
      case "rev-del": m.revisions.splice(i, 1); break;
      case "stamp-del":
        delete m.stamps[path];
        if (!Object.keys(m.stamps).length) delete m.stamps;
        break;
      case "pick-video": pick("video", path); return;
      case "pick-image": pick("image", path); return;
      case "seg": openSeg(path); return;
      case "annotate": annotate(i); return;
      case "cut": openCutter(); return;
      case "mode":
        editMode = b.getAttribute("data-v");
        try { localStorage.setItem("wi.editMode", editMode); } catch (e) {}
        render();
        window.scrollTo(0, 0);
        return;
      case "ez-go":
        ep = Math.max(0, Math.min(m.steps.length + 1, i));
        // 最後の手順の「次へ」で、手順の名前が入っていれば新しい手順を足さずに仕上げへ
        render();
        window.scrollTo(0, 0);
        var first = formEl.querySelector(".ez-page input, .ez-page textarea");
        if (first && !first.value) first.focus();
        return;
      case "ez-add":
        var at = i; // ep（1 始まり）の後ろ = 配列の at 番目
        var ns = blankStep();
        var pv = m.steps[at - 1];
        if (pv && pv.video.src) { ns.video.src = pv.video.src; ns.video.start = pv.video.end || ""; }
        m.steps.splice(at, 0, ns);
        ep = at + 1;
        saveDraft();
        render();
        window.scrollTo(0, 0);
        var ti = formEl.querySelector('[data-path="steps.' + at + '.title"]');
        if (ti) ti.focus();
        return;
      case "ez-media":
        var sm = m.steps[i], v = b.getAttribute("data-v");
        if (v === "video") delete sm.noVideo; else sm.noVideo = true;
        ezWantPhoto[i] = v === "photo";
        if (v === "none" && sm.image) {
          if (!confirm("この手順の写真を外して、文字だけにしますか？")) return;
          sm.image = "";
          delete sm.marks;
        }
        if (v === "photo" && !sm.image) { saveDraft(); render(); pick("image", "steps." + i + ".image"); return; }
        break;
      case "delete-doc": deleteDoc(); return;
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
    picker.accept = kind === "video" ? "video/*,.mp4,.m4v,.mov,.webm" : "image/*,.heic,.heif";
    picker.click();
  }
  picker.addEventListener("change", function () {
    var f = picker.files && picker.files[0];
    if (!f || !pickTarget) return;
    if (pickKind === "video") setVideo(pickTarget, f); else setImage(pickTarget, f);
  });

  // base: "steps.0.video" など
  function setVideo(base, f) {
    var src = "videos/" + f.name;
    if (objectUrls[src]) URL.revokeObjectURL(objectUrls[src]);
    objectUrls[src] = URL.createObjectURL(f);
    addPicked(src, f);
    setInput(base + ".src", src);
    // この PC で再生できるか・重すぎないかを確認して、結果を動画欄の下に出す
    mediaChecks[src] = { level: "checking" };
    render();
    VideoCheck.checkVideo(f).then(function (c) {
      if (pickedFiles[src] !== f) return; // 確認中に別のファイルを選び直した
      mediaChecks[src] = c;
      render();
    });
  }


  // path: "steps.0.image"。name を指定しない場合は元のファイル名
  function setImage(path, f, name) {
    // 大きな写真（スマホの写真など）は、力の弱い PC でも速く出るように縮めてから使う
    WI.shrinkImage(f).then(function (b) {
      setImageNow(path, b === f ? f : new File([b], name || f.name, { type: b.type }), name);
    });
  }
  function setImageNow(path, f, name) {
    var src = "images/" + (name || f.name);
    if (objectUrls[src]) URL.revokeObjectURL(objectUrls[src]);
    objectUrls[src] = URL.createObjectURL(f);
    addPicked(src, f);
    setInput(path, src);
    var ic = VideoCheck.checkImage(f);
    if (ic) mediaChecks[src] = ic; else delete mediaChecks[src];
    render();
  }

  // ---------- 写真への書き込み ----------
  // 元の写真は残し、書き込んだものを「元の名前_mark.png」として保存。書き込みの内容も残すので後から直せる
  function annotate(i) {
    var s = m.steps[i];
    var base = (s.marks && s.marks.base) || s.image;
    if (!base) return;
    imageUrl(base).then(function (url) {
      WIAnnotate.open({
        url: url,
        shapes: s.marks && s.marks.base === base ? s.marks.shapes : [],
        onDone: function (blob, shapes) {
          var name = base.split("/").pop().replace(/\.[^.]+$/, "") + "_mark.png";
          var src = "images/" + name;
          if (objectUrls[src]) URL.revokeObjectURL(objectUrls[src]);
          objectUrls[src] = URL.createObjectURL(blob);
          addPicked(src, new File([blob], name, { type: "image/png" }));
          s.marks = { base: base, shapes: shapes };
          if (!shapes.length) { delete s.marks; setInput("steps." + i + ".image", base); }
          else setInput("steps." + i + ".image", src);
          render();
        }
      });
    }, function (e) {
      notice(esc(e.message), true);
      window.scrollTo(0, 0);
    });
  }

  // 書き込み用に写真を読む。保存済みの写真は、ファイルを直接開いた画面では書き込めない（ブラウザの制限）ため、フォルダから読み込む
  function imageUrl(src) {
    if (objectUrls[src]) return Promise.resolve(objectUrls[src]);
    if (location.protocol !== "file:") return Promise.resolve(src);
    if (!WIFolder.supported) return Promise.reject(new Error("写真を「選ぶ」から選び直してから、書き込んでください。"));
    return WIFolder.getRoot().then(function (root) {
      var parts = src.split("/");
      return root.getDirectoryHandle(parts[0]).then(function (d) { return d.getFileHandle(parts[1]); });
    }).then(function (fh) { return fh.getFile(); }).then(function (f) {
      pickedFiles[src] = f; // 読み込んだだけなので書き出しはしない
      objectUrls[src] = URL.createObjectURL(f);
      return objectUrls[src];
    }, function (e) {
      if (e && e.name === "AbortError") throw new Error("フォルダが選ばれませんでした。");
      throw new Error("写真「" + src + "」がフォルダに見つかりません。「選ぶ」から選び直してください。");
    });
  }

  // 手順のカードに動画・写真ファイルをドラッグ＆ドロップ
  formEl.addEventListener("dragover", function (ev) {
    if (ev.target.closest && ev.target.closest(".edit-card")) ev.preventDefault();
  });
  formEl.addEventListener("drop", function (ev) {
    var card = ev.target.closest && ev.target.closest(".edit-card");
    var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (!card || !f) return;
    ev.preventDefault();
    var i = card.id.replace("ed-step-", "");
    if (/^video\/|\.(mp4|m4v|mov|webm)$/i.test(f.type + " " + f.name)) setVideo("steps." + i + ".video", f);
    else if (/^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name)) setImage("steps." + i + ".image", f);
  });

  // 画面のコピー（Win＋Shift＋S など）を Ctrl＋V で、いま入力している手順の写真にする
  var lastStep = -1;
  formEl.addEventListener("focusin", function (ev) {
    var card = ev.target.closest(".edit-card");
    if (card) lastStep = parseInt(card.id.replace("ed-step-", ""), 10);
  });
  document.addEventListener("paste", function (ev) {
    var items = (ev.clipboardData && ev.clipboardData.items) || [];
    var f = null;
    for (var k = 0; k < items.length; k++) {
      if (items[k].kind === "file" && /^image\//.test(items[k].type)) { f = items[k].getAsFile(); break; }
    }
    if (!f) return; // 文字の貼り付けは通常どおり
    ev.preventDefault();
    if (lastStep < 0 || !m.steps[lastStep]) {
      notice("貼り付ける手順の欄を一度クリックしてから、Ctrl＋V を押してください。", true);
      window.scrollTo(0, 0);
      return;
    }
    var t = new Date();
    var base = (m.docNo || "img").replace(/[^\w\-]+/g, "_");
    var name = base + "_" + (lastStep + 1) + "_" + pad(t.getHours()) + pad(t.getMinutes()) + pad(t.getSeconds()) + ".png";
    setImage("steps." + lastStep + ".image", f, name);
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
    var t = WI.formatTime(segVideo.currentTime);
    setInput(segBase + ".end", t);
    // 次の手順が同じ動画（または動画未設定）で開始が空なら、続きから始まるように入れておく
    var mt = /^steps\.(\d+)\.video$/.exec(segBase);
    var next = mt && m.steps[+mt[1] + 1];
    if (next) {
      var src = getPath(segBase + ".src");
      if (!next.video.src) setInput("steps." + (+mt[1] + 1) + ".video.src", src);
      if (next.video.src === src && next.video.start === "") setInput("steps." + (+mt[1] + 1) + ".video.start", t);
    }
    updateSegInfo();
  });
  document.getElementById("segPlay").addEventListener("click", function () {
    segVideo.currentTime = WI.parseTime(getPath(segBase + ".start")) || 0;
    segStopAt = WI.parseTime(getPath(segBase + ".end"));
    segVideo.play();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && seg.classList.contains("open")) closeSeg();
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === "s" || ev.key === "S")) {
      ev.preventDefault();
      var b = document.getElementById("saveDir");
      (b.hidden ? document.getElementById("save") : b).click();
    }
  });

  // ---------- 書き出し ----------
  // 空の項目を取り除いた保存用データ
  function cleaned() {
    var d = JSON.parse(JSON.stringify(m));
    if (!d.id) d.id = d.docNo || ("WI-" + Date.now());
    d.steps.forEach(function (s) {
      s.points = s.points.filter(function (p) { return p.text || p.reason; });
    });
    Object.keys(d.terms || {}).forEach(function (k) { if (!d.terms[k]) delete d.terms[k]; });
    if (d.terms && !Object.keys(d.terms).length) delete d.terms;
    // 何も入力していない手順は保存しない
    d.steps = d.steps.filter(function (s) { return s.title || s.detail || s.points.length || s.video.src || s.image; });
    WITrans.prune(d); // 今の文に対応しない古い訳は保存しない
    return d;
  }

  function toFileText(d) { return WIFolder.manualText(d); }

  // 動画がまだ付いていない手順（保存はできるが、知らせておく）
  function missingVideoNote(d) {
    var no = [];
    d.steps.forEach(function (s, i) { if (!s.noVideo && !(s.video && s.video.src)) no.push(i + 1); });
    if (!no.length) return "";
    return '<br><span class="warn-text">動画がまだの手順：' + (no.length === d.steps.length ? "すべて" : no.join("、")) + '</span>' +
      '<small>（手順の「選ぶ」から動画を付けられます。動画より写真や文字の方が分かりやすい手順は「この手順は動画を使わない」にチェックしてください）</small>';
  }

  // 文書番号からファイル名を作る。無い場合は日時を付けて、他の要領書を上書きしないようにする
  function suggestName() {
    if (fileName) return fileName;
    var base = (m.docNo || "").normalize("NFKC").replace(/[^\w\-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "");
    // 数字の無い番号（社内フォーマットの「GK-」のような書きかけ）では、他の要領書と同じ名前になるので使わない
    if (!/\d/.test(base)) base = "";
    if (!base) {
      var t = new Date();
      base = "manual-" + t.getFullYear() + pad(t.getMonth() + 1) + pad(t.getDate()) + "-" + pad(t.getHours()) + pad(t.getMinutes()) + pad(t.getSeconds());
    }
    return base + ".js";
  }

  // 保存前の確認。問題があればメッセージを出して false
  function check() {
    if (!m.title) { notice("作業名（タイトル）を入力してください。", true); window.scrollTo(0, 0); return false; }
    var bad = [];
    function seg(v, label) {
      if (!v || !v.src) return;
      var a = WI.parseTime(v.start), b = WI.parseTime(v.end);
      var blank = function (x) { return x == null || x === ""; };
      if ((!blank(v.start) && a == null) || (!blank(v.end) && b == null)) bad.push(label + "：時間の書き方が正しくありません（例 1:23）");
      else if (b != null && b <= (a || 0)) bad.push(label + "：終了が開始より前になっています");
    }
    m.steps.forEach(function (s, i) {
      seg(s.video, "手順 " + (i + 1) + " の動画");
      s.points.forEach(function (p, j) { seg(p.video, "手順 " + (i + 1) + " の急所 " + (j + 1) + " の動画"); });
    });
    if (bad.length) { notice(bad.map(esc).join("<br>"), true); window.scrollTo(0, 0); return false; }
    return true;
  }

  function markSaved(name) {
    fileName = name;
    dirty = false;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ data: m, file: fileName, dirty: false, base: baseText })); } catch (e) {}
    draftState.textContent = "保存済み";
  }

  document.getElementById("save").addEventListener("click", function () {
    if (!check()) return;
    var name = suggestName();
    var blob = new Blob([toFileText(cleaned())], { type: "text/javascript;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    // Excel から取り込んだ写真も一緒にダウンロード（images フォルダに入れてもらう）
    var imgs = Object.keys(pickedFiles).filter(function (k) { return /^images\//.test(k) && JSON.stringify(m).indexOf('"' + k + '"') !== -1; });
    imgs.forEach(function (k, i) {
      setTimeout(function () {
        var x = document.createElement("a");
        x.href = URL.createObjectURL(pickedFiles[k]);
        x.download = k.split("/").pop();
        document.body.appendChild(x);
        x.click();
        setTimeout(function () { URL.revokeObjectURL(x.href); x.remove(); }, 1000);
      }, 300 * (i + 1));
    });
    markSaved(name);
    notice("<b>「" + esc(name) + "」を書き出しました。</b><br>" +
      "① ダウンロードしたファイルを <b>manuals</b> フォルダに入れる（同じ名前があれば上書き）<br>" +
      "② 新しい要領書の場合は <b>manuals/catalog.js</b> の files に <code>\"" + esc(name) + "\"</code> を追加<br>" +
      "③ 使った動画は <b>videos</b> フォルダ、写真は <b>images</b> フォルダに入れる");
    window.scrollTo(0, 0);
  });

  // ---------- フォルダに直接保存（Chrome / Edge。ネット接続不要） ----------
  // テンプレートのフォルダを選ぶと、要領書ファイルの保存・目録への追加・動画/写真のコピーを一度に行う
  var saveDirBtn = document.getElementById("saveDir");
  var destEl = document.getElementById("saveDest");
  if (WIFolder.supported) {
    saveDirBtn.hidden = false;
    destEl.hidden = false;
  }
  // 保存先のフォルダ名を表示（どこに保存されるか分かるように）
  function showDest() {
    var n = WIFolder.currentName();
    destEl.querySelector("span").textContent = n ? "保存先：" + n : "保存先：（保存するときに選びます）";
  }
  showDest();
  destEl.querySelector("button").addEventListener("click", function () {
    WIFolder.forget().then(function () {
      showDest();
      notice("保存先を選び直します。「フォルダに保存」を押して、index.html があるフォルダを選んでください。");
      window.scrollTo(0, 0);
    });
  });

  function deleteDoc() {
    if (!confirm("「" + (m.title || fileName) + "」を削除しますか？\n一覧から外し、ファイルは manuals/_trash フォルダに移します。")) return;
    var name = fileName, root;
    WIFolder.getRoot().then(function (r) {
      root = r;
      return root.getDirectoryHandle("manuals");
    }).then(function (md) {
      return WIFolder.backup(md, name, "_trash").then(function () {
        return WIFolder.updateCatalog(root, function (c) {
          var i = c.files.indexOf(name);
          if (i === -1) return false;
          c.files.splice(i, 1);
        });
      }).then(function () {
        return md.removeEntry(name).catch(function () {});
      });
    }).then(function () {
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
      location.href = "list.html";
    }).catch(function (e) {
      if (e && e.name === "AbortError") return;
      notice("削除できませんでした。" + esc(WIFolder.errorMessage(e)), true);
    });
  }

  // 選んだ動画・写真のうち、まだフォルダに無いものをコピー
  function copyMedia(root, d) {
    var srcs = [];
    d.steps.forEach(function (s) {
      srcs.push(s.image, s.marks && s.marks.base, s.video && s.video.src);
      s.points.forEach(function (p) { srcs.push(p.video && p.video.src); });
    });
    Object.keys(d.stamps || {}).forEach(function (k) { srcs.push(d.stamps[k]); });
    // この画面で選んだ・書き込んだもので、まだ書き出していないものだけ（同じ名前のファイルは上書き）
    var todo = srcs.filter(function (x, i) { return x && freshFiles[x] && pickedFiles[x] && srcs.indexOf(x) === i; });
    var copied = [];
    return todo.reduce(function (pr, src) {
      return pr.then(function () {
        var parts = src.split("/");
        return root.getDirectoryHandle(parts[0], { create: true }).then(function (dir) {
          notice("動画・写真をコピー中… " + esc(src));
          return WIFolder.writeFile(dir, parts[1], pickedFiles[src]).then(function () {
            copied.push(src);
            delete freshFiles[src];
          });
        });
      });
    }, Promise.resolve()).then(function () { return copied; });
  }

  function uniqueName(md, name, n) {
    var cand = n ? name.replace(/\.js$/, "") + "_" + n + ".js" : name;
    return md.getFileHandle(cand).then(function () { return uniqueName(md, name, (n || 1) + 1); }, function () { return cand; });
  }

  saveDirBtn.addEventListener("click", function () {
    if (!check()) return;
    var name = suggestName();
    var d = cleaned();
    var root, added = false, copied = [];
    saveDirBtn.disabled = true;
    WIFolder.getRoot().then(function (r) {
      root = r;
      return root.getDirectoryHandle("manuals");
    }).then(function (md) {
      // 新しい要領書なのに同じ名前のファイルがある場合は、上書きせずに「_2」などを付ける
      return (fileName ? Promise.resolve(name) : uniqueName(md, name)).then(function (n) { name = n; return md; });
    }).then(function (md) {
      // 開いた後で、別の PC（別の人）がこの要領書を保存していないか
      var check = fileName && baseText ? WIFolder.readText(md, name).then(function (t) {
        var now = "";
        try { now = canon(WIFolder.parseManual(t)); } catch (e) { return; }
        if (now === baseText) return;
        if (!confirm("この要領書は、あなたが開いた後に、別の PC（または別の画面）で保存されています。\n\n" +
          "このまま保存すると、その内容はあなたの内容で上書きされます（上書きされる内容はバックアップ manuals/_backup に残ります）。\n\n" +
          "上書きして保存しますか？\n（「キャンセル」を押すと保存しません。一覧から開き直して、相手の内容を確かめてください）")) {
          var err = new Error("conflict");
          err.name = "ConflictAbort";
          throw err;
        }
      }, function () {}) : Promise.resolve();
      return check.then(function () { return WIFolder.backup(md, name, "_backup"); }).then(function () {
        return WIFolder.writeFile(md, name, toFileText(d));
      }).then(function () { baseText = canon(d); });
    }).then(function () {
      // 新しい要領書なら一覧（目録）に追加
      return WIFolder.updateCatalog(root, function (c) {
        if (c.files.indexOf(name) !== -1) return false;
        c.files.push(name);
        added = true;
      });
    }).then(function () {
      return copyMedia(root, d);
    }).then(function (c) {
      copied = c;
      markSaved(name);
      showDest();
      notice("<b>保存しました：manuals/" + esc(name) + "</b>" + missingVideoNote(d) +
        (added ? "<br>一覧（目録）に追加しました。" : "") +
        (copied.length ? "<br>コピーした動画・写真：" + copied.map(esc).join("、") : "") +
        '<br><a href="list.html">一覧で確認する</a>');
      window.scrollTo(0, 0);
    }).catch(function (e) {
      if (e && e.name === "AbortError") return; // フォルダ選択をキャンセル
      if (e && e.name === "ConflictAbort") {
        notice("<b>保存をやめました。</b>別の PC で保存された内容があります。入力中の内容はこの PC に残っているので、相手の内容を確かめてから、もう一度保存してください。", true);
        return;
      }
      notice("<b>保存できませんでした。</b>" + esc(WIFolder.errorMessage(e)) +
        "<br><small>うまくいかない場合は「ファイルに書き出す」で保存し、manuals フォルダに入れてください。</small>", true);
      window.scrollTo(0, 0);
    }).then(function () {
      saveDirBtn.disabled = false;
    });
  });

  document.getElementById("preview").addEventListener("click", function () {
    try {
      localStorage.setItem("wi.preview", JSON.stringify(cleaned()));
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ data: m, file: fileName, dirty: dirty, base: baseText }));
    } catch (e) {
      notice("プレビューを作成できませんでした（ブラウザの保存領域が使えません）。", true);
      return;
    }
    location.href = "manual.html?preview=1";
  });

  // 手順を at 番目に追加。1 本の動画を続けて使う場合が多いので、前の手順の動画の「終了」を新しい手順の「開始」にする
  function insertStep(at) {
    var s = blankStep();
    var prev = m.steps[at - 1];
    if (prev && prev.video.src) {
      s.video.src = prev.video.src;
      s.video.start = prev.video.end || "";
    }
    m.steps.splice(at, 0, s);
    if (editMode === "easy") ep = at + 1;
    render();
    saveDraft();
    var el = document.getElementById("ed-step-" + at);
    if (el) {
      el.scrollIntoView();
      var t = el.querySelector('[data-path$=".title"]');
      if (t) t.focus();
    }
  }
  document.getElementById("addStep").addEventListener("click", function () { insertStep(m.steps.length); });
  document.getElementById("cutVideo").addEventListener("click", openCutter);

  // ---------- インドネシア語 ----------
  var transBtn = document.getElementById("transBtn");
  function transLabel() {
    var s = WITrans.stats(m);
    transBtn.textContent = "🌐 インドネシア語" + (s.ok + s.mt + s.stale ? "（確認 " + s.ok + "/" + s.all + "）" : "");
  }
  transBtn.addEventListener("click", function () {
    WITrans.open({ manual: m, onChange: saveDraft, onClose: transLabel });
  });

  // ---------- 動画を手順に分ける ----------
  var cutPicker = document.createElement("input");
  cutPicker.type = "file";
  cutPicker.accept = "video/*,.mp4,.m4v,.mov,.webm";
  cutPicker.id = "cutFile";
  cutPicker.hidden = true;
  document.body.appendChild(cutPicker);
  var cutPicked = null;
  cutPicker.addEventListener("change", function () {
    var f = cutPicker.files && cutPicker.files[0];
    if (!f || !cutPicked) return;
    var src = "videos/" + f.name;
    if (objectUrls[src]) URL.revokeObjectURL(objectUrls[src]);
    objectUrls[src] = URL.createObjectURL(f);
    addPicked(src, f);
    mediaChecks[src] = { level: "checking" };
    VideoCheck.checkVideo(f).then(function (c) { if (pickedFiles[src] === f) { mediaChecks[src] = c; render(); } });
    cutPicked(src);
  });
  function openCutter() {
    var srcs = [], count = {};
    m.steps.forEach(function (s) {
      var v = s.video && s.video.src;
      if (!v) return;
      if (srcs.indexOf(v) === -1) srcs.push(v);
      count[v] = (count[v] || 0) + 1;
    });
    var main = srcs.slice().sort(function (a, b) { return count[b] - count[a]; })[0] || "";
    WICutter.open({
      steps: m.steps, srcs: srcs, src: main,
      url: function (s) { return objectUrls[s] || s; },
      size: function (s) { return pickedFiles[s] ? pickedFiles[s].size : 0; },
      pick: function (cb) { cutPicked = cb; cutPicker.value = ""; cutPicker.click(); },
      apply: function (res, src, thumbs, failed, light) {
        // 軽く作り直した動画（保存のときに videos フォルダへ書き出す。元の動画はコピーしない）
        if (light) {
          if (objectUrls[light.src]) URL.revokeObjectURL(objectUrls[light.src]);
          objectUrls[light.src] = URL.createObjectURL(light.file);
          addPicked(light.src, light.file);
        }
        var stem = src.split("/").pop().replace(/\.[^.]+$/, "").normalize("NFKC").replace(/[^\w\-]+/g, "_") || "video";
        var pics = 0;
        res.forEach(function (v, i) {
          var s = m.steps[i];
          if (v) s.video = v;
          else if (s.video.src === src) s.video = { src: "", start: "", end: "" };
          // 動画の場面から作った写真（写真の無い手順だけ）
          var b = thumbs && thumbs[i];
          if (b && v && !s.image) {
            var name = stem + "_" + Math.round((WI.parseTime(v.start) || 0) * 10) + ".jpg";
            var f = new File([b], name, { type: "image/jpeg" });
            var isrc = "images/" + name;
            if (objectUrls[isrc]) URL.revokeObjectURL(objectUrls[isrc]);
            objectUrls[isrc] = URL.createObjectURL(f);
            addPicked(isrc, f);
            s.image = isrc;
            pics++;
          }
        });
        render();
        saveDraft();
        var n = res.filter(Boolean).length;
        var mb = function (x) { return (x / 1048576).toFixed(1) + " MB"; };
        notice("<b>" + n + " 手順に動画の区間を設定しました。</b>" +
          (light ? "<br>📦 使う区間だけの軽い動画（" + esc(light.src.split("/").pop()) + "）を作りました：" +
            (light.before ? mb(light.before) + " → <b>" + mb(light.after) + "</b>" : "<b>" + mb(light.after) + "</b>") +
            "（" + WI.formatTime(light.seconds) + "）。保存すると videos フォルダに入ります。元の動画は共有フォルダにコピーしません。<br>" : "") +
          (pics ? "写真の無かった " + pics + " 手順に、動画の場面を写真として付けました。" : "") +
          (failed ? "<br><small>動画の場面を写真にできなかった手順があります（" + failed + " 件）。「別の動画を選ぶ」で動画を選び直すと作れます。</small>" : "") +
          "「プレビュー」で確認してから保存してください。");
      }
    });
  }

  // ---------- Excel 取り込み ----------
  document.getElementById("importXl").addEventListener("click", function () {
    WIImport.open(function (res) {
      if (dirty && !confirm("入力中の内容を、取り込んだ内容に置き換えますか？")) return;
      m = normalize(res.data); ep = 0;
      fileName = "";
      // Excel に貼ってあった写真は、フォルダ保存のときに images フォルダへ書き出す
      res.images.forEach(function (im) {
        var f = new File([im.bytes], im.src.split("/").pop(), { type: im.type });
        addPicked(im.src, f);
        objectUrls[im.src] = URL.createObjectURL(f); // エディタの縮小表示用
        // 大きな写真は縮めたものに置き換える（保存するのは縮めたもの）
        WI.shrinkImage(f).then(function (b) {
          if (b !== f && pickedFiles[im.src] === f) pickedFiles[im.src] = new File([b], f.name, { type: b.type });
        });
      });
      history.replaceState(null, "", "editor.html");
      render();
      saveDraft();
      var noVideo = m.steps.filter(function (s) { return !s.noVideo && !s.video.src; }).length;
      notice("<b>Excel から取り込みました（手順 " + m.steps.length + " 件）。</b><br>" +
        "内容を確認し、" + (noVideo ? "動画を「選ぶ」→「区間を設定」で付けてから、" : "") + "保存してください。" +
        (res.images.length ? "<br>Excel の" + (WIImport.photoCount(res) ? "写真 " + WIImport.photoCount(res) + " 枚" : "") +
          (res.data.stamps ? (WIImport.photoCount(res) ? "・" : "") + "判子 " + Object.keys(res.data.stamps).length + " 個" : "") +
          "は、保存すると images フォルダに書き出されます。" : ""));
      window.scrollTo(0, 0);
    });
  });

  // 似た作業の要領書を作るときに、今の内容をひな形にする
  document.getElementById("copyDoc").addEventListener("click", function () {
    if (!confirm("今の内容を元に、新しい要領書を作りますか？\n（文書番号は空になり、改訂履歴は「新規制定」から始まります。元の要領書は変わりません）")) return;
    var today = isoToday();
    m.docNo = "";
    m.id = "";
    m.title = m.title ? m.title + "（コピー）" : "";
    m.revision = "1";
    m.issued = today;
    m.updated = today;
    m.revisions = [{ rev: "1", date: today, content: "新規制定", by: m.author || "" }];
    fileName = "";
    history.replaceState(null, "", "editor.html");
    render();
    saveDraft();
    notice("コピーを作りました。<b>文書番号と作業名を入力</b>してから保存してください（別の要領書として保存されます）。");
    window.scrollTo(0, 0);
    var t = formEl.querySelector('[data-path="docNo"]');
    if (t) t.focus();
  });

  document.getElementById("newDoc").addEventListener("click", function () {
    if (!confirm("入力中の内容を破棄して、新しい要領書を作りますか？")) return;
    m = blankManual(); ep = 0;
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
        baseText = canon(JSON.parse(json));
        m = normalize(JSON.parse(json)); ep = 0;
        render();
        markSaved(f.name);
        notice("「" + esc(f.name) + "」を開きました。");
      } catch (e) {
        notice("このファイルは読み込めません（形式が違います）。", true);
      }
      input.value = "";
    };
    r.readAsText(f, "utf-8");
  });
})();
