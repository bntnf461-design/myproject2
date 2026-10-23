/* =========================================================
   Excel（.xlsx）読み込み（外部ライブラリなし・オフライン動作）
   - .xlsx は ZIP の中に XML が入った形式。ブラウザ標準の解凍機能で読む
   - 取り出すもの: シートのセルの文字、結合セル、リンク、貼り付けた画像
   ========================================================= */
(function () {
  "use strict";

  // ---------- ZIP ----------
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  function readZip(buf) {
    var b = new Uint8Array(buf);
    var eocd = -1;
    for (var i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
      if (u32(b, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Excel（.xlsx）ファイルではありません。");
    var count = u16(b, eocd + 10);
    var p = u32(b, eocd + 16);
    var entries = {};
    var dec = new TextDecoder("utf-8");
    for (var n = 0; n < count; n++) {
      if (u32(b, p) !== 0x02014b50) break;
      var method = u16(b, p + 10);
      var csize = u32(b, p + 20);
      var nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32);
      var local = u32(b, p + 42);
      var name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
      var start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
      entries[name] = { method: method, data: b.subarray(start, start + csize) };
      p += 46 + nlen + xlen + clen;
    }
    return entries;
  }

  function inflate(entry) {
    if (entry.method === 0) return Promise.resolve(entry.data);
    if (entry.method !== 8) return Promise.reject(new Error("対応していない圧縮形式です。"));
    if (typeof DecompressionStream === "undefined") {
      return Promise.reject(new Error("このブラウザは Excel の読み込みに対応していません。Chrome か Edge を使ってください。"));
    }
    var stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  // ---------- XML ヘルパ ----------
  function xml(bytes) {
    return new DOMParser().parseFromString(new TextDecoder("utf-8").decode(bytes), "application/xml");
  }
  function tags(node, local) { return node ? node.getElementsByTagNameNS("*", local) : []; }
  function first(node, local) { var t = tags(node, local); return t.length ? t[0] : null; }
  function attrNS(el, local) {
    // r:id / r:embed など、接頭辞に関係なく取得
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.localName === local) return a.value;
    }
    return null;
  }

  // "xl/worksheets/sheet1.xml" と "../media/a.png" → "xl/media/a.png"
  function resolve(base, target) {
    if (target.charAt(0) === "/") return target.slice(1);
    var parts = base.split("/");
    parts.pop();
    target.split("/").forEach(function (s) {
      if (s === "..") parts.pop(); else if (s !== ".") parts.push(s);
    });
    return parts.join("/");
  }
  function relsPath(path) {
    var i = path.lastIndexOf("/");
    return path.slice(0, i) + "/_rels/" + path.slice(i + 1) + ".rels";
  }

  // "B12" → {r: 11, c: 1}
  function cellRef(ref) {
    var m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) return null;
    var c = 0;
    for (var i = 0; i < m[1].length; i++) c = c * 26 + (m[1].charCodeAt(i) - 64);
    return { r: parseInt(m[2], 10) - 1, c: c - 1 };
  }
  function colName(c) {
    var s = "";
    c++;
    while (c > 0) { var k = (c - 1) % 26; s = String.fromCharCode(65 + k) + s; c = Math.floor((c - 1) / 26); }
    return s;
  }

  // 日付の書式か
  var DATE_IDS = { 14: 1, 15: 1, 16: 1, 17: 1, 22: 1, 27: 1, 28: 1, 29: 1, 30: 1, 31: 1, 32: 1, 33: 1, 34: 1, 35: 1, 36: 1, 50: 1, 51: 1, 52: 1, 53: 1, 54: 1, 55: 1, 56: 1, 57: 1, 58: 1 };
  function isDateFormat(code) {
    var c = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    return /[yd]/i.test(c) || /m.*d|y.*m/i.test(c) || /[年月日]/.test(code);
  }
  function serialToDate(v) {
    var d = new Date(Math.round((v - 25569) * 86400000));
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
  }

  // ---------- ブック全体 ----------
  // 戻り値: Promise<{ sheets: [{name, path}], load(i) → Promise<sheet> }>
  function openWorkbook(arrayBuffer) {
    var z;
    try { z = readZip(arrayBuffer); } catch (e) { return Promise.reject(e); }
    if (!z["xl/workbook.xml"]) {
      return Promise.reject(new Error("Excel（.xlsx）ファイルではありません。古い .xls の場合は、Excel で「名前を付けて保存」→「Excel ブック（.xlsx）」で保存し直してください。"));
    }
    var cache = {};
    function get(path) {
      if (!z[path]) return Promise.resolve(null);
      if (!cache[path]) cache[path] = inflate(z[path]);
      return cache[path];
    }
    function getXml(path) { return get(path).then(function (b) { return b ? xml(b) : null; }); }
    function getRels(path) {
      return getXml(relsPath(path)).then(function (doc) {
        var map = {};
        Array.prototype.forEach.call(tags(doc, "Relationship"), function (r) {
          map[r.getAttribute("Id")] = { target: r.getAttribute("Target"), external: r.getAttribute("TargetMode") === "External" };
        });
        return map;
      });
    }

    var shared = [];
    var dateStyles = {};

    return Promise.all([
      getXml("xl/workbook.xml"), getRels("xl/workbook.xml"),
      getXml("xl/sharedStrings.xml"), getXml("xl/styles.xml")
    ]).then(function (res) {
      var wb = res[0], rels = res[1], ss = res[2], st = res[3];

      // 共有文字列（ふりがな rPh は除く）
      Array.prototype.forEach.call(tags(ss, "si"), function (si) {
        var s = "";
        Array.prototype.forEach.call(tags(si, "t"), function (t) {
          if (t.parentNode && t.parentNode.localName === "rPh") return;
          s += t.textContent;
        });
        shared.push(s);
      });

      // 日付書式のスタイル番号
      if (st) {
        var custom = {};
        Array.prototype.forEach.call(tags(st, "numFmt"), function (f) {
          custom[f.getAttribute("numFmtId")] = f.getAttribute("formatCode") || "";
        });
        var xfs = first(st, "cellXfs");
        Array.prototype.forEach.call(xfs ? xfs.children : [], function (xf, i) {
          var id = parseInt(xf.getAttribute("numFmtId") || "0", 10);
          if (DATE_IDS[id] || (custom[id] && isDateFormat(custom[id]))) dateStyles[i] = true;
        });
      }

      var sheets = [];
      Array.prototype.forEach.call(tags(wb, "sheet"), function (s) {
        var rel = rels[attrNS(s, "id")];
        if (!rel) return;
        var hidden = s.getAttribute("state") === "hidden" || s.getAttribute("state") === "veryHidden";
        sheets.push({ name: s.getAttribute("name"), path: resolve("xl/workbook.xml", rel.target), hidden: hidden });
      });

      return { sheets: sheets, load: function (i) { return loadSheet(sheets[i]); } };
    });

    // 「セルに配置」した画像（Excel 365）。セルの vm 番号（1 から）→ 画像のパス
    var cellImageMap = null;
    function cellImagePaths() {
      if (cellImageMap) return cellImageMap;
      var base = "xl/richData/richValueRel.xml";
      cellImageMap = Promise.all([
        getXml("xl/metadata.xml"), getXml("xl/richData/rdrichvalue.xml"),
        getXml("xl/richData/rdrichvaluestructure.xml"), getXml(base), getRels(base)
      ]).then(function (res) {
        var meta = res[0], rv = res[1], st = res[2], rel = res[3], rels = res[4];
        if (!meta || !rv || !rel) return [];
        var fut = Array.prototype.map.call(tags(meta, "rvb"), function (b) { return parseInt(b.getAttribute("i"), 10); });
        var keyPos = Array.prototype.map.call(st ? tags(st, "s") : [], function (s) {
          var ks = Array.prototype.map.call(tags(s, "k"), function (k) { return k.getAttribute("n"); });
          return ks.indexOf("_rvRel:LocalImageIdentifier");
        });
        var values = Array.prototype.map.call(tags(rv, "rv"), function (r) {
          var pos = keyPos[parseInt(r.getAttribute("s") || "0", 10)];
          var v = pos >= 0 ? tags(r, "v")[pos] : null;
          return v ? parseInt(v.textContent, 10) : -1;
        });
        var relIds = Array.prototype.map.call(tags(rel, "rel"), function (x) { return attrNS(x, "id"); });
        var vm = first(meta, "valueMetadata");
        return Array.prototype.map.call(vm ? vm.children : [], function (bk) {
          var rc = first(bk, "rc");
          var i = rc ? fut[parseInt(rc.getAttribute("v"), 10)] : -1;
          var r = rels[relIds[values[i]]];
          return r ? resolve(base, r.target) : "";
        });
      }).catch(function () { return []; });
      return cellImageMap;
    }

    function loadSheet(sh) {
      return Promise.all([getXml(sh.path), getRels(sh.path)]).then(function (res) {
        var doc = res[0], rels = res[1];
        var rows = [];
        var maxC = 0;
        var vmCells = []; // セルに配置した画像 { row, col, vm }

        Array.prototype.forEach.call(tags(doc, "c"), function (c) {
          var ref = cellRef(c.getAttribute("r") || "");
          if (!ref) return;
          var t = c.getAttribute("t");
          if (c.getAttribute("vm")) vmCells.push({ row: ref.r, col: ref.c, vm: parseInt(c.getAttribute("vm"), 10) });
          var vEl = first(c, "v");
          var v = vEl ? vEl.textContent : "";
          var text;
          if (t === "s") text = shared[parseInt(v, 10)] || "";
          else if (t === "inlineStr") text = Array.prototype.map.call(tags(c, "t"), function (x) { return x.textContent; }).join("");
          else if (t === "b") text = v === "1" ? "TRUE" : "FALSE";
          else if (t === "str") text = v;
          else if (t === "e") text = ""; // #VALUE! などのエラー（セル内の画像など）は空として扱う
          else if (v !== "" && dateStyles[parseInt(c.getAttribute("s") || "0", 10)]) text = serialToDate(parseFloat(v));
          else if (v !== "") text = String(Math.round(parseFloat(v) * 1e6) / 1e6);
          else text = "";
          text = text.replace(/\r\n?/g, "\n").trim();
          if (!text) return;
          (rows[ref.r] || (rows[ref.r] = []))[ref.c] = text;
          if (ref.c + 1 > maxC) maxC = ref.c + 1;
        });

        // 空行・空セルを "" で埋める
        for (var r = 0; r < rows.length; r++) {
          var row = rows[r] || (rows[r] = []);
          for (var c2 = 0; c2 < maxC; c2++) if (row[c2] === undefined) row[c2] = "";
        }

        // 結合セル
        var merges = Array.prototype.map.call(tags(doc, "mergeCell"), function (mc) {
          var p = (mc.getAttribute("ref") || "").split(":");
          var a = cellRef(p[0]), b = cellRef(p[1] || p[0]);
          return a && b ? { r1: a.r, c1: a.c, r2: b.r, c2: b.c } : null;
        }).filter(Boolean);

        // セルのリンク（動画ファイルへのリンクなど）
        var links = {};
        Array.prototype.forEach.call(tags(doc, "hyperlink"), function (h) {
          var rel = rels[attrNS(h, "id")];
          var target = rel ? rel.target : (h.getAttribute("location") || "");
          var p = (h.getAttribute("ref") || "").split(":");
          var a = cellRef(p[0]);
          if (a && target) links[a.r + "," + a.c] = decodeURI(target);
        });

        // 貼り付けた画像（左上の位置で、どの行のものか判断）
        var drawingEl = first(doc, "drawing");
        var drawingRel = drawingEl && rels[attrNS(drawingEl, "id")];
        var imagesP = Promise.resolve([]);
        var shapes = []; // 図形（✚ や ◆ などの印・テキストボックス）{ row, col, prst, text }
        if (drawingRel) {
          var dPath = resolve(sh.path, drawingRel.target);
          imagesP = Promise.all([getXml(dPath), getRels(dPath)]).then(function (dr) {
            var ddoc = dr[0], drels = dr[1];
            if (!ddoc) return [];
            var anchors = [].concat(
              Array.prototype.slice.call(tags(ddoc, "twoCellAnchor")),
              Array.prototype.slice.call(tags(ddoc, "oneCellAnchor")),
              Array.prototype.slice.call(tags(ddoc, "absoluteAnchor"))
            );
            var list = [];
            anchors.forEach(function (an) {
              var fromEl = first(an, "from");
              var aRow = fromEl ? parseInt((first(fromEl, "row") || {}).textContent || "0", 10) : 0;
              var aCol = fromEl ? parseInt((first(fromEl, "col") || {}).textContent || "0", 10) : 0;
              // 右下の位置（無ければ左上と同じ）。判子など、どのセルの上に置いてあるかの判断に使う
              var toEl = first(an, "to");
              var tRow = toEl ? parseInt((first(toEl, "row") || {}).textContent || "0", 10) : aRow;
              var tCol = toEl ? parseInt((first(toEl, "col") || {}).textContent || "0", 10) : aCol;
              var g = anchors.indexOf(an);
              Array.prototype.forEach.call(tags(an, "sp"), function (sp) {
                var g = first(sp, "prstGeom");
                shapes.push({
                  row: aRow, col: aCol, toRow: tRow, toCol: tCol, group: g,
                  prst: g ? g.getAttribute("prst") : "",
                  // 段落ごとに改行を入れる（判子の「部署／日付／名前」などを分けて読めるように）
                  text: Array.prototype.map.call(tags(sp, "p"), function (pa) {
                    return Array.prototype.map.call(tags(pa, "t"), function (x) { return x.textContent; }).join("");
                  }).join("\n").trim()
                });
              });
              var blip = first(an, "blip");
              var from = first(an, "from");
              if (!blip || !from) return;
              var rel = drels[attrNS(blip, "embed")];
              if (!rel) return;
              var path = resolve(dPath, rel.target);
              list.push({ row: aRow, col: aCol, toRow: tRow, toCol: tCol, path: path });
            });
            return Promise.all(list.map(function (im) {
              return get(im.path).then(function (bytes) {
                im.bytes = bytes;
                im.ext = (im.path.split(".").pop() || "png").toLowerCase();
                return im;
              });
            })).then(function (arr) {
              // ブラウザで表示できる形式だけ
              return arr.filter(function (im) { return im.bytes && /^(png|jpe?g|gif|bmp|webp)$/.test(im.ext); });
            });
          });
        }

        var cellImagesP = !vmCells.length ? Promise.resolve([]) : cellImagePaths().then(function (paths) {
          return Promise.all(vmCells.map(function (vc) {
            var path = paths[vc.vm - 1];
            if (!path) return null;
            return get(path).then(function (bytes) {
              var ext = (path.split(".").pop() || "png").toLowerCase();
              return bytes && /^(png|jpe?g|gif|bmp|webp)$/.test(ext) ? { row: vc.row, col: vc.col, toRow: vc.row, toCol: vc.col, path: path, bytes: bytes, ext: ext } : null;
            });
          })).then(function (arr) { return arr.filter(Boolean); });
        });

        return Promise.all([imagesP, cellImagesP]).then(function (res) {
          return { name: sh.name, rows: rows, cols: maxC, merges: merges, links: links, images: res[0], shapes: shapes, cellImages: res[1] };
        });
      });
    }
  }

  window.XLSXReader = { open: openWorkbook, colName: colName };
})();
