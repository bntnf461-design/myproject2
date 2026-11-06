# 日報スキャン取り込み - v1
# スキャナーで読み込んだ紙（作業日報・硝子のロットNo表・検査シート）を
#   1) 日付ごとのフォルダに整理して保管し
#   2) 紙に書かれた文字を読み取って
#   3) Excel に1行ずつ書き込む
# Windows PowerShell 5.1 / Windows 10・11 用（追加のソフトは不要。Excel は書き込みに使用）

# ============================================================
#  画面に関係しない処理（tests\test_dailyreport.ps1 からも使う）
# ============================================================

function New-DefaultSettings {
    $docs = [Environment]::GetFolderPath('MyDocuments')
    $root = Join-Path $docs '日報スキャン'
    return [pscustomobject]@{
        version      = 1
        inboxFolder  = (Join-Path $root '受付')        # スキャナーの保存先にする
        archiveFolder= (Join-Path $root '保管')        # 日付ごとに整理して保管する
        excelPath    = (Join-Path $root '日報データ.xlsx')
        engine       = 'windows'                       # windows = Windows標準の文字認識（無料・ネット不要） / claude = Claude（手書きに強い・有料・ネット必要）
        claudeModel  = 'claude-opus-5-5'
        claudeEffort = 'medium'
        apiKeyProtected = ''                           # このPC・このユーザーでのみ読める形で暗号化して保存
        types = @(
            [pscustomobject]@{ name='日報'; ocr=$true; sheet='日報'; fields=@(
                [pscustomobject]@{ name='氏名';     keywords='氏名,作業者,担当者,名前'; pattern=''; multi=$false; hint='作業者の名前' }
                [pscustomobject]@{ name='品番';     keywords='品番,品名,製品';           pattern=''; multi=$false; hint='作った製品の品番・品名' }
                [pscustomobject]@{ name='作業内容'; keywords='作業内容,内容,工程';       pattern=''; multi=$false; hint='作業の内容・工程' }
                [pscustomobject]@{ name='開始時刻'; keywords='開始,始業';                 pattern=''; multi=$false; hint='作業の開始時刻（例 8:30）' }
                [pscustomobject]@{ name='終了時刻'; keywords='終了,終業';                 pattern=''; multi=$false; hint='作業の終了時刻（例 17:15）' }
                [pscustomobject]@{ name='生産数';   keywords='生産数,数量,出来高,良品数'; pattern=''; multi=$false; hint='作った数（数字だけ）' }
                [pscustomobject]@{ name='不良数';   keywords='不良数,不良';             pattern=''; multi=$false; hint='不良の数（数字だけ）' }
                [pscustomobject]@{ name='ロットNo'; keywords='ロット,LOT';                 pattern=''; multi=$true;  hint='使用した硝子のロット番号（複数ある時はカンマ区切り）' }
                [pscustomobject]@{ name='備考';     keywords='備考,特記,連絡';             pattern=''; multi=$false; hint='備考・特記事項' }
            ) }
            [pscustomobject]@{ name='ロット表'; ocr=$true; sheet='ロット'; fields=@(
                [pscustomobject]@{ name='ロットNo'; keywords='ロット,LOT'; pattern=''; multi=$true; hint='記載されている硝子のロット番号すべて（カンマ区切り）' }
                [pscustomobject]@{ name='品名';     keywords='品名,品番,種類'; pattern=''; multi=$false; hint='硝子の品名・品番' }
                [pscustomobject]@{ name='数量';     keywords='数量,枚数'; pattern=''; multi=$false; hint='数量・枚数' }
            ) }
            [pscustomobject]@{ name='検査シート'; ocr=$false; sheet='検査'; fields=@(
                [pscustomobject]@{ name='検査者'; keywords='検査者,検査員,担当'; pattern=''; multi=$false; hint='検査した人の名前' }
                [pscustomobject]@{ name='判定';   keywords='判定,合否,結果';     pattern=''; multi=$false; hint='合格／不合格などの判定' }
            ) }
        )
    }
}

# 保存されていた設定に、新しい版で増えた項目を足す（古い設定ファイルでも動くように）
function Merge-Settings($loaded) {
    $def = New-DefaultSettings
    if ($null -eq $loaded) { return $def }
    foreach ($p in $def.PSObject.Properties) {
        if (-not ($loaded.PSObject.Properties.Name -contains $p.Name) -or $null -eq $loaded.($p.Name)) {
            $loaded | Add-Member -NotePropertyName $p.Name -NotePropertyValue $p.Value -Force
        }
    }
    $types = @($loaded.types | Where-Object { $_ -and $_.name })
    if ($types.Count -eq 0) { $types = $def.types }
    foreach ($t in $types) {
        if ($null -eq $t.PSObject.Properties['ocr'])    { $t | Add-Member -NotePropertyName ocr -NotePropertyValue $true -Force }
        if (-not $t.sheet) { $t | Add-Member -NotePropertyName sheet -NotePropertyValue ([string]$t.name) -Force }
        $fs = @($t.fields | Where-Object { $_ -and $_.name })
        foreach ($f in $fs) {
            foreach ($k in 'keywords','pattern','hint') { if ($null -eq $f.PSObject.Properties[$k]) { $f | Add-Member -NotePropertyName $k -NotePropertyValue '' -Force } }
            if ($null -eq $f.PSObject.Properties['multi']) { $f | Add-Member -NotePropertyName multi -NotePropertyValue $false -Force }
        }
        $t | Add-Member -NotePropertyName fields -NotePropertyValue $fs -Force
    }
    $loaded | Add-Member -NotePropertyName types -NotePropertyValue $types -Force
    if (@('windows','claude') -notcontains $loaded.engine) { $loaded.engine = 'windows' }
    return $loaded
}

function Read-SettingsFile([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return (New-DefaultSettings) }
    $json = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
    return (Merge-Settings ($json | ConvertFrom-Json))
}

function Save-SettingsFile($settings, [string]$path) {
    $dir = Split-Path -Parent $path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $json = $settings | ConvertTo-Json -Depth 8
    $tmp = $path + '.tmp'
    [IO.File]::WriteAllText($tmp, $json, (New-Object Text.UTF8Encoding($true)))
    Move-Item -LiteralPath $tmp -Destination $path -Force
}

# 全角の英数字・記号を半角に（文字認識は全角で返すことがあるため）
function ConvertTo-HalfWidth([string]$s) {
    if ([string]::IsNullOrEmpty($s)) { return '' }
    $sb = New-Object Text.StringBuilder
    foreach ($ch in $s.ToCharArray()) {
        $c = [int]$ch
        if ($c -ge 0xFF01 -and $c -le 0xFF5E) { [void]$sb.Append([char]($c - 0xFEE0)) }
        elseif ($c -eq 0x3000) { [void]$sb.Append(' ') }
        elseif ($c -eq 0x30FC -or $c -eq 0x2015 -or $c -eq 0x2212) { [void]$sb.Append($ch) }  # 長音「ー」などはそのまま
        else { [void]$sb.Append($ch) }
    }
    return $sb.ToString()
}

# 文字認識の1行を比べやすい形に（半角にして空白を取る。日本語は1文字ずつ空白が入ることがある）
function ConvertTo-NormalizedLine([string]$s) {
    return ((ConvertTo-HalfWidth $s) -replace '\s+', '')
}

function Split-Keywords([string]$s) {
    if ([string]::IsNullOrWhiteSpace($s)) { return @() }
    return @(($s -split '[,、，;；/]') | ForEach-Object { ConvertTo-NormalizedLine $_ } | Where-Object { $_ -ne '' })
}

