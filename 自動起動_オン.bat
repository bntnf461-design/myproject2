@echo off
rem PCにサインインした時に、備品・副資材管理アプリを自動で起動するようにする
cd /d "%~dp0"
set "APPDIR=%~dp0"
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\備品・副資材管理アプリ.lnk"
set "OLDLNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\副資材在庫管理.lnk"
if exist "%OLDLNK%" del "%OLDLNK%"
rem 以前の名前（ピッとストック）のショートカットも消す
set "OLDLNK2=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ピッとストック.lnk"
if exist "%OLDLNK2%" del "%OLDLNK2%"
set "DESC=備品・副資材管理アプリ（自動起動）"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); $s.TargetPath = Join-Path $env:APPDIR 'start.bat'; $s.WorkingDirectory = $env:APPDIR; $s.WindowStyle = 7; $s.Description = $env:DESC; $s.Save()"
echo.
if exist "%LNK%" (
  echo ============================================================
  echo  自動起動をオンにしました。
  echo  次から、このPCにサインインすると自動でアプリが起動します。
  echo  （黒い画面は最小化された状態で、タスクバーに出ます）
  echo.
  echo  やめる時は「自動起動_オフ.bat」をダブルクリックします。
  echo  ※アプリのフォルダを別の場所に移した時は、もう一度これを実行してください。
  echo ============================================================
) else (
  echo 自動起動の設定に失敗しました。管理者に相談してください。
)
echo.
pause
