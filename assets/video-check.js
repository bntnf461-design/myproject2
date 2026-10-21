/* =========================================================
   動画のチェック（エディタで動画を選んだときに自動で実行）
   - この PC で再生できるか
   - HEVC（H.265）・HDR・高画質（4K など）・大容量 ではないか
   スマホ（特に iPhone の初期設定）で撮った動画は、他の PC で再生できない／重いことがあるため
   ========================================================= */
(function () {
  "use strict";

  // ファイルの先頭と末尾だけを読んで、動画の形式を示す印を探す（全体は読まないので軽い）
  function sniff(file) {
    var N = 4 * 1024 * 1024;
    var parts = [file.slice(0, Math.min(N, file.size))];
    if (file.size > N) parts.push(file.slice(Math.max(N, file.size - N)));
    return Promise.all(parts.map(function (b) { return b.arrayBuffer(); })).then(function (bufs) {
      var info = { hevc: false, dolby: false, hdr: false, h264: false };
      bufs.forEach(function (ab) {
        var b = new Uint8Array(ab);
        for (var i = 0; i + 8 < b.length; i++) {
          // 4 文字の識別子だけを見る（"h" "a" "d" "c" で始まるものだけ詳しく確認）
          var c0 = b[i];
          if (c0 !== 0x68 && c0 !== 0x61 && c0 !== 0x64 && c0 !== 0x63) continue;
          var s = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
          if (s === "hvc1" || s === "hev1") info.hevc = true;
          else if (s === "avc1" || s === "avc3") info.h264 = true;
          else if (s === "dvh1" || s === "dvhe" || s === "dvcC" || s === "dvvC") { info.dolby = true; info.hdr = true; }
          else if (s === "colr" && String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]) === "nclx") {
            var transfer = (b[i + 10] << 8) | b[i + 11];
            if (transfer === 16 || transfer === 18) info.hdr = true; // PQ / HLG = HDR
          }
        }
      });
      return info;
    }, function () { return {}; });
  }

  // 実際にこの PC で 1 コマ目を表示できるか
  function probe(file) {
    return new Promise(function (resolve) {
      var v = document.createElement("video");
      var url = URL.createObjectURL(file);
      var done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        var r = { playable: ok, w: v.videoWidth || 0, h: v.videoHeight || 0, dur: isFinite(v.duration) ? v.duration : 0 };
        v.removeAttribute("src");
        v.load();
        URL.revokeObjectURL(url);
        resolve(r);
      }
      v.muted = true;
      v.preload = "auto";
      v.addEventListener("loadeddata", function () { finish(v.videoWidth > 0); });
      v.addEventListener("error", function () { finish(false); });
      setTimeout(function () { finish(v.readyState >= 2 && v.videoWidth > 0); }, 8000);
      v.src = url;
      v.load();
    });
  }

  function mb(bytes) {
    var v = bytes / 1024 / 1024;
    return v < 10 ? v.toFixed(1) : String(Math.round(v));
  }
  function dur(sec) {
    sec = Math.round(sec);
    return Math.floor(sec / 60) + ":" + (sec % 60 < 10 ? "0" : "") + (sec % 60);
  }

  // 結果: { level: "ok" | "warn" | "error", summary, items: [] }
  function checkVideo(file) {
    return Promise.all([probe(file), sniff(file)]).then(function (r) {
      var p = r[0], s = r[1];
      var items = [];
      var level = "ok";
      var long = Math.max(p.w, p.h), short = Math.min(p.w, p.h);
      var perMin = p.dur > 0 ? file.size / (p.dur / 60) : 0;

      if (!p.playable) {
        level = "error";
        items.push(s.hevc
          ? "<b>この PC では再生できません。</b>HEVC（H.265）形式の動画です。スマホの設定を変えて撮り直すか、変換してください。"
          : s.h264
            ? "<b>このブラウザでは再生できません。</b>H.264 形式なので、Chrome か Edge で開けば再生できる見込みです。"
            : "<b>この PC では再生できません。</b>動画の形式が対応していない可能性があります。MP4（H.264）で用意してください。");
      } else {
        if (s.hevc) {
          level = "warn";
          items.push("HEVC（H.265）形式です。この PC では再生できますが、<b>他の PC（特に古い PC）では再生できない</b>場合があります。");
        }
        if (long > 1920 || short > 1080) {
          level = "warn";
          items.push("画質が高すぎます（" + p.w + "×" + p.h + "）。低スペック PC では<b>カクつく</b>場合があります。1080p（1920×1080）以下がおすすめです。");
        }
        if (s.hdr) {
          level = "warn";
          items.push("HDR 動画です。PC では<b>色が白っぽく</b>見える場合があります。");
        }
        if (perMin > 150 * 1024 * 1024 || file.size > 1024 * 1024 * 1024) {
          level = "warn";
          items.push("容量が大きめです（" + mb(file.size) + "MB）。保存や読み込みに時間がかかります。");
        }
      }
      var summary = (p.w ? p.w + "×" + p.h + "・" : "") + (p.dur ? dur(p.dur) + "・" : "") + mb(file.size) + "MB" +
        (s.hevc ? "・HEVC" : s.h264 ? "・H.264" : "");
      return { level: level, summary: summary, items: items };
    });
  }

  // 写真のチェック（iPhone の HEIC 形式はブラウザで表示できない）
  function checkImage(file) {
    if (/\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type)) {
      return { level: "error", summary: file.name, items: ["<b>HEIC 形式の写真は表示できません。</b>JPEG で用意してください（iPhone は「互換性優先」の設定で JPEG になります）。"] };
    }
    return null;
  }

  window.VideoCheck = { checkVideo: checkVideo, checkImage: checkImage };
})();
