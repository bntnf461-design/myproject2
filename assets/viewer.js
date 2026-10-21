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
  var manual = null;
  var playlist = []; // 表示順の項目（すべての手順 ＋ 急所の動画）。動画の無い手順は写真・説明を大きく表示

  function start(data, isPreview) {
    manual = data;
    document.title = (data.docNo ? data.docNo + " " : "") + (data.title || "作業要領書");
    document.getElementById("barTitle").textContent = data.title || "作業要領書";
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

    // 文書ヘッダ（帳票風）
    html += '<section class="doc-head">' +
      '<div class="doc-title"><span class="kind">作業要領書</span><span class="name">' + esc(m.title) + '</span></div>' +
      '<table class="info-table"><tbody>' +
        row2("文書番号", m.docNo, "改訂", m.revision) +
        row2("工程", m.process, "ライン", m.line) +
        row2("品番・品名", m.product, "区分", m.category) +
        row2("制定日", m.issued, "改訂日", m.updated) +
        (m.purpose ? '<tr><th>目的</th><td colspan="3">' + esc(m.purpose) + '</td></tr>' : '') +
      '</tbody></table>' +
      '<div class="stamps">' +
        stamp("承認", m.approver) + stamp("確認", m.checker) + stamp("作成", m.author) +
      '</div>' +
    '</section>';

    // 準備（保護具・道具・注意）
    var prep = "";
    if ((m.cautions || []).length) prep += '<div class="box safety"><h3>⚠ 安全上の注意</h3>' + list(m.cautions) + '</div>';
    if ((m.ppe || []).length) prep += '<div class="box"><h3>保護具</h3>' + list(m.ppe) + '</div>';
    if ((m.tools || []).length) prep += '<div class="box"><h3>使用する設備・治工具</h3>' + list(m.tools) + '</div>';
    if ((m.materials || []).length) prep += '<div class="box"><h3>使用部品・材料</h3>' + list(m.materials) + '</div>';
    if (prep) html += '<section class="section"><h2>作業前の準備</h2><div class="prep">' + prep + '</div></section>';

    // 作業手順
    html += '<section class="section"><h2 class="steps-head">作業手順 <span class="no-print hint">（行をタップすると動画を再生します）</span>' +
      (steps.length ? '<button type="button" class="btn primary small no-print" id="stepMode">▶ 手順を 1 つずつ見る</button>' : '') + '</h2>' +
      '<table class="steps"><thead><tr>' +
        '<th class="col-no">No.</th><th>主なステップ（何を）</th><th>急所（どのように）／理由</th>' +
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
          (p.reason ? '<span class="reason">理由：' + esc(p.reason) + '</span>' : '') +
        '</li>';
      }).join("");

      html += '<tr class="step-row' + (stepPl >= 0 ? ' has-video' : '') + '" id="step-' + si + '"' +
        (stepPl >= 0 ? ' data-pl="' + stepPl + '"' : '') + '>' +
        '<td class="col-no">' + (si + 1) + '</td>' +
        '<td data-label="主なステップ">' +
          '<div class="step-title">' + esc(s.title) + '</div>' +
          (s.detail ? '<div class="step-detail">' + esc(s.detail) + '</div>' : '') +
          (s.image ? '<img class="step-image" loading="lazy" decoding="async" src="' + esc(s.image) + '" alt="写真（タップで拡大）" title="タップで拡大" onerror="this.style.display=\'none\'">' : '') +
        '</td>' +
        '<td data-label="急所／理由">' + (points ? '<ul class="points">' + points + '</ul>' : '') + '</td>' +
        (showTime ? '<td class="col-time" data-label="標準時間">' + (s.time ? esc(s.time) + ' 秒' : '') + '</td>' : '') +
        '<td class="col-video">' +
          (stepPl >= 0
            ? '<button type="button" class="play-btn" data-pl="' + stepPl + '"><span class="icon">▶</span>動画' +
              (s.video.end != null && s.video.end !== "" ? '<br><small>' + segLabel(s.video) + '</small>' : '') + '</button>'
            : '<span class="no-video">動画なし</span>') +
        '</td>' +
      '</tr>';
    });
    html += '</tbody></table></section>';

    // 改訂履歴
    if ((m.revisions || []).length) {
      html += '<section class="section"><h2>改訂履歴</h2><table class="rev-table"><thead><tr>' +
        '<th>改訂</th><th>日付</th><th>内容</th><th>担当</th></tr></thead><tbody>' +
        m.revisions.map(function (r) {
          return '<tr><td>' + esc(r.rev) + '</td><td>' + esc(r.date) + '</td><td>' + esc(r.content) + '</td><td>' + esc(r.by) + '</td></tr>';
        }).join("") + '</tbody></table></section>';
    }

    docEl.innerHTML = html;
  }

  function row2(a, av, b, bv) {
    return '<tr><th>' + a + '</th><td>' + esc(av) + '</td><th>' + b + '</th><td>' + esc(bv) + '</td></tr>';
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
    if (t.id === "stepMode") { openPlayer(0); return; }
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

    pNo.textContent = "手順 " + (item.step + 1) + " / " + manual.steps.length + (point ? "　急所" : "");
    pName.textContent = point ? point.text : step.title;

    var pts = point ? [point] : (step.points || []);
    pPoints.innerHTML = pts.length ? '<ul class="points">' + pts.map(function (p) {
      return '<li>' + (p.kind && WI.KIND_LABEL[p.kind] ? '<span class="kind ' + esc(p.kind) + '">' + WI.KIND_LABEL[p.kind] + '</span>' : '') +
        esc(p.text) + (p.reason ? '<span class="reason">理由：' + esc(p.reason) + '</span>' : '') + '</li>';
    }).join("") + '</ul>' : "";

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

    // 動画の無い手順: 写真（無ければ説明）を大きく表示
    if (!item.video) {
      video.pause();
      video.hidden = true;
      pStill.hidden = false;
      pStill.innerHTML = step.image
        ? '<img src="' + esc(step.image) + '" alt="" title="タップで拡大">'
        : '<div class="still-text"><b>' + esc(step.title) + '</b>' + (step.detail ? '<p>' + esc(step.detail) + '</p>' : '') + '</div>';
      pTime.textContent = "";
      pPlay.disabled = true;
      document.getElementById("pRestart").disabled = true;
      (pNext.disabled ? pClose : pNext).focus(); // → キー・Enter で次へ
      return;
    }
    video.hidden = false;
    pStill.hidden = true;
    pStill.innerHTML = "";
    pPlay.disabled = false;
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
  video.addEventListener("play", function () { pPlay.textContent = "❚❚ 停止"; hideMsg(); });
  video.addEventListener("pause", function () { pPlay.textContent = "▶ 再生"; });

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
