/* ---------- 言語の切り替え（日本語／インドネシア語） ----------
   プログラムと記録はすべて日本語のまま。インドネシア語のときは、画面に出る文字だけを辞書で置き換える
   （MutationObserver で、書き換えられた文字をそのつど訳す）。製造種類・工程名など自分で入れた名前は訳さない。
   Excel 出力・バックアップ・ファイル名は日本語のまま（日本の様式へ転記するため）。 */
const LANG_KEY = "defectCounterLang";
let LANG = (() => { try { return localStorage.getItem(LANG_KEY) === "id" ? "id" : "ja"; } catch (e) { return "ja"; } })();
// 言語を切り替える。読み込み直さないので、全画面・作業中の画面はそのまま（訳す前の日本語を覚えておいて戻す）
function setLang(l) {
  try { localStorage.setItem(LANG_KEY, l); } catch (e) {}
  applyLang(l);
}
const I18N_ID = /*I18N-DICT*/{}/*/I18N-DICT*/;
const I18N_WD = {"日":"Min", "月":"Sen", "火":"Sel", "水":"Rab", "木":"Kam", "金":"Jum", "土":"Sab"};
const I18N_DATE_RULES = [
  [/(\d{4})年(\d{1,2})月(\d{1,2})日/g, "$3/$2/$1"],
  [/(\d{1,2})月(\d{1,2})日/g, "$2/$1"],
  [/(\d{4})年(\d{1,2})月/g, "$2/$1"],
  [/[(（]([日月火水木金土])[)）]/g, (m, w) => `(${I18N_WD[w]})`],
];
// 数字と組み合わせる言い方（辞書より先に当てる。語順を入れ替えるもの）
const I18N_NJ = "(?![\\u3040-\\u30ff\\u4e00-\\u9fff])"; // 単位のあとに日本語が続くとき（辞書の語句の一部）は当てない
const I18N_PRE_RULES = [
  [/（(\d+)から数えます）/g, "(mulai dari $1)"],
  [/前の(\d+)週間/g, "$1 minggu sebelumnya"],
  [/次の(\d+)週間/g, "$1 minggu berikutnya"],
  [/を(\d+)件減らす/g, " kurangi $1"],
  [/を(\d+)件増やす/g, " tambah $1"],
  [/カウンターのPC/g, "PC penghitung"],
  [/不良[ 　]*合計/g, "Total cacat"],
  [/停止時間[ 　]*合計/g, "Total waktu berhenti"],
  ...[["(\\d+)時間ごと", "per $1 jam"], ["(\\d+)時台", "jam $1"], ["(\\d+)時間(\\d+)分", "$1 j $2 mnt"], ["(\\d+)時間", "$1 jam"], ["(\\d+)分前", "$1 mnt lalu"],
    ["(\\d+)日前", "$1 hari lalu"], ["(\\d+)分ごと", "tiap $1 mnt"], ["(\\d+)分以上", "$1 mnt lebih"], ["(\\d+)秒間", "$1 dtk"], ["今回で\\s*(\\d+)\\s*回目", "ke-$1"],
    ["(\\d+)回目", "ke-$1"], ["(\\d+)日間", "$1 hari"], ["(\\d+)週間", "$1 minggu"], ["(\\d+)か月", "$1 bulan"], ["(\\d+)日あたり", "per $1 hari"],
    ["(\\d+)行目", "baris $1"], ["(\\d+)か所", "$1 tempat"], ["(\\d+)文字", "$1 huruf"]].map(([re, rep]) => [new RegExp(re + I18N_NJ, "g"), rep]),
];
const I18N_RULES = [
  [/(\d+)時間(\d+)分/g, "$1 j $2 mnt "],
  [/(\d+)時間/g, "$1 jam "],
  [/(\d+)時台/g, "jam $1 "],
  [/(\d+)分前/g, "$1 mnt lalu "],
  [/(\d+)日前/g, "$1 hari lalu "],
  [/(\d+)分ごと/g, "tiap $1 mnt "],
  [/(\d+)分以上/g, "$1 mnt lebih "],
  [/(\d+)分/g, "$1 mnt "],
  [/(\d+)秒間/g, "$1 dtk "],
  [/(\d+)秒/g, "$1 dtk "],
  [/(\d+)時/g, "jam $1 "],
  [/今回で\s*(\d+)\s*回目/g, "ke-$1 "],
  [/(\d+)回目/g, "ke-$1 "],
  [/(\d+)回/g, "$1 kali "],
  [/(\d+)日間/g, "$1 hari "],
  [/(\d+)週間/g, "$1 minggu "],
  [/(\d+)か月/g, "$1 bulan "],
  [/(\d+)日あたり/g, "per $1 hari "],
  [/(\d+)日/g, "$1 hari "],
  [/([\d,.]+)\s?(件|個)/g, "$1 pcs "],
  [/([\d,.]+)\s?本/g, "$1 btg "],
  [/([\d,.]+)\s?枚/g, "$1 lbr "],
  [/([\d,.]+)\s?台/g, "$1 unit "],
  [/(\d+)行目/g, "baris $1 "],
  [/(\d+)か所/g, "$1 tempat "],
  [/(\d+)番/g, "no. $1 "],
  [/第(\d+)/g, "ke-$1 "],
  [/(\d+)年/g, "$1 "],
  [/(\d+)つ/g, "$1 "],
];
// 句読点・かっこ
const I18N_PUNCT = {"、":", ", "。":". ", "，":", ", "．":". ", "：":": ", "；":"; ", "・":" · ", "／":" / ", "　":" ", "「":"“", "」":"”", "『":"“", "』":"”",
  "（":" (", "）":") ", "【":"[", "】":"]", "〜":"–", "～":"–", "！":"!", "？":"?", "＋":"+", "－":"-", "＝":"=", "＞":">", "＜":"<", "％":"%", "…":"…", "―":"-", "｜":" | "};
