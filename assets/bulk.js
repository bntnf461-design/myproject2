/* =========================================================
   Excel まとめて取り込み
   - 複数の Excel（フォルダごとでも可）を読み、シートごとに要領書にする
   - 列の意味は 1 件ずつの取り込みと同じく自動で判断（社内フォーマットにも対応）
   - 選んだものを一度にフォルダへ保存し、一覧（目録）にも追加する
   ========================================================= */
(function () {
  "use strict";
  var esc = WI.esc;
  var rowsEl = document.getElementById("rows");
  var saveBtn = document.getElementById("saveAll");
  var overwriteEl = document.getElementById("overwrite");
  var items = [];      // { file, sheet, data, images, existing, status, checked }
  var existing = {};   // 登録済みの要領書: 見分ける鍵 → ファイル名
  var busy = false;

  if (!WIFolder.supported) {
    notice("このブラウザではフォルダに保存できません。<b>Chrome か Edge</b> で開いてください。", true);
  }

  // 登録済みの要領書（同じものを二重に取り込まないため）
  WI.loadManualFiles((window.CATALOG && window.CATALOG.files) || [], function (results) {
    results.forEach(function (r) { if (r.data) existing[keyOf(r.data)] = r.file; });
    items.forEach(markExisting);
    render();
  });

  // 管理番号（番号が入っているもの）で見分ける。無ければ作業名＋工程
  function docNoKey(d) {
    var n = String(d.docNo || "").normalize("NFKC").replace(/\s+/g, "");
    return /\d/.test(n) ? n : "";
  }
  function keyOf(d) {
    var n = docNoKey(d);
    return n ? "no:" + n : "t:" + String(d.title || "").normalize("NFKC").replace(/\s+/g, "") + "|" + String(d.process || "").normalize("NFKC").replace(/\s+/g, "");
  }
  function markExisting(it) {
    if (!it.data) return;
    it.existing = existing[keyOf(it.data)] || null;
    if (it.existing && it.status === "ok" && !it.dup) it.checked = overwriteEl.checked;
  }

  function notice(html, isError) {
    document.getElementById("msgArea").innerHTML = html ? '<div class="notice' + (isError ? " error" : "") + '" style="margin-bottom:16px">' + html + '</div>' : "";
  }

  // ---------- 読み込み ----------
  function addFiles(list, done) {
    done = done || function () {};
    if (busy) { done(); return; }
    var files = Array.prototype.filter.call(list, function (f) {
      return !/^~\$/.test(f.name); // Excel を開いているときにできる一時ファイルは除く
    });
    var xl = files.filter(function (f) { return /\.(xlsx|xlsm)$/i.test(f.name); });
    var old = files.filter(function (f) { return /\.xls$/i.test(f.name); });
    var oldNames = old.slice(0, 5).map(function (f) { return esc(f.name); }).join("、") + (old.length > 5 ? " ほか" : "");
    if (!xl.length) {
      notice(old.length ? "古い形式（.xls）のファイルは読めません（" + oldNames + "）。Excel で開いて「名前を付けて保存」→「Excel ブック (.xlsx)」で保存し直してください。" : "Excel ファイル（.xlsx）が見つかりません。", true);
      done();
      return;
    }
    busy = true;
    saveBtn.disabled = true;
    var i = 0;
    (function next() {
      if (i >= xl.length) {
        busy = false;
        done();
        notice(old.length ? "古い形式（.xls）の " + old.length + " ファイルは読めませんでした（" + oldNames + "）。Excel で「Excel ブック (.xlsx)」として保存し直してください。" : "", !!old.length);
        render();
        return;
      }
      var f = xl[i++];
      notice("読み込み中… " + i + " / " + xl.length + "　" + esc(f.name));
      readFile(f).then(next, function (e) {
        items.push({ file: f.name, sheet: "", status: "error", message: e && e.message ? e.message : String(e), checked: false });
        next();
      });
    })();
  }

  function readFile(f) {
    var fileTitle = f.name.replace(/\.[^.]+$/, "");
    return f.arrayBuffer().then(XLSXReader.open).then(function (book) {
      var sheets = book.sheets.map(function (s, i) { return { s: s, i: i }; }).filter(function (x) { return !x.s.hidden; });
      var found = 0;
      return sheets.reduce(function (pr, x) {
        return pr.then(function () {
          return book.load(x.i).then(function (sheet) {
            var res = WIImport.build(sheet, WIImport.detect(sheet), sheets.length > 1 ? "" : fileTitle);
            // シートが複数ある場合、手順の無いシート（表紙・一覧など）は黙って飛ばす
            if (!res.data.steps.length && sheets.length > 1) return;
            found++;
            var it = {
              file: f.name, sheet: sheets.length > 1 ? x.s.name : "",
              data: res.data, images: res.images,
              status: res.data.steps.length ? "ok" : "empty", checked: !!res.data.steps.length
            };
            markExisting(it);
            // 同じ Excel を 2 回選んだ場合など、今回の中で同じものは 1 つだけ
            if (it.data.steps.length && items.some(function (o) { return o.data && keyOf(o.data) === keyOf(it.data); })) {
              it.dup = true;
              it.checked = false;
            }
            items.push(it);
          });
        });
      }, Promise.resolve()).then(function () {
        if (!found) items.push({ file: f.name, sheet: "", status: "empty", checked: false });
      });
    });
  }

  // ---------- 表示 ----------
  function render() {
    document.getElementById("resultSec").hidden = !items.length;
    rowsEl.innerHTML = items.map(function (it, i) {
      var d = it.data;
      var st = it.status === "error" ? '<span class="st err">読めません</span><br><small>' + esc(it.message) + '</small>'
        : it.status === "empty" ? '<span class="st err">手順なし</span>'
        : it.status === "saved" ? '<span class="st ok">保存済み</span><br><small>' + esc(it.savedAs) + '</small>'
        : it.dup ? '<span class="st warn">重複</span><br><small>同じ要領書が上にあります</small>'
        : it.existing ? '<span class="st warn">登録済み</span><br><small>' + esc(it.existing) + '</small>'
        : '<span class="st ok">OK</span>';
      var kinds = d ? d.steps.filter(function (s) { return (s.kinds || []).length; }).length : 0;
      return '<tr class="' + (it.checked ? "on" : "") + '">' +
        '<td><input type="checkbox" data-i="' + i + '"' + (it.checked ? " checked" : "") + (d && d.steps.length && it.status !== "saved" ? "" : " disabled") + ' aria-label="取り込む"></td>' +
        '<td>' + esc(it.file) + (it.sheet ? '<br><small>シート：' + esc(it.sheet) + '</small>' : '') + '</td>' +
        '<td>' + (d ? esc(d.docNo) : '') + '</td>' +
        '<td><b>' + (d ? esc(d.title) : '') + '</b></td>' +
        '<td>' + (d ? esc([d.process, d.line].filter(Boolean).join(" ／ ")) : '') + '</td>' +
        '<td>' + (d ? d.steps.length + " 件" + (kinds ? '<br><small>印 ' + kinds + ' 件</small>' : '') : '') + '</td>' +
        '<td>' + st + '</td>' +
        '<td>' + (d && d.steps.length ? '<button type="button" class="btn small" data-show="' + i + '">' + (it.open ? "閉じる" : "内容") + '</button>' : '') + '</td>' +
      '</tr>' +
      (it.open && d ? '<tr class="detail"><td></td><td colspan="7"><ol>' + d.steps.map(function (s) {
        return '<li>' + (s.kinds || []).map(WI.kindBadge).join("") + ' ' + esc(s.title) +
          (s.points.length ? '<ul>' + s.points.map(function (p) { return '<li>' + esc(p.text) + '</li>'; }).join("") + '</ul>' : '') + '</li>';
      }).join("") + '</ol></td></tr>' : '');
    }).join("");
    var ok = items.filter(function (it) { return it.data && it.data.steps.length; }).length;
    var n = items.filter(function (it) { return it.checked; }).length;
    document.getElementById("summary").textContent = items.length + " 件を読み取り（手順あり " + ok + " 件）";
    document.getElementById("selCount").textContent = n ? n + " 件を選択中" : "";
    saveBtn.disabled = busy || !n || !WIFolder.supported;
  }

  rowsEl.addEventListener("change", function (ev) {
    var i = ev.target.getAttribute("data-i");
    if (i === null) return;
    items[+i].checked = ev.target.checked;
    render();
  });
  rowsEl.addEventListener("click", function (ev) {
    var i = ev.target.getAttribute && ev.target.getAttribute("data-show");
    if (i === null || i === undefined) return;
    items[+i].open = !items[+i].open;
    render();
  });
  overwriteEl.addEventListener("change", function () {
    items.forEach(function (it) { if (it.existing && it.status === "ok" && !it.dup) it.checked = overwriteEl.checked; });
    render();
  });
  document.getElementById("checkAll").addEventListener("click", function () {
    items.forEach(function (it) { if (it.data && it.data.steps.length && it.status !== "saved") it.checked = true; });
    render();
  });
  document.getElementById("checkNone").addEventListener("click", function () {
    items.forEach(function (it) { it.checked = false; });
    render();
  });

  // 読み終わってから選択を空にする（すぐ空にすると、ブラウザによってはファイルを読めなくなる）
  ["pickFiles", "pickFolder"].forEach(function (id) {
    var input = document.getElementById(id);
    input.addEventListener("change", function () {
      addFiles(input.files, function () { input.value = ""; });
    });
  });

  // ドラッグ＆ドロップ（フォルダごとでも可）
  var drop = document.getElementById("drop");
  document.addEventListener("dragover", function (ev) { ev.preventDefault(); drop.classList.add("over"); });
  document.addEventListener("dragleave", function (ev) { if (!ev.relatedTarget) drop.classList.remove("over"); });
  document.addEventListener("drop", function (ev) {
    ev.preventDefault();
    drop.classList.remove("over");
    var dt = ev.dataTransfer;
    var entries = Array.prototype.map.call(dt.items || [], function (x) { return x.webkitGetAsEntry && x.webkitGetAsEntry(); }).filter(Boolean);
    if (!entries.length) { addFiles(dt.files); return; }
    collect(entries).then(addFiles);
  });
  // フォルダの中のファイルを集める（サブフォルダも）
  function collect(entries) {
    var out = [];
    function walk(e) {
      if (e.isFile) return new Promise(function (res) { e.file(function (f) { out.push(f); res(); }, function () { res(); }); });
      if (!e.isDirectory) return Promise.resolve();
      var reader = e.createReader();
      return new Promise(function (res) {
        var all = [];
        (function readMore() {
          reader.readEntries(function (list) {
            if (!list.length) { Promise.all(all.map(walk)).then(res); return; }
            all = all.concat(Array.prototype.slice.call(list));
            readMore();
          }, function () { res(); });
        })();
      });
    }
    return Promise.all(entries.map(walk)).then(function () { return out; });
  }

  // ---------- 保存 ----------
  function stamp() {
    var t = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate()) + "-" + p(t.getHours()) + p(t.getMinutes()) + p(t.getSeconds());
  }
  function uniqueName(md, name, n) {
    var cand = n ? name.replace(/\.js$/, "") + "_" + n + ".js" : name;
    return md.getFileHandle(cand).then(function () { return uniqueName(md, name, (n || 1) + 1); }, function () { return cand; });
  }

  // 上書きのとき、前に設定した動画・写真を、同じ文の手順・急所に引き継ぐ
  function carryOver(oldD, newD) {
    var used = {};
    newD.steps.forEach(function (s, i) {
      var j = -1;
      oldD.steps.forEach(function (o, k) { if (j === -1 && !used[k] && o.title === s.title) j = k; });
      if (j === -1 && oldD.steps[i] && !used[i]) j = i; // 文が少し変わっていても同じ順番なら引き継ぐ
      if (j === -1) return;
      used[j] = true;
      var o = oldD.steps[j];
      if (o.video && o.video.src && !(s.video && s.video.src)) s.video = o.video;
      if (o.image && !s.image) { s.image = o.image; if (o.marks) s.marks = o.marks; }
      (s.points || []).forEach(function (p) {
        (o.points || []).forEach(function (op) { if (op.text === p.text && op.video && op.video.src) p.video = op.video; });
      });
    });
    ["line", "product", "category"].forEach(function (k) { if (!newD[k] && oldD[k]) newD[k] = oldD[k]; });
  }

  saveBtn.addEventListener("click", function () {
    var todo = items.filter(function (it) { return it.checked && it.data; });
    if (!todo.length) return;
    busy = true;
    saveBtn.disabled = true;
    var root, md, added = [], saved = 0, failed = [];
    WIFolder.getRoot().then(function (r) {
      root = r;
      document.querySelector("#saveDest span").textContent = "保存先：" + r.name;
      document.getElementById("saveDest").hidden = false;
      return root.getDirectoryHandle("manuals");
    }).then(function (m) {
      md = m;
      return todo.reduce(function (pr, it, n) {
        return pr.then(function () {
          notice("保存中… " + (n + 1) + " / " + todo.length + "　" + esc(it.data.title));
          return saveOne(it, n).then(function (name) {
            saved++;
            it.status = "saved";
            it.savedAs = name;
            it.checked = false;
          }, function (e) {
            failed.push(it.file + "：" + WIFolder.errorMessage(e));
          });
        });
      }, Promise.resolve());
    }).then(function () {
      return WIFolder.updateCatalog(root, function (c) {
        var before = c.files.length;
        added.forEach(function (f) { if (c.files.indexOf(f) === -1) c.files.push(f); });
        if (c.files.length === before) return false;
      });
    }).then(function () {
      notice("<b>" + saved + " 件を保存しました。</b>" + (added.length ? "（新しく一覧に追加：" + added.length + " 件）" : "") +
        (failed.length ? '<br><span style="color:var(--safety)">保存できなかったもの：<br>' + failed.map(esc).join("<br>") + '</span>' : "") +
        '<br>動画は、一覧から要領書を開いて「編集」で付けてください。　<a href="list.html">一覧で確認する</a>', !!failed.length);
    }).catch(function (e) {
      if (e && e.name === "AbortError") { notice(""); return; }
      notice("<b>保存できませんでした。</b>" + esc(WIFolder.errorMessage(e)), true);
    }).then(function () {
      busy = false;
      render();
      window.scrollTo(0, 0);
    });

    function saveOne(it, n) {
      var d = JSON.parse(JSON.stringify(it.data));
      var overwrite = it.existing && overwriteEl.checked;
      var base = docNoKey(d).replace(/[^\w\-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "");
      if (!/\d/.test(base)) base = "manual-" + stamp() + "-" + (n + 1);
      var nameP = overwrite ? Promise.resolve(it.existing) : uniqueName(md, base + ".js");
      return nameP.then(function (name) {
        // 上書きなら、前の内容をバックアップして、動画の設定などを引き継ぐ
        var prep = overwrite
          ? WIFolder.readText(md, name).then(function (t) { carryOver(WIFolder.parseManual(t), d); }, function () {})
            .then(function () { return WIFolder.backup(md, name, "_backup"); })
          : Promise.resolve();
        return prep.then(function () {
          // 手順の行にあった写真を images フォルダへ（名前は要領書のファイル名から）
          var stem = name.replace(/\.js$/, "");
          var imgs = (it.images || []).map(function (im) {
            var ext = im.src.split(".").pop();
            if (im.stamp) {
              d.stamps[im.stamp] = "images/" + stem + "_stamp_" + im.stamp + "." + ext;
              return { src: d.stamps[im.stamp], bytes: im.bytes, type: im.type };
            }
            var idx = -1;
            d.steps.forEach(function (s, k) { if (s.image === im.src) idx = k; });
            var src = "images/" + stem + "_" + (idx + 1) + "." + ext;
            if (idx >= 0) d.steps[idx].image = src;
            return { src: src, bytes: im.bytes, type: im.type };
          });
          return imgs.reduce(function (pr, im) {
            return pr.then(function () {
              return root.getDirectoryHandle("images", { create: true }).then(function (dir) {
                return WIFolder.writeFile(dir, im.src.split("/").pop(), new Blob([im.bytes], { type: im.type }));
              });
            });
          }, Promise.resolve());
        }).then(function () {
          if (!d.id) d.id = docNoKey(d) || name.replace(/\.js$/, "");
          if (d.terms && !Object.keys(d.terms).length) delete d.terms;
          return WIFolder.writeFile(md, name, WIFolder.manualText(d));
        }).then(function () {
          if (!overwrite) added.push(name);
          existing[keyOf(d)] = name;
          return name;
        });
      });
    }
  });

  render();
})();
