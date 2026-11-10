// Copyright © 2026. All rights reserved.
// ヘルプ: 入れた質問の言葉と、よくある質問の言葉の重なりで、近い答えを探す
(function () {
  "use strict";
  const entries = JSON.parse(document.getElementById("help-data").textContent);
  const input = document.getElementById("help-q");
  const box = document.getElementById("help-results");
  const none = document.getElementById("help-none");

  // 全角・半角、カタカナ・ひらがな、大文字・小文字の違いをそろえる
  function norm(s) {
    return String(s || "").normalize("NFKC").toLowerCase()
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/[\s、。，．,.!?！？「」『』（）()［］\[\]・:：/]+/g, " ").trim();
  }
  // 質問によく入るけれど、何について聞いているかには関係のない言い方
  const FILLER = ["どうやって", "どうやる", "どうする", "どうすれば", "どうしたら", "どこで", "どこ", "したい", "したら",
    "やり方", "やりかた", "どう", "なに", "何", "方法", "には", "ですか", "ますか", "の時", "のとき", "とき", "について", "教えて", "おしえて", "わからない",
    "cara", "bagaimana", "apa", "ingin", "mau", "yang", "di", "untuk", "dengan"];
  // 日本語は言葉の区切りがないので文の中から取り除き、インドネシア語などは単語ごと取り除く
  // (「di」を文の中から消すと「diterima」が「terima」になってしまうため)
  const FILLER_JA = FILLER.filter((f) => /[^\x00-\x7f]/.test(f)).map(norm);
  const FILLER_WORD = new Set(FILLER.filter((f) => !/[^\x00-\x7f]/.test(f)).map(norm));
  function clean(q) {
    let s = " " + norm(q) + " ";
    FILLER_JA.forEach((f) => { s = s.split(f).join(" "); });
    return s.split(" ").filter((w) => w && !FILLER_WORD.has(w)).join(" ");
  }
  const isKana = (c) => /[ぁ-ゟ]/.test(c);
  function grams(s) {
    const out = new Map();
    s.split(" ").forEach((w) => {
      if (w.length === 1 && !isKana(w)) out.set(w, 0.6);  // 1文字の漢字 (例:「色」「声」)
      for (let i = 0; i + 1 < w.length; i++) {
        const g = w.slice(i, i + 2);
        // ひらがなだけの2文字 (「する」「ます」など) は弱くする
        out.set(g, isKana(g[0]) && isKana(g[1]) ? 0.3 : 1);
      }
    });
    return out;
  }
  const index = entries.map((e) => {
    const kw = norm(e.kw).split(" ").filter((w) => w.length >= 2);
    return { e, kw, head: grams(norm(e.q + " " + e.kw)), body: grams(norm(e.a.join(" "))) };
  });

  function score(q) {
    const qs = clean(q);
    if (!qs) return [];
    const qg = grams(qs);
    let total = 0;
    qg.forEach((w) => { total += w; });
    return index.map((x) => {
      let s = 0;
      qg.forEach((w, g) => { if (x.head.has(g)) s += w * 2; else if (x.body.has(g)) s += w * 0.5; });
      s = total ? s / total : 0;
      // 言いかえの言葉がそのまま入っていたら、強く当てる
      x.kw.forEach((k) => { if (qs.includes(k)) s += 0.6 + Math.min(k.length, 6) * 0.1; });
      return { e: x.e, s };
    }).filter((r) => r.s >= 0.55).sort((a, b) => b.s - a.s).slice(0, 3);
  }

  function card(e, best) {
    const d = document.createElement("section");
    d.className = "card help-hit" + (best ? " help-best" : "");
    const h = document.createElement("h3");
    h.textContent = e.q;
    d.appendChild(h);
    e.a.forEach((line) => { const p = document.createElement("p"); p.textContent = line; d.appendChild(p); });
    if (e.link) {
      const a = document.createElement("a");
      a.className = "btn btn-primary"; a.href = e.link; a.textContent = T("この画面を開く") + " →";
      d.appendChild(a);
    }
    return d;
  }

  function search() {
    const q = input.value.trim();
    box.textContent = "";
    if (!q) { none.hidden = true; return; }
    const hits = score(q);
    none.hidden = hits.length > 0;
    if (hits.length) {
      const t = document.createElement("div");
      t.className = "muted small help-hits-title";
      t.textContent = hits.length > 1 ? T("近い答え（上ほど近い）") : T("答え");
      box.appendChild(t);
    }
    hits.forEach((r, i) => box.appendChild(card(r.e, i === 0)));
  }

  let timer = null;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 200); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); clearTimeout(timer); search(); }
  });
  document.querySelectorAll(".help-ex").forEach((b) => b.addEventListener("click", () => { input.value = b.textContent; search(); input.focus(); }));
  // 一覧の質問を開いた時に、ほかを閉じる (長くならないように)
  document.querySelectorAll(".help-item").forEach((d) => d.addEventListener("toggle", () => {
    if (d.open) document.querySelectorAll(".help-item[open]").forEach((o) => { if (o !== d) o.open = false; });
  }));
  if (input.value) search();
  if (window.matchMedia("(min-width: 700px)").matches) input.focus();
})();
