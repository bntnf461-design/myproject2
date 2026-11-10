@echo off
rem 備品・副資材管理アプリ 起動用 (Windows)  Copyright (C) 2026. All rights reserved.
cd /d "%~dp0"

rem --- すでに起動している時は、画面を開くだけにする (自動起動と重なった時など) ---
powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient('127.0.0.1', 5000)).Close(); exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo アプリはすでに起動しています。画面を開きます。
  start "" http://localhost:5000/
  timeout /t 3 /nobreak >nul
  exit /b 0
)

rem --- オフライン版: 部品入りの python フォルダがあれば、それでそのまま起動する (ネット接続不要) ---
if exist "python\python.exe" (
  set "RUN=python\python.exe"
  goto run
)

rem --- Python を探す (py ランチャー優先。Microsoft Store の仮コマンドは除外) ---
set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys" >nul 2>nul && set "PY=python"
if not defined PY (
  echo.
  echo ============================================================
  echo  このPCでは、まだアプリを起動する準備ができていません。
  echo  社内のPC担当者に相談してください。
  echo ============================================================
  pause
  exit /b 1
)

rem --- 初回のみ: 必要な部品をインストール ---
if not exist ".venv\Scripts\python.exe" (
  echo 初回セットアップ中です。1～2分お待ちください...
  %PY% -m venv .venv
  if errorlevel 1 goto fail
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 goto fail
)

rem --- 新しい版で増えた部品があれば追加する (入っていれば何もしない) ---
".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r requirements.txt >nul 2>nul
set "RUN=.venv\Scripts\python.exe"

:run

echo.
echo ============================================================
echo  備品・副資材管理アプリ を起動しました。
echo  (C) 2026 All rights reserved.
echo  このPC     : http://localhost:5000/
echo  他の端末   : http://(このPCのIPアドレス):5000/
echo  スマホ     : https://(このPCのIPアドレス):5443/scan  ※カメラで読む時
echo  終了するには、この黒い画面を閉じてください。
echo ============================================================
rem 画面は、アプリが起動し終わるまで待ってから開く (最大90秒)。起動が遅いPCで「接続が拒否されました」と出るのを防ぐ
start "" powershell -NoProfile -WindowStyle Hidden -Command "for ($i=0; $i -lt 90; $i++) { try { (New-Object Net.Sockets.TcpClient('127.0.0.1', 5000)).Close(); Start-Process 'http://localhost:5000/'; break } catch { Start-Sleep -Seconds 1 } }"
"%RUN%" app.py %*
pause
exit /b 0

:fail
echo.
echo セットアップに失敗しました。インターネット接続を確認して、
echo もう一度 start.bat を実行してください。
echo （ネットにつながらないPCでは「オフライン版」を使ってください）
if exist ".venv" rmdir /s /q ".venv"
pause
exit /b 1
