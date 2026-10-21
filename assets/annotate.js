/* =========================================================
   写真・画面コピーへの書き込み（「ここをクリック」の説明用）
   - ① 番号 / □ 囲み / → 矢印 / 文字 を赤で書き込み、PNG にして保存
   - 書き込みの内容は残しておき、後から直せる
   - 大きな画像は幅 1600px までに縮小（低スペック PC でも軽く表示できるように）
   ========================================================= */
(function () {
  "use strict";
  var MAX_W = 1600;
  var COLORS = { red: "#e0201b", blue: "#1f6fd1" };

  var dlg, canvas, ctx, img, shapes, tool, color, drag, done, hintEl;

  function build() {
    dlg = document.createElement("div");
    dlg.className = "player";
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    dlg.innerHTML =
      '<div class="player-head"><div class="label"><div class="step-name">写真に書き込み</div>' +
        '<div class="step-no" id="anHint"></div></div>' +
        '<button type="button" class="btn on-navy" data-an="cancel">✕ やめる</button></div>' +
      '<div class="player-ctrl an-tools">' +
        '<button type="button" class="btn on-navy" data-tool="num">① 番号</button>' +
        '<button type="button" class="btn on-navy" data-tool="rect">□ 囲み</button>' +
        '<button type="button" class="btn on-navy" data-tool="arrow">→ 矢印</button>' +
        '<button type="button" class="btn on-navy" data-tool="text">あ 文字</button>' +
        '<span class="group">' +
          '<button type="button" class="btn on-navy small an-color" data-color="red"><span style="color:' + COLORS.red + '">●</span> 赤</button>' +
          '<button type="button" class="btn on-navy small an-color" data-color="blue"><span style="color:' + COLORS.blue + '">●</span> 青</button>' +
        '</span>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn on-navy small" data-an="undo">↶ 1つ戻す</button>' +
        '<button type="button" class="btn on-navy small" data-an="clear">全部消す</button>' +
      '</div>' +
      '<div class="player-body an-body"><canvas></canvas></div>' +
      '<div class="player-ctrl"><span class="hint" style="color:#fff">画面の説明は「① をクリック」のように、手順の急所に番号で書くと分かりやすくなります。</span>' +
        '<span class="spacer"></span><button type="button" class="btn primary" data-an="ok" style="border-color:#fff">完了</button></div>';
    document.body.appendChild(dlg);
    canvas = dlg.querySelector("canvas");
    ctx = canvas.getContext("2d");
    hintEl = dlg.querySelector("#anHint");

    dlg.addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-tool")) { setTool(b.getAttribute("data-tool")); return; }
      if (b.hasAttribute("data-color")) { setColor(b.getAttribute("data-color")); return; }
      var a = b.getAttribute("data-an");
      if (a === "cancel") close();
      else if (a === "undo") { shapes.pop(); draw(); }
      else if (a === "clear") { if (!shapes.length || confirm("書き込みを全部消しますか？")) { shapes = []; draw(); } }
      else if (a === "ok") finish();
    });

    canvas.addEventListener("pointerdown", function (ev) {
      var p = pos(ev);
      if (tool === "num") {
        var n = shapes.filter(function (s) { return s.t === "num"; }).length + 1;
        shapes.push({ t: "num", x: p.x, y: p.y, n: n, c: color });
        draw();
      } else if (tool === "text") {
        var s = prompt("書き込む文字（例：ここをクリック）");
        if (s) { shapes.push({ t: "text", x: p.x, y: p.y, s: s, c: color }); draw(); }
      } else {
        drag = { t: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, c: color };
        canvas.setPointerCapture(ev.pointerId);
      }
    });
    canvas.addEventListener("pointermove", function (ev) {
      if (!drag) return;
      var p = pos(ev);
      drag.x2 = p.x; drag.y2 = p.y;
      draw(drag);
    });
    canvas.addEventListener("pointerup", function () {
      if (!drag) return;
      // 小さすぎるもの（ただのクリック）は無視
      if (Math.abs(drag.x2 - drag.x1) + Math.abs(drag.y2 - drag.y1) > 0.01) shapes.push(drag);
      drag = null;
      draw();
    });
    document.addEventListener("keydown", function (ev) {
      if (!dlg.classList.contains("open")) return;
      if (ev.key === "Escape") close();
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "z") { ev.preventDefault(); shapes.pop(); draw(); }
    });
  }

  var HINTS = {
    num: "クリックした所に ①②③… を順に置きます",
    rect: "ドラッグして囲みます（ボタンや入力欄を囲む）",
    arrow: "矢印の根元から先へドラッグします",
    text: "クリックした所に文字を書き込みます"
  };
  function setTool(t) {
    tool = t;
    Array.prototype.forEach.call(dlg.querySelectorAll("[data-tool]"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-tool") === t);
    });
    hintEl.textContent = HINTS[t];
    canvas.style.cursor = "crosshair";
  }
  function setColor(c) {
    color = c;
    Array.prototype.forEach.call(dlg.querySelectorAll("[data-color]"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-color") === c);
    });
  }

  // 画面上の位置 → 画像に対する割合（0〜1）。画像の大きさが変わっても位置がずれない
  function pos(ev) {
    var r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
  }

  function draw(extra) {
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    var u = Math.max(W, H) / 100; // 線の太さ・文字の大きさの基準
    shapes.concat(extra ? [extra] : []).forEach(function (s) { drawShape(s, W, H, u); });
  }

  function drawShape(s, W, H, u) {
    var col = COLORS[s.c] || COLORS.red;
    var lw = Math.max(3, u * 0.5);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (s.t === "rect") {
      var x = Math.min(s.x1, s.x2) * W, y = Math.min(s.y1, s.y2) * H;
      var w = Math.abs(s.x2 - s.x1) * W, h = Math.abs(s.y2 - s.y1) * H;
      outline(function () { roundRect(x, y, w, h, lw * 2); ctx.stroke(); }, col, lw);
    } else if (s.t === "arrow") {
      var x1 = s.x1 * W, y1 = s.y1 * H, x2 = s.x2 * W, y2 = s.y2 * H;
      var a = Math.atan2(y2 - y1, x2 - x1), hl = Math.max(14, u * 3);
      outline(function () {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2 - Math.cos(a) * hl * 0.6, y2 - Math.sin(a) * hl * 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - hl * Math.cos(a - 0.45), y2 - hl * Math.sin(a - 0.45));
        ctx.lineTo(x2 - hl * Math.cos(a + 0.45), y2 - hl * Math.sin(a + 0.45));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }, col, lw);
    } else if (s.t === "num") {
      var r = Math.max(14, u * 2.2), cx = s.x * W, cy = s.y * H;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = Math.max(2, r * 0.15);
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold " + Math.round(r * 1.2) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(s.n), cx, cy + r * 0.05);
    } else if (s.t === "text") {
      var fs = Math.max(16, u * 3);
      ctx.font = "bold " + Math.round(fs) + 'px "Meiryo UI", "Meiryo", "Yu Gothic UI", sans-serif';
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(4, fs * 0.25);
      ctx.strokeStyle = "#fff";
      ctx.strokeText(s.s, s.x * W, s.y * H);
      ctx.fillStyle = col;
      ctx.fillText(s.s, s.x * W, s.y * H);
    }
  }

  // 白いふち取りをしてから色で描く（どんな背景でも見やすい）
  function outline(path, col, lw) {
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    ctx.lineWidth = lw + 4;
    path();
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = lw;
    path();
  }
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // opt: { url: 元画像の URL, shapes: 前回の書き込み, onDone(blob, shapes) }
  function open(opt) {
    if (!dlg) build();
    done = opt.onDone;
    shapes = (opt.shapes || []).map(function (s) { return JSON.parse(JSON.stringify(s)); });
    img = new Image();
    img.onload = function () {
      var scale = Math.min(1, MAX_W / img.naturalWidth);
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      setTool(tool || "rect");
      setColor(color || "red");
      dlg.classList.add("open");
      document.body.style.overflow = "hidden";
      draw();
    };
    img.onerror = function () { alert("画像を読み込めません。写真を「選ぶ」から選び直してください。"); };
    img.src = opt.url;
  }

  function close() {
    dlg.classList.remove("open");
    document.body.style.overflow = "";
  }

  function finish() {
    draw();
    try {
      canvas.toBlob(function (blob) {
        close();
        if (blob) done(blob, shapes);
      }, "image/png");
    } catch (e) {
      alert("この画像には書き込めません。写真を「選ぶ」から選び直してから、もう一度書き込んでください。");
    }
  }

  window.WIAnnotate = { open: open };
})();