// 辞書にない1文字（助詞など）は消す
const I18N_DROP = new Set("のをがはにでともへやかね".split(""));
const I18N_J = /[　-〿぀-ヿ一-鿿！-｠…―〜々]/;
const I18N_RUN = /[　-〿぀-ヿ一-鿿！-｠…―〜々]+/g;
const I18N_PSPLIT = /([　-〄〆-〿・！-／：-＠［-｀｛-｠…―])/;
let i18nMaxKey = 0; for (const k in I18N_ID) if (k.length > i18nMaxKey) i18nMaxKey = k.length;
const i18nCache = new Map();
let i18nNames = [], i18nNamesAt = 0, i18nMap = {}; // i18nMap：設定で入れたインドネシア語の名前 {日本語の名前: インドネシア語}
// 訳さない名前（製造種類・工程名など、使う人が入れたもの）。辞書にそのままある名前（初期値のキズ・段取りなど）は訳す
let i18nNamesFromApp = false;
function i18nInvalidate() { i18nNamesAt = 0; } // 設定・データが変わったら、名前の一覧をすぐ読み直す
const i18nAppReady = () => { try { return typeof state === "object" && !!state; } catch (e) { return false; } };
function i18nUserNames() {
  const ready = i18nAppReady();
  if (Date.now() - i18nNamesAt < 1000 && (i18nNamesFromApp || !ready)) return i18nNames;
  i18nNamesAt = Date.now(); i18nNamesFromApp = ready;
  const set = new Set(), map = {};
  const addMap = (ja, id) => { if (typeof ja === "string" && ja && typeof id === "string" && id.trim()) { map[ja] = id.trim(); set.add(ja); } };
  const add = v => { if (typeof v === "string" && v && I18N_J.test(v)) set.add(v); };
  const addIfNotWord = v => { if (typeof v === "string" && I18N_ID[v] === undefined) add(v); };
  try {
    // 画面を作る前（プログラムの準備前）でも名前が分かるよう、保存してある設定からも読む
    let st = null; try { st = typeof state === "object" && state ? state : null; } catch (e) {}
    if (!st) try { st = JSON.parse(localStorage.getItem("defectCounterState") || "null"); } catch (e) {}
    try { if (typeof VIEW_RAW === "object" && VIEW_RAW && VIEW_RAW.state) { (VIEW_RAW.state.shifts || []).forEach(add); add(VIEW_RAW.state.process); } } catch (e) {}
    const state_ = st;
    if (state_) { const state = state_;
      (state.shifts || []).forEach(add); add(state.process); add(state.currentShift); if (state.share) add(state.share.name);
      (state.types || []).forEach(t => { if (!t) return; if (t.nameId) addMap(t.name, t.nameId); else addIfNotWord(t.name); });
      const rid = state.reasonNamesId || {};
      Object.entries(rid).forEach(([k, v]) => addMap(k, v));
      (state.stopReasons || []).forEach(r => { if (!rid[r]) addIfNotWord(r); });
      Object.values(state.typeNames || {}).forEach(addIfNotWord);
    }
    let hs = null; try { hs = typeof hist === "object" && hist ? hist : null; } catch (e) {}
    if (hs) { const hist = hs; (hist.shifts || []).forEach(add); Object.values(hist.types || {}).forEach(t => t && addIfNotWord(t.name || t[0])); }
  } catch (e) {}
  const list = [...set].sort((a, b) => b.length - a.length);
  if (list.join("\n") !== i18nNames.join("\n") || JSON.stringify(map) !== JSON.stringify(i18nMap)) i18nCache.clear();
  i18nMap = map;
  return (i18nNames = list);
}
// 長い語句から順に、文の左から当てはめる（句読点は記号に、辞書にない助詞は消す）
function i18nGreedy(p) {
  const out = []; let i = 0, lit = "";
  const flush = () => { if (lit) { out.push(lit); lit = ""; } };
  while (i < p.length) {
    if (I18N_PUNCT[p[i]] !== undefined) { flush(); out.push(I18N_PUNCT[p[i++]]); continue; } // 句読点・かっこは先に記号へ
    let hit = false;
    for (let L = Math.min(i18nMaxKey, p.length - i); L >= 2; L--) {
      const v = I18N_ID[p.substr(i, L)];
      if (v !== undefined) { flush(); if (v) out.push(v); i += L; hit = true; break; }
    }
    if (hit) continue;
    const c = p[i++];
    if (I18N_PUNCT[c] !== undefined) { flush(); out.push(I18N_PUNCT[c]); }
    else if (I18N_ID[c] !== undefined && !I18N_DROP.has(c)) { flush(); if (I18N_ID[c]) out.push(I18N_ID[c]); }
    else if (!I18N_DROP.has(c)) lit += c;
  }
  flush();
  return out.join(" ");
}
function i18nRun(run) {
  const v = I18N_ID[run];
  return v !== undefined ? v : i18nGreedy(run);
}
function trText(s, lang = LANG) {
  if (lang !== "id" || !s || !I18N_J.test(s)) return s;
  const names = i18nUserNames();
  const c = i18nCache.get(s); if (c !== undefined) return c;
  const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0], core = s.trim();
  let t;
  const sym = core.match(/^[^\p{L}\p{N}\u3000-\u303f\uff01-\uff60（「]*/u)[0], body = core.slice(sym.length); // 先頭の絵文字・記号（📂 など）
  const ex = i18nMap[core] !== undefined ? i18nMap[core] : names.includes(core) ? core : I18N_ID[core] ?? (sym && I18N_ID[body] !== undefined ? sym + I18N_ID[body] : undefined); // 入れた名前だけの文字はそのまま
  if (ex !== undefined) t = ex;
  else {
    t = core; const prot = [];
    names.forEach(n => { if (t.includes(n)) t = t.split(n).join(`${String.fromCharCode(0xE100 + prot.push(n) - 1)}`); });
    const keep = v => `\uE000${String.fromCharCode(0xE100 + prot.push(v) - 1)}\uE001`; // 訳し終わった部分は、あとの手順で触らない
    I18N_DATE_RULES.forEach(([re, rep]) => { t = t.replace(re, rep); });
    I18N_PRE_RULES.forEach(([re, rep]) => { t = t.replace(re, rep); });
    // 1) 辞書にそのままある語句（2文字以上）を先に訳す → 2) 数字＋単位 → 3) 残りを細かく分けて訳す
    t = t.replace(I18N_RUN, run => { const v = run.length >= 2 ? (I18N_ID[run] ?? I18N_ID[run.replace(/^[\u3000-\u3004\u3006-\u303f\uff5c\u30fb]+|[\u3000-\u3004\u3006-\u303f\uff5c\u30fb]+$/g, "")]) : undefined; return v !== undefined ? ` ${keep(v)} ` : run; });
    I18N_RULES.forEach(([re, rep]) => { t = t.replace(re, rep); });
    t = t.replace(I18N_RUN, run => { const o = i18nRun(run); return o === run ? run : ` ${o} `; }); // 訳せない語（名前など）はそのまま、すき間も入れない
    t = t.replace(/(.)/g, (m, ch) => { const v = prot[ch.charCodeAt(0) - 0xE100]; return i18nMap[v] !== undefined ? i18nMap[v] : v; });
    t = t.replace(/\s{2,}/g, " ").replace(/\s+([)\],.:;!?%”])/g, "$1").replace(/([(\[“])\s+/g, "$1").replace(/\(\s*\)/g, "").replace(/\(Per /g, "(per ").trim();
  }
  const out = lead + t + trail;
  if (i18nCache.size > 6000) i18nCache.clear();
  i18nCache.set(s, out);
  if (window.__i18nLog) window.__i18nLog.set(s, out);
  return out;
}
const I18N_ATTRS = ["title", "placeholder", "aria-label", "alt"];
const I18N_SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "NOSCRIPT"]);
const i18nDone = new WeakMap(); // 訳した文字（もう一度訳さない＝書き換えの繰り返しを防ぐ）
const i18nOrig = new WeakMap(), i18nAttrOrig = new WeakMap(); // 訳す前の日本語（日本語に戻すときに使う）
// スライドの言語（実績グラフの設定）：""＝画面と同じ。スライドの部分（data-slide-area）だけ、この言語にする
let I18N_SLIDE = "";
const i18nLangOf = el => I18N_SLIDE && el.closest("[data-slide-area]") ? I18N_SLIDE : LANG;
function i18nText(n) {
  const v = n.data; if (!I18N_J.test(v) || i18nDone.get(n) === v) return;
  const p = n.parentElement; if (!p || I18N_SKIP.has(p.nodeName) || p.closest("[data-notr]")) return;
  if (i18nLangOf(p) !== "id") return;
  let o = p.hasAttribute("data-wd") && I18N_WD[v.trim()] ? I18N_WD[v.trim()] : trText(v, "id");
  // 日本語は語の間にすき間がない。太字・キーなどの隣で訳した言葉がくっつかないよう、すき間を足す
  if (o !== v) {
    const nx = n.nextSibling, pv = n.previousSibling, inl = x => x && x.nodeType === 1 && /^(B|STRONG|KBD|SPAN|I|SMALL|A|EM)$/.test(x.nodeName);
    if (inl(nx) && /[\p{L}\p{N})”.,:]$/u.test(o) && !/^\s/.test(nx.textContent)) o += " ";
    if (inl(pv) && /^[\p{L}\p{N}(“]/u.test(o) && !/\s$/.test(pv.textContent)) o = " " + o;
  }
  i18nDone.set(n, o);
  if (o !== v) { i18nOrig.set(n, v); n.data = o; }
}
function i18nAttrs(el) {
  if (i18nLangOf(el) !== "id") return;
  for (const a of I18N_ATTRS) { const v = el.getAttribute(a); if (v && I18N_J.test(v) && !el.closest("[data-notr]")) { const o = trText(v, "id"); if (o !== v && trText(o, "id") === o) { const m = i18nAttrOrig.get(el) || {}; m[a] = v; i18nAttrOrig.set(el, m); el.setAttribute(a, o); } } }
}
function i18nTree(root) {
  if (root.nodeType === 3) { i18nText(root); return; }
  if (root.nodeType !== 1 || I18N_SKIP.has(root.nodeName)) return;
  i18nAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) { if (n.nodeType === 3) i18nText(n); else i18nAttrs(n); }
}
// ブラウザの小窓（alert・confirm）も、インドネシア語のときは訳す
{ const nativeAlert = window.alert.bind(window), nativeConfirm = window.confirm.bind(window);
  window.alert = m => nativeAlert(trText(String(m)));
  window.confirm = m => nativeConfirm(trText(String(m))); }
