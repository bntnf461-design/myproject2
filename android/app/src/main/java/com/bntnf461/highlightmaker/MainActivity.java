package com.bntnf461.highlightmaker;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.ImageDecoder;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.os.Handler;
import android.os.Looper;
import androidx.media3.common.Effect;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.effect.Presentation;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.EditedMediaItemSequence;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;
import android.graphics.Color;
import android.provider.OpenableColumns;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.FrameLayout;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Highlight Maker の Android 版。
 * 画面と動画づくりは assets/index.html（Web 版と同じファイル）が端末の中だけで行う。
 * このクラスは「写真・動画・曲を選ぶ画面を開く」「完成動画をギャラリーに保存・共有する」
 * 「作成中に画面を消さない」だけを担当する。INTERNET 権限は持たない。
 */
public class MainActivity extends Activity {
    private static final int REQ_PICK = 1;
    private static final int REQ_PERM = 2;

    private WebView web;
    private FrameLayout root;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private AlertDialog busy;
    private ValueCallback<Uri[]> pickCallback;

    // 保存中の動画
    private OutputStream saveOut;
    private Uri saveUri;
    private File saveFile;
    private String saveMime;
    private Uri lastSaved;
    private String lastSavedMime;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        deletePicked(); // 前回の残り（強制終了した時など）を消す
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#fff7ef"));
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        // Android 15 以降は画面の端まで描かれるので、時計・電池の表示やナビゲーションバーと重ならないよう余白を取る
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        setSystemBars("#fff7ef", true);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(false);          // 端末にデータを残さない
        s.setDatabaseEnabled(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setAllowFileAccess(true);             // アプリ内の index.html を開くため
        s.setAllowContentAccess(true);          // 選んだ写真・動画（content://）を読むため
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setGeolocationEnabled(false);
        s.setSaveFormData(false);
        s.setSupportZoom(false);
        CookieManager.getInstance().setAcceptCookie(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return !"file".equals(req.getUrl().getScheme()); // 外のページへは移動しない
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (pickCallback != null) pickCallback.onReceiveValue(null);
                pickCallback = cb;
                try {
                    startActivityForResult(buildPickIntent(params), REQ_PICK);
                } catch (Exception e) {
                    pickCallback = null;
                    return false;
                }
                return true;
            }

            // ページからのお知らせ・確認を「file:// のページ」ではなくアプリ名で表示する
            @Override
            public boolean onJsAlert(WebView view, String url, String message, android.webkit.JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setTitle("Highlight Maker").setMessage(message)
                        .setPositiveButton("OK", (d, w) -> result.confirm()).setOnCancelListener(d -> result.confirm()).show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, android.webkit.JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setTitle("Highlight Maker").setMessage(message)
                        .setPositiveButton("OK", (d, w) -> result.confirm()).setNegativeButton("キャンセル", (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel()).show();
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny(); // カメラ・マイクなどは使わない
            }
        });
        web.addJavascriptInterface(new Bridge(), "HighlightApp");
        web.loadUrl("file:///android_asset/index.html");
    }

    /** 写真・動画は Android 13 以降の「写真の選択ツール」、曲はファイル選択で開く */
    private Intent buildPickIntent(WebChromeClient.FileChooserParams params) {
        List<String> types = new ArrayList<>();
        for (String a : params.getAcceptTypes()) {
            for (String t : a.split(",")) {
                t = t.trim();
                if (!t.isEmpty()) types.add(t);
            }
        }
        boolean multiple = params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE;
        boolean media = !types.isEmpty();
        for (String t : types) if (!(t.startsWith("image/") || t.startsWith("video/"))) media = false;

        Intent intent;
        if (media && Build.VERSION.SDK_INT >= 33) {
            intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
            if (multiple) intent.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, Math.min(50, MediaStore.getPickImagesMaxLimit()));
        } else {
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(types.size() == 1 ? types.get(0) : "*/*");
            if (types.size() > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
            if (multiple) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        return intent;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PICK || pickCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                result = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) result[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
        }
        final ValueCallback<Uri[]> cb = pickCallback;
        pickCallback = null;
        if (result == null) { cb.onReceiveValue(null); return; }
        // 写真の選択ツールのファイルは、位置情報の除去などでサイズが変わり、画面側で読めないことがある。
        // そこでアプリ専用の一時フォルダにコピーしてから渡す（アプリを閉じる・全部消す時に必ず削除）
        startPrepare(result, cb);
    }

    /* ===== 選んだ写真・動画を「画面側で必ず読める形」にそろえる =====
       ・動画：H.265/HEVC・HDR・4K・大きすぎる動画は、端末の中で H.264（720p）に変換（Media3 Transformer）
       ・写真：HEIC は JPEG に変換
       ・それ以外：アプリ専用の一時フォルダにコピー
       どれもアプリ専用の一時フォルダに置き、全部消す・アプリを閉じる・次の起動で削除する */
    private static final long MAX_VIDEO_US = 3L * 60 * 1000 * 1000; // 長い動画は最初の3分だけ使う
    private final Handler main = new Handler(Looper.getMainLooper());
    private Transformer currentTx;
    private volatile boolean prepCancelled;

    private static class Info {
        String name = "file", vmime;
        boolean video, heic, needs;
        long size, durationUs;
        int w, h, rot, transfer;
    }

    private void startPrepare(Uri[] picked, ValueCallback<Uri[]> cb) {
        prepCancelled = false;
        busy = new AlertDialog.Builder(this).setTitle("Highlight Maker").setMessage("写真・動画を準備しています…").setCancelable(false)
                .setNegativeButton("中止", (d, w) -> { prepCancelled = true; if (currentTx != null) currentTx.cancel(); }).show();
        prepareAt(picked, 0, new ArrayList<>(), cb);
    }

    private void setBusy(String msg) { if (busy != null) busy.setMessage(msg); }

    private void prepareAt(Uri[] picked, int i, List<Uri> out, ValueCallback<Uri[]> cb) {
        if (i >= picked.length || prepCancelled) {
            if (busy != null) { busy.dismiss(); busy = null; }
            cb.onReceiveValue(out.toArray(new Uri[0]));
            return;
        }
        final Uri uri = picked[i];
        final String label = (i + 1) + " / " + picked.length;
        setBusy("写真・動画を準備しています… " + label);
        io.execute(() -> {
            Info info = probe(uri, i);
            if (info.video && info.needs && !prepCancelled) {
                main.post(() -> transcode(uri, info, label, f -> {
                    if (f != null) { out.add(Uri.fromFile(f)); main.post(() -> prepareAt(picked, i + 1, out, cb)); }
                    else io.execute(() -> { File c = copyToCache(uri, i); out.add(c != null ? Uri.fromFile(c) : uri); main.post(() -> prepareAt(picked, i + 1, out, cb)); });
                }));
            } else {
                File f = info.heic ? heicToJpeg(uri, info) : null;
                if (f == null) f = copyToCache(uri, i);
                out.add(f != null ? Uri.fromFile(f) : uri);
                main.post(() -> prepareAt(picked, i + 1, out, cb));
            }
        });
    }

    private Info probe(Uri uri, int index) {
        Info in = new Info();
        in.name = "file" + index;
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                if (!c.isNull(0)) in.name = c.getString(0);
                if (!c.isNull(1)) in.size = c.getLong(1);
            }
        } catch (Exception ignored) { }
        String type = getContentResolver().getType(uri);
        String lower = in.name.toLowerCase(java.util.Locale.ROOT);
        in.video = (type != null && type.startsWith("video/")) || lower.matches(".*\\.(mp4|mov|m4v|3gp|mkv|webm)$");
        in.heic = (type != null && (type.contains("heic") || type.contains("heif"))) || lower.matches(".*\\.(heic|heif)$");
        if (!in.video) return in;
        MediaExtractor ex = new MediaExtractor();
        try {
            ex.setDataSource(this, uri, null);
            for (int t = 0; t < ex.getTrackCount(); t++) {
                MediaFormat f = ex.getTrackFormat(t);
                String m = f.getString(MediaFormat.KEY_MIME);
                if (m != null && m.startsWith("video/")) {
                    in.vmime = m;
                    if (f.containsKey(MediaFormat.KEY_WIDTH)) in.w = f.getInteger(MediaFormat.KEY_WIDTH);
                    if (f.containsKey(MediaFormat.KEY_HEIGHT)) in.h = f.getInteger(MediaFormat.KEY_HEIGHT);
                    if (f.containsKey(MediaFormat.KEY_DURATION)) in.durationUs = f.getLong(MediaFormat.KEY_DURATION);
                    if (f.containsKey(MediaFormat.KEY_COLOR_TRANSFER)) in.transfer = f.getInteger(MediaFormat.KEY_COLOR_TRANSFER);
                    break;
                }
            }
        } catch (Exception ignored) {
        } finally { ex.release(); }
        try {
            MediaMetadataRetriever r = new MediaMetadataRetriever();
            r.setDataSource(this, uri);
            String rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION);
            if (rot != null) in.rot = Integer.parseInt(rot);
            r.release();
        } catch (Exception ignored) { }
        boolean easyCodec = "video/avc".equals(in.vmime) || "video/x-vnd.on2.vp8".equals(in.vmime) || "video/x-vnd.on2.vp9".equals(in.vmime);
        boolean hdr = in.transfer == MediaFormat.COLOR_TRANSFER_ST2084 || in.transfer == MediaFormat.COLOR_TRANSFER_HLG;
        in.needs = !easyCodec || hdr || Math.max(in.w, in.h) > 1920 || in.size > 120L * 1024 * 1024 || in.durationUs > MAX_VIDEO_US;
        return in;
    }

    private void transcode(Uri uri, Info info, String label, java.util.function.Consumer<File> done) {
        File dir = new File(pickedDir(), String.valueOf(System.nanoTime()));
        if (!dir.mkdirs() && !dir.isDirectory()) { done.accept(null); return; }
        String base = info.name.replaceAll("[\\\\/:*?\"<>|]", "_").replaceAll("\\.[A-Za-z0-9]+$", "");
        final File outF = new File(dir, base + ".mp4");
        // 縦横を考えて、短い辺を 720 にそろえる（小さい動画はそのまま）
        int w = info.w, h = info.h;
        if (info.rot == 90 || info.rot == 270) { int t = w; w = h; h = t; }
        if (w <= 0 || h <= 0) { w = 1280; h = 720; }
        float k = Math.min(1f, 720f / Math.min(w, h));
        int ow = Math.max(2, Math.round(w * k / 2) * 2), oh = Math.max(2, Math.round(h * k / 2) * 2);
        MediaItem.Builder mb = new MediaItem.Builder().setUri(uri);
        if (info.durationUs > MAX_VIDEO_US)
            mb.setClippingConfiguration(new MediaItem.ClippingConfiguration.Builder().setEndPositionMs(MAX_VIDEO_US / 1000).build());
        List<Effect> video = new ArrayList<>();
        video.add(Presentation.createForWidthAndHeight(ow, oh, Presentation.LAYOUT_SCALE_TO_FIT));
        EditedMediaItem item = new EditedMediaItem.Builder(mb.build())
                .setEffects(new Effects(new ArrayList<AudioProcessor>(), video)).build();
        Composition comp = new Composition.Builder(new EditedMediaItemSequence(item))
                .setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL).build();
        final String msg = "この端末で読める形に変換しています… " + label + (info.durationUs > MAX_VIDEO_US ? "\n（長い動画なので最初の3分を使います）" : "");
        setBusy(msg);
        final Transformer tx;
        try {
            tx = new Transformer.Builder(this)
                    .setVideoMimeType(MimeTypes.VIDEO_H264)
                    .setAudioMimeType(MimeTypes.AUDIO_AAC)
                    .addListener(new Transformer.Listener() {
                        @Override
                        public void onCompleted(Composition composition, ExportResult exportResult) {
                            currentTx = null;
                            done.accept(outF);
                        }

                        @Override
                        public void onError(Composition composition, ExportResult exportResult, ExportException exportException) {
                            currentTx = null;
                            outF.delete();
                            done.accept(null);
                        }
                    }).build();
            currentTx = tx;
            tx.start(comp, outF.getAbsolutePath());
        } catch (Exception e) {
            currentTx = null;
            outF.delete();
            done.accept(null);
            return;
        }
        final ProgressHolder ph = new ProgressHolder();
        main.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (currentTx != tx) return;
                if (tx.getProgress(ph) == Transformer.PROGRESS_STATE_AVAILABLE) setBusy(msg + "  " + ph.progress + "%");
                main.postDelayed(this, 500);
            }
        }, 500);
    }

    /** HEIC の写真を JPEG に（長い辺 2160 まで縮小） */
    private File heicToJpeg(Uri uri, Info info) {
        if (Build.VERSION.SDK_INT < 28) return null;
        try {
            ImageDecoder.Source src = ImageDecoder.createSource(getContentResolver(), uri);
            Bitmap bm = ImageDecoder.decodeBitmap(src, (dec, ii, s) -> {
                int W = ii.getSize().getWidth(), H = ii.getSize().getHeight();
                float k = Math.min(1f, 2160f / Math.max(W, H));
                dec.setTargetSize(Math.max(1, Math.round(W * k)), Math.max(1, Math.round(H * k)));
                dec.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
            });
            File dir = new File(pickedDir(), String.valueOf(System.nanoTime()));
            if (!dir.mkdirs() && !dir.isDirectory()) return null;
            File f = new File(dir, info.name.replaceAll("\\.[A-Za-z0-9]+$", "") + ".jpg");
            try (OutputStream o = new FileOutputStream(f)) { bm.compress(Bitmap.CompressFormat.JPEG, 92, o); }
            bm.recycle();
            return f;
        } catch (Exception e) {
            return null;
        }
    }

    private File pickedDir() { return new File(getCacheDir(), "picked"); }

    private File copyToCache(Uri uri, int index) {
        String name = "file" + index;
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) name = c.getString(0);
        } catch (Exception ignored) { }
        name = name.replaceAll("[\\/:*?\"<>|]", "_");
        if (!name.contains(".")) {
            String t = getContentResolver().getType(uri);
            if (t != null) {
                String ext = android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(t);
                if (ext != null) name = name + "." + ext;
            }
        }
        File dir = new File(pickedDir(), String.valueOf(System.nanoTime()));
        if (!dir.mkdirs() && !dir.isDirectory()) return null;
        File f = new File(dir, name);
        try (InputStream in = getContentResolver().openInputStream(uri); OutputStream o = new FileOutputStream(f)) {
            if (in == null) return null;
            byte[] buf = new byte[1 << 20];
            int n;
            while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
            return f;
        } catch (Exception e) {
            f.delete();
            return null;
        }
    }

    private void deletePicked() { deleteTree(pickedDir()); }

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] list = f.listFiles();
        if (list != null) for (File c : list) deleteTree(c);
        f.delete();
    }

    /** 時計・電池の帯の色をデザインに合わせる（light=true は明るい背景で黒い文字） */
    private void setSystemBars(String color, boolean light) {
        int c;
        try { c = Color.parseColor(color); } catch (Exception e) { return; }
        root.setBackgroundColor(c);
        getWindow().setStatusBarColor(c);
        getWindow().setNavigationBarColor(c);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController wc = getWindow().getInsetsController();
            if (wc != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                wc.setSystemBarsAppearance(light ? mask : 0, mask);
            }
        } else {
            int flags = getWindow().getDecorView().getSystemUiVisibility();
            if (light) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR; else flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
    }

    /** ページ（JavaScript）から呼ばれる窓口 */
    private class Bridge {
        @JavascriptInterface
        public void setTheme(final String color, final boolean light) {
            runOnUiThread(() -> setSystemBars(color, light));
        }

        /** 「全部消す」：コピーした写真・動画を消す */
        @JavascriptInterface
        public void clearPicked() {
            io.execute(MainActivity.this::deletePicked);
        }

        @JavascriptInterface
        public void keepScreenOn(final boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        /** 保存を始める。"ok" / "permission"（許可待ち） / エラー文 を返す */
        @JavascriptInterface
        public synchronized String beginSave(String name, String mime) {
            abortSave();
            saveMime = mime == null || mime.isEmpty() ? "video/mp4" : mime;
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Video.Media.DISPLAY_NAME, name);
                    v.put(MediaStore.Video.Media.MIME_TYPE, saveMime);
                    v.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/HighlightMaker");
                    v.put(MediaStore.Video.Media.IS_PENDING, 1);
                    ContentResolver cr = getContentResolver();
                    saveUri = cr.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                    if (saveUri == null) return "保存先を作れませんでした";
                    saveOut = cr.openOutputStream(saveUri);
                } else {
                    if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                        runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_PERM));
                        return "permission";
                    }
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "HighlightMaker");
                    if (!dir.exists() && !dir.mkdirs()) return "フォルダを作れませんでした";
                    saveFile = new File(dir, name);
                    saveOut = new FileOutputStream(saveFile);
                }
                return "ok";
            } catch (Exception e) {
                abortSave();
                return String.valueOf(e.getMessage());
            }
        }

        @JavascriptInterface
        public synchronized boolean appendChunk(String b64) {
            if (saveOut == null) return false;
            try {
                saveOut.write(Base64.decode(b64, Base64.DEFAULT));
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        /** 保存を終える。保存場所の説明、または "error:..." を返す */
        @JavascriptInterface
        public synchronized String finishSave() {
            try {
                if (saveOut == null) return "error:保存が始まっていません";
                saveOut.close();
                saveOut = null;
                if (saveUri != null) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Video.Media.IS_PENDING, 0);
                    getContentResolver().update(saveUri, v, null, null);
                    lastSaved = saveUri;
                } else if (saveFile != null) {
                    MediaScannerConnection.scanFile(MainActivity.this, new String[]{saveFile.getAbsolutePath()}, new String[]{saveMime},
                            (path, uri) -> lastSaved = uri);
                }
                lastSavedMime = saveMime;
                saveUri = null;
                saveFile = null;
                return "動画フォルダ / HighlightMaker";
            } catch (Exception e) {
                abortSave();
                return "error:" + e.getMessage();
            }
        }

        @JavascriptInterface
        public synchronized void abortSave() {
            MainActivity.this.abortSave();
        }

        /** 最後に保存した動画を LINE などで共有する */
        @JavascriptInterface
        public void shareLast() {
            final Uri u = lastSaved;
            if (u == null) return;
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(lastSavedMime != null ? lastSavedMime : "video/*");
                send.putExtra(Intent.EXTRA_STREAM, u);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(send, "動画を共有"));
            });
        }
    }

    private synchronized void abortSave() {
        try { if (saveOut != null) saveOut.close(); } catch (Exception ignored) { }
        saveOut = null;
        if (saveUri != null) { try { getContentResolver().delete(saveUri, null, null); } catch (Exception ignored) { } }
        if (saveFile != null) { try { saveFile.delete(); } catch (Exception ignored) { } }
        saveUri = null;
        saveFile = null;
    }

    @Override
    public void onBackPressed() {
        new AlertDialog.Builder(this)
                .setMessage("アプリを閉じますか？\n選んだ写真・動画と作成中の動画はすべて消えます（保存した動画は残ります）。")
                .setPositiveButton("閉じる", (d, w) -> finish())
                .setNegativeButton("戻る", null)
                .show();
    }

    @Override
    protected void onDestroy() {
        abortSave();
        if (busy != null) { busy.dismiss(); busy = null; }
        prepCancelled = true;
        if (currentTx != null) { currentTx.cancel(); currentTx = null; }
        io.shutdownNow();
        deletePicked();
        if (web != null) {
            // 個人データを残さない：メモリ・キャッシュ・履歴をすべて消す
            web.evaluateJavascript("try{wipeAll()}catch(e){}", null);
            web.clearCache(true);
            web.clearHistory();
            web.clearFormData();
            WebStorage.getInstance().deleteAllData();
            CookieManager.getInstance().removeAllCookies(null);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
