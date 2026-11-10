// 画面の言葉の切り替え (日本語 / インドネシア語)  Copyright © 2026. All rights reserved.
// T("残り{n}個", {n: 3}) → 今の言語の言葉。訳が無い時は日本語のまま。
window.LANG = window.LANG || "ja";
window.T = function (text, vars) {
  var out = (window.I18N && window.I18N[text]) || text;
  if (vars) out = out.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? vars[k] : m; });
  return out;
};
// 品名: インドネシア語の画面では、インドネシア語の品名があればそれを出す
window.itemLabel = function (item) {
  return (window.LANG === "id" && item && item.name_id) ? item.name_id : (item ? item.name : "");
};
