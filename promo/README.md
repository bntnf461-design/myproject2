# PR 動画の材料（作業要領書 × 動画）

製品の ZIP には入りません（`.gitattributes` で除外）。PR 動画を作り直すための材料と手順です。

## 中身

| ファイル | 内容 |
|---|---|
| `pr2.html` | 動画の絵と動き（時間 t を渡すとその瞬間の絵になる）。字幕の文は `TEXT` |
| `script.json` | ナレーション原稿（n1〜n12。`|` は文の区切り） |
| `fg_L.png` / `fg_R.png` | 元の写真（左＝これまで、右＝これから）。`bg_*.jpg` はそのぼかし |
| `ui/*.jpg`, `tab_ui.jpg` | アプリの実際の画面（架空の「ガラスの外観検査」の要領書で撮影） |
| `build.sh` | 声 12 本 → 完成した MP4 まで一度に作る |
| `mix.py` | 声と BGM（自作の和音）を合わせる。声の間は BGM を小さくする |
| `tts2.py` | Open JTalk（声「Mei」）でナレーションを作る（予備） |

## 春日部つむぎ（VOICEVOX）の声で作り直す

**新しいセッションへの引き継ぎ**：前のセッションでは、ネットワークの制限で VOICEVOX をダウンロードできなかったため、ここから続けてください。

1. VOICEVOX CORE（Python 版）と、声のモデル・辞書・ONNX Runtime を用意する（GitHub `VOICEVOX/voicevox_core` のリリースにあるダウンローダーで取得できる）
2. `script.json` の n1〜n12 を、**春日部つむぎ（ノーマル）**で 1 本ずつ WAV にする（`|` は文の区切りなので取り除いてよい。読み方は「エクセル」「一本」で書いてある）
3. `voice_tsumugi/n1.wav` 〜 `n12.wav` として置く
4. `bash build.sh voice_tsumugi "VOICEVOX:春日部つむぎ" PR動画_春日部つむぎ.mp4`
   - 最後の画面に「VOICEVOX:春日部つむぎ」と表示される（**利用規約で表示が必要**）
   - 場面の長さは声の長さに合わせて自動で決まる（約 90 秒）
   - Chromium の場所が違う場合は `CHROME=/path/to/chrome` を付ける

必要なもの：Node.js と Playwright（このフォルダで `npm i playwright`）、Python 3（numpy・Pillow）、ffmpeg（libx264）

## 注意

- 写真は依頼者からいただいたもの。製品の画面は架空のデータで撮影しており、社内の Excel の中身は使っていない
- 声「Mei」を使う場合は、最後の画面に「HTS Voice "Mei" © Nagoya Institute of Technology（CC BY 3.0）」の表示が必要（`CREDIT` を空にすると自動でこの表示）
- 「お問い合わせ：〇〇〇〇」は仮の文字（`pr2.html` の終わりの場面）