if (LANG === "id") {
  document.documentElement.lang = "id";
  i18nStart();
}
// 訳した文字を日本語に戻す（日本語にする部分だけ）
function i18nRevert(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    if (n.nodeType === 3) {
      const o = i18nOrig.get(n);
      if (o !== undefined && n.parentElement && i18nLangOf(n.parentElement) !== "id") { if (i18nDone.get(n) === n.data) n.data = o; i18nOrig.delete(n); i18nDone.delete(n); }
      else if (o === undefined) i18nDone.delete(n);
    } else {
      const m = i18nAttrOrig.get(n);
      if (m && i18nLangOf(n) !== "id") { Object.entries(m).forEach(([a, v]) => n.setAttribute(a, v)); i18nAttrOrig.delete(n); }
    }
  }
}
function applyLang(l) {
  l = l === "id" ? "id" : "ja";
  if (l === LANG) return;
  LANG = l;
  document.documentElement.lang = l;
  document.querySelectorAll("[data-slide-area]").forEach(el => { el.lang = I18N_SLIDE || LANG; });
  i18nInvalidate();
  if (l === "id") { if (i18nStarted) i18nTree(document.documentElement); else i18nStart(); }
  else i18nRevert(document.documentElement);
  i18nRefreshButtons();
  if (typeof window.onLangChange === "function") { try { window.onLangChange(); } catch (e) { console.error(e); } } // 画面を描き直す（アプリ側）
}
// 言語ボタンの表示を、今の言語に合わせる
function i18nRefreshButtons() {
  document.querySelectorAll("button.lang-btn[data-lang]").forEach(b => {
    b.dataset.lang = LANG === "id" ? "ja" : "id";
    b.title = LANG === "id" ? "日本語に切り替え（Tab キー）" : "Ganti ke Bahasa Indonesia (tombol Tab)";
    b.innerHTML = `🌐 ${LANG === "id" ? "日本語" : "Bahasa Indonesia"}<kbd>Tab</kbd>`;
  });
}
// 画面に出た文字を見張って訳す（インドネシア語の画面か、スライドだけインドネシア語のとき）
var i18nStarted; // var（代入なし）：上の「インドネシア語の画面なら開始」から先に呼ばれるため
function i18nStart() {
  if (i18nStarted) return;
  i18nStarted = true;
  i18nTree(document.documentElement);
  new MutationObserver(ms => {
    for (const m of ms) {
      if (m.type === "childList") m.addedNodes.forEach(i18nTree);
      else if (m.type === "characterData") i18nText(m.target);
      else if (m.type === "attributes") i18nAttrs(m.target);
    }
  }).observe(document.documentElement, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:I18N_ATTRS});
}
function setSlideLang(l) {
  I18N_SLIDE = l === "ja" || l === "id" ? l : "";
  if (I18N_SLIDE === "id") i18nStart();
  document.querySelectorAll("[data-slide-area]").forEach(el => { el.lang = I18N_SLIDE || LANG; });
}
// ほかのタブで言語を変えたら、このタブも合わせる
window.addEventListener("storage", e => { if (e.key === LANG_KEY) applyLang(e.newValue); });
// 言語ボタン（訳さない）：押すと切り替え
function langButtonHtml(cls = "") {
  return `<button type="button" class="lang-btn ${cls}" data-notr data-lang="${LANG === "id" ? "ja" : "id"}" title="${LANG === "id" ? "日本語に切り替え（Tab キー）" : "Ganti ke Bahasa Indonesia (tombol Tab)"}">🌐 ${LANG === "id" ? "日本語" : "Bahasa Indonesia"}<kbd>Tab</kbd></button>`;
}
document.addEventListener("click", e => { const b = e.target.closest("[data-lang]"); if (b) setLang(b.dataset.lang); });
// Tab キーだけで言語を切り替える（テンキー・キーボードの Tab）。
// 入力欄にいるとき（Tab で次の欄へ移る）と、設定画面を開いているとき（保存前の変更が消えるため）は切り替えない
window.addEventListener("keydown", e => {
  if (e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target, tag = t && t.tagName;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (t && t.isContentEditable)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (e.repeat) return;
  const st = document.getElementById("settingsOverlay");
  if (st && st.classList.contains("show")) return;
  setLang(LANG === "id" ? "ja" : "id");
}, true);
