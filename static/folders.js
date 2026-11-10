// Copyright © 2026. All rights reserved.
// 品目一覧のフォルダ: Windows のエクスプローラーのように、右クリックで作る・名前を変える・消す、
// 品目やフォルダをフォルダへドラッグして移す。左の木の「▾」で、中のフォルダを開く・閉じる。
(function () {
  "use strict";
  const explorer = document.getElementById("explorer");
  if (!explorer) return;
  const current = explorer.dataset.folder || "";
  const itemsUrl = explorer.dataset.itemsUrl;
  const folderForm = document.getElementById("folder-form");
  const moveForm = document.getElementById("move-form");
  const menu = document.getElementById("folder-menu");

  function openFolder(path) {
    location.href = itemsUrl + (path ? "?cat=" + encodeURIComponent(path) : "");
  }
  function sendFolder(action, fields) {
    folderForm.elements.action.value = action;
    ["path", "name", "to"].forEach((k) => { folderForm.elements[k].value = fields[k] || ""; });
    folderForm.submit();
  }
  function leaf(path) { return path.split("/").pop(); }

  // ---- フォルダの操作 (右クリックのメニューと、上のボタンで同じことをする)
  function run(cmd, path, count) {
    if (cmd === "open") { openFolder(path); return; }
    if (cmd === "new") {
      const name = prompt(path ? T("「{name}」の中に作るフォルダの名前", { name: path }) : T("新しいフォルダの名前"), T("新しいフォルダ"));
      if (name && name.trim()) sendFolder("new", { path, name: name.trim() });
      return;
    }
    if (!path) return;  // 「すべての品目」は名前を変えたり消したりできない
    if (cmd === "rename") {
      const name = prompt(T("新しい名前"), leaf(path));
      if (name && name.trim() && name.trim() !== leaf(path)) sendFolder("rename", { path, name: name.trim() });
      return;
    }
    if (cmd === "delete") {
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      const n = parseInt(count || "0", 10);
      const msg = n
        ? T("フォルダ「{name}」を削除しますか？\n中の品目 {n} 件は消さずに「{to}」へ移します。", { name: path, n, to: parent || T("すべての品目") })
        : T("フォルダ「{name}」を削除しますか？", { name: path });
      if (confirm(msg)) sendFolder("delete", { path });
    }
  }
  document.querySelectorAll("[data-folder-cmd]").forEach((b) => {
    b.addEventListener("click", () => run(b.dataset.folderCmd, b.dataset.path || "", b.dataset.count));
  });

  // ---- 右クリックのメニュー
  let target = null;
  function hideMenu() { menu.hidden = true; target = null; }
  function showMenu(x, y, path, count, newOnly) {
    target = { path, count };
    menu.querySelector('[data-menu="open"]').hidden = !!newOnly;
    menu.querySelector('[data-menu="rename"]').hidden = !path || !!newOnly;
    menu.querySelector('[data-menu="delete"]').hidden = !path || !!newOnly;
    menu.hidden = false;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.min(x, window.innerWidth - w - 8) + "px";
    menu.style.top = Math.min(y, window.innerHeight - h - 8) + "px";
    menu.querySelector("button:not([hidden])").focus();
  }
  explorer.addEventListener("contextmenu", (e) => {
    const node = e.target.closest(".folder-node, .folder-row-link, .folder-row");
    const inTree = e.target.closest(".folder-pane");
    if (!node && !inTree) return;  // 品目の行などでは、いつもの右クリックのまま
    e.preventDefault();
    if (node) {
      const link = node.matches("a") ? node : node.querySelector("a[data-path]");
      showMenu(e.clientX, e.clientY, link.dataset.path || "", link.dataset.count);
    } else {
      showMenu(e.clientX, e.clientY, current, "0", true);  // 木の何もない所: 今のフォルダの中に新しいフォルダ
    }
  });
  menu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-menu]");
    if (!b || !target) return;
    const t = target;
    hideMenu();
    run(b.dataset.menu, t.path, t.count);
  });
  document.addEventListener("click", (e) => { if (!menu.contains(e.target)) hideMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideMenu(); });
  window.addEventListener("scroll", hideMenu, { passive: true });

  // ---- 左の木: 中のフォルダを開く・閉じる (開き方は、この端末が覚える)
  const KEY = "stock.folders.closed";
  let closed = [];
  try { closed = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { closed = []; }
  const lis = Array.from(document.querySelectorAll("#folder-tree .folder-li"));
  function applyTree() {
    lis.forEach((li) => {
      const p = li.dataset.path;
      if (!p) return;
      // 閉じたフォルダの中にあるフォルダは隠す (今開いているフォルダの上は、いつも開いておく)
      li.hidden = closed.some((c) => p.startsWith(c + "/") && !(current === c || current.startsWith(c + "/")));
      const t = li.querySelector(".folder-toggle");
      if (t) {
        const isClosed = closed.includes(p) && !(current.startsWith(p + "/"));
        t.textContent = isClosed ? "▸" : "▾";
        t.setAttribute("aria-expanded", isClosed ? "false" : "true");
      }
    });
  }
  lis.forEach((li) => {
    const t = li.querySelector(".folder-toggle");
    if (!t) return;
    t.addEventListener("click", () => {
      const p = li.dataset.path;
      closed = closed.includes(p) ? closed.filter((c) => c !== p) : closed.concat([p]);
      try { localStorage.setItem(KEY, JSON.stringify(closed)); } catch (e) { /* 覚えられなくても動く */ }
      applyTree();
    });
  });
  applyTree();

  // ---- ドラッグして移す (品目 → フォルダ、フォルダ → フォルダ)
  let drag = null;
  document.querySelectorAll(".item-row[draggable]").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      const box = row.querySelector('input[name="id"]');
      // チェックした品目の行をつかんだ時は、チェックした品目をまとめて移す
      const checked = Array.from(document.querySelectorAll('#label-form input[name="id"]:checked')).map((c) => c.value);
      const ids = box && box.checked && checked.length ? checked : [row.dataset.id];
      drag = { kind: "items", ids };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", T("{n} 件の品目", { n: ids.length }));
      explorer.classList.add("dragging");
    });
    row.addEventListener("dragend", () => { drag = null; explorer.classList.remove("dragging"); });
  });
  document.querySelectorAll("a[data-path][draggable]").forEach((a) => {
    a.addEventListener("dragstart", (e) => {
      drag = { kind: "folder", path: a.dataset.path };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", a.dataset.path);
      explorer.classList.add("dragging");
    });
    a.addEventListener("dragend", () => { drag = null; explorer.classList.remove("dragging"); });
  });
  function canDrop(to) {
    if (!drag) return false;
    if (drag.kind === "items") return true;
    const from = drag.path;
    const parent = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
    return to !== from && !to.startsWith(from + "/") && to !== parent;
  }
  document.querySelectorAll('[data-drop="1"]').forEach((el) => {
    const to = el.dataset.path || "";
    el.addEventListener("dragover", (e) => {
      if (!canDrop(to)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      el.classList.add("drop-here");
    });
    el.addEventListener("dragleave", () => el.classList.remove("drop-here"));
    el.addEventListener("drop", (e) => {
      el.classList.remove("drop-here");
      if (!canDrop(to)) return;
      e.preventDefault();
      if (drag.kind === "folder") {
        sendFolder("move", { path: drag.path, to });
        return;
      }
      moveForm.querySelectorAll('input[name="id"]').forEach((x) => x.remove());
      drag.ids.forEach((id) => {
        const input = document.createElement("input");
        input.type = "hidden"; input.name = "id"; input.value = id;
        moveForm.appendChild(input);
      });
      moveForm.elements.to.value = to;
      moveForm.submit();
    });
  });
})();
