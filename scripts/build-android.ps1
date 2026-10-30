param([string]$JavaHome,[string]$SdkRoot,[string]$GradleExecutable,[switch]$Offline,[string]$PlatformUrl)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
if(-not $JavaHome){$JavaHome='C:/Program Files/Java/jdk-17'}
if(-not $SdkRoot){$SdkRoot=Join-Path $env:LOCALAPPDATA 'Android/Sdk'}
if(-not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin/java.exe'))){throw 'Pass -JavaHome with a JDK17 installation'}
if(-not (Test-Path -LiteralPath (Join-Path $SdkRoot 'platforms/android-35/android.jar'))){throw 'Install Android SDK platform35 first'}
$env:JAVA_HOME=$JavaHome
$env:ANDROID_HOME=$SdkRoot
$env:ANDROID_USER_HOME=Join-Path $projectRoot 'data/android-tools/android-home'
$env:GRADLE_USER_HOME=Join-Path $projectRoot 'data/android-tools/gradle-home'
$existingDependencyCache=Join-Path $env:USERPROFILE '.gradle/caches'
if(Test-Path -LiteralPath (Join-Path $existingDependencyCache 'modules-2')){$env:GRADLE_RO_DEP_CACHE=$existingDependencyCache}
New-Item -ItemType Directory -Force -Path $env:ANDROID_USER_HOME,$env:GRADLE_USER_HOME | Out-Null
Set-Content -LiteralPath (Join-Path $projectRoot 'android/local.properties') -Value ('sdk.dir='+$SdkRoot.Replace('\','/')) -Encoding ascii
if(-not $GradleExecutable){
 if(Test-Path -LiteralPath 'C:/gradle/gradle-8.7/bin/gradle.bat'){$GradleExecutable='C:/gradle/gradle-8.7/bin/gradle.bat'}
 else{$GradleExecutable=Join-Path $projectRoot 'android/gradlew.bat'}
}
$buildArgs=@('-p',(Join-Path $projectRoot 'android'),'assembleDebug','testDebugUnitTest','lintDebug','--no-daemon','--console=plain')
$localAapt=Join-Path $SdkRoot 'build-tools/35.0.0/aapt2.exe'
if(Test-Path -LiteralPath $localAapt){$buildArgs+=('-Pandroid.aapt2FromMavenOverride='+$localAapt)}
if($Offline){$buildArgs+='--offline'}
# Defaults to the hosted demo in app/build.gradle; pass http://localhost:3000 for the USB build.
if($PlatformUrl){$buildArgs+=('-PplatformUrl='+$PlatformUrl)}
& $GradleExecutable @buildArgs
if($LASTEXITCODE -ne 0){throw 'Android build or verification failed; no new APK accepted'}
$apk=Join-Path $projectRoot 'android/app/build/outputs/apk/debug/app-debug.apk'
$releaseFolder=Join-Path $projectRoot 'releases/android'
New-Item -ItemType Directory -Force -Path $releaseFolder | Out-Null
$output=Join-Path $releaseFolder 'min-buyutna-local.apk'
Copy-Item -LiteralPath $apk -Destination $output -Force
$digest=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
$sums=Get-ChildItem -LiteralPath $releaseFolder -File | Where-Object Name -ne 'SHA256SUMS' | Sort-Object Name | ForEach-Object {(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+$_.Name}
Set-Content -LiteralPath (Join-Path $releaseFolder 'SHA256SUMS') -Value $sums -Encoding ascii
Write-Output ('APK ready: '+$output)
Write-Output ('SHA256: '+$digest)
