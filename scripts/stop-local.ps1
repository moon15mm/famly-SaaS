param()
$ErrorActionPreference='Stop'
$localRoot=Split-Path -Parent $PSScriptRoot
$record=Join-Path $localRoot 'data\local-run\processes.json'
if(-not (Test-Path -LiteralPath $record)){Write-Output 'No local process record.';return}
$info=Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
$stoppingProcessIds=@()
foreach($processIdValue in @($info.api_pid,$info.worker_pid,$info.web_pid)){
 if(-not $processIdValue){continue}
 $owned=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$processIdValue) -ErrorAction Stop
 if($owned -and $owned.CommandLine -and $owned.CommandLine.IndexOf($localRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0){
  $children=Get-CimInstance Win32_Process -Filter ('ParentProcessId = '+[int]$processIdValue) -ErrorAction Stop
  foreach($child in $children){if($child.CommandLine -and $child.CommandLine.IndexOf($localRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0){$stoppingProcessIds+=$child.ProcessId;Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue}}
  $stoppingProcessIds+=$processIdValue
  Stop-Process -Id $processIdValue -ErrorAction SilentlyContinue
 }
}
if($stoppingProcessIds.Count){Wait-Process -Id $stoppingProcessIds -Timeout 10 -ErrorAction SilentlyContinue}
Write-Output 'Verified project services stopped; other applications were left unchanged.'
