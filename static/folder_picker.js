// Copyright © 2026. All rights reserved.
// バックアップの保存先を、サーバPCのフォルダから選ぶ
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const dlg = $("folder-dialog");
  const input = $("backup-dir");
  if (!dlg || !input) return;
  let current = "";

  function showError(msg) {
    $("folder-error").textContent = msg || "";
    $("folder-error").hidden = !msg;
  }

  function item(label, path, icon) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "folder-item";
    b.textContent = icon + " " + label;
    b.title = path;
    b.addEventListener("click", () => open(path));
    li.appendChild(b);
    return li;
  }

  async function open(path) {
    showError("");
    let data;
    try {
      const r = await fetch("/api/folders?path=" + encodeURIComponent(path || ""));
      data = await r.json();
    } catch (e) {
      showError(T("サーバにつながりません"));
      return;
    }
    if (!data.ok) { showError(data.error); return; }
    current = data.path;
    const list = $("folder-list");
    list.textContent = "";
    if (!current) {
      data.places.forEach((p) => list.appendChild(item(p.label, p.path, p.kind === 2 ? "💾" : p.kind === 4 ? "🌐" : "📂")));
    } else {
      data.dirs.forEach((name) => {
        const sep = /[\\/]$/.test(current) ? "" : (current.includes("\\") ? "\\" : "/");
        list.appendChild(item(name, current + sep + name, "📁"));
      });
      if (!data.dirs.length) {
        const li = document.createElement("li");
        li.className = "muted small";
        li.textContent = T("（この中にフォルダはありません）");
        list.appendChild(li);
      }
    }
    $("folder-current").textContent = current || T("場所を選んでください");
    $("folder-up").disabled = !current;
    $("folder-up").dataset.path = data.parent || "";
    $("folder-ok").disabled = !current;
    $("folder-new-row").hidden = !current;
  }

  $("folder-pick").addEventListener("click", () => {
    const start = input.value.trim();
    // 今の保存先から (相対パスはアプリのフォルダから見た場所)。開けなければ最初の画面から
    current = "";  // 前に開いた時の場所を残さない (開けなかった時に、前の場所が選ばれないように)
    dlg.showModal();
    open(start).then(() => { if (start && !current) open(""); });
  });
  $("folder-up").addEventListener("click", (e) => open(e.currentTarget.dataset.path || ""));
  $("folder-top").addEventListener("click", () => open(""));
  $("folder-cancel").addEventListener("click", () => dlg.close());
  $("folder-ok").addEventListener("click", () => {
    if (!current) return;
    input.value = current;
    dlg.close();
    input.focus();
  });
  $("folder-new").addEventListener("click", async () => {
    const name = $("folder-new-name").value.trim();
    if (!name) { $("folder-new-name").focus(); return; }
    let data;
    try {
      const r = await fetch("/api/folders/new", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: current, name }),
      });
      data = await r.json();
    } catch (e) {
      showError(T("サーバにつながりません"));
      return;
    }
    if (!data.ok) { showError(data.error); return; }
    $("folder-new-name").value = "";
    open(data.path);
  });
  $("folder-new-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("folder-new").click(); }
  });
})();
