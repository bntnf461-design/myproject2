@echo off
rem ライン進捗アンドン：共有サーバーを起動して、この PC のブラウザで画面を開く
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0andon-server.ps1" -Open
pause
