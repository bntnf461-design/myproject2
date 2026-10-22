/* =========================================================
   画面の枠（左のメニュー／スマホは下のタブ）
   - メニュー・一覧・作成・取り込み・撮り方・設定の画面で共通
   - ページの中身はそのまま、左にメニューを付けるだけ（各画面の処理には影響しない）
   ========================================================= */
(function () {
  "use strict";
  var esc = WI.esc;
  var cat = window.CATALOG || {};
  var page = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  var ICON = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    list: '<path d="M4 5h16M4 12h16M4 19h10"/>',
    edit: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
    excel: '<rect x="4" y="3" width="13" height="18" rx="2"/><path d="M20 12v8M17 17l3 3 3-3"/>',
    video: '<rect x="3" y="7" width="13" height="11" rx="2"/><path d="M16 11l5-3v9l-5-3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>'
  };
  function icon(k) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[k] + '</svg>'; }

  var NAV = [
    { href: "index.html", icon: "home", label: "ホーム", tab: true },
    { href: "list.html", icon: "list", label: "要領書を見る", tab: true, also: ["manual.html"] },
    { sec: "作る・管理する" },
    { href: "editor.html", icon: "edit", label: "要領書を作る", tab: true },
    { href: "bulk.html", icon: "excel", label: "Excel から取り込む" },
    { href: "guide.html", icon: "video", label: "動画の撮り方" },
    { href: "settings.html", icon: "gear", label: "設定", tab: true }
  ];
  function isOn(n) { return n.href === page || (n.also || []).indexOf(page) !== -1; }

  var org = WI.orgParts(cat);
  var side = document.createElement("aside");
  side.className = "side";
  side.innerHTML =
    '<a class="brand" href="index.html"><span class="logo">要</span><b>作業要領書</b></a>' +
    (org.length ? '<a class="side-org" href="settings.html#org" title="名前を変える"><b>' + esc(org[0]) + '</b>' +
      (org.length > 1 ? '<br>' + org.slice(1).map(esc).join(" ＞ ") : '') + '</a>' : '') +
    '<ul class="nav">' + NAV.map(function (n) {
      if (n.sec) return '<li class="sec">' + n.sec + '</li>';
      return '<li><a href="' + n.href + '"' + (isOn(n) ? ' class="on" aria-current="page"' : '') + '>' + icon(n.icon) + '<span>' + n.label + '</span></a></li>';
    }).join("") + '</ul>' +
    '<div class="side-foot">インターネット不要で動作</div>';

  var tabs = document.createElement("nav");
  tabs.className = "tabs";
  tabs.setAttribute("aria-label", "メニュー");
  tabs.innerHTML = NAV.filter(function (n) { return n.tab; }).map(function (n) {
    return '<a href="' + n.href + '"' + (isOn(n) ? ' class="on" aria-current="page"' : '') + '>' + icon(n.icon) + '<span>' + n.label.replace("要領書を", "") + '</span></a>';
  }).join("");

  // ページの中身を右側に移す（id はそのままなので、各画面の処理はこれまでどおり動く）
  var main = document.createElement("div");
  main.className = "shell-main";
  while (document.body.firstChild) main.appendChild(document.body.firstChild);
  var shell = document.createElement("div");
  shell.className = "shell";
  shell.appendChild(side);
  shell.appendChild(main);
  document.body.appendChild(shell);
  document.body.appendChild(tabs);
  document.body.classList.add("has-shell");
})();
