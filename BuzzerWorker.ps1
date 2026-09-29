param([int]$Seconds=2,[string]$SoundPath='')
if($Seconds -lt 1){$Seconds=1}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WinMMWorker {
 [DllImport("winmm.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern bool PlaySound(string pszSound, IntPtr hmod, uint fdwSound);
}
'@
$SND_ASYNC=0x00000001
$SND_LOOP=0x00000008
$SND_FILENAME=0x00020000
$SND_PURGE=0x00000040
try {
  if(Test-Path -LiteralPath $SoundPath){
    [WinMMWorker]::PlaySound($SoundPath,[IntPtr]::Zero,($SND_FILENAME -bor $SND_ASYNC -bor $SND_LOOP)) | Out-Null
    Start-Sleep -Seconds $Seconds
  }
} finally {
  try { [WinMMWorker]::PlaySound($null,[IntPtr]::Zero,$SND_PURGE) | Out-Null } catch {}
  try { [WinMMWorker]::PlaySound($null,[IntPtr]::Zero,0) | Out-Null } catch {}
}
