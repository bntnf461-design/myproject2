@echo off
rem ライン進捗アンドン：事務所などの PC からつなげるよう、Windows ファイアウォールでポート 8080 を許可する（最初に1回）
net session >nul 2>&1
if errorlevel 1 (
  echo このファイルは「管理者として実行」してください。
  echo （ファイルを右クリック → 管理者として実行）
  pause
  exit /b 1
)
netsh advfirewall firewall delete rule name="Andon Server 8080" >nul 2>&1
netsh advfirewall firewall add rule name="Andon Server 8080" dir=in action=allow protocol=TCP localport=8080 profile=domain,private
if errorlevel 1 (
  echo 設定できませんでした。会社のシステム担当者に「TCP 8080 番の受信許可」を依頼してください。
) else (
  echo 設定しました。事務所の PC から http://%COMPUTERNAME%:8080/ を開けるようになります。
)
pause