# 「目印」の文字を探して、その後ろ（無ければ次の行）を値にする
function Get-FieldValuesFromLines([string[]]$lines, $fields) {
    $norm = @($lines | ForEach-Object { ConvertTo-NormalizedLine $_ } | Where-Object { $_ -ne '' })
    $all = $norm -join "`n"
    $result = [ordered]@{}
    $trimChars = [char[]]':：.。・-=＝)）]】>　 '
    foreach ($f in $fields) {
        $found = New-Object System.Collections.ArrayList
        if (-not [string]::IsNullOrWhiteSpace([string]$f.pattern)) {
            try {
                foreach ($m in [regex]::Matches($all, [string]$f.pattern)) { if ($found -notcontains $m.Value) { [void]$found.Add($m.Value) } }
            } catch { }
        } else {
            $kws = Split-Keywords ([string]$f.keywords)
            for ($i = 0; $i -lt $norm.Count; $i++) {
                $hit = $false
                foreach ($kw in $kws) {
                    $idx = $norm[$i].IndexOf($kw, [StringComparison]::OrdinalIgnoreCase)
                    if ($idx -lt 0) { continue }
                    $v = $norm[$i].Substring($idx + $kw.Length)
                    # 「生産数」に対する「数」のように、もっと長い目印の一部だった時は、残りの目印の文字を取り除く
                    foreach ($kw2 in $kws) { if ($kw2.Length -gt $kw.Length -and $norm[$i].IndexOf($kw2, [StringComparison]::OrdinalIgnoreCase) -eq $idx) { $v = $norm[$i].Substring($idx + $kw2.Length); break } }
                    $v = $v.TrimStart($trimChars) -creplace '^(No|NO|№)[.:]', ''
                    $v = $v.TrimStart($trimChars).TrimEnd()
                    if ($v -eq '' -and ($i + 1) -lt $norm.Count) { $v = $norm[$i + 1].Trim($trimChars) }
                    if ($v -ne '' -and $found -notcontains $v) { [void]$found.Add($v) }
                    $hit = $true
                    break
                }
                if ($hit -and -not $f.multi) { break }
            }
        }
        $result[[string]$f.name] = ($found -join ', ')
    }
    return $result
}

# Claude の返事（JSON）から項目の値を取り出す
function ConvertFrom-ClaudeAnswer([string]$text, $fields) {
    $result = [ordered]@{}
    foreach ($f in $fields) { $result[[string]$f.name] = '' }
    if ([string]::IsNullOrWhiteSpace($text)) { return $result }
    $s = $text.IndexOf('{'); $e = $text.LastIndexOf('}')
    if ($s -lt 0 -or $e -le $s) { return $result }
    try { $obj = $text.Substring($s, $e - $s + 1) | ConvertFrom-Json } catch { return $result }
    foreach ($f in $fields) {
        $p = $obj.PSObject.Properties[[string]$f.name]
        if ($null -eq $p -or $null -eq $p.Value) { continue }
        $v = $p.Value
        if ($v -is [array]) { $v = (@($v) | ForEach-Object { [string]$_ } | Where-Object { $_ -ne '' }) -join ', ' }
        $result[[string]$f.name] = ([string]$v).Trim()
    }
    return $result
}

function Get-SafeName([string]$s) {
    $bad = [IO.Path]::GetInvalidFileNameChars()
    $sb = New-Object Text.StringBuilder
    foreach ($ch in $s.ToCharArray()) { if ($bad -contains $ch) { [void]$sb.Append('_') } else { [void]$sb.Append($ch) } }
    $r = $sb.ToString().Trim()
    if ($r -eq '') { $r = '_' }
    return $r
}

# 保管先のフォルダ： 保管\2026\2026-11\2026-11-06\日報
function Get-DayFolder([string]$archiveRoot, [datetime]$date) {
    return (Join-Path (Join-Path (Join-Path $archiveRoot $date.ToString('yyyy')) $date.ToString('yyyy-MM')) $date.ToString('yyyy-MM-dd'))
}

# 保管するファイル名： 2026-11-06_日報_01.jpg （同じ日の同じ種類で通し番号）
function Get-ArchiveTarget([string]$archiveRoot, [datetime]$date, [string]$typeName, [string]$ext) {
    $tn = Get-SafeName $typeName
    $dir = Join-Path (Get-DayFolder $archiveRoot $date) $tn
    $prefix = ('{0:yyyy-MM-dd}_{1}_' -f $date, $tn)
    $max = 0
    if (Test-Path -LiteralPath $dir) {
        foreach ($f in Get-ChildItem -LiteralPath $dir -File) {
            if ($f.Name.StartsWith($prefix)) {
                $m = [regex]::Match($f.BaseName.Substring($prefix.Length), '^(\d+)')
                if ($m.Success) { $n = [int]$m.Groups[1].Value; if ($n -gt $max) { $max = $n } }
            }
        }
    }
    return (Join-Path $dir ('{0}{1:00}{2}' -f $prefix, ($max + 1), $ext.ToLowerInvariant()))
}

$script:scanExtensions = @('.jpg','.jpeg','.png','.tif','.tiff','.bmp','.pdf')

function Test-ScanFile([string]$path) {
    return ($script:scanExtensions -contains ([IO.Path]::GetExtension($path).ToLowerInvariant()))
}

# スキャナーが書き込み中でないか（2秒以上変化がなく、開けること）
function Test-FileReady([IO.FileInfo]$fi) {
    if (((Get-Date) - $fi.LastWriteTime).TotalSeconds -lt 2) { return $false }
    try { $fs = [IO.File]::Open($fi.FullName, 'Open', 'Read', 'None'); $fs.Close(); return $true } catch { return $false }
}

# CSV 用に1つの値を囲む
function ConvertTo-CsvCell($v) {
    $s = [string]$v
    if ($s -match '[",\r\n]') { return '"' + $s.Replace('"', '""') + '"' }
    return $s
}

# 読み取り結果の控え（Excel が使えない時もデータが残るように、その日のフォルダに CSV で残す）
function Add-BackupCsvRow([string]$csvPath, [string[]]$header, [object[]]$values) {
    $dir = Split-Path -Parent $csvPath
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $enc = New-Object Text.UTF8Encoding($true)   # Excel で文字化けしないよう BOM 付き
    if (-not (Test-Path -LiteralPath $csvPath)) {
        [IO.File]::WriteAllText($csvPath, (($header | ForEach-Object { ConvertTo-CsvCell $_ }) -join ',') + "`r`n", $enc)
    }
    [IO.File]::AppendAllText($csvPath, (($values | ForEach-Object { ConvertTo-CsvCell $_ }) -join ',') + "`r`n", $enc)
}

function Get-ClaudePrompt($type) {
    $lines = foreach ($f in $type.fields) {
        $h = [string]$f.hint; if ($h -eq '') { $h = [string]$f.name }
        '- "{0}": {1}' -f $f.name, $h
    }
    $keys = ($type.fields | ForEach-Object { '"' + $_.name + '": ""' }) -join ', '
    return @"
この画像は工場の「$($type.name)」をスキャンしたものです（手書きの文字を含みます）。
次の項目を読み取ってください。

$($lines -join "`n")

決まり：
- 書かれている通りに読み取り、推測で補わないでください。読めない・書かれていない項目は "" にしてください。
- 数字は半角にしてください。
- 同じ項目が複数ある時（ロット番号など）は、カンマ区切りで1つの文字列にしてください。
- 返事は次の形の JSON だけにしてください（説明の文章は不要です）。
{$keys}
"@
}

# ============================================================
#  ここから下は Windows でだけ動く処理
# ============================================================

