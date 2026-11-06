param(
    [string]$PlatformUrl = "https://buyutna.wardat.xyz"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$AndroidDir = Join-Path $ProjectRoot "android"
$OutputDir = Join-Path $ProjectRoot "releases\android"

if (!(Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$env:JAVA_HOME = "C:\Program Files\Java\jdk-17"
$env:ANDROID_HOME = "C:\Users\maher\AppData\Local\Android\Sdk"
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"

$localAapt = Join-Path $env:ANDROID_HOME "build-tools\35.0.0\aapt2.exe"
$buildArgs = @("bundleRelease", "-PplatformUrl=$PlatformUrl", "--no-daemon")
if (Test-Path -LiteralPath $localAapt) {
    $buildArgs += ("-Pandroid.aapt2FromMavenOverride=" + $localAapt)
}

Write-Host "Building Production Android App Bundle (.aab)..." -ForegroundColor Cyan
Write-Host "Target Platform: $PlatformUrl" -ForegroundColor Cyan

Push-Location $AndroidDir
try {
    .\gradlew.bat @buildArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Gradle bundleRelease failed with exit code $LASTEXITCODE"
    }

    $AabSource = Join-Path $AndroidDir "app\build\outputs\bundle\release\app-release.aab"
    if (!(Test-Path $AabSource)) {
        throw "Could not find generated AAB at $AabSource"
    }

    $DestAab = Join-Path $OutputDir "min-buyutna-release.aab"
    Copy-Item $AabSource $DestAab -Force

    $Hash = (Get-FileHash -Path $DestAab -Algorithm SHA256).Hash
    $SizeMb = [math]::Round((Get-Item $DestAab).Length / 1MB, 2)

    Write-Host "Production AAB ready at: $DestAab" -ForegroundColor Green
    Write-Host "Size: $SizeMb MB" -ForegroundColor Green
    Write-Host "SHA256: $Hash" -ForegroundColor Green
}
finally {
    Pop-Location
}
