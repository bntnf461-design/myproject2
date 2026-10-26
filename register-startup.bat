@echo off
rem ライン進捗アンドン：Windows にサインインしたとき、共有サーバーが自動で起動するようにする
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\アンドンサーバー.lnk"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); $s.TargetPath='%~dp0start-server.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
if exist "%LNK%" (
  echo 登録しました。次回から Windows にサインインすると、サーバーと画面が自動で開きます。
  echo やめるときは、スタートアップ フォルダーの「アンドンサーバー」を削除してください。
) else (
  echo 登録できませんでした。
)
pause
