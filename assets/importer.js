/* =========================================================
   Excel 取り込み
   - 見出し（「主なステップ」「急所」「理由」など）を自動で探して、列の意味を判断
   - 判断が違っていても、画面で列を選び直せる
   - 文書番号・作業名・承認者などは、見出しより上の欄から自動で拾う
   ========================================================= */
(function () {
  "use strict";
  var esc = WI.esc;
  var col = XLSXReader.colName;

  // ---------- 列の意味（判定の順番が大事：「急所の理由」は理由として扱う） ----------
  var COLS = [
    { key: "no", label: "No.", re: /^(no|№|番号|順序|順番|手順no|手順番号|ステップno|step)\.?$/i },
    { key: "reason", label: "理由", re: /理由|根拠|なぜ/ },
    { key: "point", label: "急所", re: /急所|ポイント|要点|注意点|コツ|どのように/ },
    { key: "video", label: "動画", re: /動画|映像|ビデオ|video/i },
    { key: "time", label: "標準時間", re: /時間|秒|工数|^st$/i },
    { key: "kind", label: "区分（安全・品質）", re: /^(区分|分類|種別|種類)$/ },
    { key: "detail", label: "詳しい説明", re: /詳細|説明|補足/ },
    { key: "step", label: "主なステップ", re: /^(主なステップ|主な手順|(要素)?作業(内容|手順|ステップ|項目|の順序|順序|要素|名)?|要素作業(手順)?|手順(内容)?|ステップ|何を.*)$/ }
  ];
  var COL_ORDER = ["no", "step", "detail", "point", "reason", "kind", "time", "video"];

  // ---------- 見出しより上の文書情報 ----------
  var INFO = [
    { key: "docNo", label: "文書番号", re: /^(文書(番号|no|№)|管理(番号|no)|要領書(番号|no)|標準書?(番号|no)|書類番号|文書no\.?)$/i },
    { key: "title", label: "作業名", re: /^(作業名|作業名称|件名|表題|タイトル|要領書名)$/ },
    { key: "process", label: "工程", re: /^(工程|工程名|工程番号)$/ },
    { key: "line", label: "ライン", re: /^(ライン|ライン名|職場|職場名|場所|設備|設備名)$/ },
    { key: "product", label: "品番・品名", re: /^(品番|品名|品番・?品名|製品名?|部品番号|部品名|型式|機種)$/ },
    { key: "updated", label: "改訂日", re: /^(改訂日|改定日|更新日|変更日|改訂年月日)$/ },
    { key: "issued", label: "制定日", re: /^(制定日|作成日|発行日|作成年月日|制定年月日)$/ },
    { key: "revision", label: "改訂", re: /^(改訂|改定|改訂番号|改訂no|版|版数|rev\.?)$/i },
    { key: "approver", label: "承認", re: /^(承認|承認者)$/, below: true },
    { key: "inspector", label: "点検", re: /^(点検|点検者)$/, below: true },
    { key: "checker", label: "確認", re: /^(確認|確認者|検印|審査|照査)$/, below: true },
    { key: "author", label: "作成", re: /^(作成|作成者|担当|担当者)$/, below: true },
    { key: "purpose", label: "目的", re: /^目的$/ },
    { key: "category", label: "区分", re: /^(区分|分類|作業区分)$/ },
    { key: "ppe", label: "保護具", re: /保護具/, list: true },
    { key: "tools", label: "設備・治工具", re: /^(使用)?(治工具|工具|設備・?治工具|治具|道具|使用設備)/, list: true },
    { key: "materials", label: "部品・材料", re: /^(使用)?(部品|材料|部材)$/, list: true },
    { key: "cautions", label: "安全上の注意", re: /安全(上の)?注意|注意事項|安全事項/, list: true },
    { key: "videoFile", label: "動画ファイル", re: /^(動画|動画ファイル|動画名|映像)$/ },
    // 値としては使わないが、項目名なので値と間違えないようにするもの
    { key: "_", re: /^(品証|製造|関連標準|ページ|頁|会社名|部署|部署名|図解no\.?|図no\.?|図解|写真)$/ }
  ];

  var STOP_RE = /^(改訂履歴|改訂記録|改定履歴|変更履歴|改訂来歴|改訂欄)$/;
  var VIDEO_EXT = /\.(mp4|m4v|webm|mov|avi|wmv)$/i;

  // 比較用に整える（空白・末尾のコロン・「（何を）」のような括弧書きを除く）
  function norm(s) {
    return String(s || "").normalize("NFKC").replace(/\s+/g, "").replace(/\([^)]*\)/g, "").replace(/:$/, "").toLowerCase();
  }
  // 見出し・項目名らしい短い文字か（値と区別するため）
  function isLabel(text) {
    var n = norm(text);
    if (!n || n.length > 10) return false;
    return INFO.some(function (f) { return f.re.test(n); }) || COLS.some(function (f) { return f.re.test(n); });
  }

  // ---------- 見出し行と列の自動判定 ----------
  function matchHeader(row) {
    var map = {};
    var n = 0;
    row.forEach(function (cell, c) {
      var t = norm(cell);
      if (!t || t.length > 20) return;
      for (var i = 0; i < COLS.length; i++) {
        if (map[COLS[i].key] === undefined && COLS[i].re.test(t)) { map[COLS[i].key] = c; n++; break; }
      }
    });
    return { map: map, score: n + (map.step !== undefined ? 1 : 0) + (map.point !== undefined ? 1 : 0) };
  }

  function detect(sheet) {
    var best = { row: -1, score: 0, map: {} };
    var limit = Math.min(sheet.rows.length, 80);
    for (var r = 0; r < limit; r++) {
      var h = matchHeader(sheet.rows[r]);
      if (h.score > best.score) best = { row: r, score: h.score, map: h.map };
    }
    var mapping = { headerRow: best.row, headerRows: 1, cols: {} };
    COL_ORDER.forEach(function (k) { mapping.cols[k] = -1; });
    if (best.row < 0) return mapping;
    Object.keys(best.map).forEach(function (k) { mapping.cols[k] = best.map[k]; });

    // 見出しが 2 段の場合（例: 「急所」の下に「内容」「理由」）
    var next = sheet.rows[best.row + 1];
    if (next) {
      var h2 = matchHeader(next);
      var added = 0;
      Object.keys(h2.map).forEach(function (k) {
        if (mapping.cols[k] === -1 || mapping.cols[k] === h2.map[k]) { if (mapping.cols[k] === -1) added++; mapping.cols[k] = h2.map[k]; }
      });
      var stepText = mapping.cols.step >= 0 ? next[mapping.cols.step] : "";
      if (Object.keys(h2.map).length && (added || !stepText || isLabel(stepText))) mapping.headerRows = 2;
    }
    return mapping;
  }

  // ---------- 文書情報 ----------
  function readInfo(sheet, untilRow) {
    var info = {};
    var rows = sheet.rows;
    var end = untilRow < 0 ? Math.min(rows.length, 30) : untilRow;

    function valueRight(r, c) {
      for (var k = c + 1; k < Math.min(rows[r].length, c + 8); k++) {
        var v = rows[r][k];
        if (v) return isLabel(v) ? "" : v;
      }
      return "";
    }
    function valueBelow(r, c) {
      for (var k = r + 1; k < Math.min(rows.length, r + 3); k++) {
        var v = rows[k] && rows[k][c];
        if (v) return isLabel(v) ? "" : v;
      }
      return "";
    }

    for (var r = 0; r < end; r++) {
      for (var c = 0; c < rows[r].length; c++) {
        var raw = rows[r][c];
        if (!raw) continue;
        var label = raw, inline = "";
        // 「品番：BR-1024」のように 1 つのセルに入っている場合
        var m = /^([^:：\n]{1,12})[:：]\s*([\s\S]+)$/.exec(raw);
        if (m) { label = m[1]; inline = m[2].trim(); }
        var n = norm(label);
        for (var i = 0; i < INFO.length; i++) {
          var f = INFO[i];
          if (info[f.key] !== undefined || !f.re.test(n)) continue;
          // 承認・確認・作成の欄は、項目名の下だけを見る（右隣は別の項目名のため）
          var v = inline || (f.below ? valueBelow(r, c) : (valueRight(r, c) || valueBelow(r, c)));
          if (f.key === "_") break;
          if (v) info[f.key] = v;
          if (f.below) (info._pos || (info._pos = {}))[f.key] = { r: r, c: c };
          // 社内フォーマットの項目名（例：管理番号・工程名・作業名称（部品名））を、表示にもそのまま使う
          if (!info._labels) info._labels = {};
          info._labels[f.key] = label.replace(/[\s　]+/g, "");
          break;
        }
      }
    }

    // 作業名が無い場合: 「○○ 作業要領書」のような表題セルから
    if (!info.title) {
      for (var r2 = 0; r2 < end && !info.title; r2++) {
        for (var c2 = 0; c2 < rows[r2].length; c2++) {
          var t = rows[r2][c2];
          if (t && /要領書|作業標準|作業手順書|作業指導書/.test(t)) {
            var s = t.replace(/作業要領書|要領書|作業標準書?|作業手順書|作業指導書/g, "").replace(/^[\s　（(「【\-－:：]+|[\s　）)」】\-－:：]+$/g, "");
            if (s) { info.title = s; break; }
          }
        }
      }
    }
    return info;
  }

  // 「2025/4/1」「2025年4月1日」「令和7年4月1日」「R7.4.1」→ 2025-04-01（読めなければそのまま）
  function toISODate(v) {
    var s = String(v || "").trim();
    if (!s) return "";
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    var m = /^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/.exec(s);
    if (m) return m[1] + "-" + p(+m[2]) + "-" + p(+m[3]);
    m = /^(令和|R|平成|H)\s*(\d{1,2}|元)[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/i.exec(s);
    if (m) {
      var y = m[2] === "元" ? 1 : +m[2];
      y += /^(令和|r)$/i.test(m[1]) ? 2018 : 1988;
      return y + "-" + p(+m[3]) + "-" + p(+m[4]);
    }
    return s;
  }

  function half(v) { return String(v || "").normalize("NFKC").trim(); }

  function splitList(v) {
    return String(v || "").split(/\n|、|，|,|・/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function splitPairs(v) {
    return splitList(v).map(function (x) {
      var m = /^(.*?)[\s　]*[×x＊*]?[\s　]*(\d+[^\d\s]{0,3})$/.exec(x);
      return m && m[1] ? { name: m[1], qty: m[2] } : { name: x, qty: "" };
    });
  }

  // ---------- 動画欄の読み取り ----------
  // 例: "assy.mp4 0:00-0:06" / "0:06〜0:12" / リンク付きセル
  function parseVideo(text, link, fallbackSrc) {
    var v = { src: "", start: "", end: "" };
    var name = "";
    if (link && VIDEO_EXT.test(link.split(/[?#]/)[0])) name = link;
    var m = /([^\s　"]+\.(mp4|m4v|webm|mov|avi|wmv))/i.exec(text || "");
    if (!name && m) name = m[1];
    var tm = /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-~〜～－]\s*(\d{1,2}:\d{2}(?::\d{2})?)?/.exec(text || "");
    if (name) v.src = "videos/" + name.replace(/\\/g, "/").split("/").pop();
    else if (tm && fallbackSrc) v.src = fallbackSrc;
    if (tm && v.src) { v.start = tm[1]; v.end = tm[2] || ""; }
    return v;
  }

  function stripBullet(s) { return s.replace(/^[・●◆◇■□○\-\*＊]\s*/, "").trim(); }
  function kindOf(s) {
    s = norm(s);
    if (/安全|^安$/.test(s)) return "safety";
    if (/品質|^品$/.test(s)) return "quality";
    if (/やりやすさ|やり易さ|作業性|^易$/.test(s)) return "ease";
    return "";
  }

  // ---------- 手順の組み立て ----------
  function build(sheet, mapping, fileTitle) {
    var rows = sheet.rows;
    var C = mapping.cols;
    var info = readInfo(sheet, mapping.headerRow);
    var d = {
      // 番号・ライン名などは全角／半角をそろえる（「Ｎライン」と「Nライン」が一覧で別々にならないように）
      id: "", docNo: half(info.docNo), title: info.title || fileTitle || sheet.name,
      category: half(info.category), process: half(info.process), line: half(info.line), product: half(info.product),
      revision: info.revision || "", issued: toISODate(info.issued), updated: toISODate(info.updated || info.issued),
      author: info.author || "", inspector: info.inspector || "", checker: info.checker || "", approver: info.approver || "", purpose: info.purpose || "",
      cautions: splitList(info.cautions), ppe: splitList(info.ppe), tools: splitPairs(info.tools), materials: splitPairs(info.materials),
      steps: [], revisions: []
    };
    var defaultVideo = info.videoFile ? parseVideo(info.videoFile, null, "").src || ("videos/" + info.videoFile) : "";

    var images = [];
    if (mapping.headerRow < 0) return { data: d, images: images, info: info, starts: [] };

    var cell = function (r, k) { return C[k] >= 0 ? (rows[r][C[k]] || "") : ""; };
    var starts = [];      // 各手順の開始行
    var lastRows = [];    // 各手順の最後の行（写真・印の割り当てに使う）
    var cur = null;
    var lastNo = "";
    var stopAt = rows.length;
    var first = mapping.headerRow + mapping.headerRows;

    // 改訂履歴の表（「改訂履歴」の見出し、または「改訂内容」などの列がある行）で手順を終わる
    function isStop(row) {
      var firstText = "";
      for (var c = 0; c < row.length; c++) if (row[c]) { firstText = row[c]; break; }
      if (STOP_RE.test(norm(firstText))) return true;
      return row.some(function (t) { return /^(改訂|改定|変更)(内容|履歴|記録|事項|来歴)$/.test(norm(t)); });
    }
    var numOf = function (v) { var n = String(v || "").normalize("NFKC").trim(); return /^\d+\.?$/.test(n) ? n.replace(".", "") : ""; };
    for (var r0 = first; r0 < rows.length; r0++) if (isStop(rows[r0])) { stopAt = r0; break; }
    // No. 欄に番号が付いている形式なら、番号が変わったところで次の手順にする
    // （番号の無い行は前の手順の続き：長い文が 2 行に分かれている場合など）
    var numbered = C.no >= 0 && rows.slice(first, stopAt).filter(function (row) { return numOf(row[C.no]); }).length >= 2;

    for (var r = first; r < stopAt; r++) {
      var no = cell(r, "no"), step = cell(r, "step"), detail = cell(r, "detail");
      var point = cell(r, "point"), reason = cell(r, "reason"), kind = cell(r, "kind");
      var time = cell(r, "time"), vtext = cell(r, "video");
      // 番号だけの行（図の番号など）や空の行は飛ばす
      if (!step && !detail && !point && !reason && !vtext) continue;
      // 途中に見出しが繰り返されている行（2 ページ目など）は飛ばす
      if (matchHeader(rows[r]).score >= 3) continue;

      var isNew = numbered
        ? !cur || (numOf(no) !== "" && numOf(no) !== lastNo)
        : !cur || !!step || (no && no !== lastNo);
      if (cur && !isNew && step) {
        // 手順の文の続き。「。」などで終わっていなければ、改行せずにつなげる
        cur.title += /[。．.！!？?)）]$/.test(cur.title) || /^[※＊*・]/.test(step) ? "\n" + step : step;
      }
      if (isNew) {
        // 手順名が無く詳しい説明だけある場合は、説明の 1 行目を手順名にする
        var title = step;
        var det = detail;
        if (!title && det) { var lines = det.split("\n"); title = lines.shift(); det = lines.join("\n"); }
        if (!title && !no && !point) continue;
        cur = { title: title, detail: det, points: [], kinds: [], time: "", image: "", video: { src: "", start: "", end: "" } };
        d.steps.push(cur);
        starts.push(r);
        lastRows.push(r);
        lastNo = numbered ? numOf(no) : no;
      } else if (detail) {
        cur.detail = cur.detail ? cur.detail + "\n" + detail : detail;
      }

      lastRows[lastRows.length - 1] = r;

      // 急所と理由（セル内の改行で複数ある場合は、同じ順番で対応させる）
      var ps = point ? point.split("\n").map(stripBullet).filter(Boolean) : [];
      var rs = reason ? reason.split("\n").map(stripBullet).filter(Boolean) : [];
      if (ps.length && rs.length && rs.length !== ps.length) rs = [rs.join(" ")];
      var rowKind = kindOf(kind);
      ps.forEach(function (p, i) {
        var k = rowKind;
        var km = /^[【\[（(<＜]?(安全|品質|やりやすさ|作業性)[】\]）)>＞]\s*/.exec(p);
        if (km) { k = kindOf(km[1]); p = p.slice(km[0].length).trim(); }
        cur.points.push({ text: p, reason: rs.length === ps.length ? rs[i] : (i === 0 ? rs[0] || "" : ""), kind: k, video: { src: "", start: "", end: "" } });
      });
      if (!ps.length && rs.length && cur.points.length) {
        var lp = cur.points[cur.points.length - 1];
        lp.reason = lp.reason ? lp.reason + " " + rs.join(" ") : rs.join(" ");
      }

      if (time && !cur.time) {
        var t = parseFloat(String(time).replace(/[^\d.]/g, ""));
        if (!isNaN(t)) cur.time = t;
      }

      // 動画（動画の列、またはその行の動画へのリンク）
      if (!cur.video.src) {
        var link = C.video >= 0 ? sheet.links[r + "," + C.video] : null;
        if (!link) {
          for (var c3 = 0; c3 < rows[r].length; c3++) {
            var l = sheet.links[r + "," + c3];
            if (l && VIDEO_EXT.test(l.split(/[?#]/)[0])) { link = l; break; }
          }
        }
        var prevSrc = d.steps.length > 1 ? d.steps[d.steps.length - 2].video.src : "";
        var v = parseVideo(vtext, link, prevSrc || defaultVideo);
        if (v.src) cur.video = v;
      }
    }

    // 改訂履歴（手順の下にある場合）
    if (stopAt < rows.length) d.revisions = readRevisions(rows, stopAt);

    // 手順が書かれている行（＋1 行）の範囲 → 何番目の手順か。図や写真の欄に貼られたものは対象外
    function stepAt(row) {
      // その行より上で、いちばん近くから始まる手順
      for (var i = starts.length - 1; i >= 0; i--) {
        if (row >= starts[i]) return row <= lastRows[i] + 1 ? i : -1;
      }
      return -1;
    }

    // ✚（安全）◆（品質）などの印: 見本（凡例）の図形から意味を読み取り、手順の行にある印を区分にする
    var legend = readLegend(sheet.shapes || []);
    (sheet.shapes || []).forEach(function (sh) {
      var k = legend[sh.prst];
      if (!k || sh.text || sh.row < first) return;
      var i = stepAt(sh.row);
      if (i >= 0 && d.steps[i].kinds.indexOf(k) === -1) d.steps[i].kinds.push(k);
    });
    d.steps.forEach(function (s) {
      s.kinds.sort(function (a, b) { return KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b); });
    });

    // 社内フォーマットの見出し・項目名をそのまま表示に使う（要素作業手順・急所ポイント・管理番号 など）
    var hdr = rows[mapping.headerRow] || [];
    var hdr2 = mapping.headerRows === 2 ? rows[mapping.headerRow + 1] || [] : [];
    var clean = function (t) { return String(t || "").replace(/[\s　]+/g, ""); };
    var terms = {};
    ["step", "point", "reason"].forEach(function (k) {
      if (C[k] >= 0) { var t = clean(hdr2[C[k]] || hdr[C[k]]); if (t && t.length <= 20) terms[k] = t; }
    });
    var L = info._labels || {};
    ["docNo", "title", "process", "line", "product"].forEach(function (k) { if (L[k]) terms[k] = L[k]; });
    if (Object.keys(terms).length) d.terms = terms;

    // 画像: 各手順の行の範囲に貼られている最初の画像を、その手順の写真にする
    // 写真のファイル名。番号の無い管理番号（「GK-」など）だと他の要領書と同じ名前になるので、日時を使う
    var base = String(d.docNo || "").normalize("NFKC").replace(/[^\w\-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "");
    if (!/\d/.test(base)) base = "xl" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    var extra = 0;
    sheet.images.filter(function (im) { return !im.unsupported && !im.inGroup; }).sort(function (a, b) { return a.row - b.row || a.col - b.col; }).forEach(function (im) {
      var idx = stepAt(im.row);
      if (idx < 0) return;
      var s = d.steps[idx];
      if (s.image) { extra++; return; }
      var ext = im.ext === "jpeg" ? "jpg" : im.ext;
      s.image = "images/" + base + "_" + (idx + 1) + "." + ext;
      images.push({ src: s.image, bytes: im.bytes, type: ext === "jpg" ? "image/jpeg" : "image/" + ext });
    });

    var stampNotes = readStamps(sheet, info, d, base, images);

    // 区間の「開始」が空で、前の手順と同じ動画なら、前の「終了」から始める
    d.steps.forEach(function (s, i) {
      var p = d.steps[i - 1];
      if (p && s.video.src && s.video.src === p.video.src && !s.video.start && p.video.end) s.video.start = p.video.end;
    });

    return { data: d, images: images, info: info, starts: starts, extraImages: extra, stampNotes: stampNotes };
  }

  // ---------- 判子（承認・点検・確認・作成の欄に押した印） ----------
  // 項目名の下の欄に置いてある画像は、判子の画像として取り込む。
  // 図形（〇と文字）で作った判子は、その文字を名前にする
  var STAMP_KEYS = ["approver", "inspector", "checker", "author"];
  var STAMP_LABEL = { approver: "承認", inspector: "点検", checker: "確認", author: "作成" };
  function photoCount(res) { return res.images.filter(function (im) { return !im.stamp; }).length; }
  function readStamps(sheet, info, d, base, images) {
    var pos = info._pos || {};
    var notes = [];
    function mergeAt(r, c) {
      for (var i = 0; i < sheet.merges.length; i++) {
        var m = sheet.merges[i];
        if (r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) return m;
      }
      return { r1: r, c1: c, r2: r, c2: c };
    }
    // 画像・図形が欄にどれだけ重なっているか（0〜1）。少しはみ出して置いてあっても欄のものとみなす
    function overlap(o, a) {
      var b = o.box || { r1: o.row, c1: o.col, r2: o.toRow + 1, c2: o.toCol + 1 };
      var h = Math.min(b.r2, a.r2 + 1) - Math.max(b.r1, a.r1);
      var w = Math.min(b.c2, a.c2 + 1) - Math.max(b.c1, a.c1);
      if (h <= 0 || w <= 0) return 0;
      var area = Math.max((b.r2 - b.r1) * (b.c2 - b.c1), 1e-6);
      return h * w / area;
    }
    function best(list, a) {
      var top = null, score = 0.3;
      list.forEach(function (x) { var v = overlap(x, a); if (v > score) { score = v; top = x; } });
      return top;
    }
    var pics = (sheet.images || []).concat(sheet.cellImages || []);
    STAMP_KEYS.forEach(function (key) {
      var p = pos[key];
      if (!p) return;
      var lab = mergeAt(p.r, p.c);
      var box = mergeAt(lab.r2 + 1, lab.c1);
      var area = { r1: lab.r2 + 1, r2: box.r2, c1: lab.c1, c2: Math.max(lab.c2, box.c2) };
      var im = best(pics, area);
      if (im) {
        pics = pics.filter(function (x) { return x !== im; });
        if (im.unsupported) {
          notes.push(STAMP_LABEL[key] + "の判子は " + im.ext.toUpperCase() + " 形式の画像のため、画像として取り込めませんでした");
        } else {
          var ext = im.ext === "jpeg" ? "jpg" : im.ext;
          var src = "images/" + base + "_stamp_" + key + "." + ext;
          (d.stamps || (d.stamps = {}))[key] = src;
          images.push({ src: src, bytes: im.bytes, type: ext === "jpg" ? "image/jpeg" : "image/" + ext, stamp: key });
        }
      }
      if (!d[key]) {
        // 図形の判子：同じまとまり（グループ）の文字を読む。
        // 日付の行は除き、1 文字ずつの行（縦書きの「長／坂」）はつなげ、それ以外は最後の行（日付印の名前）を使う
        var text = {};
        (sheet.shapes || []).forEach(function (sp) {
          if (sp.text && overlap(sp, area) > 0.3) text[sp.group] = (text[sp.group] ? text[sp.group] + "\n" : "") + sp.text;
        });
        var name = Object.keys(text).map(function (g) {
          var lines = text[g].split("\n").map(function (x) { return x.replace(/[\s　]+/g, ""); }).filter(function (x) {
            return x && !/^(R|H|令和|平成|'|’)?\d{1,4}[.\/\-年]\d{1,2}([.\/\-月]\d{1,2}日?)?$/.test(x);
          });
          if (lines.every(function (x) { return x.length === 1; })) return lines.join("");
          return lines[lines.length - 1];
        }).filter(Boolean)[0];
        if (name && name.length <= 10) d[key] = name;
      }
    });
    return notes;
  }

  var KIND_ORDER = ["safety", "quality", "ease"];
  var DEFAULT_LEGEND = { plus: "safety", flowChartDecision: "quality", diamond: "quality" };

  // 「✚ 安全ポイント」「◆ 品質ポイント」のような凡例から、図形の形 → 区分 の対応を作る
  function readLegend(shapes) {
    var map = {};
    Object.keys(DEFAULT_LEGEND).forEach(function (k) { map[k] = DEFAULT_LEGEND[k]; });
    shapes.forEach(function (label) {
      var k = kindOf(label.text.replace(/ポイント|マーク|記号/g, ""));
      if (!k) return;
      // 文字の左にある、文字の無い図形が見本
      var best = null;
      shapes.forEach(function (sh) {
        if (sh.text || !sh.prst || Math.abs(sh.row - label.row) > 1 || sh.col > label.col || label.col - sh.col > 3) return;
        var dist = Math.abs(sh.row - label.row) * 10 + (label.col - sh.col);
        if (!best || dist < best.dist) best = { prst: sh.prst, dist: dist };
      });
      if (best) map[best.prst] = k;
    });
    return map;
  }

  function readRevisions(rows, from) {
    var revRe = /^(改訂|改定|版|rev|no|改訂no|改訂番号)\.?$/i;
    var hdr = -1, maps = [];
    for (var r = from; r < Math.min(rows.length, from + 4); r++) {
      // 左右に同じ表が並んでいる形式にも対応（「NO.」が出てきたら次の表）
      var list = [], m = {};
      rows[r].forEach(function (t, c) {
        var n = norm(t);
        if (!n) return;
        if (revRe.test(n)) {
          if (m.rev !== undefined) { list.push(m); m = {}; }
          m.rev = c;
        }
        else if (m.date === undefined && /日/.test(n)) m.date = c;
        else if (m.content === undefined && /内容|理由|事項|概要/.test(n)) m.content = c;
        else if (m.by === undefined && /者|担当|作成|承認/.test(n)) m.by = c;
      });
      list.push(m);
      list = list.filter(function (x) { return Object.keys(x).length >= 2; });
      if (list.length) { hdr = r; maps = list; break; }
    }
    if (hdr < 0) return [];
    var out = [];
    maps.forEach(function (map) {
      for (var r2 = hdr + 1; r2 < rows.length; r2++) {
        var g = function (k) { return map[k] !== undefined ? rows[r2][map[k]] || "" : ""; };
        var rec = { rev: g("rev"), date: toISODate(g("date")), content: g("content"), by: g("by") };
        // 日付も内容も無い行（番号だけの空欄）は取り込まない
        if (!rec.date && !rec.content) continue;
        out.push(rec);
      }
    });
    return out;
  }

  // =========================================================
  // 画面
  // =========================================================
  var dlg, els = {};
  var book = null, sheet = null, mapping = null, result = null, fileTitle = "";
  var onDone = null;

  function $(id) { return document.getElementById(id); }

  function setup() {
    dlg = $("xl");
    ["xlFile", "xlSheet", "xlHeader", "xlMap", "xlInfo", "xlSteps", "xlGrid", "xlMsg", "xlApply", "xlClose", "xlBody"].forEach(function (id) { els[id] = $(id); });
    els.xlClose.addEventListener("click", close);
    els.xlFile.addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (f) loadFile(f);
      this.value = "";
    });
    els.xlSheet.addEventListener("change", function () { loadSheet(parseInt(this.value, 10)); });
    els.xlHeader.addEventListener("change", function () {
      var v = parseInt(this.value, 10);
      if (v >= 1) { mapping.headerRow = v - 1; refresh(); }
    });
    els.xlMap.addEventListener("change", function (ev) {
      var k = ev.target.getAttribute("data-k");
      if (!k) return;
      mapping.cols[k] = parseInt(ev.target.value, 10);
      refresh();
    });
    els.xlApply.addEventListener("click", function () {
      if (!result || !result.data.steps.length) return;
      var r = result;
      close();
      onDone(r);
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && dlg.classList.contains("open")) close();
    });
  }

  function open(cb) {
    if (!dlg) setup();
    onDone = cb;
    dlg.classList.add("open");
    document.body.style.overflow = "hidden";
    if (!book) msg("取り込む Excel ファイル（.xlsx）を選んでください。");
  }
  function close() {
    dlg.classList.remove("open");
    document.body.style.overflow = "";
  }
  function msg(html, isError) {
    els.xlMsg.className = "notice" + (isError ? " error" : "");
    els.xlMsg.innerHTML = html;
    els.xlMsg.hidden = !html;
  }

  function loadFile(f) {
    msg("読み込み中…");
    fileTitle = f.name.replace(/\.[^.]+$/, "");
    var reader = new FileReader();
    reader.onload = function () {
      XLSXReader.open(reader.result).then(function (b) {
        book = b;
        var visible = b.sheets.map(function (s, i) { return { s: s, i: i }; }).filter(function (x) { return !x.s.hidden; });
        els.xlSheet.innerHTML = visible.map(function (x) {
          return '<option value="' + x.i + '">' + esc(x.s.name) + '</option>';
        }).join("");
        els.xlSheet.disabled = visible.length < 2;
        if (!visible.length) throw new Error("シートがありません。");
        loadSheet(visible[0].i);
      }).catch(fail);
    };
    reader.onerror = function () { fail(new Error("ファイルを読み込めません。")); };
    reader.readAsArrayBuffer(f);
  }

  function fail(e) {
    msg(esc(e && e.message ? e.message : e), true);
    els.xlBody.hidden = true;
    els.xlApply.disabled = true;
  }

  function loadSheet(i) {
    msg("読み込み中…");
    els.xlSheet.value = String(i);
    book.load(i).then(function (s) {
      sheet = s;
      mapping = detect(s);
      els.xlBody.hidden = false;
      refresh();
    }).catch(fail);
  }

  function colOptions(cur) {
    var hdr = mapping.headerRow >= 0 ? sheet.rows[mapping.headerRow] || [] : [];
    var hdr2 = mapping.headerRows === 2 ? sheet.rows[mapping.headerRow + 1] || [] : [];
    var h = '<option value="-1">（使わない）</option>';
    for (var c = 0; c < sheet.cols; c++) {
      var label = (hdr[c] || hdr2[c] || "").replace(/\s+/g, " ");
      if (label.length > 14) label = label.slice(0, 14) + "…";
      h += '<option value="' + c + '"' + (c === cur ? " selected" : "") + '>' + col(c) + ' 列' + (label ? "：" + esc(label) : "") + '</option>';
    }
    return h;
  }

  function refresh() {
    result = build(sheet, mapping, book.sheets.length > 1 ? "" : fileTitle);
    var d = result.data;

    // メッセージ
    if (mapping.headerRow < 0) {
      msg("「主なステップ」「急所」などの見出しが見つかりませんでした。下の表を見て、<b>見出しの行</b>と<b>列</b>を選んでください。", true);
    } else if (!d.steps.length) {
      msg("手順を読み取れませんでした。見出しの行と列の選び方を確認してください。", true);
    } else {
      msg("自動で読み取りました。<b>手順 " + d.steps.length + " 件</b>" +
        (photoCount(result) ? "・写真 " + photoCount(result) + " 枚" : "") +
        (d.stamps ? "・判子 " + Object.keys(d.stamps).length + " 個" : "") +
        "。内容が違う場合は、見出しの行や列を選び直してください。" +
        (result.stampNotes && result.stampNotes.length ? "<br><small>" + result.stampNotes.join("。<br>") + "。名前を文字で入れるか、エディタの「判子の画像」で png・jpg の画像を付けてください。</small>" : "") +
        (result.extraImages ? "<br><small>1 つの手順に写真が複数ある場合は、最初の 1 枚だけを取り込みます（" + result.extraImages + " 枚は取り込みません）。</small>" : ""));
    }

    // 列の対応
    els.xlHeader.value = mapping.headerRow >= 0 ? mapping.headerRow + 1 : "";
    els.xlMap.innerHTML = COL_ORDER.map(function (k) {
      var f = COLS.filter(function (x) { return x.key === k; })[0];
      return '<label class="field"><span>' + f.label + '</span><select data-k="' + k + '">' + colOptions(mapping.cols[k]) + '</select></label>';
    }).join("");

    // 文書情報
    var infoRows = [
      ["作業名", d.title], ["文書番号", d.docNo], ["改訂", d.revision], ["工程", d.process], ["ライン", d.line],
      ["品番・品名", d.product], ["制定日", d.issued], ["改訂日", d.updated],
      ["作成／確認／点検／承認", ["author", "checker", "inspector", "approver"].map(function (k) {
        return (d[k] || "－") + (d.stamps && d.stamps[k] ? "（判子）" : "");
      }).join("／")],
      ["保護具", d.ppe.join("、")], ["設備・治工具", d.tools.map(function (t) { return t.name + (t.qty ? " " + t.qty : ""); }).join("、")],
      ["安全上の注意", d.cautions.join("、")], ["改訂履歴", d.revisions.length ? d.revisions.length + " 件" : ""]
    ];
    els.xlInfo.innerHTML = '<table class="info-table"><tbody>' + infoRows.map(function (x) {
      return '<tr><th>' + x[0] + '</th><td>' + (x[1] ? esc(x[1]) : '<span class="hint">（見つかりません）</span>') + '</td></tr>';
    }).join("") + '</tbody></table>';

    // 手順のプレビュー
    els.xlSteps.innerHTML = d.steps.length ? '<table class="rev-table"><thead><tr><th>No.</th><th>主なステップ</th><th>急所／理由</th><th>写真</th><th>動画</th></tr></thead><tbody>' +
      d.steps.map(function (s, i) {
        return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(s.title) + '</b>' + (s.detail ? '<br><small>' + esc(s.detail) + '</small>' : '') + '</td><td>' +
          s.points.map(function (p) {
            return (p.kind ? '<span class="kind ' + p.kind + '">' + WI.KIND_LABEL[p.kind] + '</span>' : '') + esc(p.text) +
              (p.reason ? '<br><small class="hint">理由：' + esc(p.reason) + '</small>' : '');
          }).join("<br>") + '</td><td>' + (s.image ? "あり" : "") + '</td><td>' +
          (s.video.src ? esc(s.video.src.replace(/^videos\//, "")) + (s.video.start || s.video.end ? '<br><small>' + esc(s.video.start || "0:00") + "〜" + esc(s.video.end) + '</small>' : '') : '') +
        '</td></tr>';
      }).join("") + '</tbody></table>' : "";

    // Excel の中身（どの行・列か確認用）
    var maxR = Math.min(sheet.rows.length, 120), maxC = Math.min(sheet.cols, 30);
    var used = {};
    COL_ORDER.forEach(function (k) { if (mapping.cols[k] >= 0) used[mapping.cols[k]] = true; });
    var g = '<table><thead><tr><th></th>';
    for (var c = 0; c < maxC; c++) g += '<th class="' + (used[c] ? "used" : "") + '">' + col(c) + '</th>';
    g += '</tr></thead><tbody>';
    var startSet = {};
    result.starts.forEach(function (r) { startSet[r] = true; });
    for (var r = 0; r < maxR; r++) {
      var cls = r === mapping.headerRow || (mapping.headerRows === 2 && r === mapping.headerRow + 1) ? "hdr" : (startSet[r] ? "start" : "");
      g += '<tr class="' + cls + '"><th>' + (r + 1) + '</th>';
      for (var c2 = 0; c2 < maxC; c2++) {
        var t = sheet.rows[r][c2] || "";
        g += '<td class="' + (used[c2] ? "used" : "") + '" title="' + esc(t) + '">' + esc(t.length > 24 ? t.slice(0, 24) + "…" : t) + '</td>';
      }
      g += '</tr>';
    }
    els.xlGrid.innerHTML = g + '</tbody></table>';

    els.xlApply.disabled = !d.steps.length;
  }

  window.WIImport = { open: open, detect: detect, build: build, photoCount: photoCount };
})();
