@echo off
rem 自動起動をやめる
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\備品・副資材管理アプリ.lnk"
set "OLDLNK2=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ピッとストック.lnk"
set "OLDLNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\副資材在庫管理.lnk"
set "DONE="
if exist "%OLDLNK%" (
  del "%OLDLNK%"
  set "DONE=1"
)
if exist "%OLDLNK2%" (
  del "%OLDLNK2%"
  set "DONE=1"
)
if exist "%LNK%" (
  del "%LNK%"
  set "DONE=1"
)
echo.
if defined DONE (
  echo 自動起動をオフにしました。次からは start.bat をダブルクリックして起動します。
) else (
  echo 自動起動はオンになっていません。
)
echo.
pause
