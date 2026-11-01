package com.bntnf461.highlightmaker;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
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
        web = new WebView(this);
        setContentView(web);

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
        pickCallback.onReceiveValue(result);
        pickCallback = null;
    }

    /** ページ（JavaScript）から呼ばれる窓口 */
    private class Bridge {
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
