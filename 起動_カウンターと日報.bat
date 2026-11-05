@echo off
rem ============================================================
rem  Opens the defect counter (left) and the daily report (right)
rem  side by side in Microsoft Edge.
rem  Put this file in the same folder as index.html and defect-counter.html.
rem  Change the numbers below to match the screen size.
rem ============================================================
set SCREEN_W=1366
set SCREEN_H=728
set COUNTER_W=480

set DIR=%~dp0
set EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe
if not exist "%EDGE%" set EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe
set /a REPORT_X=%COUNTER_W%
set /a REPORT_W=%SCREEN_W%-%COUNTER_W%

start "" "%EDGE%" --new-window --window-position=0,0 --window-size=%COUNTER_W%,%SCREEN_H% "%DIR%defect-counter.html"
timeout /t 2 /nobreak >nul
start "" "%EDGE%" --new-window --window-position=%REPORT_X%,0 --window-size=%REPORT_W%,%SCREEN_H% "%DIR%index.html"
