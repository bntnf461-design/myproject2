/* =========================================================
   印刷（A4 に整える）
   - 「印刷」で用紙の向き・1 枚に収める・写真を入れるかを選んでから印刷する
   - 1 枚に収める：印刷の形にしたときの高さを測り、用紙の高さに収まるように全体を縮める
   - Ctrl＋P で直接印刷したときも、前に選んだ設定で整える
   ========================================================= */
(function () {
  "use strict";
  var MM = 96 / 25.4;      // 1mm = 約 3.78px
  var MARGIN = 8;          // 用紙の余白（mm）
  var MIN_ZOOM = 0.5;      // これより小さくすると読めないので、それ以上は 2 枚目に回す
  var PAPER = { landscape: { w: 297, h: 210 }, portrait: { w: 210, h: 297 } };

  var opt = { orient: "landscape", fit: true, photo: true, mark: true };
  try { var saved = JSON.parse(localStorage.getItem("wi.print") || "null"); if (saved) for (var k in saved) opt[k] = saved[k]; } catch (e) {}

  var html = document.documentElement;
  var pageStyle = document.createElement("style");
  document.head.appendChild(pageStyle);

  function paperEl() { return document.querySelector(".paper"); }

  // 印刷の形にする（画面のままで測れるように、クラスで切り替える）
  function apply() {
    var p = PAPER[opt.orient];
    html.classList.add("printing");
    html.classList.toggle("print-nophoto", !opt.photo);
    html.classList.toggle("print-nomark", !opt.mark);
    html.style.setProperty("--print-w", ((p.w - MARGIN * 2) * MM) + "px");
    pageStyle.textContent = "@page { size: A4 " + opt.orient + "; margin: " + MARGIN + "mm; }";
    var el = paperEl();
    if (!el) return { pages: 0, zoom: 1 };
    var W = (p.w - MARGIN * 2) * MM;
    var avail = (p.h - MARGIN * 2) * MM - 4; // 少し余裕を持たせる
    // z の大きさにしたときの、紙の上での高さ（縮めた分だけ幅を広げて、用紙の幅いっぱいに使う）
    function heightAt(z) {
      el.style.zoom = z === 1 ? "" : z;
      el.style.width = z === 1 ? "" : (W / z) + "px";
      return el.getBoundingClientRect().height;
    }
    var h1 = heightAt(1);
    var pages = Math.max(1, Math.ceil(h1 / avail));
    var zoom = 1;
    if (opt.fit && h1 > avail) {
      // 収まるいちばん大きい倍率を探す
      var lo = MIN_ZOOM, hi = 1;
      if (heightAt(lo) > avail) { zoom = lo; }
      else {
        for (var i = 0; i < 8; i++) {
          var mid = (lo + hi) / 2;
          if (heightAt(mid) <= avail) lo = mid; else hi = mid;
        }
        zoom = lo;
      }
    }
    var hz = heightAt(zoom);
    return { pages: pages, zoom: zoom, after: Math.max(1, Math.ceil(hz / avail)) };
  }
  function clear() {
    html.classList.remove("printing", "print-nophoto", "print-nomark");
    var el = paperEl();
    if (el) { el.style.zoom = ""; el.style.width = ""; }
  }

  // Ctrl＋P などで直接印刷したときも整える
  window.addEventListener("beforeprint", function () { if (!html.classList.contains("printing")) apply(); });
  window.addEventListener("afterprint", clear);

  // ---------- 印刷の設定 ----------
  var dlg = document.createElement("div");
  dlg.className = "print-dlg";
  dlg.innerHTML = '<div class="print-box" role="dialog" aria-modal="true" aria-label="印刷">' +
    '<h2>印刷</h2>' +
    '<div class="print-row"><b>用紙</b>' +
      '<label><input type="radio" name="pOrient" value="landscape"> A4 横</label>' +
      '<label><input type="radio" name="pOrient" value="portrait"> A4 縦</label></div>' +
    '<label class="print-chk"><input type="checkbox" data-o="fit"> 1 枚に収める（入りきらないときは全体を縮める）</label>' +
    '<label class="print-chk"><input type="checkbox" data-o="photo"> 写真を入れる</label>' +
    '<label class="print-chk"><input type="checkbox" data-o="mark"> 改訂したところの黄色の印を入れる</label>' +
    '<p class="print-info" id="printInfo"></p>' +
    '<div class="print-btns"><button type="button" class="btn" data-p="cancel">やめる</button>' +
      '<button type="button" class="btn primary" data-p="go">🖨 印刷する</button></div>' +
    '<p class="hint">印刷の画面で「余白」を「既定」、「倍率」を「100」にしてください。「背景のグラフィック」に✓を入れると、見出しの色も印刷されます。</p>' +
  '</div>';
  document.body.appendChild(dlg);

  function sync() {
    Array.prototype.forEach.call(dlg.querySelectorAll('[name="pOrient"]'), function (r) { r.checked = r.value === opt.orient; });
    Array.prototype.forEach.call(dlg.querySelectorAll("[data-o]"), function (c) { c.checked = !!opt[c.getAttribute("data-o")]; });
    // 今の設定で何枚になるか
    var r = apply();
    clear();
    var info = dlg.querySelector("#printInfo");
    if (!r.pages) { info.textContent = ""; return; }
    if (r.pages === 1) info.innerHTML = "A4 " + (opt.orient === "landscape" ? "横" : "縦") + " <b>1 枚</b>に収まります。";
    else if (opt.fit) info.innerHTML = "そのままだと " + r.pages + " 枚 → <b>" + r.after + " 枚</b>" + "（文字の大きさ 約 " + Math.round(r.zoom * 100) + "%）" +
      (r.after > 1 ? "<br><small>これ以上縮めると読めないため、" + r.after + " 枚になります。「写真を入れる」を外すか、用紙を変えると枚数が減ります。</small>" : "");
    else info.innerHTML = "A4 " + (opt.orient === "landscape" ? "横" : "縦") + " <b>" + r.pages + " 枚</b>になります。";
    // もう一方の向きの方が大きく印刷できるなら知らせる
    if (opt.fit && r.zoom < 0.95) {
      var mine = opt.orient, other = mine === "landscape" ? "portrait" : "landscape";
      opt.orient = other;
      var r2 = apply();
      clear();
      opt.orient = mine;
      if (r2.after <= r.after && r2.zoom > r.zoom + 0.05) {
        info.innerHTML += '<br><small>A4 ' + (other === "landscape" ? "横" : "縦") + 'にすると、文字の大きさ 約 ' + Math.round(r2.zoom * 100) + '% で印刷できます。</small> ' +
          '<button type="button" class="btn small" data-p="flip" data-v="' + other + '">A4 ' + (other === "landscape" ? "横" : "縦") + 'にする</button>';
      }
    }
  }
  function save() { try { localStorage.setItem("wi.print", JSON.stringify(opt)); } catch (e) {} }

  dlg.addEventListener("change", function (ev) {
    var t = ev.target;
    if (t.name === "pOrient") opt.orient = t.value;
    else if (t.hasAttribute("data-o")) opt[t.getAttribute("data-o")] = t.checked;
    save();
    sync();
  });
  dlg.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-p]");
    if (ev.target === dlg || (b && b.getAttribute("data-p") === "cancel")) { dlg.classList.remove("open"); return; }
    if (b && b.getAttribute("data-p") === "flip") { opt.orient = b.getAttribute("data-v"); save(); sync(); return; }
    if (b && b.getAttribute("data-p") === "go") {
      dlg.classList.remove("open");
      apply();
      setTimeout(function () { window.print(); }, 50);
    }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && dlg.classList.contains("open")) { ev.stopImmediatePropagation(); dlg.classList.remove("open"); }
  }, true);

  window.WIPrint = {
    open: function () { dlg.classList.add("open"); sync(); },
    apply: apply, clear: clear, opt: opt
  };
  var btn = document.getElementById("printBtn");
  if (btn) btn.addEventListener("click", function () { window.WIPrint.open(); });
})();
