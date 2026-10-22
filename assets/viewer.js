/* =========================================================
   要領書ビューア
   - 手順の行（または急所）をタップすると、その部分の動画を再生
   - 動画は必要になった時だけ読み込み、閉じたら解放（低スペック PC 対策）
   ========================================================= */
(function () {
  "use strict";
  var esc = WI.esc;
  var docEl = document.getElementById("doc");

  WI.initTextSize(document.getElementById("textSize"));

  // 読み込みより前に用意しておく（プレビューはすぐに表示するため）
  var manual = null;
  var playlist = []; // 表示順の項目（すべての手順 ＋ 急所の動画）。動画の無い手順は写真・説明を大きく表示

  // ---------- データ読み込み ----------
  var file = WI.getParam("file");
  if (WI.getParam("preview") === "1") {
    var raw = null;
    try { raw = localStorage.getItem("wi.preview"); } catch (e) {}
    if (raw) {
      document.getElementById("backLink").href = "editor.html?resume=1";
      document.getElementById("backLink").textContent = "◀ 編集に戻る";
      document.getElementById("editLink").style.display = "none";
      start(JSON.parse(raw), true);
    } else {
      showError("プレビューデータがありません。編集画面から開き直してください。");
    }
  } else if (file) {
    WI.loadManualFile(file, function (data, err) {
      if (data) start(data, false); else showError(err);
    });
  } else {
    showError("表示する要領書が指定されていません。一覧から選んでください。");
  }

  function showError(msg) {
    docEl.innerHTML = '<div class="notice error">' + esc(msg) + '</div>';
  }

  // ---------- 描画 ----------

  function start(data, isPreview) {
    manual = data;
    document.title = (data.docNo ? data.docNo + " " : "") + (data.title || "作業要領書");
    document.getElementById("barTitle").innerHTML = WI.orgHtml(window.CATALOG) + '<span class="org-sep">＞</span><b>' + esc(data.title || "作業要領書") + '</b>';
    if (!isPreview && data._file) {
      document.getElementById("editLink").href = "editor.html?file=" + encodeURIComponent(data._file);
      // 一覧の「最近見た要領書」用に記録（この PC のブラウザ内だけ）
      try {
        var recent = JSON.parse(localStorage.getItem("wi.recent") || "[]").filter(function (f) { return f !== data._file; });
        recent.unshift(data._file);
        localStorage.setItem("wi.recent", JSON.stringify(recent.slice(0, 6)));
      } catch (e) {}
    }
    render();
  }

  function list(arr) {
    arr = (arr || []).filter(function (x) { return x !== "" && x != null; });
    if (!arr.length) return "";
    return "<ul>" + arr.map(function (x) {
      if (typeof x === "object") {
        return "<li>" + esc(x.name) + (x.qty ? "　<b>" + esc(x.qty) + "</b>" : "") + "</li>";
      }
      return "<li>" + esc(x) + "</li>";
    }).join("") + "</ul>";
  }

  function hasVideo(v) { return v && v.src; }

  function render() {
    var m = manual;
    var steps = m.steps || [];
    playlist = [];

    var showTime = steps.some(function (s) { return s.time; });

    var html = "";

    var T = WI.terms(m, window.CATALOG);

    // ---------- 帳票のヘッダ（社内フォーマットと同じ形） ----------
    var cell = function (k, v, cls) {
      return '<div class="cell' + (cls ? " " + cls : "") + '"><div class="k">' + esc(k) + '</div><div class="v">' + (v ? esc(v) : "&nbsp;") + '</div></div>';
    };
    var catLabel = WI.catConfig(window.CATALOG).labels.category;
    var mid = cell(T.docNo, m.docNo) +
      (m.revision || m.updated ? cell("改訂", [m.revision ? "第 " + m.revision + " 版" : "", m.updated].filter(Boolean).join("　")) : cell("制定日", m.issued));
    var sub = [cell(T.process, m.process, "wide"), cell(T.title, m.title, "wide2")];
    if (m.line) sub.push(cell(T.line, m.line));
    if (m.product) sub.push(cell(T.product, m.product));
    if (m.category) sub.push(cell(catLabel, m.category));
    html += '<div class="paper">' +
      '<section class="form-head">' +
        '<div class="fh-title">作業要領書</div>' +
        '<div class="fh-mid">' + mid + '</div>' +
        '<div class="fh-stamps">' + stamp("承認", m.approver) + stamp("確認", m.checker) + stamp("作成", m.author) + '</div>' +
        '<div class="fh-sub">' + sub.join("") + '</div>' +
        (m.purpose ? '<div class="fh-sub">' + cell("目的", m.purpose, "full") + '</div>' : '') +
      '</section>';

    // 準備（保護具・道具・注意）
    var prep = "";
    if ((m.cautions || []).length) prep += '<div class="box safety"><h3>⚠ 安全上の注意</h3>' + list(m.cautions) + '</div>';
    if ((m.ppe || []).length) prep += '<div class="box"><h3>保護具</h3>' + list(m.ppe) + '</div>';
    if ((m.tools || []).length) prep += '<div class="box"><h3>使用する設備・治工具</h3>' + list(m.tools) + '</div>';
    if ((m.materials || []).length) prep += '<div class="box"><h3>使用部品・材料</h3>' + list(m.materials) + '</div>';
    if (prep) html += '<section class="form-sec"><h2>作業前の準備</h2><div class="prep">' + prep + '</div></section>';

    // ---------- 作業手順の表 ----------
    var hasReason = steps.some(function (s) { return (s.points || []).some(function (p) { return p.reason; }); });
    // ✚ 安全・◆ 品質 の印は、社内フォーマットと同じく「手順」と「急所」の間の列に出す
    var hasKinds = steps.some(function (s) { return (s.kinds || []).length; });
    html += '<section class="form-sec">' +
      '<table class="steps"><thead><tr>' +
        '<th class="col-no">NO.</th><th>' + esc(T.step) + '</th>' +
        (hasKinds ? '<th class="col-kinds" title="✚ 安全ポイント ／ ◆ 品質ポイント">✚ ◆</th>' : '') +
        '<th>' + esc(T.point) + (hasReason ? '／' + esc(T.reason) : '') + '</th>' +
        (showTime ? '<th class="col-time">標準時間</th>' : '') +
        '<th class="col-video">動画</th>' +
      '</tr></thead><tbody>';

    steps.forEach(function (s, si) {
      var stepPl = -1;
      var stepIdx = playlist.length;
      playlist.push({ step: si, point: -1, video: hasVideo(s.video) ? s.video : null });
      if (hasVideo(s.video)) stepPl = stepIdx;

      var points = (s.points || []).map(function (p, pi) {
        var pv = "";
        if (hasVideo(p.video)) {
          pv = ' class="has-video" data-pl="' + playlist.length + '" role="button" tabindex="0" title="タップで動画を再生"';
          playlist.push({ step: si, point: pi, video: p.video });
        }
        return '<li' + pv + '>' +
          (p.kind && WI.KIND_LABEL[p.kind] ? '<span class="kind ' + esc(p.kind) + '">' + WI.KIND_LABEL[p.kind] + '</span>' : '') +
          esc(p.text) + (hasVideo(p.video) ? ' ▶' : '') +
          (p.reason ? '<span class="reason">' + esc(T.reason) + '：' + esc(p.reason) + '</span>' : '') +
        '</li>';
      }).join("");

      // 行のどこをタップしても開く（動画があれば再生、無ければ手順を大きく表示）
      html += '<tr class="step-row' + (stepPl >= 0 ? ' has-video' : ' still') + '" id="step-' + si + '" data-pl="' + stepIdx + '">' +
        '<td class="col-no">' + (si + 1) + '</td>' +
        '<td class="col-step" data-label="' + esc(T.step) + '">' +
          '<div class="step-title">' + esc(s.title) + '</div>' +
          (s.detail ? '<div class="step-detail">' + esc(s.detail) + '</div>' : '') +
          (s.image ? '<img class="step-image" loading="lazy" decoding="async" src="' + esc(s.image) + '" alt="写真（タップで拡大）" title="タップで拡大" onerror="this.style.display=\'none\'">' : '') +
        '</td>' +
        (hasKinds ? '<td class="col-kinds' + ((s.kinds || []).length ? '' : ' empty') + '" data-label="安全・品質ポイント">' + (s.kinds || []).map(WI.kindBadge).join("") + '</td>' : '') +
        '<td class="col-point' + (points ? '' : ' empty') + '" data-label="' + esc(T.point) + '">' + (points ? '<ul class="points">' + points + '</ul>' : '') + '</td>' +
        (showTime ? '<td class="col-time" data-label="標準時間">' + (s.time ? esc(s.time) + ' 秒' : '') + '</td>' : '') +
        '<td class="col-video">' +
          (stepPl >= 0
            ? '<button type="button" class="round-btn" data-pl="' + stepPl + '" title="動画を再生"><span>▶</span></button><span class="print-only">動画あり</span>' +
              (s.video.end != null && s.video.end !== "" ? '<small class="seg">' + segLabel(s.video) + '</small>' : '')
            : '<button type="button" class="round-btn off" data-pl="' + stepIdx + '" title="大きく表示（動画なし）"><span>⤢</span></button><small class="seg">動画なし</small><span class="print-only">－</span>') +
        '</td>' +
      '</tr>';
    });
    html += '</tbody></table>' +
      '<div class="legend no-print">' +
        (hasKinds ? WI.kindBadge("safety") + ' 安全ポイント　' + WI.kindBadge("quality") + ' 品質ポイント　' : '') +
        '<span>手順の行のどこをタップしても、動画の再生（動画が無い手順は大きく表示）ができます</span></div>' +
    '</section>';

    // 改訂履歴
    if ((m.revisions || []).length) {
      html += '<section class="form-sec"><h2>改訂履歴</h2><table class="rev-table"><thead><tr>' +
        '<th>改訂</th><th>日付</th><th>内容</th><th>担当</th></tr></thead><tbody>' +
        m.revisions.map(function (r) {
          return '<tr><td>' + esc(r.rev) + '</td><td>' + esc(r.date) + '</td><td>' + esc(r.content) + '</td><td>' + esc(r.by) + '</td></tr>';
        }).join("") + '</tbody></table></section>';
    }
    html += '</div>';

    docEl.innerHTML = html;
  }

  function stamp(label, who) {
    return '<div><div class="label">' + label + '</div><div class="who">' + esc(who) + '</div></div>';
  }
  function segLabel(v) {
    var s = WI.parseTime(v.start) || 0;
    var e = WI.parseTime(v.end);
    return WI.formatTime(s) + "〜" + (e != null ? WI.formatTime(e) : "");
  }

  // タップ（クリック）で再生。イベントは 1 か所でまとめて受ける（要素ごとに登録しない＝軽い）
  docEl.addEventListener("click", function (ev) {
    var t = ev.target;
    if (t.closest("a")) return;

    // 写真をタップしたら拡大（画面コピーの細かい文字も読めるように）
    if (t.classList.contains("step-image")) { ev.stopPropagation(); openLightbox(t.src); return; }
    var el = t.closest("[data-pl]");
    if (!el) return;
    // 急所の動画を優先。行のどこかをタップした場合は手順の動画
    ev.stopPropagation();
    openPlayer(parseInt(el.getAttribute("data-pl"), 10));
  });
  docEl.addEventListener("keydown", function (ev) {
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches("li[data-pl]")) {
      ev.preventDefault();
      openPlayer(parseInt(ev.target.getAttribute("data-pl"), 10));
    }
  });

  document.getElementById("stepMode").addEventListener("click", function () { if (playlist.length) openPlayer(0); });

  // ---------- 写真の拡大表示 ----------
  var lb = document.createElement("div");
  lb.className = "lightbox";
  lb.setAttribute("role", "dialog");
  lb.innerHTML = '<img alt=""><button type="button" class="btn on-navy close">✕ 閉じる</button>';
  document.body.appendChild(lb);
  function openLightbox(src) {
    lb.querySelector("img").src = src;
    lb.classList.add("open");
  }
  function closeLightbox() {
    lb.classList.remove("open");
    lb.querySelector("img").removeAttribute("src");
  }
  lb.addEventListener("click", closeLightbox);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && lb.classList.contains("open")) { closeLightbox(); ev.stopImmediatePropagation(); }
  });

  // ---------- 動画プレーヤー ----------
  var player = document.getElementById("player");
  var video = document.getElementById("pVideo");
  var pNo = document.getElementById("pNo");
  var pName = document.getElementById("pName");
  var pMsg = document.getElementById("pMsg");
  var pPoints = document.getElementById("pPoints");
  var pPlay = document.getElementById("pPlay");
  var pPrev = document.getElementById("pPrev");
  var pNext = document.getElementById("pNext");
  var pRepeat = document.getElementById("pRepeat");
  var pAuto = document.getElementById("pAuto");
  var pTime = document.getElementById("pTime");
  var pClose = document.getElementById("pClose");
  var pStill = document.getElementById("pStill");
  var pCount = document.getElementById("pCount");
  var pProg = document.getElementById("pProg");
  var pBody = document.getElementById("pBody");
  var pMarks = document.getElementById("pMarks");
  // 手順モードの写真もタップで拡大
  pStill.addEventListener("click", function (ev) { if (ev.target.tagName === "IMG") openLightbox(ev.target.src); });
  var rateBtns = player.querySelectorAll("[data-rate]");

  var cur = -1;
  var segStart = 0, segEnd = null;
  var repeat = false;
  var autoNext = false; // 区間が終わったら次の手順へ進む（通し再生・教育用）
  var rate = 1;
  var loadedSrc = "";
  var lastFocus = null;

  try { repeat = localStorage.getItem("wi.repeat") === "1"; } catch (e) {}
  try { autoNext = localStorage.getItem("wi.autoNext") === "1"; } catch (e) {}
  try { rate = parseFloat(localStorage.getItem("wi.rate")) || 1; } catch (e) {}
  updateRepeat();
  updateRate();

  function openPlayer(idx) {
    if (idx < 0 || idx >= playlist.length) return;
    if (cur === -1) lastFocus = document.activeElement;
    cur = idx;
    var item = playlist[idx];
    var step = manual.steps[item.step];
    var point = item.point >= 0 ? step.points[item.point] : null;

    var T = WI.terms(manual, window.CATALOG);
    var n = manual.steps.length;
    // 上：作業名・何番目か・進み具合
    document.getElementById("pCrumb").textContent = [manual.line, manual.process].filter(Boolean).join(" ＞ ");
    document.getElementById("pTitle").textContent = manual.title || "";
    pCount.innerHTML = (item.step + 1) + '<small> / ' + n + '</small>';
    var bars = "";
    for (var k = 0; k < n; k++) bars += '<i class="' + (k < item.step ? "done" : k === item.step ? "now" : "") + '"></i>';
    pProg.innerHTML = bars;
    // 右：手順の文・印・急所
    pNo.textContent = point ? T.point.replace(/[（(].*$/, "") + "（手順 " + (item.step + 1) + "）" : T.step.replace(/[（(].*$/, "");
    pName.textContent = point ? point.text : step.title;
    pMarks.innerHTML = (step.kinds || []).map(WI.kindBadge).join("");
    var pts = point ? [] : (step.points || []);
    pPoints.innerHTML = pts.map(function (p) {
      return '<div class="tp-point' + (p.kind ? " " + esc(p.kind) : "") + '"><div class="lbl">' + esc(T.point.replace(/[（(].*$/, "")) + '</div>' +
        '<div class="txt">' + (p.kind && WI.KIND_LABEL[p.kind] ? WI.kindBadge(p.kind) + ' ' : '') + esc(p.text) + '</div>' +
        (p.reason ? '<div class="why">' + esc(T.reason) + '：' + esc(p.reason) + '</div>' : '') + '</div>';
    }).join("");
    if (step.detail && !point) pPoints.innerHTML = '<div class="tp-detail">' + esc(step.detail) + '</div>' + pPoints.innerHTML;

    pPrev.disabled = idx === 0;
    pNext.disabled = idx === playlist.length - 1;

    hideMsg();

    // 一覧の該当行を強調
    var rows = docEl.querySelectorAll(".step-row.current");
    for (var i = 0; i < rows.length; i++) rows[i].classList.remove("current");
    var row = document.getElementById("step-" + item.step);
    if (row) row.classList.add("current");

    player.classList.add("open");
    document.body.style.overflow = "hidden";

    // 動画の無い手順: 写真があれば大きく表示。写真も無ければ、手順の文を画面いっぱいに
    if (!item.video) {
      video.pause();
      video.hidden = true;
      pStill.hidden = !step.image;
      pStill.innerHTML = step.image ? '<img src="' + esc(step.image) + '" alt="" title="タップで拡大">' : '';
      pBody.classList.toggle("no-media", !step.image);
      pBody.classList.add("still"); // 再生の操作ボタンは出さない
      pTime.textContent = "";
      pPlay.disabled = true;
      pPlay.textContent = "動画なし";
      document.getElementById("pRestart").disabled = true;
      (pNext.disabled ? pClose : pNext).focus(); // → キー・Enter で次へ
      return;
    }
    video.hidden = false;
    pStill.hidden = true;
    pStill.innerHTML = "";
    pBody.classList.remove("no-media");
    pBody.classList.remove("still");
    pPlay.disabled = false;
    pPlay.textContent = video.paused ? "▶ 動画を再生" : "❚❚ 一時停止";
    document.getElementById("pRestart").disabled = false;
    segStart = WI.parseTime(item.video.start) || 0;
    segEnd = WI.parseTime(item.video.end);

    var src = item.video.src;
    if (src !== loadedSrc) {
      // 別の動画ファイル: 読み込み直し
      loadedSrc = src;
      video.preload = "auto";
      video.src = src;
      video.load();
      // 開始位置は loadedmetadata で設定
    } else if (video.readyState >= 1) {
      // 同じファイルの別区間: 読み込まずにシークだけ（速い）
      video.currentTime = segStart;
    }
    video.playbackRate = rate;
    play();
    pPlay.focus(); // Space キーで再生／停止できるように
  }

  function closePlayer() {
    if (cur === -1) return;
    video.pause();
    // デコーダとメモリを解放する
    video.removeAttribute("src");
    video.load();
    loadedSrc = "";
    player.classList.remove("open");
    document.body.style.overflow = "";
    var item = playlist[cur];
    cur = -1;
    var row = item && document.getElementById("step-" + item.step);
    if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function play() {
    var p = video.play();
    if (p && p.catch) {
      p.catch(function (e) {
        if (e && e.name === "NotAllowedError") showMsg("▶ 再生 ボタンを押してください。");
      });
    }
  }

  function togglePlay() {
    if (video.paused || video.ended) {
      if (segEnd != null && video.currentTime >= segEnd - 0.05) video.currentTime = segStart;
      play();
    } else {
      video.pause();
    }
  }

  function restart() {
    video.currentTime = segStart;
    play();
  }

  function showMsg(html) { pMsg.innerHTML = html; pMsg.classList.add("show"); }
  function hideMsg() { pMsg.classList.remove("show"); }

  function updateRepeat() {
    pRepeat.classList.toggle("active", repeat);
    pRepeat.setAttribute("aria-pressed", repeat ? "true" : "false");
    pAuto.classList.toggle("active", autoNext);
    pAuto.setAttribute("aria-pressed", autoNext ? "true" : "false");
  }

  // 区間（または動画）の終わりに来たときの動き
  function segmentDone() {
    if (repeat) { video.currentTime = segStart; play(); return; }
    if (autoNext) {
      // 急所だけの動画は飛ばして、次の「手順」の動画へ
      for (var j = cur + 1; j < playlist.length; j++) {
        if (playlist[j].point === -1) { openPlayer(j); return; }
      }
      showMsg("最後の手順まで再生しました。");
    }
    if (!video.paused) video.pause();
  }
  function updateRate() {
    for (var i = 0; i < rateBtns.length; i++) {
      rateBtns[i].classList.toggle("active", parseFloat(rateBtns[i].getAttribute("data-rate")) === rate);
    }
    video.playbackRate = rate;
  }

  video.addEventListener("loadedmetadata", function () {
    if (segStart > 0) video.currentTime = segStart;
    video.playbackRate = rate;
  });

  // 区間の終わりで止める／繰り返す（timeupdate は 1 秒に数回なので負荷は小さい）
  video.addEventListener("timeupdate", function () {
    var t = video.currentTime;
    if (segEnd != null && t >= segEnd && !video.paused) segmentDone();
    var s = WI.formatTime(Math.max(0, t - segStart));
    var len = segEnd != null ? segEnd - segStart : (isFinite(video.duration) ? video.duration - segStart : null);
    pTime.textContent = s + (len != null ? " / " + WI.formatTime(len) : "");
  });

  video.addEventListener("ended", segmentDone);
  video.addEventListener("play", function () { pPlay.textContent = "❚❚ 一時停止"; hideMsg(); });
  video.addEventListener("pause", function () { if (!pPlay.disabled) pPlay.textContent = "▶ 動画を再生"; });

  video.addEventListener("error", function () {
    if (!video.getAttribute("src")) return; // 閉じた時の解放によるもの
    showMsg("動画を再生できません。<br><small>ファイル：" + esc(loadedSrc) +
      "<br>videos フォルダにファイルがあるか、形式が MP4（H.264）か確認してください。</small>" +
      '<br><a class="btn on-navy small" href="guide.html" target="_blank" style="margin-top:8px">スマホで撮った動画の場合（撮影ガイド）</a>');
  });

  pClose.addEventListener("click", closePlayer);
  pPlay.addEventListener("click", togglePlay);
  document.getElementById("pRestart").addEventListener("click", restart);
  pPrev.addEventListener("click", function () { openPlayer(cur - 1); });
  pNext.addEventListener("click", function () { openPlayer(cur + 1); });
  pRepeat.addEventListener("click", function () {
    repeat = !repeat;
    try { localStorage.setItem("wi.repeat", repeat ? "1" : "0"); } catch (e) {}
    updateRepeat();
  });
  pAuto.addEventListener("click", function () {
    autoNext = !autoNext;
    try { localStorage.setItem("wi.autoNext", autoNext ? "1" : "0"); } catch (e) {}
    updateRepeat();
  });
  for (var i = 0; i < rateBtns.length; i++) {
    rateBtns[i].addEventListener("click", function () {
      rate = parseFloat(this.getAttribute("data-rate"));
      try { localStorage.setItem("wi.rate", String(rate)); } catch (e) {}
      updateRate();
    });
  }

  // キーボード操作（PC 用）
  document.addEventListener("keydown", function (ev) {
    if (cur === -1 || lb.classList.contains("open")) return; // 写真の拡大中は拡大表示の操作を優先
    if (ev.target === video && (ev.key === " " || ev.key.indexOf("Arrow") === 0)) return; // 標準操作に任せる
    var still = !playlist[cur].video;
    switch (ev.key) {
      case "Escape": closePlayer(); break;
      case " ":
      case "k": if (still || (ev.target.tagName === "BUTTON" && ev.key === " ")) return; togglePlay(); break;
      case "ArrowRight": case "PageDown": if (cur < playlist.length - 1) openPlayer(cur + 1); break;
      case "ArrowLeft": case "PageUp": if (cur > 0) openPlayer(cur - 1); break;
      case "Home": if (!still) restart(); break;
      case "r": case "R": pRepeat.click(); break;
      case "a": case "A": pAuto.click(); break;
      default: return;
    }
    ev.preventDefault();
  });
})();
