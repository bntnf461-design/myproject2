/* =========================================================
   設定画面
   - 工場名、一覧で絞り込む項目（表示名・順番）
   - カテゴリーの名前の追加・変更・並べ替え・削除
     名前を変える／削除すると、その名前を使っている要領書もまとめて書き換える
   ========================================================= */
(function () {
  "use strict";
  var esc = WI.esc;
  var formEl = document.getElementById("form");
  var stateEl = document.getElementById("state");
  var KEYS = WI.CAT_KEYS;
  var DEFAULT_LABEL = { line: "ライン", product: "製品", process: "工程", category: "作業区分" };
  var EXAMPLE = { line: "例：Cライン", product: "例：AB-300 カバー", process: "例：塗装工程", category: "例：検査" };

  var cat = window.CATALOG || { files: [] };
  var conf = WI.catConfig(cat);
  // 工場・課・工程などの名前（何段でも可）
  var org = (cat.org && cat.org.length ? cat.org.slice() : (cat.siteName ? [cat.siteName] : []));
  while (org.length < 3) org.push("");
  var ORG_PH = ["例：○○工場", "例：○○課", "例：○○工程", "例：○○係"];
  var terms = JSON.parse(JSON.stringify(cat.terms || {})); // 見出しの名前（全体の初期値）
  var formats = (cat.formats || []).slice(); // 覚えた Excel の様式
  var readings = (cat.readings || []).map(function (r) { return { w: r.w, y: r.y }; }); // 読み上げの読み方
  var speech = JSON.parse(JSON.stringify(cat.speech || {})); // 読み上げの声
  if (!speech.voice) speech.voice = {};
  var SAMPLE = { ja: "手順 1。ブラケットを治具にセットする。急所。基準ピンに当たるまで奥へ押す。", id: "Langkah 1. Pasang braket pada jig. Poin kunci: dorong sampai menyentuh pin acuan." };
  if (window.speechSynthesis && speechSynthesis.addEventListener) {
    speechSynthesis.addEventListener("voiceschanged", function () { if (render.done) render(); });
  }
  function voiceSection() {
    var langs = [["ja", "日本語"], ["id", "インドネシア語"]];
    var h = '<div class="voice-box">' +
      '<label class="set-check"><input type="checkbox" data-sp="natural"' + (speech.natural ? " checked" : "") + '> ' +
        '<b>インターネットにつながっているときは、自然な声を使う</b></label>' +
      '<p class="hint" style="margin:4px 0 10px">Edge の「自然な声（Natural）」は、人に近い抑揚で読みます。インターネットが必要なため、つながっていないときは自動で PC に入っている声に戻ります。Chrome では自然な声が無いため、PC に入っている声で読みます。</p>';
    langs.forEach(function (L) {
      var vs = WI.voices(L[0]);
      var cur = WI.pickVoice(L[0], { natural: speech.natural, voice: speech.voice });
      h += '<div class="voice-row"><span class="voice-lang">' + L[1] + '</span>' +
        (vs.length ? '<select data-sv="' + L[0] + '"><option value="">おまかせ</option>' + vs.map(function (v) {
          var kind = v.localService ? "PC の声" : (WI.isNatural(v) ? "自然な声・要インターネット" : "要インターネット");
          return '<option value="' + esc(v.name) + '"' + (speech.voice[L[0]] === v.name ? " selected" : "") + '>' + esc(v.name) + '（' + kind + '）</option>';
        }).join("") + '</select>' : '<span class="hint">この PC には声がありません' + (L[0] === "id" ? "（Windows の設定 → 時刻と言語 → 音声 で追加できます）" : "") + '</span>') +
        (vs.length ? '<button type="button" class="btn small" data-act="sp-test" data-k="' + L[0] + '">▶ 声を試す</button>' : '') +
        (cur ? '<span class="hint">今の声：' + esc(cur.name) + '</span>' : '') +
      '</div>';
    });
    return h + '</div>';
  }
  var READ_STARTER = [["急所", "きゅうしょ"], ["仮締め", "かりじめ"], ["本締め", "ほんじめ"], ["治具", "じぐ"], ["治工具", "じこうぐ"],
    ["品番", "ひんばん"], ["段取り", "だんどり"], ["締付け", "しめつけ"], ["外観", "がいかん"], ["員数", "いんずう"]];
  var levelRows = [];   // [{ key, use, label }]（上から順に絞り込み）
  var rows = {};        // key → [{ orig, name, count }]
  var deleted = {};     // key → [元の名前]
  var unreadable = [];  // 読み込めなかった要領書
  var dirty = false;

  // 絞り込みの項目: 使っている項目を順番どおり → 使っていない項目
  conf.levels.forEach(function (k) { levelRows.push({ key: k, use: true, label: conf.labels[k] }); });
  KEYS.forEach(function (k) {
    if (conf.levels.indexOf(k) === -1) levelRows.push({ key: k, use: false, label: conf.labels[k] });
  });

  WI.loadManualFiles(cat.files || [], function (results) {
    var used = {};
    KEYS.forEach(function (k) { used[k] = {}; deleted[k] = []; });
    results.forEach(function (r) {
      if (!r.data) { unreadable.push(r.file); return; }
      KEYS.forEach(function (k) {
        WI.splitCat(r.data[k]).forEach(function (v) { used[k][v] = (used[k][v] || 0) + 1; });
      });
    });
    KEYS.forEach(function (k) {
      var names = conf.categories[k].slice();
      Object.keys(used[k]).sort(WI.catSorter(names)).forEach(function (v) { if (names.indexOf(v) === -1) names.push(v); });
      rows[k] = names.map(function (n) { return { orig: n, name: n, count: used[k][n] || 0 }; });
    });
    render();
  });

  function labelOf(k) {
    for (var i = 0; i < levelRows.length; i++) if (levelRows[i].key === k) return levelRows[i].label || DEFAULT_LABEL[k];
    return DEFAULT_LABEL[k];
  }

  function render() {
    var y = window.scrollY;
    var h = '<div id="msgArea"></div>';

    if (!WIFolder.supported) {
      h += '<div class="notice error" style="margin-bottom:16px">このブラウザではフォルダに直接保存できません。Chrome か Edge で開いてください。</div>';
    }

    var shown = org.filter(function (x) { return x.trim(); });
    h += '<section class="section" id="org"><h2>工場・課・工程の名前</h2>' +
      '<p class="hint" style="margin-top:0">画面の上に「' + (shown.length ? shown.map(esc).join(" ＞ ") : "○○工場 ＞ ○○課 ＞ ○○工程") + '」のように表示されます。使わない欄は空欄のままで大丈夫です。</p>' +
      org.map(function (v, i) {
        return '<div class="set-row">' +
          '<span class="set-check" style="min-width:4em">' + (i + 1) + ' 段目</span>' +
          '<input type="text" data-org="' + i + '" value="' + esc(v) + '" placeholder="' + (ORG_PH[i] || "例：○○") + '" aria-label="' + (i + 1) + ' 段目の名前">' +
          (org.length > 1 ? '<button type="button" class="btn small danger" data-act="org-del" data-i="' + i + '">削除</button>' : '') +
        '</div>';
      }).join("") +
      '<button type="button" class="btn small" data-act="org-add" style="margin-top:6px">＋ 段を追加（例：○○係）</button>' +
    '</section>';

    h += '<section class="section"><h2>要領書の見出しの名前（社内フォーマットに合わせる）</h2>' +
      '<p class="hint" style="margin-top:0">要領書の画面・エディタに表示する見出しの名前です（例：主なステップ → 要素作業手順、急所 → 急所ポイント、文書番号 → 管理番号）。空欄なら標準の名前です。<br>' +
      'Excel から取り込んだ要領書は、その Excel の見出しの名前が自動で使われます。</p><div class="form-grid">' +
      WI.TERM_KEYS.map(function (k) {
        return '<label class="field"><span>' + esc(WI.DEFAULT_TERMS[k]) + '</span><input type="text" data-term="' + k + '" value="' + esc(terms[k] || "") + '" placeholder="' + esc(WI.DEFAULT_TERMS[k]) + '"></label>';
      }).join("") + '</div></section>';

    h += '<section class="section" id="formats"><h2>覚えた Excel の様式</h2>' +
      '<p class="hint">Excel 取り込みで列の対応を直して「この様式を覚える」を押すと、ここに並びます。同じ様式の Excel は、1 件ずつでも、まとめて取り込みでも、自動でこの対応で読み取ります。</p>' +
      (formats.length ? '<ul class="fmt-list">' + formats.map(function (f, i) {
        var cols = Object.keys(f.cols || {}).length;
        return '<li><b>' + esc(f.name) + '</b><span class="hint">見出し ' + (f.headerRows || 1) + ' 段・使う列 ' + cols + ' つ</span>' +
          '<button type="button" class="btn small danger" data-act="fmt-del" data-i="' + i + '">削除</button></li>';
      }).join("") + '</ul>' : '<p class="hint">（まだありません。自動で読み取れている場合は、覚える必要はありません）</p>') +
    '</section>';

    h += '<section class="section" id="readings"><h2>読み上げ</h2>' + voiceSection() +
      '<h3 class="sub-h">読み方の辞書</h3>' +
      '<p class="hint">作業者の画面の「🔈 読み上げ」で、読み間違える言葉の読み方を、ひらがなで登録します（例：仮締め → かりじめ）。</p>' +
      '<div class="read-list">' + readings.map(function (r, i) {
        return '<div class="g-row"><input type="text" data-rw="' + i + '" value="' + esc(r.w) + '" placeholder="言葉（例：仮締め）">' +
          '<input type="text" data-ry="' + i + '" value="' + esc(r.y) + '" placeholder="読み方（例：かりじめ）">' +
          '<button type="button" class="btn small danger" data-act="rd-del" data-i="' + i + '">削除</button></div>';
      }).join("") + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button type="button" class="btn small" data-act="rd-add">＋ 追加</button>' +
      '<button type="button" class="btn small" data-act="rd-starter">読み間違えやすい言葉を追加</button></div>' +
    '</section>';

    h += '<section class="section"><h2>一覧で絞り込む項目</h2>' +
      '<p class="hint" style="margin-top:0">チェックした項目が、上から順に一覧の絞り込みに表示されます。表示名は自由に変えられます（例：ライン → 職場、工程 → 業務）。</p>' +
      levelRows.map(function (r, i) {
        return '<div class="set-row">' +
          '<label class="set-check"><input type="checkbox" data-use="' + i + '"' + (r.use ? " checked" : "") + '> 使う</label>' +
          '<input type="text" data-label="' + i + '" value="' + esc(r.label) + '" aria-label="表示名" placeholder="' + DEFAULT_LABEL[r.key] + '">' +
          '<span class="hint">要領書の「' + DEFAULT_LABEL[r.key] + '」欄</span>' +
          '<button type="button" class="btn small" data-act="lv-up" data-i="' + i + '"' + (i === 0 ? " disabled" : "") + '>↑</button>' +
          '<button type="button" class="btn small" data-act="lv-down" data-i="' + i + '"' + (i === levelRows.length - 1 ? " disabled" : "") + '>↓</button>' +
        '</div>';
      }).join("") + '</section>';

    h += '<section class="section"><h2>カテゴリーの名前</h2>' +
      '<p class="hint" style="margin-top:0">名前を変えると、その名前を使っている要領書も<b>まとめて書き換わります</b>。2 つを同じ名前にすると 1 つにまとまります。並び順は一覧の表示順になります。<br>追加した名前は、エディタの入力候補に出ます。</p>';
    levelRows.forEach(function (lr) {
      var k = lr.key;
      var list = rows[k];
      h += '<div class="edit-card"><header><span class="ttl">' + esc(labelOf(k)) + (lr.use ? "" : '　<small>（一覧では使っていません）</small>') + '</span></header><div class="body">' +
        (list.length ? list.map(function (r, i) {
          return '<div class="set-row">' +
            '<input type="text" data-name="' + k + '" data-i="' + i + '" value="' + esc(r.name) + '" aria-label="名前">' +
            '<span class="hint">' + (r.orig === null ? "新規" : "要領書 " + r.count + " 件") + '</span>' +
            '<button type="button" class="btn small" data-act="up" data-k="' + k + '" data-i="' + i + '"' + (i === 0 ? " disabled" : "") + '>↑</button>' +
            '<button type="button" class="btn small" data-act="down" data-k="' + k + '" data-i="' + i + '"' + (i === list.length - 1 ? " disabled" : "") + '>↓</button>' +
            '<button type="button" class="btn small danger" data-act="del" data-k="' + k + '" data-i="' + i + '">削除</button>' +
          '</div>';
        }).join("") : '<p class="hint">まだありません。</p>') +
        '<div class="set-row set-add">' +
          '<input type="text" data-new="' + k + '" placeholder="' + EXAMPLE[k] + '" aria-label="追加する名前">' +
          '<button type="button" class="btn small" data-act="add" data-k="' + k + '">＋ 追加</button>' +
        '</div>' +
      '</div></div>';
    });
    h += '</section>';

    if (unreadable.length) {
      h += '<div class="notice error">読み込めない要領書があります（名前の変更が反映されません）：' + unreadable.map(esc).join("、") + '</div>';
    }

    formEl.innerHTML = h;
    window.scrollTo(0, y);
    var saved = null;
    try { saved = sessionStorage.getItem("wi.settingsMsg"); sessionStorage.removeItem("wi.settingsMsg"); } catch (e) {}
    if (saved) { notice(saved); stateEl.textContent = "保存済み"; }
    // メニューの「名前を変える」から来たときは、その欄を表示
    if (!render.done && location.hash) {
      var target = document.querySelector(location.hash);
      if (target) { target.scrollIntoView(); var inp = target.querySelector("input"); if (inp) inp.focus(); }
    }
    render.done = true;
  }

  function notice(html, isError) {
    var a = document.getElementById("msgArea");
    if (a) a.innerHTML = '<div class="notice' + (isError ? " error" : "") + '" style="margin-bottom:16px">' + html + '</div>';
    window.scrollTo(0, 0);
  }

  function touch() {
    dirty = true;
    stateEl.textContent = "● 未保存の変更あり";
  }

  formEl.addEventListener("input", function (ev) {
    var t = ev.target;
    if (t.hasAttribute("data-org")) org[+t.getAttribute("data-org")] = t.value;
    else if (t.hasAttribute("data-term")) terms[t.getAttribute("data-term")] = t.value;
    else if (t.hasAttribute("data-label")) levelRows[+t.getAttribute("data-label")].label = t.value;
    else if (t.hasAttribute("data-use")) levelRows[+t.getAttribute("data-use")].use = t.checked;
    else if (t.hasAttribute("data-name")) rows[t.getAttribute("data-name")][+t.getAttribute("data-i")].name = t.value;
    else if (t.getAttribute("data-sp") === "natural") { speech.natural = t.checked; touch(); render(); return; }
    else if (t.hasAttribute("data-sv")) { speech.voice[t.getAttribute("data-sv")] = t.value; touch(); render(); return; }
    else if (t.hasAttribute("data-rw")) readings[+t.getAttribute("data-rw")].w = t.value;
    else if (t.hasAttribute("data-ry")) readings[+t.getAttribute("data-ry")].y = t.value;
    else return;
    touch();
  });
  formEl.addEventListener("change", function (ev) {
    if (ev.target.hasAttribute("data-use") || ev.target.hasAttribute("data-label")) render(); // 見出しの表示を更新
  });
  formEl.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" && ev.target.hasAttribute("data-new")) {
      ev.preventDefault();
      add(ev.target.getAttribute("data-new"));
    }
  });

  function add(k) {
    var input = formEl.querySelector('[data-new="' + k + '"]');
    var v = input.value.trim();
    if (!v) return;
    if (rows[k].some(function (r) { return r.name === v; })) { input.select(); return; }
    rows[k].push({ orig: null, name: v, count: 0 });
    touch();
    render();
    var next = formEl.querySelector('[data-new="' + k + '"]');
    if (next) next.focus();
  }

  formEl.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-act]");
    if (!b) return;
    var act = b.getAttribute("data-act"), k = b.getAttribute("data-k"), i = +b.getAttribute("data-i");
    var swap = function (a, x, y) { var t = a[x]; a[x] = a[y]; a[y] = t; };
    if (act === "lv-up") swap(levelRows, i, i - 1);
    else if (act === "lv-down") swap(levelRows, i, i + 1);
    else if (act === "up") swap(rows[k], i, i - 1);
    else if (act === "down") swap(rows[k], i, i + 1);
    else if (act === "add") { add(k); return; }
    else if (act === "org-add") org.push("");
    else if (act === "org-del") org.splice(i, 1);
    else if (act === "sp-test") {
      var v = WI.pickVoice(k, { natural: speech.natural, voice: speech.voice });
      if (!v || !window.speechSynthesis) return;
      speechSynthesis.cancel();
      var text = SAMPLE[k];
      if (k === "ja") readings.forEach(function (r) { if (r.w && r.y) text = text.split(r.w).join(r.y); });
      var u = new SpeechSynthesisUtterance(text);
      u.voice = v; u.lang = v.lang;
      speechSynthesis.speak(u);
      return;
    }
    else if (act === "rd-add") readings.push({ w: "", y: "" });
    else if (act === "rd-del") readings.splice(i, 1);
    else if (act === "rd-starter") READ_STARTER.forEach(function (p) { if (!readings.some(function (r) { return r.w === p[0]; })) readings.push({ w: p[0], y: p[1] }); });
    else if (act === "fmt-del") {
      if (!confirm("様式「" + formats[i].name + "」を削除しますか？（取り込み済みの要領書は変わりません）")) return;
      formats.splice(i, 1);
    }
    else if (act === "del") {
      var r = rows[k][i];
      if (r.count && !confirm("「" + r.orig + "」は要領書 " + r.count + " 件で使われています。\n削除すると、それらの要領書のこの欄は空（未設定）になります。削除しますか？")) return;
      if (r.orig !== null) deleted[k].push(r.orig);
      rows[k].splice(i, 1);
    } else return;
    touch();
    render();
  });

  // ---------- 保存 ----------
  // 要領書の書き換え内容: key → { 元の名前: 新しい名前（削除は null） }
  function changes() {
    var ch = {}, n = 0;
    KEYS.forEach(function (k) {
      ch[k] = {};
      rows[k].forEach(function (r) {
        var v = r.name.trim();
        if (r.orig !== null && v !== r.orig) { ch[k][r.orig] = v || null; n++; }
      });
      deleted[k].forEach(function (o) { ch[k][o] = null; n++; });
    });
    return n ? ch : null;
  }

  function applyTo(d, ch) {
    var changed = false;
    KEYS.forEach(function (k) {
      var before = WI.splitCat(d[k]);
      var after = [];
      before.forEach(function (v) {
        var nv = Object.prototype.hasOwnProperty.call(ch[k], v) ? ch[k][v] : v;
        if (nv && after.indexOf(nv) === -1) after.push(nv);
      });
      if (after.join("、") !== before.join("、")) { d[k] = after.join("、"); changed = true; }
    });
    return changed;
  }

  function newCatalog(base) {
    var c = {
      org: org.map(function (x) { return x.trim(); }).filter(Boolean),
      siteName: org.map(function (x) { return x.trim(); }).filter(Boolean).join(" "),
      levels: levelRows.filter(function (r) { return r.use; }).map(function (r) { return r.key; }),
      labels: {},
      terms: {},
      categories: {},
      formats: formats,
      speech: { natural: !!speech.natural, voice: Object.keys(speech.voice).reduce(function (o, k) { if (speech.voice[k]) o[k] = speech.voice[k]; return o; }, {}) },
      readings: readings.map(function (r) { return { w: r.w.trim(), y: r.y.trim() }; }).filter(function (r) { return r.w && r.y; }),
      files: base.files
    };
    levelRows.forEach(function (r) { c.labels[r.key] = r.label.trim() || DEFAULT_LABEL[r.key]; });
    Object.keys(terms).forEach(function (k) { if (terms[k] && terms[k].trim()) c.terms[k] = terms[k].trim(); });
    KEYS.forEach(function (k) {
      var names = [];
      rows[k].forEach(function (r) { var v = r.name.trim(); if (v && names.indexOf(v) === -1) names.push(v); });
      c.categories[k] = names;
    });
    return c;
  }

  document.getElementById("save").addEventListener("click", function () {
    var ch = changes();
    if (!WIFolder.supported) {
      notice("このブラウザでは保存できません。Chrome か Edge で開いてください。", true);
      return;
    }
    var btn = this;
    btn.disabled = true;
    var root, updated = 0, failed = [];
    WIFolder.getRoot().then(function (r) {
      root = r;
      return root.getDirectoryHandle("manuals").then(function (md) {
        return WIFolder.readText(md, "catalog.js").then(function (text) {
          var files = WIFolder.parseCatalog(text).files;
          if (!ch) return;
          // 名前を変えた・削除したカテゴリーを使っている要領書を書き換える
          return files.reduce(function (pr, f) {
            return pr.then(function () {
              return WIFolder.readText(md, f).then(function (t) {
                var d = WIFolder.parseManual(t);
                if (!applyTo(d, ch)) return;
                notice("要領書を更新中… " + esc(f));
                return WIFolder.backup(md, f, "_backup").then(function () {
                  return WIFolder.writeFile(md, f, WIFolder.manualText(d));
                }).then(function () { updated++; });
              }).catch(function () { failed.push(f); });
            });
          }, Promise.resolve());
        });
      });
    }).then(function () {
      return WIFolder.updateCatalog(root, function (c) {
        var n = newCatalog(c);
        Object.keys(n).forEach(function (k) { c[k] = n[k]; });
      });
    }).then(function () {
      dirty = false;
      var msg = "<b>保存しました。</b>" + (updated ? "要領書 " + updated + " 件のカテゴリーを書き換えました。" : "") +
        (failed.length ? '<br><span style="color:var(--safety)">書き換えられなかった要領書：' + failed.map(esc).join("、") + '</span>' : "") +
        '<br><a href="list.html">一覧で確認する</a>';
      // 保存した内容で画面を読み直す（メッセージは読み直した後に表示）
      try { sessionStorage.setItem("wi.settingsMsg", msg); } catch (e) {}
      location.reload();
    }).catch(function (e) {
      if (e && e.name === "AbortError") return;
      notice("<b>保存できませんでした。</b>" + esc(WIFolder.errorMessage(e)), true);
    }).then(function () { btn.disabled = false; });
  });

  window.addEventListener("beforeunload", function (ev) {
    if (dirty) { ev.preventDefault(); ev.returnValue = ""; }
  });
})();
