#!/bin/bash
# ナレーションの音声 12 本から PR 動画を作る
#   使い方: bash build.sh <音声フォルダ> "<クレジット>" <出力.mp4>
#   音声フォルダには n1.wav 〜 n12.wav（script.json の n1〜n12 の順）を入れておく。サンプリング周波数は何でもよい
#   例: bash build.sh voice_tsumugi "VOICEVOX:春日部つむぎ" PR動画_春日部つむぎ.mp4
set -e
cd "$(dirname "$0")"
VDIR="$1"; CREDIT="$2"; OUT="${3:-PR.mp4}"
[ -f grain0.png ] || python3 make_grain.py
# 48kHz にそろえ、音量を整える
mkdir -p .v48
for i in $(seq 1 12); do
  ffmpeg -loglevel error -y -i "$VDIR/n$i.wav" -af "highpass=f=70,loudnorm=I=-18:TP=-2:LRA=7" -ar 48000 -ac 1 ".v48/n$i.wav"
done
# 場面の長さ＝声の長さ
python3 - <<'PY'
import json, wave
d = {}
for i in range(1, 13):
    w = wave.open('.v48/n%d.wav' % i)
    d['n%d' % i] = round(w.getnframes() / w.getframerate() + 0.1, 2)
json.dump(d, open('dur.json', 'w'))
print(d)
PY
export DUR_FILE=dur.json CREDIT="$CREDIT"
node timing.mjs
python3 mix.py .v48 .audio.wav
rm -rf frames2 && mkdir frames2
node render2.mjs
ffmpeg -loglevel error -y -framerate 30 -i frames2/f%05d.jpg -i .audio.wav -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest -movflags +faststart "$OUT"
rm -rf frames2 .v48 .audio.wav
echo "できました: $OUT"