# --- Windows 標準の文字認識（Windows.Media.Ocr）---
$script:winrtReady = $false
function Initialize-WinRT {
    if ($script:winrtReady) { return }
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
    $null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
    $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
    $methods = [System.WindowsRuntimeSystemExtensions].GetMethods()
    $script:asTaskOp = $methods | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
    $script:asTaskAction = $methods | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
    $script:ocrEngine = $null
    try { $script:ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('ja')) } catch { }
    if ($null -eq $script:ocrEngine) { $script:ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
    if ($null -eq $script:ocrEngine) { throw 'Windows の日本語の文字認識が使えません。「設定」→「時刻と言語」→「言語」で日本語の「光学式文字認識（OCR）」を追加してください。' }
    $script:winrtReady = $true
}
function Wait-WinRT($op, [type]$resultType) {
    $t = $script:asTaskOp.MakeGenericMethod($resultType).Invoke($null, @($op))
    [void]$t.Wait(-1)
    return $t.Result
}
function Wait-WinRTAction($op) {
    $t = $script:asTaskAction.Invoke($null, @($op))
    [void]$t.Wait(-1)
}
function Get-OcrLinesFromStream($stream) {
    $decoder = Wait-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
    if ($decoder.PixelWidth -gt $max -or $decoder.PixelHeight -gt $max) {
        $scale = [Math]::Min($max / $decoder.PixelWidth, $max / $decoder.PixelHeight)
        $tf = New-Object Windows.Graphics.Imaging.BitmapTransform
        $tf.ScaledWidth = [uint32]($decoder.PixelWidth * $scale); $tf.ScaledHeight = [uint32]($decoder.PixelHeight * $scale)
        $bmp = Wait-WinRT ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $tf, [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
    } else {
        $bmp = Wait-WinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    }
    $res = Wait-WinRT ($script:ocrEngine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    return @($res.Lines | ForEach-Object { $_.Text })
}
function Get-OcrLines([string]$path) {
    Initialize-WinRT
    $file = Wait-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $lines = New-Object System.Collections.ArrayList
    if ([IO.Path]::GetExtension($path).ToLowerInvariant() -eq '.pdf') {
        $pdf = Wait-WinRT ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
        for ($i = 0; $i -lt $pdf.PageCount; $i++) {
            $page = $pdf.GetPage([uint32]$i)
            $mem = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
            $opt = New-Object Windows.Data.Pdf.PdfPageRenderOptions
            $opt.DestinationWidth = [uint32][Math]::Min(4000, $page.Size.Width * 3)   # 約300dpi相当で描いてから読む
            Wait-WinRTAction ($page.RenderToStreamAsync($mem, $opt))
            foreach ($l in (Get-OcrLinesFromStream $mem)) { [void]$lines.Add($l) }
            $page.Dispose(); $mem.Dispose()
        }
    } else {
        $stream = Wait-WinRT ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        foreach ($l in (Get-OcrLinesFromStream $stream)) { [void]$lines.Add($l) }
        $stream.Dispose()
    }
    return @($lines)
}

# --- Claude で読み取る ---
function Get-ApiKey($settings) {
    if ($env:ANTHROPIC_API_KEY) { return $env:ANTHROPIC_API_KEY }
    if ([string]::IsNullOrEmpty($settings.apiKeyProtected)) { return '' }
    try {
        $sec = ConvertTo-SecureString $settings.apiKeyProtected
        $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
        try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
    } catch { return '' }
}
function Protect-ApiKey([string]$key) {
    if ([string]::IsNullOrEmpty($key)) { return '' }
    return (ConvertTo-SecureString $key -AsPlainText -Force | ConvertFrom-SecureString)
}

# 画像は長い辺 2000px の JPEG にしてから送る（大きいままだと送れない・時間がかかるため）
function Get-ImageBase64ForClaude([string]$path) {
    Add-Type -AssemblyName System.Drawing
    $src = [System.Drawing.Image]::FromFile($path)
    try {
        $scale = [Math]::Min(1.0, 2000.0 / [Math]::Max($src.Width, $src.Height))
        $w = [Math]::Max(1, [int]($src.Width * $scale)); $h = [Math]::Max(1, [int]($src.Height * $scale))
        $bmp = New-Object System.Drawing.Bitmap($w, $h)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.Clear([System.Drawing.Color]::White)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.DrawImage($src, 0, 0, $w, $h); $g.Dispose()
        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
        $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]88)
        $ms = New-Object IO.MemoryStream
        $bmp.Save($ms, $codec, $ep); $bmp.Dispose()
        return [Convert]::ToBase64String($ms.ToArray())
    } finally { $src.Dispose() }
}

function Invoke-ClaudeRead($settings, $type, [string]$path) {
    $key = Get-ApiKey $settings
    if ([string]::IsNullOrEmpty($key)) { throw 'Claude の APIキーが設定されていません（「設定」から入力してください）。' }
    if ([IO.Path]::GetExtension($path).ToLowerInvariant() -eq '.pdf') {
        $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($path))
        $part = @{ type = 'document'; source = @{ type = 'base64'; media_type = 'application/pdf'; data = $b64 } }
    } else {
        $part = @{ type = 'image'; source = @{ type = 'base64'; media_type = 'image/jpeg'; data = (Get-ImageBase64ForClaude $path) } }
    }
    $body = [ordered]@{
        model         = [string]$settings.claudeModel
        max_tokens    = 16000
        output_config = @{ effort = [string]$settings.claudeEffort }
        messages      = @(@{ role = 'user'; content = @($part, @{ type = 'text'; text = (Get-ClaudePrompt $type) }) })
    }
    # 安全確認で断られた時は、別のモデルで自動的に読み直す（対応しているモデルだけ）
    $useFallback = ([string]$settings.claudeModel) -match '^claude-(opus-5|fable-5|sonnet-5-5)'
    if ($useFallback) { $body['fallbacks'] = 'default' }
    $bytes = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 10 -Compress))
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $req = [Net.HttpWebRequest]::Create('https://api.anthropic.com/v1/messages')
    $req.Method = 'POST'; $req.ContentType = 'application/json; charset=utf-8'; $req.Timeout = 300000; $req.ReadWriteTimeout = 300000
    $req.Headers.Add('x-api-key', $key)
    $req.Headers.Add('anthropic-version', '2023-06-01')
    if ($useFallback) { $req.Headers.Add('anthropic-beta', 'server-side-fallback-2026-07-01') }
    $rs = $req.GetRequestStream(); $rs.Write($bytes, 0, $bytes.Length); $rs.Close()
    try { $resp = $req.GetResponse() }
    catch [Net.WebException] {
        $msg = $_.Exception.Message
        if ($_.Exception.Response) {
            $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream(), [Text.Encoding]::UTF8)
            $err = $sr.ReadToEnd(); $sr.Close()
            try { $msg = ($err | ConvertFrom-Json).error.message } catch { $msg = $err }
            $code = [int]$_.Exception.Response.StatusCode
            if ($code -eq 401) { $msg = 'APIキーが正しくありません。' + $msg }
            elseif ($code -eq 429) { $msg = '短い時間に送りすぎました。少し待ってからやり直してください。' + $msg }
        }
        throw "Claude への送信に失敗しました：$msg"
    }
    $sr = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
    $text = $sr.ReadToEnd(); $sr.Close(); $resp.Close()
    $obj = $text | ConvertFrom-Json
    if ($obj.stop_reason -eq 'refusal') { throw 'Claude がこの画像の読み取りを断りました。' }
    $answer = (@($obj.content) | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }) -join "`n"
    return $answer
}

# --- Excel に書き込む ---
function Release-Com($o) { if ($null -ne $o) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($o) } catch { } } }

