/* =========================================================
   インドネシア語への翻訳（日本語で確認してから使う）
   - 翻訳は Chrome の端末内翻訳（Translator API）を使う。最初の 1 回だけ言語データをダウンロードし、
     その後はインターネット無しで動く。使えないブラウザでは、手入力・CSV でのやり取りで翻訳できる
   - 翻訳した文を日本語に戻した文（逆翻訳）を並べて表示し、意味が合っているかを日本語で確認する
   - 用語集（catalog.js の glossary）の言葉は、決めた訳語で必ず訳す
   データ: manual.tr = { id: { "<場所>": { t: 訳文, src: 訳したときの日本語, back: 逆翻訳, ok: 確認済み } } }
   ========================================================= */
(function () {
  "use strict";
  var esc = WI.esc;
  var LANG = "id";
  var LANG_NAME = "インドネシア語";

  // ---------- 翻訳する文の一覧（場所のキー・表示名・日本語） ----------
  function fields(m) {
    var T = WI.terms(m, window.CATALOG);
    var pt = T.point.replace(/[（(].*$/, ""), st = T.step.replace(/[（(].*$/, "");
    var out = [];
    function add(key, group, label, ja) { if (ja && String(ja).trim()) out.push({ key: key, group: group, label: label, ja: String(ja) }); }
    add("title", "文書", T.title, m.title);
    add("purpose", "文書", "目的", m.purpose);
    (m.cautions || []).forEach(function (x, i) { add("cautions." + i, "作業前の準備", "安全上の注意 " + (i + 1), x); });
    (m.ppe || []).forEach(function (x, i) { add("ppe." + i, "作業前の準備", "保護具 " + (i + 1), x); });
    (m.tools || []).forEach(function (x, i) { add("tools." + i, "作業前の準備", "設備・治工具 " + (i + 1), x && x.name); });
    (m.materials || []).forEach(function (x, i) { add("materials." + i, "作業前の準備", "部品・材料 " + (i + 1), x && x.name); });
    (m.steps || []).forEach(function (s, i) {
      var g = "手順 " + (i + 1);
      add("steps." + i + ".title", g, st, s.title);
      add("steps." + i + ".detail", g, "詳しい説明", s.detail);
      add("steps." + i + ".note", g, "補足", s.note);
      (s.points || []).forEach(function (p, j) {
        add("steps." + i + ".points." + j + ".text", g, pt + " " + (j + 1), p.text);
        add("steps." + i + ".points." + j + ".reason", g, T.reason + " " + (j + 1), p.reason);
      });
    });
    return out;
  }

  function store(m) {
    if (!m.tr) m.tr = {};
    if (!m.tr[LANG]) m.tr[LANG] = {};
    return m.tr[LANG];
  }

  // その場所の訳。日本語が変わっていれば使わない（手順の並べ替えで場所が変わった場合は、同じ日本語の訳を探す）
  function lookup(m, key, ja) { return WI.trLookup(m, LANG, key, ja); }
  // 状態: none（未翻訳）／ mt（未確認）／ ok（確認済み）／ stale（日本語が変わった）
  function state(m, f) {
    var e = lookup(m, f.key, f.ja);
    if (e) return e.ok ? "ok" : "mt";
    var old = m.tr && m.tr[LANG] && m.tr[LANG][f.key];
    return old && old.t ? "stale" : "none";
  }
  function stats(m) {
    var fs = fields(m), s = { all: fs.length, ok: 0, mt: 0, stale: 0, none: 0 };
    fs.forEach(function (f) { s[state(m, f)]++; });
    return s;
  }
  // 保存前：今の文に対応しない古い訳を消す
  function prune(m) {
    var tr = m.tr && m.tr[LANG];
    if (!tr) return;
    var fs = fields(m), keep = {};
    fs.forEach(function (f) {
      var e = lookup(m, f.key, f.ja);
      if (e) keep[f.key] = e;
      else if (tr[f.key] && tr[f.key].t) keep[f.key] = tr[f.key]; // 日本語が変わった訳（要確認）も残す
    });
    m.tr[LANG] = keep;
    if (!Object.keys(keep).length) delete m.tr[LANG];
    if (!Object.keys(m.tr).length) delete m.tr;
  }

  // ---------- 用語集 ----------
  function glossary() { return ((window.CATALOG && window.CATALOG.glossary) || []).filter(function (g) { return g.ja && g.id; }); }
  // 文に含まれる用語（長い言葉から先に）
  function termsIn(ja) {
    return glossary().slice().sort(function (a, b) { return b.ja.length - a.ja.length; })
      .filter(function (g) { return ja.indexOf(g.ja) !== -1; });
  }
  // 翻訳の前に、用語を決めた訳語に置き換えておく（機械翻訳で言葉がぶれないように）
  function protect(ja) {
    var s = ja;
    termsIn(ja).forEach(function (g) { s = s.split(g.ja).join(" " + g.id + " "); });
    return s.replace(/ {2,}/g, " ").trim();
  }
  // 現場でよく使う言葉（はじめに追加できる候補。会社の言い方に合わせて直して使う）
  var STARTER = [
    ["急所", "poin kunci"], ["作業要領書", "instruksi kerja"], ["保護具", "APD"], ["安全", "keselamatan"], ["品質", "kualitas"],
    ["作業者", "operator"], ["治具", "jig"], ["トルクレンチ", "kunci torsi"], ["仮締め", "pengencangan sementara"],
    ["本締め", "pengencangan akhir"], ["外観検査", "pemeriksaan visual"], ["不良品", "produk cacat"], ["品番", "nomor part"],
    ["工程", "proses"], ["ライン", "lini"], ["段取り", "persiapan"], ["リーダー", "leader"], ["保護メガネ", "kacamata pelindung"],
    ["安全靴", "sepatu keselamatan"], ["手袋", "sarung tangan"]
  ];

  // ---------- 機械翻訳（Chrome の端末内翻訳） ----------
  var translators = {};
  function supported() { return typeof self !== "undefined" && "Translator" in self; }
  function getTranslator(from, to, onProgress) {
    var k = from + ">" + to;
    if (!translators[k]) {
      translators[k] = self.Translator.create({
        sourceLanguage: from, targetLanguage: to,
        monitor: function (mon) {
          mon.addEventListener("downloadprogress", function (e) { if (onProgress) onProgress(e.loaded); });
        }
      }).catch(function (e) { delete translators[k]; throw e; });
    }
    return translators[k];
  }
  function availability() {
    if (!supported()) return Promise.resolve("unsupported");
    return self.Translator.availability({ sourceLanguage: "ja", targetLanguage: LANG }).catch(function () { return "unavailable"; });
  }

  // =========================================================
  // 翻訳の画面
  // =========================================================
  var el, opt, m, onlyTodo = false, busy = false;

  function build() {
    el = document.createElement("div");
    el.className = "sheet-dialog trans";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.innerHTML =
      '<div class="player-head">' +
        '<div class="label"><div class="step-name">' + LANG_NAME + 'に翻訳（Bahasa Indonesia）</div>' +
        '<div class="step-no">翻訳した文を日本語に戻した文で、意味が合っているかを確認します</div></div>' +
        '<button type="button" class="btn on-navy" data-t="close">✓ 閉じる</button>' +
      '</div>' +
      '<div class="tr-top">' +
        '<div class="tr-progress"><div class="tr-bar"><i id="trBarOk"></i><i id="trBarMt"></i></div><div id="trCount"></div></div>' +
        '<div class="tr-buttons">' +
          '<button type="button" class="btn primary" data-t="all">🌐 まとめて翻訳</button>' +
          '<label class="set-check"><input type="checkbox" id="trTodo"> 確認がまだのものだけ表示</label>' +
          '<span style="flex:1"></span>' +
          '<button type="button" class="btn" data-t="glossary">📖 用語集</button>' +
          '<button type="button" class="btn" data-t="csv-out" title="翻訳できる人に渡す・Excel で直す">⇩ CSV に書き出す</button>' +
          '<label class="btn" title="Excel で直した CSV を読み込む">⇧ CSV を読み込む<input type="file" accept=".csv,text/csv" hidden id="trCsvIn"></label>' +
        '</div>' +
        '<div class="notice" id="trMsg" hidden></div>' +
      '</div>' +
      '<div class="sheet-scroll"><div class="page" id="trBody"></div></div>';
    document.body.appendChild(el);

    el.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-t]");
      if (!b) return;
      var a = b.getAttribute("data-t"), key = b.getAttribute("data-k");
      if (a === "close") close();
      else if (a === "all") translateAll();
      else if (a === "one") translateKeys([key], true);
      else if (a === "back") backKeys([key]);
      else if (a === "glossary") openGlossary();
      else if (a === "csv-out") csvOut();
    });
    el.addEventListener("change", function (ev) {
      var t = ev.target;
      if (t.id === "trTodo") { onlyTodo = t.checked; render(); return; }
      if (t.id === "trCsvIn") { if (t.files[0]) csvIn(t.files[0]); t.value = ""; return; }
      if (t.hasAttribute("data-ok")) {
        var f = fieldOf(t.getAttribute("data-ok"));
        var e = f && current(f);
        if (!e) { t.checked = false; return; }
        e.ok = t.checked;
        changed();
        rowUpdate(f, "state");
      }
    });
    // 訳文を手で直した：確認はやり直し（逆翻訳も古くなる）
    el.addEventListener("input", function (ev) {
      var t = ev.target;
      if (!t.hasAttribute("data-tr")) return;
      var f = fieldOf(t.getAttribute("data-tr"));
      if (!f) return;
      var st = store(m);
      var e = current(f) || (st[f.key] = { t: "", src: f.ja, back: "", ok: false });
      e.t = t.value;
      e.src = f.ja;
      e.ok = false;
      e.back = "";
      e.hand = true;
      st[f.key] = e;
      changed();
      rowUpdate(f, "input");
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && el.classList.contains("open") && !document.querySelector(".tr-gloss.open")) { ev.stopImmediatePropagation(); close(); }
    }, true);
  }

  var fs = [];
  function fieldOf(key) { for (var i = 0; i < fs.length; i++) if (fs[i].key === key) return fs[i]; return null; }
  function current(f) { return lookup(m, f.key, f.ja); }
  function changed() { if (opt.onChange) opt.onChange(); summary(); }

  function msg(html, isError) {
    var n = el.querySelector("#trMsg");
    n.className = "notice" + (isError ? " error" : "");
    n.innerHTML = html;
    n.hidden = !html;
  }

  var STATE_LABEL = { none: "未翻訳", mt: "確認まだ", ok: "確認OK", stale: "日本語が変わりました" };
  function rowHtml(f) {
    var e = current(f), s = state(m, f);
    var old = !e && m.tr && m.tr[LANG] && m.tr[LANG][f.key];
    var t = e ? e.t : (old ? old.t : "");
    var terms = termsIn(f.ja);
    return '<div class="tr-row ' + s + '" data-row="' + esc(f.key) + '">' +
      '<div class="tr-lbl"><b>' + esc(f.label) + '</b><span class="tr-st">' + STATE_LABEL[s] + '</span></div>' +
      '<div class="tr-ja"><small>日本語（元の文）</small>' + esc(f.ja) +
        (terms.length ? '<div class="tr-terms">用語：' + terms.map(function (g) { return esc(g.ja) + " → <b>" + esc(g.id) + "</b>"; }).join("、") + '</div>' : '') +
        (s === "stale" ? '<div class="tr-warn">翻訳した後で日本語が変わりました。翻訳し直してください。<br><small>前の日本語：' + esc(old.src) + '</small></div>' : '') +
      '</div>' +
      '<div class="tr-id"><small>インドネシア語</small><textarea data-tr="' + esc(f.key) + '" rows="2" placeholder="（まだ翻訳していません）">' + esc(t) + '</textarea></div>' +
      '<div class="tr-back"><small>日本語に戻すと（意味の確認用）</small>' +
        '<div class="tr-back-txt">' + (e && e.back ? esc(e.back) : '<span class="hint">' + (e && e.t ? "「日本語に戻す」で確認できます" : "－") + '</span>') + '</div>' +
      '</div>' +
      '<div class="tr-act">' +
        '<label class="tr-ok"><input type="checkbox" data-ok="' + esc(f.key) + '"' + (e && e.ok ? " checked" : "") + (e && e.t ? "" : " disabled") + '> 確認OK</label>' +
        '<button type="button" class="btn small" data-t="one" data-k="' + esc(f.key) + '">' + (t ? "翻訳し直す" : "翻訳する") + '</button>' +
        (e && e.t && !e.back ? '<button type="button" class="btn small" data-t="back" data-k="' + esc(f.key) + '">日本語に戻す</button>' : '') +
      '</div>' +
    '</div>';
  }
  // mode: "input"（訳文を直している最中）／ "state"（確認OK を変えた）は、入力欄をそのままにして一部だけ更新
  function rowUpdate(f, mode) {
    var row = el.querySelector('[data-row="' + cssEsc(f.key) + '"]');
    if (!row) return;
    if (mode) {
      var s = state(m, f), e = current(f);
      row.className = "tr-row " + s;
      row.querySelector(".tr-st").textContent = STATE_LABEL[s];
      if (mode === "state") return;
      row.querySelector(".tr-back-txt").innerHTML = '<span class="hint">「日本語に戻す」で確認できます</span>';
      var ok = row.querySelector("[data-ok]");
      ok.checked = !!(e && e.ok);
      ok.disabled = !(e && e.t);
      if (!row.querySelector('[data-t="back"]') && e && e.t) {
        row.querySelector(".tr-act").insertAdjacentHTML("beforeend", '<button type="button" class="btn small" data-t="back" data-k="' + esc(f.key) + '">日本語に戻す</button>');
      }
      return;
    }
    var div = document.createElement("div");
    div.innerHTML = rowHtml(f);
    row.parentNode.replaceChild(div.firstChild, row);
  }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"'); }

  function summary() {
    var s = stats(m);
    el.querySelector("#trBarOk").style.width = (s.all ? s.ok / s.all * 100 : 0) + "%";
    el.querySelector("#trBarMt").style.width = (s.all ? s.mt / s.all * 100 : 0) + "%";
    el.querySelector("#trCount").innerHTML = '<b>確認OK ' + s.ok + ' / ' + s.all + '</b>' +
      (s.mt ? '　<span class="tr-c mt">確認まだ ' + s.mt + '</span>' : '') +
      (s.none ? '　<span class="tr-c none">未翻訳 ' + s.none + '</span>' : '') +
      (s.stale ? '　<span class="tr-c stale">日本語が変わった ' + s.stale + '</span>' : '');
  }

  function render() {
    fs = fields(m);
    var groups = [], by = {};
    fs.forEach(function (f) {
      if (onlyTodo && state(m, f) === "ok") return;
      if (!by[f.group]) { by[f.group] = []; groups.push(f.group); }
      by[f.group].push(f);
    });
    el.querySelector("#trBody").innerHTML = (groups.length ? groups.map(function (g) {
      return '<section class="tr-group"><h2>' + esc(g) + '</h2>' + by[g].map(rowHtml).join("") + '</section>';
    }).join("") : '<div class="notice">' + (onlyTodo ? "すべて確認が済んでいます。" : "翻訳する文がありません。") + '</div>');
    summary();
  }

  // ---------- 翻訳する ----------
  function ensureTranslator(to, from) {
    if (!supported()) {
      return Promise.reject(new Error("unsupported"));
    }
    return getTranslator(from || "ja", to || LANG, function (p) {
      msg("翻訳のデータを準備中… " + Math.round((p || 0) * 100) + "%（最初の 1 回だけ。インターネットが必要です）");
    });
  }
  function explain(e) {
    if (e && e.message === "unsupported") {
      return "このブラウザでは自動翻訳が使えません。<b>Chrome（バージョン 138 以降）</b>で開いてください。" +
        "<br>自動翻訳を使わない場合は、インドネシア語の欄に直接入力するか、「CSV に書き出す」で翻訳できる人に渡して、直した CSV を読み込んでください。";
    }
    return "翻訳できませんでした（" + esc(e && e.message || e) + "）。" +
      "<br>最初の 1 回は、翻訳のデータをダウンロードするためインターネットが必要です。社内ネットワークで止められている場合は、「CSV に書き出す」で翻訳できる人に頼んでください。";
  }

  function translateAll() {
    var keys = fs.filter(function (f) { var s = state(m, f); return s === "none" || s === "stale"; }).map(function (f) { return f.key; });
    if (!keys.length) {
      msg(stats(m).mt ? "すべて翻訳済みです。<b>「確認まだ」</b>の文を、日本語に戻した文で確認して「確認OK」にしてください。" : "すべて翻訳・確認が済んでいます。");
      return;
    }
    translateKeys(keys, false);
  }

  function translateKeys(keys, force) {
    if (busy) return;
    busy = true;
    var done = 0;
    msg("翻訳中… 0 / " + keys.length);
    // 先に翻訳の準備（ボタンを押した直後に呼ぶ：データのダウンロードにはボタン操作が必要）
    Promise.all([ensureTranslator(LANG, "ja"), ensureTranslator("ja", LANG)]).then(function (tr) {
      return keys.reduce(function (pr, key) {
        return pr.then(function () {
          var f = fieldOf(key);
          if (!f) return;
          return tr[0].translate(protect(f.ja)).then(function (t) {
            t = fixTerms(t, f.ja);
            return tr[1].translate(t).then(function (back) {
              store(m)[f.key] = { t: t, src: f.ja, back: back, ok: false };
              done++;
              msg("翻訳中… " + done + " / " + keys.length);
              rowUpdate(f);
              changed();
            });
          });
        });
      }, Promise.resolve());
    }).then(function () {
      busy = false;
      msg("<b>" + done + " 件を翻訳しました。</b>右の「日本語に戻すと」を読んで、意味が合っていれば<b>「確認OK」</b>にしてください。言葉がおかしいときは、インドネシア語の欄を直すか、<b>用語集</b>に正しい訳語を登録して「翻訳し直す」を押してください。");
    }).catch(function (e) {
      busy = false;
      msg(explain(e), true);
    });
  }
  // 用語集の訳語が訳文に入っていなければ、そのままの形で入っているかを確かめる（大文字小文字だけ合わせる）
  function fixTerms(t, ja) {
    termsIn(ja).forEach(function (g) {
      var re = new RegExp(g.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      t = t.replace(re, g.id);
    });
    return t;
  }
  function backKeys(keys) {
    ensureTranslator("ja", LANG).then(function (tr) {
      return keys.reduce(function (pr, key) {
        return pr.then(function () {
          var f = fieldOf(key), e = f && current(f);
          if (!e || !e.t) return;
          return tr.translate(e.t).then(function (back) { e.back = back; rowUpdate(f); changed(); });
        });
      }, Promise.resolve());
    }).catch(function (e) { msg(explain(e), true); });
  }

  // ---------- 用語集 ----------
  var gEl = null, gRows = [];
  function openGlossary() {
    if (!gEl) {
      gEl = document.createElement("div");
      gEl.className = "tr-gloss";
      gEl.innerHTML = '<div class="tr-gloss-box" role="dialog" aria-modal="true">' +
        '<h2>📖 用語集（決まった訳語）</h2>' +
        '<p class="hint">ここに登録した日本語は、翻訳のとき必ずこの訳語で訳します。社内の言い方・現場で通じる言い方に合わせてください。すべての要領書で共通です。</p>' +
        '<div class="tr-gloss-list" id="gList"></div>' +
        '<div class="tr-gloss-foot">' +
          '<button type="button" class="btn small" data-g="add">＋ 追加</button>' +
          '<button type="button" class="btn small" data-g="starter" title="よく使う言葉の訳の候補を追加">よく使う言葉を追加</button>' +
          '<span style="flex:1"></span>' +
          '<button type="button" class="btn" data-g="cancel">やめる</button>' +
          '<button type="button" class="btn primary" data-g="save">用語集を保存</button>' +
        '</div></div>';
      document.body.appendChild(gEl);
      gEl.addEventListener("click", function (ev) {
        var b = ev.target.closest("[data-g]");
        if (!b) return;
        var a = b.getAttribute("data-g");
        readRows();
        if (a === "add") gRows.push({ ja: "", id: "" });
        else if (a === "del") gRows.splice(+b.getAttribute("data-i"), 1);
        else if (a === "starter") {
          STARTER.forEach(function (p) { if (!gRows.some(function (r) { return r.ja === p[0]; })) gRows.push({ ja: p[0], id: p[1] }); });
        } else if (a === "cancel") { gEl.classList.remove("open"); return; }
        else if (a === "save") { saveGlossary(); return; }
        drawRows();
      });
    }
    gRows = glossary().map(function (g) { return { ja: g.ja, id: g.id }; });
    if (!gRows.length) gRows.push({ ja: "", id: "" });
    drawRows();
    gEl.classList.add("open");
  }
  function drawRows() {
    gEl.querySelector("#gList").innerHTML = '<div class="g-row g-head"><span>日本語</span><span>インドネシア語</span><span></span></div>' +
      gRows.map(function (r, i) {
        return '<div class="g-row"><input type="text" data-gja="' + i + '" value="' + esc(r.ja) + '" placeholder="例：急所">' +
          '<input type="text" data-gid="' + i + '" value="' + esc(r.id) + '" placeholder="例：poin kunci">' +
          '<button type="button" class="btn small danger" data-g="del" data-i="' + i + '">削除</button></div>';
      }).join("");
  }
  function readRows() {
    gRows.forEach(function (r, i) {
      var a = gEl.querySelector('[data-gja="' + i + '"]'), b = gEl.querySelector('[data-gid="' + i + '"]');
      if (a) r.ja = a.value.trim();
      if (b) r.id = b.value.trim();
    });
  }
  function saveGlossary() {
    readRows();
    var list = gRows.filter(function (r) { return r.ja && r.id; });
    function put(c) { c.glossary = list; }
    var done = function () {
      if (window.CATALOG) put(window.CATALOG);
      gEl.classList.remove("open");
      render();
      msg("用語集を保存しました（" + list.length + " 語）。すでに翻訳した文に反映するには「翻訳し直す」を押してください。");
    };
    if (!window.WIFolder || !WIFolder.supported) { done(); return; }
    WIFolder.getRoot().then(function (root) {
      return WIFolder.updateCatalog(root, function (c) { put(c); });
    }).then(done).catch(function (e) {
      if (e && e.name === "AbortError") return;
      alert("用語集を保存できませんでした。" + (WIFolder.errorMessage ? WIFolder.errorMessage(e) : e));
    });
  }

  // ---------- CSV（翻訳できる人とのやり取り） ----------
  function csvCell(v) { v = String(v == null ? "" : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function csvOut() {
    var rows = [["場所(変更しない)", "項目", "日本語", "インドネシア語", "確認(OKと入力)"]];
    fs.forEach(function (f) {
      var e = current(f);
      rows.push([f.key, f.group + " " + f.label, f.ja, e ? e.t : "", e && e.ok ? "OK" : ""]);
    });
    var text = "﻿" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = "翻訳_" + (m.docNo || m.title || "要領書").replace(/[\\\/:*?"<>|\s]+/g, "_") + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    msg("CSV を書き出しました。Excel で開いて「インドネシア語」の列を直し、確認した行は「確認」の列に OK と入れて保存し、「CSV を読み込む」で読み込んでください。");
  }
  function parseCsv(text) {
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function csvIn(file) {
    file.arrayBuffer().then(function (buf) {
      var text;
      // Excel で保存し直すと Shift_JIS になることがあるので、両方を試す
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
      catch (e) { text = new TextDecoder("shift_jis").decode(buf); }
      text = text.replace(/^﻿/, "");
      var rows = parseCsv(text), n = 0, skipped = 0;
      rows.slice(1).forEach(function (r) {
        var f = fieldOf((r[0] || "").trim());
        var t = (r[3] || "").trim();
        if (!f || !t) return;
        if ((r[2] || "").trim() !== f.ja.trim()) { skipped++; return; } // 書き出した後で日本語が変わった
        var e = current(f);
        var okv = /^(ok|○|◯|済)$/i.test((r[4] || "").trim());
        if (e && e.t === t) { if (okv && !e.ok) { e.ok = true; n++; } return; }
        store(m)[f.key] = { t: t, src: f.ja, back: "", ok: okv, hand: true };
        n++;
      });
      changed();
      render();
      msg("CSV から " + n + " 件を読み込みました。" + (skipped ? "（書き出した後で日本語が変わった " + skipped + " 件は読み込んでいません）" : ""));
    }).catch(function (e) { msg("CSV を読み込めませんでした（" + esc(e.message || e) + "）", true); });
  }

  // ---------- 開く・閉じる ----------
  function open(o) {
    if (!el) build();
    opt = o;
    m = o.manual;
    onlyTodo = false;
    el.querySelector("#trTodo").checked = false;
    msg("");
    render();
    el.classList.add("open");
    document.body.style.overflow = "hidden";
    availability().then(function (a) {
      if (a === "unsupported" || a === "unavailable") msg(explain(new Error("unsupported")), true);
      else if (a === "downloadable") msg("「まとめて翻訳」を押すと、最初の 1 回だけ翻訳のデータをダウンロードします（インターネットが必要。2 回目からは不要です）。");
    });
  }
  function close() {
    el.classList.remove("open");
    document.body.style.overflow = "";
    if (opt.onClose) opt.onClose();
  }

  window.WITrans = { LANG: LANG, fields: fields, lookup: lookup, stats: stats, prune: prune, open: open, protect: protect };
})();
