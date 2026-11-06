# 日報スキャン取り込みの、画面以外の処理のテスト（Windows も Excel も不要）
# 実行：powershell -ExecutionPolicy Bypass -File tests\test_dailyreport.ps1   （PowerShell 7 でも可）
$ErrorActionPreference = 'Stop'
$env:DAILYREPORT_NO_GUI = '1'
. (Join-Path $PSScriptRoot '..\DailyReport.ps1')
$env:DAILYREPORT_NO_GUI = $null
$fail = 0
function T($name, $cond) { if ($cond) { "PASS $name" } else { "FAIL $name"; $script:fail++ } }

# --- 全角→半角・空白の除去 ---
T 'half-width' ((ConvertTo-HalfWidth 'ＡＢＣ１２３－ー') -eq 'ABC123-ー')
T 'normalize'  ((ConvertTo-NormalizedLine '品 番 ： Ｋ－１０２') -eq '品番:K-102')

# --- 目印の文字から値を取り出す ---
$def = New-DefaultSettings
$nippo = $def.types[0]
$lines = @(
    '作 業 日 報',
    '氏名 山田 太郎',
    '品番：Ｋ－１０２',
    '生産数 １２０ 個',
    '不良数',
    '３',
    'ロットNo. A2611-01',
    'ロットNo. A2611-02',
    '開始 8:30  終了 17:15'
)
$v = Get-FieldValuesFromLines $lines $nippo.fields
T 'name'        ($v['氏名'] -eq '山田太郎')
T 'part'        ($v['品番'] -eq 'K-102')
T 'qty'         ($v['生産数'] -eq '120個')
T 'next line'   ($v['不良数'] -eq '3')
T 'multi lot'   ($v['ロットNo'] -eq 'A2611-01, A2611-02')
T 'start'       ($v['開始時刻'] -eq '8:30終了17:15')   # 同じ行に2つある時は後ろも付く（表で直す）
T 'end'         ($v['終了時刻'] -eq '17:15')
T 'missing'     ($v['備考'] -eq '')
T 'all keys'    (@($v.Keys).Count -eq @($nippo.fields).Count)

# 形の決まり（正規表現）
$pf = @([pscustomobject]@{ name = 'ロット'; keywords = ''; pattern = 'A\d{4}-\d{2}'; multi = $true; hint = '' })
$v2 = Get-FieldValuesFromLines @('xx A2611-01 yy', 'A2611-03', 'A2611-01') $pf
T 'pattern'     ($v2['ロット'] -eq 'A2611-01, A2611-03')

# --- Claude の返事 ---
$ans = "読み取りました。`n```json`n{""氏名"": ""佐藤"", ""生産数"": 50, ""ロットNo"": [""L1"", ""L2""], ""不明"": ""x""}`n````n"
$c = ConvertFrom-ClaudeAnswer $ans $nippo.fields
T 'claude name' ($c['氏名'] -eq '佐藤')
T 'claude num'  ($c['生産数'] -eq '50')
T 'claude arr'  ($c['ロットNo'] -eq 'L1, L2')
T 'claude miss' ($c['備考'] -eq '')
$c2 = ConvertFrom-ClaudeAnswer 'すみません、読めません' $nippo.fields
T 'claude bad'  ($c2['氏名'] -eq '' -and @($c2.Keys).Count -eq @($nippo.fields).Count)
$p = Get-ClaudePrompt $nippo
T 'prompt keys' ($p.Contains('"氏名": ""') -and $p.Contains('ロット番号'))

# --- 保管先のファイル名（通し番号） ---
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('drt_' + [guid]::NewGuid())
$d = [datetime]'2026-11-06'
$t1 = Get-ArchiveTarget $tmp $d '日報' '.JPG'
T 'archive path' ($t1 -eq (Join-Path $tmp (Join-Path '2026' (Join-Path '2026-11' (Join-Path '2026-11-06' (Join-Path '日報' '2026-11-06_日報_01.jpg'))))))
New-Item -ItemType Directory -Path (Split-Path -Parent $t1) -Force | Out-Null
Set-Content -LiteralPath $t1 -Value 'x'
Set-Content -LiteralPath ([IO.Path]::ChangeExtension($t1, '.txt')) -Value 'x'
Set-Content -LiteralPath ($t1 -replace '_01\.jpg$', '_07.pdf') -Value 'x'
$t2 = Get-ArchiveTarget $tmp $d '日報' '.jpg'
T 'archive seq'  ($t2.EndsWith('2026-11-06_日報_08.jpg'))
T 'safe name'    ((Get-SafeName 'a/b:c') -eq 'a_b_c')
T 'scan ext'     ((Test-ScanFile 'x.PDF') -and -not (Test-ScanFile 'x.txt'))

# --- 控えの CSV ---
$csv = Join-Path $tmp 'r.csv'
Add-BackupCsvRow $csv @('日付', '備考') @('2026/11/06', 'a,"b"')
Add-BackupCsvRow $csv @('日付', '備考') @('2026/11/07', '')
$txt = [IO.File]::ReadAllText($csv, [Text.Encoding]::UTF8)
T 'csv'          ($txt -eq "日付,備考`r`n2026/11/06,""a,""""b""""""`r`n2026/11/07,`r`n")

# --- 設定の保存・読み込み ---
$sp = Join-Path $tmp 'settings.json'
$def.engine = 'claude'; $def.types[0].fields = @($def.types[0].fields | Select-Object -First 2)
Save-SettingsFile $def $sp
$back = Read-SettingsFile $sp
T 'settings engine' ($back.engine -eq 'claude')
T 'settings fields' (@($back.types[0].fields).Count -eq 2 -and $back.types[0].fields[0].name -eq '氏名')
# 古い設定（項目が足りない）でも読める
[IO.File]::WriteAllText($sp, '{"inboxFolder":"C:\\scan","types":[{"name":"日報","fields":[{"name":"氏名"}]}],"engine":"zzz"}', [Text.Encoding]::UTF8)
$old = Read-SettingsFile $sp
T 'old inbox'   ($old.inboxFolder -eq 'C:\scan')
T 'old engine'  ($old.engine -eq 'windows')
T 'old field'   ($old.types[0].fields[0].keywords -eq '' -and $old.types[0].fields[0].multi -eq $false -and $old.types[0].ocr -eq $true -and $old.types[0].sheet -eq '日報')
T 'old model'   ($old.claudeModel -ne $null -and $old.claudeModel -ne '')

Remove-Item -LiteralPath $tmp -Recurse -Force
if ($fail -gt 0) { "$fail 件失敗"; exit 1 } else { 'すべて成功' }