# $rows は @{ date; file; values(ordered) } の配列。見出しは名前で探すので、項目を増やしても列がずれない
function Write-RowsToExcel([string]$excelPath, [string]$sheetName, [string[]]$fieldNames, $rows) {
    $xl = $null; $wb = $null; $ws = $null
    try {
        try { $xl = New-Object -ComObject Excel.Application } catch { throw 'Excel が見つかりません。読み取り結果は、その日の保管フォルダの「読み取り結果.csv」に残っています。' }
        $xl.Visible = $false; $xl.DisplayAlerts = $false
        $dir = Split-Path -Parent $excelPath
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $isNew = -not (Test-Path -LiteralPath $excelPath)
        if ($isNew) { $wb = $xl.Workbooks.Add() } else {
            $wb = $xl.Workbooks.Open($excelPath)
            if ($wb.ReadOnly) { throw "Excelファイルを誰かが開いています。閉じてから、もう一度「Excelに書き込む」を押してください。`r`n$excelPath" }
        }
        foreach ($s in $wb.Worksheets) { if ($s.Name -eq $sheetName) { $ws = $s; break } }
        if ($null -eq $ws) {
            if ($isNew) { $ws = $wb.Worksheets.Item(1) } else { $ws = $wb.Worksheets.Add([Type]::Missing, $wb.Worksheets.Item($wb.Worksheets.Count)) }
            $ws.Name = $sheetName
        }
        # 見出し（無い列は右に足す）
        $want = @('日付') + $fieldNames + @('スキャン画像', '取り込み日時')
        $colOf = @{}
        $lastCol = $ws.Cells.Item(1, $ws.Columns.Count).End(-4159).Column   # xlToLeft
        for ($c = 1; $c -le $lastCol; $c++) { $h = [string]$ws.Cells.Item(1, $c).Text; if ($h -ne '' -and -not $colOf.ContainsKey($h)) { $colOf[$h] = $c } }
        if ($colOf.Count -eq 0) { $lastCol = 0 }
        foreach ($h in $want) { if (-not $colOf.ContainsKey($h)) { $lastCol++; $ws.Cells.Item(1, $lastCol).Value2 = $h; $colOf[$h] = $lastCol } }
        $hdr = $ws.Range($ws.Cells.Item(1, 1), $ws.Cells.Item(1, $lastCol))
        $hdr.Font.Bold = $true; $hdr.Interior.Color = 0xEFE3D6
        $row = $ws.Cells.Item($ws.Rows.Count, $colOf['日付']).End(-4162).Row + 1   # xlUp
        if ($row -lt 2) { $row = 2 }
        foreach ($r in $rows) {
            $cell = $ws.Cells.Item($row, $colOf['日付']); $cell.NumberFormatLocal = 'yyyy/mm/dd'; $cell.Value2 = ([datetime]$r.date).ToOADate()
            foreach ($n in $fieldNames) {
                $c = $ws.Cells.Item($row, $colOf[$n]); $v = [string]$r.values[$n]
                if ($v -match '^-?\d+(\.\d+)?$' -and $v -notmatch '^0\d') { $c.Value2 = [double]$v } else { $c.NumberFormat = '@'; $c.Value2 = $v }
            }
            $fc = $ws.Cells.Item($row, $colOf['スキャン画像'])
            [void]$ws.Hyperlinks.Add($fc, [string]$r.file, [Type]::Missing, '押すと紙の画像が開きます', [IO.Path]::GetFileName([string]$r.file))
            $tc = $ws.Cells.Item($row, $colOf['取り込み日時']); $tc.NumberFormatLocal = 'yyyy/mm/dd hh:mm'; $tc.Value2 = (Get-Date).ToOADate()
            $row++
        }
        [void]$ws.Columns.AutoFit()
        if ($isNew) { $wb.SaveAs($excelPath, 51) } else { $wb.Save() }   # 51 = .xlsx
    } finally {
        if ($wb) { try { $wb.Close($false) } catch { } }
        if ($xl) { try { $xl.Quit() } catch { } }
        Release-Com $ws; Release-Com $wb; Release-Com $xl
        [GC]::Collect(); [GC]::WaitForPendingFinalizers()
    }
}

# テストから読み込まれた時は、ここで終わる（画面は作らない）
if ($env:DAILYREPORT_NO_GUI -eq '1') { return }

# ============================================================
#  画面
# ============================================================
try {
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)

$script:mutex = New-Object System.Threading.Mutex($false, 'Local\DAILY_REPORT_SCAN_SINGLE')
$owns = $false
try { $owns = $script:mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns = $true }
if (-not $owns) { [void][System.Windows.Forms.MessageBox]::Show('日報スキャン取り込みは、すでに起動しています。', '日報スキャン取り込み'); return }

