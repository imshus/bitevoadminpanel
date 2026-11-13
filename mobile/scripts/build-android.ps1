# Builds BiteVo Admin (the APK) on this PC, with Java and the Android SDK from BITEVO_ANDROID_TOOLS (default
# D:\Android, holding jdk\<version>, Sdk\ and gradle-home\), as for the customer and rider apps, or else Android
# Studio's own Java and SDK. Nothing is changed in Windows' settings: the paths apply only while this script runs.
# The APK is copied to mobile\BiteVoAdmin.apk.
#   npm run build:android                                          the live panel, https://admin.bitevo.in
#   npm run build:android -- -AppUrl http://10.0.2.2:2001          a test build: the dev server, as the emulator sees it
#   npm run build:android -- -AppUrl http://192.168.1.20:2001      a test build: the dev server, from a phone on the Wi-Fi
#   npm run build:android -- -Bundle                               the live app as an .aab for the Play Store, signed with
#                                                                  the upload key (~/.bitevo/admin-upload.properties)
#   npm run test:android                                           the app's JVM tests (no APK); add
#                                                                  -TestApi http://127.0.0.1:4100 -TestEmail … -TestPassword …
#                                                                  to also check against a running local API
param(
  [string]$AppUrl = $(if ($env:BITEVO_ADMIN_URL) { $env:BITEVO_ADMIN_URL } else { 'https://admin.bitevo.in' }),
  [switch]$Bundle,
  [switch]$Test,
  [string]$TestApi = '',
  [string]$TestEmail = '',
  [string]$TestPassword = ''
)
$ErrorActionPreference = 'Stop'
$tools = if ($env:BITEVO_ANDROID_TOOLS) { $env:BITEVO_ANDROID_TOOLS } else { 'D:\Android' }
if (Test-Path "$tools\jdk") { # (not Join-Path: it fails outright for a drive this PC doesn't have)
  $env:JAVA_HOME = (Get-ChildItem (Join-Path $tools 'jdk') -Directory | Select-Object -First 1).FullName
  $env:ANDROID_HOME = Join-Path $tools 'Sdk'
  $env:GRADLE_USER_HOME = Join-Path $tools 'gradle-home'
} else {
  # No such folder: Android Studio's Java and SDK where it installs them; Gradle's cache in the user folder.
  $studioJava = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
  if (-not $env:JAVA_HOME -and (Test-Path $studioJava)) { $env:JAVA_HOME = $studioJava }
  if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
  if (-not $env:JAVA_HOME -or -not (Test-Path $env:ANDROID_HOME)) {
    throw "No Java or Android SDK found: install Android Studio, or set BITEVO_ANDROID_TOOLS to a folder with jdk\ and Sdk\."
  }
}

$mobile = Split-Path $PSScriptRoot -Parent
if ($Bundle -and -not $AppUrl.StartsWith('https:')) { throw "Play Store bundles are for the live panel (an https address)." }
if ($Test) {
  $tasks = @('testDebugUnitTest', '--rerun', "-PtestApi=$TestApi", "-PtestEmail=$TestEmail", "-PtestPassword=$TestPassword")
} elseif ($Bundle) {
  $tasks = @('bundleRelease', '-Pplay=true', "-PappUrl=$AppUrl")
} else {
  $tasks = @('assembleRelease', "-PappUrl=$AppUrl")
}
Push-Location (Join-Path $mobile 'android')
try {
  & .\gradlew.bat @tasks --console=plain
  if ($LASTEXITCODE -ne 0) { throw "Gradle failed ($LASTEXITCODE)" }
} finally {
  Pop-Location
}
if ($Test) { return }

if ($Bundle) {
  $out = Join-Path $mobile 'BiteVoAdmin.aab'
  Copy-Item (Join-Path $mobile 'android\app\build\outputs\bundle\release\app-release.aab') $out -Force
  "Bundle ready: $out ($([math]::Round((Get-Item $out).Length / 1MB, 1)) MB), for $AppUrl, signed with the upload key"
  return
}
$out = Join-Path $mobile 'BiteVoAdmin.apk'
Copy-Item (Join-Path $mobile 'android\app\build\outputs\apk\release\app-release.apk') $out -Force
"APK ready: $out ($([math]::Round((Get-Item $out).Length / 1MB, 2)) MB), for $AppUrl"
