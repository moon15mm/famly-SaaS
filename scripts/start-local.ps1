param([switch]$Restart,[string]$NodeExecutable)
$ErrorActionPreference='Stop'
$localRoot=Split-Path -Parent $PSScriptRoot
if($Restart){& (Join-Path $PSScriptRoot 'stop-local.ps1')}
foreach($portValue in @(3000,8000)){
 $probe=[System.Net.Sockets.TcpClient]::new()
 try{$connectionTask=$probe.ConnectAsync('127.0.0.1',$portValue);$null=$connectionTask.Wait(1000);if($probe.Connected){throw "Port $portValue is in use. Stop this project's services or choose another configuration."}}catch [System.AggregateException]{}finally{$probe.Dispose()}
}
$runFolder=Join-Path $localRoot 'data\local-run'
New-Item -ItemType Directory -Path $runFolder -Force | Out-Null
$pythonExe=Join-Path $localRoot '.venv\Scripts\python.exe'
$nodeRecord=Join-Path $runFolder 'node-path.txt'
if(-not $NodeExecutable -and (Test-Path -LiteralPath $nodeRecord)){$NodeExecutable=(Get-Content -LiteralPath $nodeRecord -Raw).Trim()}
$nodeExe=if($NodeExecutable){(Get-Item -LiteralPath $NodeExecutable).FullName}else{(Get-Command node.exe).Source}
$nodeVersion=& $nodeExe --version
if([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 22){throw 'Use a supported Node.js release (Node 24 LTS recommended); pass -NodeExecutable with its full path.'}
Set-Content -LiteralPath $nodeRecord -Value $nodeExe -Encoding utf8
$env:PYTHONPATH=Join-Path $localRoot 'backend'
$apiProcess=Start-Process -FilePath $pythonExe -ArgumentList @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000','--no-access-log','--timeout-keep-alive','130') -WorkingDirectory $localRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runFolder 'api.out.log') -RedirectStandardError (Join-Path $runFolder 'api.err.log')
$workerProcess=Start-Process -FilePath $pythonExe -ArgumentList @('-m','app.worker') -WorkingDirectory $localRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runFolder 'worker.out.log') -RedirectStandardError (Join-Path $runFolder 'worker.err.log')
$entry=Join-Path $localRoot 'frontend\scripts\start-production.mjs'
$webProcess=Start-Process -FilePath $nodeExe -ArgumentList ('"'+$entry+'"') -WorkingDirectory (Join-Path $localRoot 'frontend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runFolder 'web.out.log') -RedirectStandardError (Join-Path $runFolder 'web.err.log')
@{api_pid=$apiProcess.Id;worker_pid=$workerProcess.Id;web_pid=$webProcess.Id;url='http://localhost:3000';started_at=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runFolder 'processes.json') -Encoding utf8
$healthy=$false
for($attempt=0;$attempt -lt 30;$attempt++){
 try{$healthResult=Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 2 -ErrorAction Stop;if($healthResult.status -eq 'ok'){$healthy=$true;break}}catch{Start-Sleep -Milliseconds 500}
}
if(-not $healthy){throw 'API did not become healthy; inspect data/local-run/api.err.log'}
$storefrontResponse=Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
if($storefrontResponse.StatusCode -ne 200){throw 'Storefront did not return a successful response'}
Write-Output 'Local app ready: http://localhost:3000'
