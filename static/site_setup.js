// Copyright © 2026. All rights reserved.
// 設定「ほかの現場を探す」: 社内のネットワークからほかの現場を見つけて、チェックしたものを登録する
(function () {
  "use strict";
  const btn = document.getElementById("site-scan");
  const box = document.getElementById("site-scan-result");
  const urls = document.getElementById("site-urls");
  const form = document.getElementById("site-form");
  if (!btn || !box || !urls || !form) return;
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    box.hidden = false;
    box.textContent = "";
    box.appendChild(el("div", "muted", "⏳ " + T("探しています…（数秒かかります）")));
    let data;
    try {
      const res = await fetch(location.pathname.replace(/settings\/?$/, "") + "api/sites/scan", { method: "POST" });
      data = await res.json();
    } catch (e) {
      data = { ok: false };
    }
    btn.disabled = false;
    box.textContent = "";
    if (!data.ok) { box.appendChild(el("div", "flash flash-error", T("探せませんでした。もう一度押してください。"))); return; }
    if (!data.found.length) {
      box.appendChild(el("div", "muted", T("同じネットワーク（{net}）には、ほかの現場が見つかりませんでした。ほかの現場のアプリが起動しているか確かめるか、下の「アドレスを直接入力」を使ってください。", { net: data.network })));
      return;
    }
    box.appendChild(el("div", "small", T("{n} か所見つかりました。登録する現場にチェックを入れてください。", { n: data.found.length })));
    const list = el("ul", "site-found");
    data.found.forEach((f) => {
      const li = el("li");
      const label = el("label");
      const cb = el("input");
      cb.type = "checkbox";
      cb.value = f.url;
      cb.checked = !f.registered;
      cb.disabled = f.registered;
      label.appendChild(cb);
      label.appendChild(el("strong", "", " " + (f.site || T("（名前なし）"))));
      label.appendChild(el("span", "muted small mono", "  " + f.url));
      label.appendChild(el("span", "muted small", "  " + (f.registered ? T("登録済み") : T("{n} 品目", { n: f.total }))));
      li.appendChild(label);
      list.appendChild(li);
    });
    box.appendChild(list);
    const add = el("button", "btn btn-primary", T("チェックした現場を登録する"));
    add.type = "button";
    add.addEventListener("click", () => {
      const now = urls.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      list.querySelectorAll("input:checked:not(:disabled)").forEach((cb) => { if (!now.includes(cb.value)) now.push(cb.value); });
      urls.value = now.join("\n");
      form.requestSubmit ? form.requestSubmit() : form.submit();
    });
    box.appendChild(add);
  });
})();
