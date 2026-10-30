param([string]$Serial,[switch]$Install,[switch]$Launch)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$adbPath=Join-Path $env:LOCALAPPDATA 'Android/Sdk/platform-tools/adb.exe'
if(-not (Test-Path -LiteralPath $adbPath)){$adbPath=(Get-Command adb.exe -ErrorAction Stop).Source}
$devices=& $adbPath devices
$ready=@($devices | Select-String '^([^\s]+)\s+device$' | ForEach-Object {$_.Matches[0].Groups[1].Value})
if(-not $Serial){
 if($ready.Count -ne 1){throw 'Connect one Android device with USB debugging authorized, or pass -Serial for the intended device'}
 $Serial=$ready[0]
}
if($Serial -notin $ready){throw 'The selected device is not connected and authorized'}
$health=Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 5
if($health.environment -ne 'development'){throw 'This USB helper is only for the local development platform'}
& $adbPath -s $Serial reverse tcp:3000 tcp:3000
if($LASTEXITCODE -ne 0){throw 'USB connection could not be configured'}
if($Install){
 $apk=Join-Path $projectRoot 'releases/android/min-buyutna-local.apk'
 if(-not (Test-Path -LiteralPath $apk)){throw 'Build the local APK first'}
 & $adbPath -s $Serial install -r $apk
 if($LASTEXITCODE -ne 0){throw 'APK installation failed'}
}
if($Launch){
 & $adbPath -s $Serial shell am start -n sa.minbuyutna.app.local/sa.minbuyutna.app.MainActivity
 if($LASTEXITCODE -ne 0){throw 'Android application could not be opened'}
}
Write-Output 'Android connected to the local platform. Keep the computer services and the USB connection active.'
