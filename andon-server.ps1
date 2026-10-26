# ライン進捗アンドン 共有サーバー
# 現場 PC で動かし、事務所など社内 LAN の PC から http://<この PC の名前>:8080/ で同じ画面を開けるようにする。
# 計画・実績・設定はこのフォルダーの andon-data.json に保存する（全員で共有）。
# Windows 標準の PowerShell 5.1 で動く（追加ソフト不要）。

param([int]$Port = 8080, [switch]$Open)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataFile = Join-Path $root 'andon-data.json'
$revFile = Join-Path $root 'andon-rev.txt'
$backupDir = Join-Path $root 'backup'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$maxBody = 20MB

# ---------- 保存データ ----------
$script:state = $null      # 状態の JSON 文字列（サーバーでは中身を解釈しない）
$script:rev = 0            # 更新のたびに 1 増える番号
if (Test-Path $dataFile) { $script:state = [IO.File]::ReadAllText($dataFile, $utf8) }
if (Test-Path $revFile) { $script:rev = [int]([IO.File]::ReadAllText($revFile, $utf8).Trim()) }

function Save-State([string]$json, [int]$rev) {
  # 書きかけで壊れないよう、一時ファイルに書いてから置き換える（$null を渡すと空文字になるため [NullString] を使う）
  $tmp = $dataFile + '.tmp'
  [IO.File]::WriteAllText($tmp, $json, $utf8)
  if (Test-Path $dataFile) {
    try { [IO.File]::Replace($tmp, $dataFile, [NullString]::Value) }
    catch {
      # OneDrive・ネットワークドライブなどで置き換えできないときは上書きコピーする
      [IO.File]::Copy($tmp, $dataFile, $true)
      [IO.File]::Delete($tmp)
    }
  } else { [IO.File]::Move($tmp, $dataFile) }
  [IO.File]::WriteAllText($revFile, [string]$rev, $utf8)
  # 1日1回バックアップ（60日分を残す）
  if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
  $bk = Join-Path $backupDir ('andon-' + (Get-Date -Format 'yyyyMMdd') + '.json')
  if (-not (Test-Path $bk)) {
    [IO.File]::WriteAllText($bk, $json, $utf8)
    Get-ChildItem $backupDir -Filter 'andon-*.json' | Sort-Object Name -Descending | Select-Object -Skip 60 | Remove-Item -Force
  }
}

# ---------- HTTP ----------
function Send-Response($stream, [int]$code, [string]$type, [byte[]]$body) {
  $reason = @{ 200 = 'OK'; 400 = 'Bad Request'; 404 = 'Not Found'; 405 = 'Method Not Allowed'; 409 = 'Conflict'; 413 = 'Payload Too Large'; 500 = 'Internal Server Error' }[$code]
  $head = "HTTP/1.1 $code $reason`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}
function Send-Text($stream, [int]$code, [string]$type, [string]$text) {
  Send-Response $stream $code $type $utf8.GetBytes($text)
}
function State-Json { if ($script:state) { $script:state } else { 'null' } }

# 1 件のリクエストを読む。戻り値：@{ Method; Path; Query; Headers; Body } / 読めなければ $null
function Read-Request($stream) {
  $buf = New-Object byte[] 65536
  $ms = New-Object IO.MemoryStream
  $headerEnd = -1
  while ($headerEnd -lt 0) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { return $null }
    $ms.Write($buf, 0, $n)
    $all = $ms.ToArray()
    for ($i = [Math]::Max(0, $all.Length - $n - 3); $i -le $all.Length - 4; $i++) {
      if ($all[$i] -eq 13 -and $all[$i + 1] -eq 10 -and $all[$i + 2] -eq 13 -and $all[$i + 3] -eq 10) { $headerEnd = $i; break }
    }
    if ($headerEnd -lt 0 -and $ms.Length -gt 65536) { return $null }
  }
  $all = $ms.ToArray()
  $lines = [Text.Encoding]::ASCII.GetString($all, 0, $headerEnd) -split "`r`n"
  $parts = $lines[0] -split ' '
  if ($parts.Count -lt 2) { return $null }
  $headers = @{}
  foreach ($l in ($lines | Select-Object -Skip 1)) {
    $p = $l.IndexOf(':')
    if ($p -gt 0) { $headers[$l.Substring(0, $p).Trim().ToLower()] = $l.Substring($p + 1).Trim() }
  }
  $len = 0
  if ($headers.ContainsKey('content-length')) { $len = [int]$headers['content-length'] }
  if ($len -gt $maxBody) { return @{ TooLarge = $true } }
  $body = New-Object byte[] $len
  $have = $all.Length - ($headerEnd + 4)
  if ($have -gt 0) { [Array]::Copy($all, $headerEnd + 4, $body, 0, [Math]::Min($have, $len)) }
  while ($have -lt $len) {
    $n = $stream.Read($body, $have, $len - $have)
    if ($n -le 0) { return $null }
    $have += $n
  }
  $target = $parts[1]
  $q = ''
  $qi = $target.IndexOf('?')
  if ($qi -ge 0) { $q = $target.Substring($qi + 1); $target = $target.Substring(0, $qi) }
  return @{ Method = $parts[0]; Path = [Uri]::UnescapeDataString($target); Query = $q; Headers = $headers; Body = $body }
}

