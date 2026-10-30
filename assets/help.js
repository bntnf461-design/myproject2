/* =========================================================
   「？ 困ったとき」ボタン
   - どの画面でも右上に出し、その画面でよくある困りごとと直し方を短く出す
   ========================================================= */
(function () {
  "use strict";
  var page = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  // [困りごと, 直し方（HTML）]
  var SEE = [
    ["動画が再生されない", "<ol><li>動画のファイルが <b>videos</b> フォルダに入っているか確認します。</li><li>スマホで撮った動画は、形式が合わないことがあります。<a href=\"guide.html\">動画の撮り方</a>の「すでに撮った動画が使えないとき」を見てください。</li></ol>"],
    ["動画がカクカクする・止まる", "<ol><li>ほかのアプリやブラウザのタブを閉じます。</li><li>スティック PC など力の弱い PC では、<b>720p・30fps</b> で撮った動画が軽く再生できます（リーダーに伝えてください）。</li><li>4K や HDR で撮った動画は重いので、<a href=\"guide.html\">動画の撮り方</a>の設定で撮り直してください。</li></ol>"],
    ["音が聞こえない", "<ol><li>PC の音量（画面右下のスピーカー）を上げます。</li><li>動画の左下のスピーカーの印に斜線が入っていたら、押して音を出します。</li><li>「読み上げ：オン」のときは、読み上げ中だけ動画の音を消しています。</li></ol>"],
    ["読み上げがしゃべらない", "<ol><li>「▶ 順に見る」の画面の右上が「🔊 読み上げ：オン」になっているか確認します。</li><li>PC の音量を上げます。</li><li>インドネシア語の声は、Windows の「設定 → 時刻と言語 → 音声」で追加すると使えます。</li></ol>"],
    ["文字が小さくて読みにくい", "画面の上の「<b>文字 大</b>」を押します。一度押すと、その PC ではそのままになります。<br>キーボードの <b>Ctrl</b> を押しながら <b>＋</b> でも、画面全体を大きくできます。"],
    ["インドネシア語で見たい", "要領書の画面の右上にある「<b>🌐 Bahasa Indonesia</b>」を押します。ボタンが無いときは、その要領書はまだ翻訳されていません（リーダーに頼んでください）。"]
  ];
  var MAKE_SAVE = ["保存できない", "<ol><li>下の「<b>フォルダに保存</b>」を押し、<b>index.html があるフォルダ</b>（sagyo-youryousho など）を選びます。manuals フォルダではありません。</li><li>「このフォルダへの書き込みを許可しますか」と出たら「<b>許可</b>」（ファイルを編集）を押します。</li><li>うまくいかないときは、Chrome か Edge で開いているか確認してください。</li></ol>"];
  var COMMON = [
    ["画面が固まった・古いまま", "キーボードの <b>F5</b> を押して、画面を読み直します。それでも直らないときは、ブラウザを閉じて開き直してください。"],
    ["前の画面に戻りたい", "画面の左上の「◀」のボタンを押します。ブラウザの「←」（戻る）でも戻れます。"]
  ];
  var HELP = {
    "easy.html": [
      ["作業が見つからない", "上から順に、ラインや工程の大きなボタンを押していきます。違うところを押したときは「<b>◀ もどる</b>」で戻れます。"],
      ["作る・直す画面に行きたい（リーダー）", "画面のいちばん下の「<b>リーダー・管理者の方へ</b>」を押します。"]
    ].concat(SEE),
    "index.html": [
      ["はじめに何をすればいい？", "「はじめての方へ」の 1〜4 を順番に進めます。Excel の要領書がある場合は、1 の「Excel の要領書を取り込む」から始めます。"],
      ["作業者が使う PC を、かんたんにしたい", "「<b>この PC を作業者用にする</b>」を押すと、その PC では最初に大きなボタンだけのかんたん画面が開きます。"],
      ["工場・課・工程の名前を変えたい", "右上の「<b>✎ 名前を変える</b>」を押します。"]
    ],
    "list.html": [
      ["要領書が見つからない", "<ol><li>上のラインや工程のボタンを押して絞り込みます。「すべて」で解除できます。</li><li>検索の欄に、作業名・番号・言葉の一部を入れても探せます（全角・半角は気にしなくて大丈夫です）。</li></ol>"],
      ["Excel の要領書が出てこない", "Excel はフォルダに置いただけでは出ません。メニューの「<b>Excel から取り込む</b>」で取り込んで保存してください。"]
    ],
    "manual.html": [
      ["動画を見たい", "手順の行のどこかを押すと、その手順の動画が出ます。「<b>▶ 順に見る</b>」で、最初から順番に見られます。"],
      ["黄色の印は何？", "前の版から<b>変わったところ</b>です。改訂されたところを確認してください。"]
    ].concat(SEE),
    "editor.html": [
      MAKE_SAVE,
      ["保存したのに一覧に出ない", "下の「保存先」に出ているフォルダが、いま開いているフォルダと違うかもしれません。「<b>変更</b>」を押して、index.html があるフォルダを選び直してください。"],
      ["写真を入れたい", "手順の「写真」を選んで「写真を選ぶ」。画面のコピー（<b>Win＋Shift＋S</b>）は、その手順の欄で <b>Ctrl＋V</b> で貼り付けられます。「✎ 書き込み」で丸や矢印も書けます。"],
      ["スマホの動画を PC に移したい", "USB ケーブルでつなぎ、動画をデスクトップにコピーしてから「選ぶ」で選びます。くわしくは<a href=\"guide.html#transfer\">動画の撮り方 → スマホの動画を PC に移す</a>。"],
      ["動画を付けたい", "作業を 1 本で撮り、「<b>🎬 動画を手順に分ける</b>」で、見ながら手順の切れ目で Enter を押すだけです。動画より写真や文字の方が分かりやすい手順は、「写真」「文字だけ」を選びます。"],
      ["入力の画面が分かりにくい", "上の「<b>かんたん入力</b>」にすると、1 画面に 1 つずつ順番に入力できます。"],
      ["途中で閉じてしまった", "入力中の内容はこの PC に自動で残っています。もう一度この画面を開くと、続きから始まります。"],
      ["間違えて保存・削除した", "前の内容は <b>manuals/_backup</b>（削除は <b>manuals/_trash</b>）に日時付きで残っています。リーダーに相談してください。"]
    ],
    "bulk.html": [
      ["Excel が読めない", "古い形式（.xls）は読めません。Excel で開いて「名前を付けて保存」→「<b>Excel ブック (.xlsx)</b>」で保存し直してください。"],
      ["「アップロードしますか」と出た", "「<b>アップロード</b>」を押して大丈夫です。インターネットには送られず、この PC の中だけで読み取ります。"],
      ["手順がうまく読み取れない", "エディタの「Excel 取り込み」で 1 つ開き、列の対応を直して「<b>この様式を覚える</b>」を押すと、次からは同じ様式を自動で読み取ります。"],
      MAKE_SAVE
    ],
    "settings.html": [
      ["名前や順番を変えたのに反映されない", "いちばん下の「<b>保存</b>」を押して、index.html があるフォルダを選んでください。"],
      ["読み上げの読み方がおかしい", "「読み方の辞書」に、言葉と読み方（ひらがな）を登録します。例：仮締め → かりじめ"],
      MAKE_SAVE
    ],
    "guide.html": [
      ["どの設定で撮ればいい？", "スマホは「<b>1080p・30fps</b>」「<b>互換性優先</b>（iPhone）」がおすすめです。この画面の上の表を見てください。"]
    ]
  };
  var list = (HELP[page] || []).concat(COMMON);

  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "help-btn";
  btn.textContent = "？ 困ったとき";
  btn.setAttribute("aria-haspopup", "dialog");
  var host = document.querySelector(".topbar .actions") || document.querySelector(".topbar") || document.querySelector(".easy-top");
  if (!host) return;
  if (host.classList.contains("actions")) host.insertBefore(btn, host.firstChild); else host.appendChild(btn);

  var panel = document.createElement("div");
  panel.className = "help-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "困ったとき");
  panel.innerHTML = '<div class="help-box">' +
    '<div class="help-head"><b>困ったとき</b><button type="button" class="btn small" data-close>✕ 閉じる</button></div>' +
    '<p class="hint">当てはまるものを押すと、直し方が出ます。</p>' +
    list.map(function (q) { return '<details><summary>' + q[0] + '</summary><div class="help-a">' + q[1] + '</div></details>'; }).join("") +
    '<p class="hint" style="margin-top:14px">それでも分からないときは、リーダーや担当の方に、この画面を見せて相談してください。</p>' +
  '</div>';
  document.body.appendChild(panel);
  function open() { panel.classList.add("open"); var s = panel.querySelector("summary"); if (s) s.focus(); }
  function close() { panel.classList.remove("open"); btn.focus(); }
  btn.addEventListener("click", open);
  panel.addEventListener("click", function (ev) {
    if (ev.target === panel || ev.target.closest("[data-close]")) close();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && panel.classList.contains("open")) { ev.stopImmediatePropagation(); close(); }
  }, true);
})();
