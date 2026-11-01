/* =========================================================
   はじめての案内（ホーム画面）
   - 最初に開いたときだけ自動で出る（「▶ はじめての案内」でいつでも開ける）
   - 見るだけの人：準備なし。見本を開く／この PC を作業者用にする
   - 作る人：① ブラウザの確認 → ② 保存先のフォルダを選ぶ（絵つき）→ ③ 見本を見て作り始める
   ========================================================= */
(function () {
  "use strict";
  var esc = WI.esc;
  var KEY = "wi.welcome";
  var box = null, page = "role", folderName = "", folderErr = "";

  function sample() {
    var f = (window.CATALOG && window.CATALOG.files) || [];
    return f.filter(function (x) { return /^sample-/.test(x); })[0] || f[0] || "";
  }
  function done() { try { localStorage.setItem(KEY, "done"); } catch (e) {} }

  function open(p) {
    page = p || "role";
    if (!box) {
      box = document.createElement("div");
      box.className = "folder-guide welcome";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-labelledby", "wlTitle");
      box.addEventListener("click", onClick);
      document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && box && box.parentNode) close(); });
    }
    if (!box.parentNode) document.body.appendChild(box);
    draw();
  }
  function close() {
    done();
    if (box && box.parentNode) box.remove();
  }

  function dots(n) {
    var names = ["ブラウザの確認", "保存先のフォルダ", "作ってみる"];
    return '<ol class="wl-dots">' + names.map(function (t, i) {
      return '<li class="' + (i + 1 < n ? "done" : i + 1 === n ? "now" : "") + '"><span>' + (i + 1 < n ? "✓" : i + 1) + '</span>' + t + '</li>';
    }).join("") + '</ol>';
  }
  function nav(back, next, nextLabel) {
    return '<div class="actions">' +
      (back ? '<button type="button" class="btn" data-w="' + back + '">◀ もどる</button>' : '') +
      '<span style="flex:1"></span>' +
      '<button type="button" class="btn" data-w="close">あとで</button>' +
      (next ? '<button type="button" class="btn primary" data-w="' + next + '">' + (nextLabel || "次へ ▶") + '</button>' : '') +
    '</div>';
  }

  function draw() {
    var smp = sample();
    var h = '<div class="folder-guide-box welcome-box">';
    if (page === "role") {
      h += '<h2 id="wlTitle">ようこそ</h2>' +
        '<p>手順をタップすると、動画や写真で作業が見られる要領書です。<b>インターネットにつながなくても使えます。</b></p>' +
        '<p>どちらで使いますか？</p>' +
        '<div class="wl-roles">' +
          '<button type="button" data-w="see"><span class="ic">👀</span><b>見るだけ</b><small>作業をする人。準備はいりません</small></button>' +
          '<button type="button" data-w="make1"><span class="ic">✎</span><b>作る・直す</b><small>要領書を作る・管理する人。3 つの準備をします（約 2 分）</small></button>' +
        '</div>' + nav("", "", "");
    } else if (page === "see") {
      h += '<h2 id="wlTitle">見るだけなら、準備はいりません</h2>' +
        '<ol class="wl-list">' +
          '<li><b>見本の要領書を開いてみる</b><br><span class="hint">手順の行をタップすると、動画や写真が大きく出ます。「▶ 順に見る」で最初から順番に見られます。</span>' +
            (smp ? '<br><a class="btn primary" href="manual.html?file=' + encodeURIComponent(smp) + '" data-w="done">見本を開く</a>' : '') + '</li>' +
          '<li><b>この PC で作業者が見るなら</b><br><span class="hint">「作業者用」にすると、次から大きなボタンだけの画面（ライン → 工程 → 作業を押すだけ）が開きます。</span>' +
            '<br><button type="button" class="btn" data-w="worker">この PC を作業者用にする</button></li>' +
        '</ol>' + nav("role", "close", "はじめる");
    } else if (page === "make1") {
      var ok = !!window.showDirectoryPicker;
      h += '<h2 id="wlTitle">作るための準備</h2>' + dots(1) +
        (ok ? '<div class="wl-ok">✓ Chrome か Edge で開いています。このまま作れます。</div>'
          : '<div class="notice error"><b>このブラウザでは、要領書を保存できません。</b><br>この画面を <b>Chrome</b> か <b>Edge</b> で開き直してください（index.html を右クリック →「プログラムから開く」→ Chrome / Edge）。<br><small>見るだけなら、このままで使えます。</small></div>') +
        nav("role", ok ? "make2" : "", "次へ ▶");
    } else if (page === "make2") {
      h += '<h2 id="wlTitle">保存先のフォルダを選ぶ</h2>' + dots(2) +
        (folderName ? '<div class="wl-ok">✓ 「' + esc(folderName) + '」を保存先にしました。次からは選ぶ必要はありません。</div>'
          : WIFolder.guideBody() +
            (folderErr ? '<div class="notice error">' + folderErr + '</div>' : '') +
            '<p class="center"><button type="button" class="btn primary wl-pick" data-w="pick">📁 フォルダを選ぶ</button></p>' +
            '<p class="hint center">今は選ばなくても大丈夫です（初めて保存するときに、同じ案内が出ます）。</p>') +
        nav("make1", "make3", folderName ? "次へ ▶" : "あとで選ぶ ▶");
    } else if (page === "make3") {
      h += '<h2 id="wlTitle">作ってみましょう</h2>' + dots(3) +
        '<div class="wl-tip"><b>💡 動画は無くても完成です。</b><br>まずは<b>写真と文字だけ</b>で作って、作業者に見てもらいましょう。動画は、動きが大事な手順だけ、あとから足せば十分です（動画の無い手順は、写真か文字が大きく出ます）。</div>' +
        '<div class="wl-roles three">' +
          (smp ? '<a href="manual.html?file=' + encodeURIComponent(smp) + '" data-w="done"><span class="ic">👀</span><b>見本を見る</b><small>出来上がりのイメージ</small></a>' : '') +
          '<a href="bulk.html" data-w="done"><span class="ic">📊</span><b>Excel から取り込む</b><small>今の紙の要領書をそのまま</small></a>' +
          '<a href="editor.html" data-w="done"><span class="ic">＋</span><b>新しく作る</b><small>1 つずつ順番に入力</small></a>' +
        '</div>' + nav("make2", "close", "閉じる");
    }
    h += '</div>';
    box.innerHTML = h;
    var f = box.querySelector(".btn.primary, .wl-roles button");
    if (f) f.focus();
  }

  function onClick(ev) {
    var t = ev.target.closest("[data-w]");
    if (!t) { if (ev.target === box) close(); return; }
    var w = t.getAttribute("data-w");
    if (w === "done") { done(); return; } // リンクはそのまま開く
    ev.preventDefault();
    if (w === "close") { close(); return; }
    if (w === "worker") {
      done();
      var b = document.getElementById("workerOn");
      if (b) b.click(); else { try { localStorage.setItem("wi.mode", "worker"); } catch (e) {} location.href = "easy.html"; }
      return;
    }
    if (w === "pick") {
      folderErr = "";
      WIFolder.getRoot({ noGuide: true }).then(function (d) {
        folderName = d.name;
        draw();
      }, function (e) {
        if (e && e.name === "AbortError") return;
        folderErr = e && e.name === "NotAllowedError"
          ? "フォルダが許可されませんでした。もう一度「フォルダを選ぶ」を押して、確認が出たら「<b>ファイルを表示</b>」「<b>ファイルを編集</b>」を押してください。"
          : esc(WIFolder.errorMessage(e));
        draw();
      });
      return;
    }
    open(w);
  }

  var btn = document.getElementById("welcomeOpen");
  if (btn) btn.addEventListener("click", function () { open("role"); });
  var first = true;
  try { first = !localStorage.getItem(KEY) && localStorage.getItem("wi.mode") !== "worker"; } catch (e) {}
  if (first) open("role");

  window.WIWelcome = { open: open };
})();