function Handle($stream, $req) {
  $path = $req.Path
  if ($req.Method -eq 'GET' -and ($path -eq '/' -or $path -eq '/index.html')) {
    $file = Join-Path $root 'index.html'
    Send-Response $stream 200 'text/html; charset=utf-8' ([IO.File]::ReadAllBytes($file))
    return
  }
  if ($path -eq '/api/state') {
    if ($req.Method -eq 'GET') {
      # ?rev=N と同じなら中身を省略（2秒ごとの確認を軽くする）
      if ($req.Query -match '(^|&)rev=(\d+)' -and [int]$Matches[2] -eq $script:rev) {
        Send-Text $stream 200 'application/json; charset=utf-8' ('{"rev":' + $script:rev + ',"same":true}')
      } else {
        Send-Text $stream 200 'application/json; charset=utf-8' ('{"rev":' + $script:rev + ',"state":' + (State-Json) + '}')
      }
      return
    }
    if ($req.Method -eq 'POST') {
      $base = -1
      if ($req.Headers.ContainsKey('x-base-rev')) { $base = [int]$req.Headers['x-base-rev'] }
      $json = $utf8.GetString($req.Body).Trim()
      if (-not $json.StartsWith('{')) { Send-Text $stream 400 'application/json; charset=utf-8' '{"error":"bad body"}'; return }
      if ($base -ne $script:rev) {
        # 他の PC が先に更新していた：最新の状態を返し、画面側で合わせてから送り直してもらう
        Send-Text $stream 409 'application/json; charset=utf-8' ('{"rev":' + $script:rev + ',"state":' + (State-Json) + '}')
        return
      }
      # ファイルに保存できてから番号を進める（保存に失敗したら変更しない）
      Save-State $json ($script:rev + 1)
      $script:rev++
      $script:state = $json
      Send-Text $stream 200 'application/json; charset=utf-8' ('{"rev":' + $script:rev + '}')
      return
    }
    Send-Text $stream 405 'text/plain; charset=utf-8' 'Method Not Allowed'
    return
  }
  if ($req.Method -eq 'GET' -and $path -eq '/api/info') {
    $ips = @([Net.Dns]::GetHostAddresses([Net.Dns]::GetHostName()) | Where-Object { $_.AddressFamily -eq 'InterNetwork' -and -not [Net.IPAddress]::IsLoopback($_) } | ForEach-Object { '"' + $_.ToString() + '"' })
    $info = '{"host":"' + [Net.Dns]::GetHostName() + '","port":' + $Port + ',"ips":[' + ($ips -join ',') + ']}'
    Send-Text $stream 200 'application/json; charset=utf-8' $info
    return
  }
  Send-Text $stream 404 'text/plain; charset=utf-8' 'Not Found'
}

