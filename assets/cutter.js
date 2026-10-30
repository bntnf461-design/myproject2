/* =========================================================
   動画を手順に分ける（1 本撮りの動画 → 手順ごとの区間）
   - 作業を最初から最後まで 1 本で撮り、見ながら手順の切れ目で「区切る」を押すだけ
   - 動画ファイルそのものは切らない（開始・終了の時間だけを記録）ので、PC の性能に左右されない
   WICutter.open({ steps, src, srcs, url(src), pick(cb), apply(result) })
   ========================================================= */
(function () {
  "use strict";
  var esc = WI.esc;

  // 0.1 秒単位で記録（1:05.3）。整数ならこれまでどおり 1:05
  function fmt(sec) {
    if (sec == null || isNaN(sec)) return "";
    sec = Math.max(0, Math.round(sec * 10) / 10);
    var m = Math.floor(sec / 60), s = sec - m * 60;
    var ss = (Math.round(s * 10) % 10 === 0) ? String(Math.round(s)) : s.toFixed(1);
    if (s < 10) ss = "0" + ss;
    return m + ":" + ss;
  }
  function dur(a, b) { return Math.max(0, Math.round((b - a) * 10) / 10); }

  var el, video, opt, segs, cur, src, history, stopAt, duration;

  function build() {
    el = document.createElement("div");
    el.className = "sheet-dialog cutter";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.innerHTML =
      '<div class="player-head">' +
        '<div class="label"><div class="step-name">動画を手順に分ける</div>' +
        '<div class="step-no" id="cutSrc"></div></div>' +
        '<label class="field cut-src"><span>使う動画</span><select id="cutSel"></select></label>' +
        '<button type="button" class="btn on-navy" id="cutPick">別の動画を選ぶ</button>' +
        '<button type="button" class="btn on-navy" id="cutClose">✕ やめる</button>' +
      '</div>' +
      '<div class="cut-body">' +
        '<div class="cut-main">' +
          '<div class="cut-video"><video id="cutPlayer" playsinline preload="metadata" disablepictureinpicture></video>' +
            '<div class="cut-empty" id="cutEmpty">右上の「別の動画を選ぶ」から、作業を撮った動画を選んでください。</div></div>' +
          '<div class="cut-now" id="cutNow"></div>' +
          '<div class="cut-line" id="cutLine" title="押した位置に移動"><div class="cut-segs" id="cutSegs"></div><div class="cut-head" id="cutHead"></div></div>' +
          '<div class="cut-time"><span id="cutPos">0:00</span><span id="cutDur"></span></div>' +
          '<div class="cut-ctrl">' +
            '<button type="button" class="tbtn" data-seek="-5" title="5 秒戻る (Shift+←)">« 5秒</button>' +
            '<button type="button" class="tbtn" data-seek="-1" title="1 秒戻る (←)">‹ 1秒</button>' +
            '<button type="button" class="tbtn play" id="cutPlay" title="再生／一時停止 (Space)">▶ 再生</button>' +
            '<button type="button" class="tbtn" data-seek="1" title="1 秒進む (→)">1秒 ›</button>' +
            '<button type="button" class="tbtn" data-seek="5" title="5 秒進む (Shift+→)">5秒 »</button>' +
            '<span class="group" role="group" aria-label="再生速度">' +
              '<button type="button" class="tbtn" data-rate="1">標準</button>' +
              '<button type="button" class="tbtn" data-rate="2">2倍速</button>' +
            '</span>' +
          '</div>' +
          '<div class="cut-actions">' +
            '<button type="button" class="btn" id="cutStart" title="今の位置から、この手順を始める (S)">⇤ ここから開始</button>' +
            '<button type="button" class="btn primary-inv big" id="cutMark" title="今の位置で区切って、次の手順へ (Enter)"></button>' +
            '<button type="button" class="btn" id="cutUndo" title="1 つ前に戻す (Ctrl+Z)">↶ 元に戻す</button>' +
          '</div>' +
          '<p class="hint cut-help">使い方：▶ 再生して、手順が終わったところで<b>「区切る」</b>（Enter キー）を押すだけ。押すたびに次の手順へ進みます。' +
            '手順の間の不要な部分は、次の手順の始まりで<b>「ここから開始」</b>（S キー）を押すと飛ばせます。区切りの線は、ドラッグで前後に動かせます。</p>' +
        '</div>' +
        '<div class="cut-side"><div class="cut-side-head">手順と区間</div><ol class="cut-list" id="cutList"></ol></div>' +
      '</div>' +
      '<div class="player-ctrl">' +
        '<span class="seg-info" id="cutSum"></span>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn primary-inv" id="cutApply">この区切りで反映する</button>' +
      '</div>';
    document.body.appendChild(el);
    video = el.querySelector("#cutPlayer");

    video.addEventListener("loadedmetadata", function () {
      duration = video.duration || 0;
      el.querySelector("#cutDur").textContent = fmt(duration);
      el.querySelector("#cutEmpty").hidden = true;
      render();
    });
    video.addEventListener("error", function () {
      if (!video.getAttribute("src")) return;
      var e = el.querySelector("#cutEmpty");
      e.hidden = false;
      e.innerHTML = "動画を開けません（" + esc(src) + "）。<br>videos フォルダにあるか確認するか、「別の動画を選ぶ」から選び直してください。";
    });
    video.addEventListener("timeupdate", function () {
      if (stopAt != null && video.currentTime >= stopAt) { video.pause(); stopAt = null; }
      tick();
    });
    video.addEventListener("play", tick);
    video.addEventListener("pause", tick);

    el.querySelector("#cutClose").addEventListener("click", function () {
      if (history.length && !confirm("区切った内容を反映せずに閉じますか？")) return;
      close();
    });
    el.querySelector("#cutPick").addEventListener("click", function () {
      opt.pick(function (s) { addSrc(s); setSrc(s); });
    });
    el.querySelector("#cutSel").addEventListener("change", function (ev) { setSrc(ev.target.value); });
    el.querySelector("#cutPlay").addEventListener("click", togglePlay);
    el.querySelector("#cutMark").addEventListener("click", mark);
    el.querySelector("#cutStart").addEventListener("click", startHere);
    el.querySelector("#cutUndo").addEventListener("click", undo);
    el.querySelector("#cutApply").addEventListener("click", apply);
    el.querySelector(".cut-ctrl").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-seek")) seek(video.currentTime + parseFloat(b.getAttribute("data-seek")));
      if (b.hasAttribute("data-rate")) { video.playbackRate = parseFloat(b.getAttribute("data-rate")); tick(); }
    });
    el.querySelector("#cutList").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-a]");
      var li = ev.target.closest("li[data-i]");
      if (!li) return;
      var i = +li.getAttribute("data-i");
      var a = b ? b.getAttribute("data-a") : "sel";
      if (a === "play" && segs[i]) {
        video.currentTime = segs[i].start;
        stopAt = segs[i].end;
        video.play();
      } else if (a === "clear") {
        save();
        segs[i] = null;
      } else {
        cur = i;
        if (segs[i]) seek(segs[i].start);
      }
      render();
    });

    // タイムライン：押した位置へ移動。区切りの線はドラッグで調整
    var line = el.querySelector("#cutLine");
    var drag = null;
    function timeAt(x) {
      var r = line.getBoundingClientRect();
      return Math.max(0, Math.min(duration, (x - r.left) / r.width * duration));
    }
    line.addEventListener("pointerdown", function (ev) {
      if (!duration) return;
      var h = ev.target.closest("[data-edge]");
      if (h) {
        save();
        var i = +h.getAttribute("data-i"), edge = h.getAttribute("data-edge");
        // 前後の手順と切れ目なく続いている区切りは、両方を一緒に動かす
        var a = edge === "end" ? segs[i] : segs[i - 1], b = edge === "end" ? segs[i + 1] : segs[i];
        drag = { a: a && a.end != null ? a : null, b: b && b.start != null ? b : null };
        if (drag.a && drag.b && Math.abs(drag.a.end - drag.b.start) > 0.05) {
          if (edge === "end") drag.b = null; else drag.a = null;
        }
        line.setPointerCapture(ev.pointerId);
        ev.preventDefault();
        return;
      }
      seek(timeAt(ev.clientX));
    });
    line.addEventListener("pointermove", function (ev) {
      if (!drag) return;
      var t = Math.round(timeAt(ev.clientX) * 10) / 10;
      var lo = drag.a ? drag.a.start + 0.2 : 0;
      var hi = drag.b ? (drag.b.end == null ? duration : drag.b.end) - 0.2 : duration;
      t = Math.max(lo, Math.min(hi, t));
      if (drag.a) drag.a.end = t;
      if (drag.b) drag.b.start = t;
      seek(t);
      render();
    });
    line.addEventListener("pointerup", function () { drag = null; });
    line.addEventListener("pointercancel", function () { drag = null; });

    document.addEventListener("keydown", function (ev) {
      if (!el.classList.contains("open")) return;
      var tag = (ev.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") return;
      if (ev.key === " ") { ev.preventDefault(); togglePlay(); }
      else if (ev.key === "Enter") { ev.preventDefault(); mark(); }
      else if (ev.key === "s" || ev.key === "S") { ev.preventDefault(); startHere(); }
      else if (ev.key === "ArrowLeft") { ev.preventDefault(); seek(video.currentTime - (ev.shiftKey ? 5 : 1)); }
      else if (ev.key === "ArrowRight") { ev.preventDefault(); seek(video.currentTime + (ev.shiftKey ? 5 : 1)); }
      else if ((ev.ctrlKey || ev.metaKey) && (ev.key === "z" || ev.key === "Z")) { ev.preventDefault(); undo(); }
      else if (ev.key === "Escape") { ev.stopImmediatePropagation(); el.querySelector("#cutClose").click(); }
    }, true);
  }

  function seek(t) {
    if (!duration) return;
    video.currentTime = Math.max(0, Math.min(duration, t));
    tick();
  }
  function togglePlay() {
    if (!duration) return;
    stopAt = null;
    if (video.paused) video.play(); else video.pause();
  }
  function save() { history.push({ segs: JSON.stringify(segs), cur: cur }); }
  function undo() {
    var h = history.pop();
    if (!h) return;
    segs = JSON.parse(h.segs);
    cur = h.cur;
    render();
  }

  // 今の位置で区切る：今の手順の終わり＝次の手順の始まり
  function mark() {
    if (!duration || cur >= segs.length) return;
    var t = Math.round(video.currentTime * 10) / 10;
    var startT = segs[cur] && segs[cur].start != null ? segs[cur].start : prevEnd(cur);
    if (t <= startT + 0.2) { flash("もう少し先まで再生してから押してください"); return; }
    save();
    segs[cur] = { start: startT, end: t };
    if (cur + 1 < segs.length) {
      // 次の手順は、ここから始まる（「ここから開始」で後から変えられる）
      var n = segs[cur + 1];
      if (!n || n.start < t) segs[cur + 1] = { start: t, end: n && n.end > t ? n.end : null };
    }
    cur++;
    render();
    if (cur >= segs.length) {
      // 最後の手順の終わりは動画の最後まで
      video.pause();
      flash("すべての手順を区切りました。下の「この区切りで反映する」を押してください");
    }
  }
  function startHere() {
    if (!duration || cur >= segs.length) return;
    var t = Math.round(video.currentTime * 10) / 10;
    save();
    var s = segs[cur];
    segs[cur] = { start: t, end: s && s.end > t ? s.end : null };
    render();
  }
  function prevEnd(i) {
    for (var k = i - 1; k >= 0; k--) if (segs[k] && segs[k].end != null) return segs[k].end;
    return 0;
  }
  function flash(t) {
    var n = el.querySelector("#cutNow");
    n.setAttribute("data-msg", t);
    n.classList.add("msg");
    clearTimeout(flash.t);
    flash.t = setTimeout(function () { n.classList.remove("msg"); }, 3500);
  }

  function tick() {
    var t = video.currentTime || 0;
    el.querySelector("#cutPos").textContent = fmt(t);
    el.querySelector("#cutHead").style.left = (duration ? t / duration * 100 : 0) + "%";
    el.querySelector("#cutPlay").textContent = video.paused ? "▶ 再生" : "❚❚ 一時停止";
    Array.prototype.forEach.call(el.querySelectorAll("[data-rate]"), function (b) {
      b.classList.toggle("active", parseFloat(b.getAttribute("data-rate")) === video.playbackRate);
    });
  }

  function render() {
    var steps = opt.steps;
    var done = cur >= segs.length;
    el.querySelector("#cutMark").innerHTML = done ? "✓ すべて区切りました"
      : "✂ ここまでが「手順 " + (cur + 1) + "」<small>" + esc(steps[cur].title || "") + "</small>";
    el.querySelector("#cutMark").disabled = done || !duration;
    el.querySelector("#cutStart").disabled = done || !duration;
    el.querySelector("#cutUndo").disabled = !history.length;
    el.querySelector("#cutNow").innerHTML = done ? "<b>すべての手順を区切りました</b>"
      : "いま区切っている手順：<b>手順 " + (cur + 1) + "</b>　" + esc(steps[cur].title || "");

    // タイムライン
    el.querySelector("#cutSegs").innerHTML = duration ? segs.map(function (s, i) {
      if (!s || s.start == null) return "";
      var e = s.end == null ? duration : s.end;
      return '<div class="cut-seg' + (i === cur ? " cur" : "") + (i % 2 ? " odd" : "") + '" style="left:' + (s.start / duration * 100) + '%;width:' + ((e - s.start) / duration * 100) + '%">' +
        '<span>' + (i + 1) + '</span>' +
        '<i class="edge s" data-edge="start" data-i="' + i + '"></i>' +
        (s.end != null ? '<i class="edge e" data-edge="end" data-i="' + i + '"></i>' : '') + '</div>';
    }).join("") : "";

    // 手順の一覧
    var count = 0;
    el.querySelector("#cutList").innerHTML = steps.map(function (st, i) {
      var s = segs[i];
      if (s && s.start != null) count++;
      var e = s ? (s.end == null ? duration : s.end) : null;
      return '<li data-i="' + i + '" class="' + (i === cur ? "cur" : "") + (s ? " has" : "") + '">' +
        '<div class="no">' + (i + 1) + '</div>' +
        '<div class="tx"><b>' + esc(st.title || "（名前なし）") + '</b>' +
          '<small>' + (s ? fmt(s.start) + " 〜 " + (s.end == null ? "最後まで" : fmt(s.end)) + (e != null ? "（" + dur(s.start, e) + " 秒）" : "") : "まだ区切っていません") + '</small></div>' +
        (s ? '<button type="button" class="tbtn" data-a="play" title="この区間を再生">▶</button><button type="button" class="tbtn" data-a="clear" title="この手順の区切りを消す">✕</button>' : '') +
      '</li>';
    }).join("");
    el.querySelector("#cutSum").textContent = count + " / " + steps.length + " 手順に区間を設定";
    var curLi = el.querySelector("#cutList li.cur");
    if (curLi && curLi.scrollIntoView) curLi.scrollIntoView({ block: "nearest" });
  }

  function addSrc(s) {
    if (opt.srcs.indexOf(s) === -1) opt.srcs.push(s);
    el.querySelector("#cutSel").innerHTML = opt.srcs.map(function (x) {
      return '<option value="' + esc(x) + '">' + esc(x.split("/").pop()) + '</option>';
    }).join("");
  }
  function setSrc(s) {
    src = s;
    el.querySelector("#cutSel").value = s;
    el.querySelector("#cutSrc").textContent = s;
    duration = 0;
    // この動画で設定済みの区間を読み込む
    segs = opt.steps.map(function (st) {
      var v = st.video || {};
      if (v.src !== s) return null;
      return { start: WI.parseTime(v.start) || 0, end: WI.parseTime(v.end) };
    });
    history = [];
    cur = 0;
    while (cur < segs.length && segs[cur]) cur++;
    if (cur >= segs.length) cur = 0;
    el.querySelector("#cutEmpty").hidden = false;
    el.querySelector("#cutEmpty").textContent = "動画を読み込み中…";
    video.src = opt.url(s);
    video.load();
    render();
  }

  function apply() {
    if (!src) { close(); return; }
    var result = segs.map(function (s) {
      if (!s || s.start == null) return null;
      var end = s.end;
      if (end != null && duration && end >= duration - 0.3) end = null; // 最後まで
      return { src: src, start: s.start ? fmt(s.start) : "", end: end == null ? "" : fmt(end) };
    });
    opt.apply(result, src);
    close();
  }

  function open(o) {
    if (!el) build();
    opt = o;
    opt.srcs = (o.srcs || []).slice();
    el.querySelector("#cutSel").innerHTML = "";
    opt.srcs.forEach(addSrc);
    el.classList.add("open");
    document.body.style.overflow = "hidden";
    history = [];
    segs = o.steps.map(function () { return null; });
    cur = 0;
    duration = 0;
    if (o.src) setSrc(o.src);
    else {
      src = "";
      el.querySelector("#cutSrc").textContent = "";
      el.querySelector("#cutEmpty").hidden = false;
      render();
    }
  }
  function close() {
    video.pause();
    video.removeAttribute("src");
    video.load();
    el.classList.remove("open");
    document.body.style.overflow = "";
  }

  window.WICutter = { open: open, fmt: fmt };
})();