$script:baseDir = $PSScriptRoot
$script:settingsPath = Join-Path $script:baseDir 'dailyreport_settings.json'
$script:errorLog = Join-Path $script:baseDir 'dailyreport_error.log'
function Write-ErrorLog([string]$msg) { try { [IO.File]::AppendAllText($script:errorLog, ('{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $msg) + "`r`n", [Text.Encoding]::UTF8) } catch { } }

try { $script:settings = Read-SettingsFile $script:settingsPath } catch { Write-ErrorLog "設定の読み込みに失敗：$_"; $script:settings = New-DefaultSettings }
function Save-Settings { try { Save-SettingsFile $script:settings $script:settingsPath } catch { Write-ErrorLog "設定の保存に失敗：$_" } }
function Ensure-Folders { foreach ($d in $script:settings.inboxFolder, $script:settings.archiveFolder) { if ($d -and -not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null } } }
Ensure-Folders
Save-Settings

$fontUI = New-Object System.Drawing.Font('Yu Gothic UI', 10)
$fontBig = New-Object System.Drawing.Font('Yu Gothic UI', 12, [System.Drawing.FontStyle]::Bold)
$blue = [System.Drawing.Color]::FromArgb(37, 99, 235)

$form = New-Object System.Windows.Forms.Form
$form.Text = '日報スキャン取り込み v1'
$form.Size = New-Object System.Drawing.Size(1280, 800)
$form.MinimumSize = New-Object System.Drawing.Size(1000, 640)
$form.StartPosition = 'CenterScreen'
$form.Font = $fontUI
$form.KeyPreview = $true
$form.BackColor = [System.Drawing.Color]::FromArgb(246, 247, 249)

function New-Btn([string]$text, [int]$w = 150, [bool]$primary = $false) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $text; $b.Width = $w; $b.Height = 38; $b.FlatStyle = 'Flat'; $b.Margin = New-Object System.Windows.Forms.Padding(4)
    if ($primary) { $b.BackColor = $blue; $b.ForeColor = [System.Drawing.Color]::White; $b.FlatAppearance.BorderSize = 0; $b.Font = $fontBig }
    else { $b.BackColor = [System.Drawing.Color]::White; $b.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(200, 205, 212) }
    return $b
}

# ---- 上：日付と紙の種類 ----
$top = New-Object System.Windows.Forms.FlowLayoutPanel
$top.Dock = 'Top'; $top.Height = 58; $top.Padding = New-Object System.Windows.Forms.Padding(10, 10, 10, 0); $top.WrapContents = $false
$lblDate = New-Object System.Windows.Forms.Label; $lblDate.Text = '日報の日付'; $lblDate.AutoSize = $true; $lblDate.Margin = New-Object System.Windows.Forms.Padding(4, 12, 4, 0)
$dtp = New-Object System.Windows.Forms.DateTimePicker; $dtp.Format = 'Long'; $dtp.Width = 190; $dtp.Font = $fontBig; $dtp.Margin = New-Object System.Windows.Forms.Padding(4, 6, 4, 0)
$btnToday = New-Btn '今日' 64; $btnYesterday = New-Btn '昨日' 64
$btnToday.Add_Click({ $dtp.Value = (Get-Date).Date })
$btnYesterday.Add_Click({ $dtp.Value = (Get-Date).Date.AddDays(-1) })
$sep = New-Object System.Windows.Forms.Label; $sep.Width = 24
$lblType = New-Object System.Windows.Forms.Label; $lblType.Text = '紙の種類'; $lblType.AutoSize = $true; $lblType.Margin = New-Object System.Windows.Forms.Padding(4, 12, 4, 0)
$top.Controls.AddRange(@($lblDate, $dtp, $btnToday, $btnYesterday, $sep, $lblType))
$script:typeButtons = @()
function Build-TypeButtons {
    foreach ($rb in $script:typeButtons) { $top.Controls.Remove($rb); $rb.Dispose() }
    $script:typeButtons = @()
    foreach ($t in $script:settings.types) {
        $rb = New-Object System.Windows.Forms.RadioButton
        $rb.Appearance = 'Button'; $rb.Text = $t.name; $rb.Width = 130; $rb.Height = 38; $rb.TextAlign = 'MiddleCenter'; $rb.FlatStyle = 'Flat'; $rb.Font = $fontBig
        $rb.FlatAppearance.CheckedBackColor = $blue; $rb.BackColor = [System.Drawing.Color]::White
        $rb.Tag = $t
        $rb.Add_CheckedChanged({ param($s, $e) if ($s.Checked) { $s.ForeColor = [System.Drawing.Color]::White; On-TypeChanged } else { $s.ForeColor = [System.Drawing.Color]::Black } })
        $top.Controls.Add($rb)
        $script:typeButtons += $rb
    }
}
function Get-CurrentType { foreach ($rb in $script:typeButtons) { if ($rb.Checked) { return $rb.Tag } }; return $null }

# ---- 左：受付フォルダの紙 ----
$split = New-Object System.Windows.Forms.SplitContainer
$split.Dock = 'Fill'; $split.Panel1.Padding = New-Object System.Windows.Forms.Padding(10); $split.Panel2.Padding = New-Object System.Windows.Forms.Padding(10)

$lblInbox = New-Object System.Windows.Forms.Label; $lblInbox.Dock = 'Top'; $lblInbox.Height = 26; $lblInbox.Font = $fontBig; $lblInbox.Text = '① スキャンした紙（受付フォルダ）'
$list = New-Object System.Windows.Forms.ListView
$list.Dock = 'Top'; $list.Height = 230; $list.View = 'Details'; $list.CheckBoxes = $true; $list.FullRowSelect = $true; $list.HideSelection = $false
[void]$list.Columns.Add('ファイル', 250); [void]$list.Columns.Add('スキャン時刻', 140)
$inboxBar = New-Object System.Windows.Forms.FlowLayoutPanel; $inboxBar.Dock = 'Top'; $inboxBar.Height = 48
$btnAll = New-Btn 'すべて選ぶ' 110; $btnOpenInbox = New-Btn '受付フォルダを開く' 160; $btnAddFiles = New-Btn 'ファイルを追加…' 140
$inboxBar.Controls.AddRange(@($btnAll, $btnOpenInbox, $btnAddFiles))
$preview = New-Object System.Windows.Forms.PictureBox; $preview.Dock = 'Fill'; $preview.SizeMode = 'Zoom'; $preview.BackColor = [System.Drawing.Color]::FromArgb(230, 232, 236); $preview.BorderStyle = 'FixedSingle'
$split.Panel1.Controls.Add($preview); $split.Panel1.Controls.Add($inboxBar); $split.Panel1.Controls.Add($list); $split.Panel1.Controls.Add($lblInbox)

# ---- 右：読み取り結果 ----
$lblRes = New-Object System.Windows.Forms.Label; $lblRes.Dock = 'Top'; $lblRes.Height = 26; $lblRes.Font = $fontBig; $lblRes.Text = '② 読み取った内容（直せます）'
$grid = New-Object System.Windows.Forms.DataGridView
$grid.Dock = 'Fill'; $grid.AllowUserToAddRows = $false; $grid.RowHeadersWidth = 28; $grid.BackgroundColor = [System.Drawing.Color]::White
$grid.AutoSizeRowsMode = 'AllCells'; $grid.DefaultCellStyle.WrapMode = 'True'; $grid.SelectionMode = 'CellSelect'
$actBar = New-Object System.Windows.Forms.FlowLayoutPanel; $actBar.Dock = 'Bottom'; $actBar.Height = 54; $actBar.Padding = New-Object System.Windows.Forms.Padding(0, 6, 0, 0)
$btnImport = New-Btn '取り込む（保管＋読み取り）' 260 $true
$btnWrite = New-Btn 'Excelに書き込む' 190 $true
$btnOpenExcel = New-Btn 'Excelを開く' 120; $btnOpenDay = New-Btn 'この日の保管フォルダ' 180; $btnSettings = New-Btn '設定' 80
$actBar.Controls.AddRange(@($btnImport, $btnWrite, $btnOpenExcel, $btnOpenDay, $btnSettings))
$split.Panel2.Controls.Add($grid); $split.Panel2.Controls.Add($actBar); $split.Panel2.Controls.Add($lblRes)

$status = New-Object System.Windows.Forms.StatusStrip
$statusLbl = New-Object System.Windows.Forms.ToolStripStatusLabel; $statusLbl.Spring = $true; $statusLbl.TextAlign = 'MiddleLeft'
[void]$status.Items.Add($statusLbl)
function Set-Status([string]$s) { $statusLbl.Text = $s; [System.Windows.Forms.Application]::DoEvents() }

$form.Controls.Add($split); $form.Controls.Add($top); $form.Controls.Add($status)

$tips = New-Object System.Windows.Forms.ToolTip
$tips.SetToolTip($btnImport, '選んだ紙を、日付と種類ごとのフォルダへ移して保管し、文字を読み取ります（F5）')
$tips.SetToolTip($btnWrite, '右の表の内容を Excel に1行ずつ追加します（F8）')
$tips.SetToolTip($dtp, '日報に書いた日付を選びます。翌朝にまとめてスキャンする時は「昨日」を押してください')

# ---- 結果の表 ----
$script:dirty = $false
function Reset-Grid($type) {
    $grid.Rows.Clear(); $grid.Columns.Clear()
    $c = New-Object System.Windows.Forms.DataGridViewTextBoxColumn; $c.Name = '__date'; $c.HeaderText = '日付'; $c.Width = 95; [void]$grid.Columns.Add($c)
    if ($type) { foreach ($f in $type.fields) { $c = New-Object System.Windows.Forms.DataGridViewTextBoxColumn; $c.Name = 'f_' + $f.name; $c.HeaderText = $f.name; $c.Width = 110; [void]$grid.Columns.Add($c) } }
    $c = New-Object System.Windows.Forms.DataGridViewTextBoxColumn; $c.Name = '__file'; $c.HeaderText = '保管したファイル'; $c.ReadOnly = $true; $c.Width = 200; [void]$grid.Columns.Add($c)
    $script:dirty = $false
}
$script:lastType = $null
function On-TypeChanged {
    $t = Get-CurrentType
    if ($null -ne $t -and $t -eq $script:lastType) { return }
    if ($script:dirty -and $grid.Rows.Count -gt 0 -and $script:lastType -ne $t) {
        $r = [System.Windows.Forms.MessageBox]::Show("まだ Excel に書き込んでいない読み取り結果があります。`r`n書き込まずに種類を変えますか？`r`n（結果は保管フォルダの .txt に文字だけ残っています）", '確認', 'YesNo', 'Warning')
        if ($r -ne 'Yes') { foreach ($rb in $script:typeButtons) { if ($rb.Tag -eq $script:lastType) { $rb.Checked = $true } }; return }
    }
    $script:lastType = $t
    Reset-Grid $t
    if ($t -and -not $t.ocr) { Set-Status "「$($t.name)」は保管だけ行います（文字の読み取りは「設定」で入にできます）。" } else { Set-Status '' }
}
$grid.Add_CellValueChanged({ $script:dirty = $true })
$grid.Add_CellDoubleClick({ param($s, $e) if ($e.RowIndex -ge 0) { $p = [string]$grid.Rows[$e.RowIndex].Cells['__file'].Tag; if ($p -and (Test-Path -LiteralPath $p)) { Start-Process -FilePath $p } } })

# ---- 受付フォルダの一覧 ----
function Refresh-Inbox {
    $inbox = $script:settings.inboxFolder
    if (-not (Test-Path -LiteralPath $inbox)) { return }
    $files = @(Get-ChildItem -LiteralPath $inbox -File -ErrorAction SilentlyContinue | Where-Object { Test-ScanFile $_.FullName } | Sort-Object LastWriteTime, Name)
    $now = @($files | ForEach-Object { $_.FullName })
    $old = @($list.Items | ForEach-Object { $_.Tag })
    if (($now -join '|') -eq ($old -join '|')) { return }
    $checked = @($list.CheckedItems | ForEach-Object { $_.Tag })
    $list.BeginUpdate(); $list.Items.Clear()
    foreach ($f in $files) {
        $it = New-Object System.Windows.Forms.ListViewItem($f.Name)
        [void]$it.SubItems.Add($f.LastWriteTime.ToString('MM/dd HH:mm:ss'))
        $it.Tag = $f.FullName
        if ($checked -contains $f.FullName) { $it.Checked = $true }
        [void]$list.Items.Add($it)
    }
    $list.EndUpdate()
    $lblInbox.Text = "① スキャンした紙（受付フォルダ）  $($files.Count) 枚"
}
function Show-Preview([string]$path) {
    if ($preview.Image) { $preview.Image.Dispose(); $preview.Image = $null }
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { return }
    if ([IO.Path]::GetExtension($path).ToLowerInvariant() -eq '.pdf') { return }
    try {
        # ファイルをつかんだままにしない（移動できなくなるため）
        $bytes = [IO.File]::ReadAllBytes($path); $ms = New-Object IO.MemoryStream(, $bytes)
        $img = [System.Drawing.Image]::FromStream($ms); $preview.Image = New-Object System.Drawing.Bitmap($img); $img.Dispose(); $ms.Dispose()
    } catch { }
}
$list.Add_SelectedIndexChanged({ if ($list.SelectedItems.Count -gt 0) { Show-Preview ([string]$list.SelectedItems[0].Tag) } })
$btnAll.Add_Click({ $all = $true; foreach ($it in $list.Items) { if (-not $it.Checked) { $all = $false } }; foreach ($it in $list.Items) { $it.Checked = -not $all } })
$btnOpenInbox.Add_Click({ Ensure-Folders; Start-Process explorer.exe -ArgumentList ('"' + $script:settings.inboxFolder + '"') })
$btnAddFiles.Add_Click({
    $ofd = New-Object System.Windows.Forms.OpenFileDialog
    $ofd.Multiselect = $true; $ofd.Filter = 'スキャンした紙 (*.jpg;*.jpeg;*.png;*.tif;*.tiff;*.bmp;*.pdf)|*.jpg;*.jpeg;*.png;*.tif;*.tiff;*.bmp;*.pdf'
    if ($ofd.ShowDialog() -eq 'OK') {
        foreach ($p in $ofd.FileNames) { Copy-Item -LiteralPath $p -Destination (Join-Path $script:settings.inboxFolder ([IO.Path]::GetFileName($p))) -Force }
        Set-Status "$($ofd.FileNames.Count) 件を受付フォルダにコピーしました。"
    }
})
$timer = New-Object System.Windows.Forms.Timer; $timer.Interval = 2000; $timer.Add_Tick({ if (-not $script:busy) { Refresh-Inbox } })

# ---- 取り込む ----
$script:busy = $false
function Set-Busy([bool]$b) { $script:busy = $b; foreach ($x in $btnImport, $btnWrite, $btnSettings) { $x.Enabled = -not $b }; $form.Cursor = $(if ($b) { [System.Windows.Forms.Cursors]::WaitCursor } else { [System.Windows.Forms.Cursors]::Default }) }

function Read-Fields($type, [string]$path) {
    if ($script:settings.engine -eq 'claude') {
        $ans = Invoke-ClaudeRead $script:settings $type $path
        return @{ values = (ConvertFrom-ClaudeAnswer $ans $type.fields); text = $ans }
    }
    $lines = Get-OcrLines $path
    return @{ values = (Get-FieldValuesFromLines $lines $type.fields); text = ($lines -join "`r`n") }
}

function Invoke-Import {
    $type = Get-CurrentType
    if (-not $type) { [void][System.Windows.Forms.MessageBox]::Show('上の「紙の種類」を選んでください。', '日報スキャン取り込み'); return }
    $items = @($list.CheckedItems)
    if ($items.Count -eq 0) { $items = @($list.Items) }
    if ($items.Count -eq 0) { [void][System.Windows.Forms.MessageBox]::Show("受付フォルダにスキャンした紙がありません。`r`nスキャナーの保存先を次のフォルダにしてください：`r`n$($script:settings.inboxFolder)", '日報スキャン取り込み'); return }
    $date = $dtp.Value.Date
    $msg = "{0:yyyy年M月d日} の「{1}」として {2} 枚を取り込みます。よろしいですか？" -f $date, $type.name, $items.Count
    if ([System.Windows.Forms.MessageBox]::Show($msg, '確認', 'OKCancel', 'Question') -ne 'OK') { return }
    Show-Preview $null
    Set-Busy $true
    $ok = 0; $errs = New-Object System.Collections.ArrayList
    try {
        $n = 0
        foreach ($it in $items) {
            $n++
            $src = [string]$it.Tag
            try {
                $fi = Get-Item -LiteralPath $src -ErrorAction Stop
                if (-not (Test-FileReady $fi)) { [void]$errs.Add("$($fi.Name)：スキャナーが書き込み中のため、あとで取り込んでください"); continue }
                $dest = Get-ArchiveTarget $script:settings.archiveFolder $date $type.name $fi.Extension
                New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
                Move-Item -LiteralPath $src -Destination $dest -ErrorAction Stop
                $ok++
                if ($type.ocr -and @($type.fields).Count -gt 0) {
                    Set-Status ("読み取り中 {0}/{1}：{2}" -f $n, $items.Count, [IO.Path]::GetFileName($dest))
                    $r = $null
                    try { $r = Read-Fields $type $dest } catch { [void]$errs.Add("$([IO.Path]::GetFileName($dest))：保管しましたが読み取れませんでした（$($_.Exception.Message)）"); Write-ErrorLog "読み取り失敗 $dest : $_" }
                    $idx = $grid.Rows.Add()
                    $row = $grid.Rows[$idx]
                    $row.Cells['__date'].Value = $date.ToString('yyyy/MM/dd')
                    $row.Cells['__file'].Value = [IO.Path]::GetFileName($dest); $row.Cells['__file'].Tag = $dest
                    if ($r) {
                        foreach ($f in $type.fields) { $row.Cells['f_' + $f.name].Value = [string]$r.values[[string]$f.name] }
                        try { [IO.File]::WriteAllText([IO.Path]::ChangeExtension($dest, '.txt'), [string]$r.text, (New-Object Text.UTF8Encoding($true))) } catch { }
                    }
                    $script:dirty = $true
                } else { Set-Status ("保管 {0}/{1}" -f $n, $items.Count) }
            } catch { [void]$errs.Add("$([IO.Path]::GetFileName($src))：$($_.Exception.Message)"); Write-ErrorLog "取り込み失敗 $src : $_" }
        }
    } finally { Set-Busy $false; Refresh-Inbox }
    $s = "$ok 枚を保管しました：$(Get-DayFolder $script:settings.archiveFolder $date)"
    if ($type.ocr) { $s += '　→ 右の表を確認・修正して「Excelに書き込む」を押してください' }
    Set-Status $s
    if ($errs.Count -gt 0) { [void][System.Windows.Forms.MessageBox]::Show(($errs -join "`r`n"), 'うまくいかなかった紙', 'OK', 'Warning') }
}
$btnImport.Add_Click({ Invoke-Import })

# ---- Excel に書き込む ----
function Invoke-WriteExcel {
    $type = Get-CurrentType
    if (-not $type -or $grid.Rows.Count -eq 0) { [void][System.Windows.Forms.MessageBox]::Show('書き込む内容がありません。先に「取り込む」を押してください。', '日報スキャン取り込み'); return }
    $grid.EndEdit()
    $names = @($type.fields | ForEach-Object { [string]$_.name })
    $rows = @()
    foreach ($gr in $grid.Rows) {
        $d = (Get-Date).Date
        $ds = [string]$gr.Cells['__date'].Value
        $tmp = [datetime]::MinValue
        if ([datetime]::TryParse($ds, [ref]$tmp)) { $d = $tmp.Date } else { [void][System.Windows.Forms.MessageBox]::Show("日付が正しくありません：$ds", '日報スキャン取り込み'); return }
        $vals = [ordered]@{}
        foreach ($n in $names) { $vals[$n] = [string]$gr.Cells['f_' + $n].Value }
        $rows += [pscustomobject]@{ date = $d; file = [string]$gr.Cells['__file'].Tag; values = $vals }
    }
    Set-Busy $true
    try {
        # 先に控えの CSV（その日のフォルダ）
        foreach ($r in $rows) {
            $csv = Join-Path (Get-DayFolder $script:settings.archiveFolder $r.date) ('読み取り結果_' + (Get-SafeName $type.name) + '.csv')
            $vals = @($r.date.ToString('yyyy/MM/dd')) + @($names | ForEach-Object { $r.values[$_] }) + @($r.file, (Get-Date).ToString('yyyy/MM/dd HH:mm'))
            Add-BackupCsvRow $csv (@('日付') + $names + @('スキャン画像', '取り込み日時')) $vals
        }
        Set-Status 'Excel に書き込み中…'
        Write-RowsToExcel $script:settings.excelPath ([string]$type.sheet) $names $rows
        Reset-Grid $type
        Set-Status "$($rows.Count) 行を Excel（$($script:settings.excelPath) のシート「$($type.sheet)」）に書き込みました。"
    } catch {
        Write-ErrorLog "Excel 書き込み失敗：$_"
        [void][System.Windows.Forms.MessageBox]::Show("Excel に書き込めませんでした。`r`n$($_.Exception.Message)`r`n`r`n表の内容は消していません。直してからもう一度押してください。", '日報スキャン取り込み', 'OK', 'Warning')
        Set-Status 'Excel に書き込めませんでした（表の内容はそのまま残っています）'
    } finally { Set-Busy $false }
}
$btnWrite.Add_Click({ Invoke-WriteExcel })
$btnOpenExcel.Add_Click({ if (Test-Path -LiteralPath $script:settings.excelPath) { Start-Process -FilePath $script:settings.excelPath } else { [void][System.Windows.Forms.MessageBox]::Show('まだ Excel ファイルがありません（はじめて書き込む時に作られます）。', '日報スキャン取り込み') } })
$btnOpenDay.Add_Click({
    $d = Get-DayFolder $script:settings.archiveFolder $dtp.Value.Date
    if (-not (Test-Path -LiteralPath $d)) { [void][System.Windows.Forms.MessageBox]::Show(("{0:yyyy年M月d日} の保管はまだありません。" -f $dtp.Value), '日報スキャン取り込み'); return }
    Start-Process explorer.exe -ArgumentList ('"' + $d + '"')
})

# ---- 設定 ----
function Show-SettingsDialog {
    $s = $script:settings
    $dlg = New-Object System.Windows.Forms.Form
    $dlg.Text = '設定'; $dlg.Size = New-Object System.Drawing.Size(900, 680); $dlg.StartPosition = 'CenterParent'; $dlg.Font = $fontUI; $dlg.FormBorderStyle = 'FixedDialog'; $dlg.MaximizeBox = $false
    $y = 14
    function Add-PathRow([string]$label, [string]$value, [bool]$isFile) {
        $l = New-Object System.Windows.Forms.Label; $l.Text = $label; $l.Location = New-Object System.Drawing.Point(14, ($script:sy + 4)); $l.Width = 170
        $t = New-Object System.Windows.Forms.TextBox; $t.Text = $value; $t.Location = New-Object System.Drawing.Point(190, $script:sy); $t.Width = 560
        $b = New-Object System.Windows.Forms.Button; $b.Text = '選ぶ…'; $b.Location = New-Object System.Drawing.Point(760, ($script:sy - 1)); $b.Width = 100; $b.Tag = @($t, $isFile)
        $b.Add_Click({ param($sender, $e)
            $tb = $sender.Tag[0]
            if ($sender.Tag[1]) { $sf = New-Object System.Windows.Forms.SaveFileDialog; $sf.Filter = 'Excel ブック (*.xlsx)|*.xlsx'; $sf.OverwritePrompt = $false; $sf.FileName = $tb.Text; if ($sf.ShowDialog() -eq 'OK') { $tb.Text = $sf.FileName } }
            else { $fb = New-Object System.Windows.Forms.FolderBrowserDialog; $fb.SelectedPath = $tb.Text; if ($fb.ShowDialog() -eq 'OK') { $tb.Text = $fb.SelectedPath } }
        })
        $dlg.Controls.AddRange(@($l, $t, $b)); $script:sy += 34
        return $t
    }
    $script:sy = $y
    $tInbox = Add-PathRow '受付フォルダ（スキャナーの保存先）' $s.inboxFolder $false
    $tArch = Add-PathRow '保管フォルダ' $s.archiveFolder $false
    $tXl = Add-PathRow 'Excel ファイル' $s.excelPath $true

    $gb = New-Object System.Windows.Forms.GroupBox; $gb.Text = '文字の読み取り方法'; $gb.Location = New-Object System.Drawing.Point(14, ($script:sy + 4)); $gb.Size = New-Object System.Drawing.Size(846, 120)
    $rWin = New-Object System.Windows.Forms.RadioButton; $rWin.Text = 'Windows 標準（無料・ネット不要。印刷された文字・きれいな字向け）'; $rWin.Location = New-Object System.Drawing.Point(14, 24); $rWin.AutoSize = $true
    $rCl = New-Object System.Windows.Forms.RadioButton; $rCl.Text = 'Claude（手書きに強い・1枚数円程度・インターネットが必要）'; $rCl.Location = New-Object System.Drawing.Point(14, 52); $rCl.AutoSize = $true
    $lk = New-Object System.Windows.Forms.Label; $lk.Text = 'APIキー'; $lk.Location = New-Object System.Drawing.Point(34, 86); $lk.AutoSize = $true
    $tKey = New-Object System.Windows.Forms.TextBox; $tKey.Location = New-Object System.Drawing.Point(100, 82); $tKey.Width = 420; $tKey.UseSystemPasswordChar = $true
    if (Get-ApiKey $s) { $tKey.Text = '********' }
    $lm = New-Object System.Windows.Forms.Label; $lm.Text = 'モデル'; $lm.Location = New-Object System.Drawing.Point(540, 86); $lm.AutoSize = $true
    $tModel = New-Object System.Windows.Forms.TextBox; $tModel.Location = New-Object System.Drawing.Point(590, 82); $tModel.Width = 240; $tModel.Text = $s.claudeModel
    if ($s.engine -eq 'claude') { $rCl.Checked = $true } else { $rWin.Checked = $true }
    $gb.Controls.AddRange(@($rWin, $rCl, $lk, $tKey, $lm, $tModel))
    $dlg.Controls.Add($gb); $script:sy += 132

    $lt = New-Object System.Windows.Forms.Label; $lt.Text = '紙の種類'; $lt.Location = New-Object System.Drawing.Point(14, ($script:sy + 4)); $lt.AutoSize = $true
    $cbType = New-Object System.Windows.Forms.ComboBox; $cbType.DropDownStyle = 'DropDownList'; $cbType.Location = New-Object System.Drawing.Point(90, $script:sy); $cbType.Width = 160
    $chkOcr = New-Object System.Windows.Forms.CheckBox; $chkOcr.Text = '文字を読み取って Excel に書く'; $chkOcr.Location = New-Object System.Drawing.Point(270, ($script:sy + 2)); $chkOcr.AutoSize = $true
    $ls = New-Object System.Windows.Forms.Label; $ls.Text = 'シート名'; $ls.Location = New-Object System.Drawing.Point(560, ($script:sy + 4)); $ls.AutoSize = $true
    $tSheet = New-Object System.Windows.Forms.TextBox; $tSheet.Location = New-Object System.Drawing.Point(630, $script:sy); $tSheet.Width = 230
    $dlg.Controls.AddRange(@($lt, $cbType, $chkOcr, $ls, $tSheet)); $script:sy += 34
    $fg = New-Object System.Windows.Forms.DataGridView; $fg.Location = New-Object System.Drawing.Point(14, $script:sy); $fg.Size = New-Object System.Drawing.Size(846, 250); $fg.BackgroundColor = [System.Drawing.Color]::White
    foreach ($col in @(@('name', '項目名（Excelの見出し）', 150), @('keywords', '紙に印刷されている目印の文字（カンマ区切り）', 230), @('hint', 'Claude への説明', 250), @('pattern', '形の決まり（正規表現・任意）', 130))) {
        $c = New-Object System.Windows.Forms.DataGridViewTextBoxColumn; $c.Name = $col[0]; $c.HeaderText = $col[1]; $c.Width = $col[2]; [void]$fg.Columns.Add($c)
    }
    $cm = New-Object System.Windows.Forms.DataGridViewCheckBoxColumn; $cm.Name = 'multi'; $cm.HeaderText = '複数'; $cm.Width = 50; [void]$fg.Columns.Add($cm)
    $dlg.Controls.Add($fg); $script:sy += 258
    $note = New-Object System.Windows.Forms.Label; $note.Location = New-Object System.Drawing.Point(14, $script:sy); $note.Size = New-Object System.Drawing.Size(846, 40)
    $note.Text = 'Windows 標準では「目印の文字」の右（無ければ次の行）を読み取ります。紙に印刷されている見出し（例：品番、生産数）をそのまま入れてください。行を消すには左端を選んで Delete キー。'
    $dlg.Controls.Add($note)

    # 編集用の写し（キャンセルしたら捨てる）
    $work = @($s.types | ForEach-Object { $_ | ConvertTo-Json -Depth 5 | ConvertFrom-Json })
    $script:curWork = $null
    $saveCur = {
        if ($null -eq $script:curWork) { return }
        $fg.EndEdit()
        $fs = @()
        foreach ($r in $fg.Rows) {
            if ($r.IsNewRow) { continue }
            $nm = ([string]$r.Cells['name'].Value).Trim(); if ($nm -eq '') { continue }
            $fs += [pscustomobject]@{ name = $nm; keywords = [string]$r.Cells['keywords'].Value; pattern = [string]$r.Cells['pattern'].Value; multi = [bool]$r.Cells['multi'].Value; hint = [string]$r.Cells['hint'].Value }
        }
        $script:curWork.fields = $fs; $script:curWork.ocr = $chkOcr.Checked
        if ($tSheet.Text.Trim() -ne '') { $script:curWork.sheet = $tSheet.Text.Trim() }
    }
    foreach ($t in $work) { [void]$cbType.Items.Add($t.name) }
    $cbType.Add_SelectedIndexChanged({
        & $saveCur
        $script:curWork = $work[$cbType.SelectedIndex]
        $fg.Rows.Clear()
        foreach ($f in $script:curWork.fields) { [void]$fg.Rows.Add($f.name, $f.keywords, $f.hint, $f.pattern, [bool]$f.multi) }
        $chkOcr.Checked = [bool]$script:curWork.ocr; $tSheet.Text = $script:curWork.sheet
    })
    $cbType.SelectedIndex = 0

    $ok = New-Object System.Windows.Forms.Button; $ok.Text = '保存'; $ok.Width = 120; $ok.Height = 36; $ok.Location = New-Object System.Drawing.Point(610, 594); $ok.DialogResult = 'OK'
    $cancel = New-Object System.Windows.Forms.Button; $cancel.Text = 'キャンセル'; $cancel.Width = 120; $cancel.Height = 36; $cancel.Location = New-Object System.Drawing.Point(740, 594); $cancel.DialogResult = 'Cancel'
    $dlg.Controls.AddRange(@($ok, $cancel)); $dlg.AcceptButton = $ok; $dlg.CancelButton = $cancel
    if ($dlg.ShowDialog($form) -ne 'OK') { return }
    & $saveCur
    if ($rCl.Checked -and -not (Get-ApiKey $s) -and ($tKey.Text -eq '' -or $tKey.Text -eq '********')) {
        [void][System.Windows.Forms.MessageBox]::Show('Claude を使うには APIキーが必要です。今回は Windows 標準のままにします。', '設定')
        $rWin.Checked = $true
    }
    $s.inboxFolder = $tInbox.Text.Trim(); $s.archiveFolder = $tArch.Text.Trim(); $s.excelPath = $tXl.Text.Trim()
    $s.engine = $(if ($rCl.Checked) { 'claude' } else { 'windows' })
    if ($tModel.Text.Trim() -ne '') { $s.claudeModel = $tModel.Text.Trim() }
    if ($tKey.Text -ne '********') { $s.apiKeyProtected = Protect-ApiKey $tKey.Text.Trim() }
    $s.types = $work
    $script:settings = Merge-Settings $s
    Save-Settings; Ensure-Folders
    $cur = Get-CurrentType; $curName = $(if ($cur) { $cur.name } else { '' })
    $script:dirty = $false
    Build-TypeButtons
    $sel = $script:typeButtons | Where-Object { $_.Text -eq $curName } | Select-Object -First 1
    if (-not $sel) { $sel = $script:typeButtons | Select-Object -First 1 }
    if ($sel) { $sel.Checked = $true; On-TypeChanged }
    $list.Items.Clear(); Refresh-Inbox
    Set-Status '設定を保存しました。'
}
$btnSettings.Add_Click({ if ($script:dirty -and $grid.Rows.Count -gt 0) { [void][System.Windows.Forms.MessageBox]::Show('先に右の表を Excel に書き込んでください。', '設定'); return }; Show-SettingsDialog })

$form.Add_KeyDown({ param($s, $e) if ($e.KeyCode -eq 'F5' -and -not $script:busy) { Invoke-Import } elseif ($e.KeyCode -eq 'F8' -and -not $script:busy) { Invoke-WriteExcel } })
$form.Add_FormClosing({ param($s, $e)
    if ($script:busy) { $e.Cancel = $true; return }
    if ($script:dirty -and $grid.Rows.Count -gt 0) {
        if ([System.Windows.Forms.MessageBox]::Show('Excel に書き込んでいない読み取り結果があります。終了しますか？', '確認', 'YesNo', 'Warning') -ne 'Yes') { $e.Cancel = $true }
    }
})
$form.Add_Shown({
    try { $split.SplitterDistance = 470 } catch { }
    Build-TypeButtons
    if ($script:typeButtons.Count -gt 0) { $script:typeButtons[0].Checked = $true }
    On-TypeChanged
    Refresh-Inbox; $timer.Start()
    Set-Status "スキャナーの保存先を「$($script:settings.inboxFolder)」にしてください。　読み取り方法：$(if ($script:settings.engine -eq 'claude') { 'Claude' } else { 'Windows 標準' })"
})
[void]$form.ShowDialog()
$timer.Stop()
} catch {
    try { Write-ErrorLog "起動・実行中のエラー：$_ $($_.ScriptStackTrace)" } catch { }
    [void][System.Windows.Forms.MessageBox]::Show("エラーが起きました。`r`n$($_.Exception.Message)", '日報スキャン取り込み')
} finally {
    if ($script:mutex) { try { $script:mutex.ReleaseMutex() } catch { } }
}