# ---------- 起動 ----------
# 黒い画面をクリックすると「簡易編集モード」で処理が止まるため、このウィンドウでは無効にする
if ($env:OS -eq 'Windows_NT') {
  try {
    Add-Type -Namespace AndonWin -Name Console -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern System.IntPtr GetStdHandle(int h);
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(System.IntPtr h, out uint m);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(System.IntPtr h, uint m);
'@
    $h = [AndonWin.Console]::GetStdHandle(-10)
    $mode = 0
    if ([AndonWin.Console]::GetConsoleMode($h, [ref]$mode)) {
      $new = $mode -bor 0x80                         # ENABLE_EXTENDED_FLAGS
      if ($new -band 0x40) { $new = $new - 0x40 }   # ENABLE_QUICK_EDIT_MODE を外す
      [void][AndonWin.Console]::SetConsoleMode($h, [uint32]$new)
    }
  } catch { }
}
if (-not (Test-Path (Join-Path $root 'index.html'))) {
  Write-Host 'index.html が同じフォルダーにありません。' -ForegroundColor Red
  Read-Host 'Enter キーで終了'
  exit 1
}
$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Any, $Port)
try { $listener.Start() } catch {
  Write-Host "ポート $Port を使えません（すでにサーバーが動いている可能性があります）。" -ForegroundColor Red
  Read-Host 'Enter キーで終了'
  exit 1
}
$hostName = [Net.Dns]::GetHostName()
Write-Host '========================================================'
Write-Host ' ライン進捗アンドン サーバー 起動中（この画面は閉じないでください）'
Write-Host '========================================================'
Write-Host " この PC で開く     : http://localhost:$Port/"
Write-Host " 事務所などから開く : http://${hostName}:$Port/"
[Net.Dns]::GetHostAddresses($hostName) | Where-Object { $_.AddressFamily -eq 'InterNetwork' -and -not [Net.IPAddress]::IsLoopback($_) } |
  ForEach-Object { Write-Host "                      http://$($_.ToString()):$Port/" }
Write-Host " データの保存先     : $dataFile"
# 事務所 PC に配るショートカット（ダブルクリックでブラウザが開く）をこのフォルダーに作る
try {
  $links = @{ 'アンドン（事務所PC用）.url' = "http://${hostName}:$Port/"; '本日の計画（事務所PC用）.url' = "http://${hostName}:$Port/#plan" }
  foreach ($name in $links.Keys) {
    [IO.File]::WriteAllText((Join-Path $root $name), "[InternetShortcut]`r`nURL=$($links[$name])`r`n", [Text.Encoding]::ASCII)
  }
  Write-Host " 事務所PC用のショートカット : 「アンドン（事務所PC用）」「本日の計画（事務所PC用）」をこのフォルダーに作りました。"
  Write-Host "                              事務所PCのデスクトップにコピーすると、ダブルクリックで開けます。"
} catch {
  Write-Host ' 事務所PC用のショートカットを作れませんでした（フォルダーに書き込めません）。' -ForegroundColor Yellow
}
Write-Host ' 終了するには Ctrl + C を押すか、この画面を閉じます。'
Write-Host ''
if ($Open) { Start-Process "http://localhost:$Port/" }

# ブラウザは先につないでおくだけの接続を作ることがあるので、データが届いた接続から順に処理する
$pending = New-Object System.Collections.ArrayList
try {
  while ($true) {
    $busy = $false
    while ($listener.Pending()) {
      $c = $listener.AcceptTcpClient()
      $c.ReceiveTimeout = 3000
      $c.SendTimeout = 5000
      [void]$pending.Add(@{ Client = $c; Since = [DateTime]::Now })
      $busy = $true
    }
    foreach ($p in @($pending)) {
      $client = $p.Client
      $ready = $false
      try { $ready = $client.Available -gt 0 } catch { }
      if (-not $ready) {
        if (([DateTime]::Now - $p.Since).TotalSeconds -gt 15 -or -not $client.Connected) { $client.Close(); $pending.Remove($p) }
        continue
      }
      $pending.Remove($p)
      $busy = $true
      $stream = $null
      try {
        $stream = $client.GetStream()
        $req = Read-Request $stream
        if ($req -eq $null) { }
        elseif ($req.TooLarge) { Send-Text $stream 413 'text/plain; charset=utf-8' 'Payload Too Large' }
        else { Handle $stream $req }
      } catch {
        Write-Host ((Get-Date -Format 'HH:mm:ss') + ' エラー: ' + $_.Exception.Message) -ForegroundColor Yellow
        try { if ($stream) { Send-Text $stream 500 'text/plain; charset=utf-8' 'Internal Server Error' } } catch { }
      } finally {
        $client.Close()
      }
    }
    if (-not $busy) { Start-Sleep -Milliseconds 10 }
  }
} finally {
  foreach ($p in $pending) { $p.Client.Close() }
  $listener.Stop()
}
