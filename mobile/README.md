# BiteVo Admin — Android app

The admin panel on an Android phone or tablet. It opens the live panel (`https://admin.bitevo.in`) and adds the one
thing a web page can't do: **the new-order bell keeps ringing while the app is closed or the screen is off, and new
orders show in the notification bar.**

It's a small native app (Kotlin, no libraries; the APK is under 1 MB): a WebView for the panel, plus a
background service for the bell. The panel's screens come from the server, so panel changes reach the app without
a new APK; only changes to the app's own Android side (below) need one.

## Build the APK

Needs Java 17+ and the Android SDK: Android Studio's own (`Program Files\Android\Android Studio\jbr`,
`%LOCALAPPDATA%\Android\Sdk`), or a folder in `BITEVO_ANDROID_TOOLS` (default `D:\Android`) holding `jdk\`, `Sdk\` and
`gradle-home\`, as for the customer and rider apps. Nothing to `npm install`.

```bash
npm run build:android
```

The APK is written to `mobile\BiteVoAdmin.apk`. The app opens one address, set when building:

| Build | Opens |
|---|---|
| `npm run build:android` | the **live** panel, `https://admin.bitevo.in` |
| `npm run build:android -- -AppUrl http://10.0.2.2:2001` | a test build: the dev server, as the **Android emulator** sees this PC |
| `npm run build:android -- -AppUrl http://192.168.1.20:2001` | a test build: the dev server from a **phone on the same Wi-Fi** (this PC's address; run Vite with `-- --host`) |

(`BITEVO_ADMIN_URL` does the same as `-AppUrl`.) Test builds allow plain http, let you type another address on the
"Can't reach BiteVo" screen, and can be inspected from the PC's Chrome at `chrome://inspect`.

The APK is signed with React Native's public debug key, like the other two apps: fine for installing directly.
For the Play Store, make an upload key once (`keytool -genkeypair -v -keystore %USERPROFILE%\.bitevo\admin-upload.jks
-keyalg RSA -keysize 2048 -validity 10000 -alias admin-upload`), describe it in `~/.bitevo/admin-upload.properties`
(`storeFile`, `storePassword`, `keyAlias`, `keyPassword`), back both up, and run `npm run build:android -- -Bundle`
(writes `mobile\BiteVoAdmin.aab`). Raise `versionCode` in `android/app/build.gradle` before each upload.

## Install

Copy `BiteVoAdmin.apk` to the phone and open it (allow "Install unknown apps" for the app you open it with), or over
USB with USB debugging on:

```bash
%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe install -r BiteVoAdmin.apk
```

Sign in as usual. The first time, the app asks to **allow notifications** (Android 13+: new orders can't show in the
notification bar without it) and to **run in the background without battery restrictions** (otherwise some phones
stop the checks while the screen is off). Allow both on the kitchen's phone.

Many phones (Xiaomi, Oppo, Vivo, Realme, OnePlus, Samsung) also stop background apps on their own: set Battery to
**Unrestricted** / **No restrictions**, turn on **Autostart** where there is one, and on Samsung keep the app out of
"Sleeping apps" ([dontkillmyapp.com](https://dontkillmyapp.com) has each brand's steps). The bell plays on the
**alarm volume**, so keep that up; it rings even with the phone on silent.

## How the bell works

- **App open:** the panel's own bell (`frontend/src/components/OrderBell.jsx`) rings and shows a toast, as in a
  browser. The page tells the app its bell settings (Ring for new orders, Loud ring / Soft bell, Ring again every
  30 s) through `window.BiteVoAdmin.bell(…)`; the app uses the same ones.
- **App closed, in the background, or the screen off:** Android pauses the page, so the app's
  `OrderWatchService` takes over. It's a foreground service ("Watching for new orders" stays in the notification
  bar, saying how many orders are waiting) that asks `GET /api/live/waiting` every 10 s (every 20 s while the app is
  open), with the panel's own sign-in cookie, which it reads from the WebView. For each new order it:
  - rings the same sound as the panel (made in `RingSound.kt`, played by `Ring.kt` on the alarm volume) and buzzes;
  - shows **"New order BV1113-004 · Rahul · 2 items · ₹318"** in the notification bar, popping up on screen. Tapping
    it opens that order in the app. It goes away once the order is accepted (or when the app is opened).
  - While orders are waiting it rings again every 30 s, like the panel, if that's on.
  An API from before `/api/live/waiting` existed answers 404; the app then reads today's orders instead
  (`/api/orders?days=1`), so it works with either.
- **Opening the app** stops any ringing and clears those notifications. The panel doesn't ring again for orders the
  app already rang for (`window.BiteVoAdmin.announced(id)`).
- **Signed out**, or the session expired (7 days): the service stops and shows "Signed out of BiteVo Admin", so the
  kitchen knows the bell is off. Signing in again starts it.
- **"Stop until I open the app"** on the "Watching" notification turns the bell off until the app is opened.
- **After the phone restarts** (or the app is updated) it starts watching again by itself, without opening the app.
- While the app is closed, the service keeps the phone's processor awake between checks (a partial wake lock), so
  checks go on in deep sleep; that's why it asks to be left out of battery saving.

The panel's "Desktop notification" switch is hidden in the app (the app's notifications replace it).

## Testing

```bash
npm run test:android
```

runs the app's JVM tests on this PC: reading the API's answers, the signed-in / signed-out / offline / older-API
cases against a stand-in server, telling new orders apart, and the ring sounds (length, loudness, the 25 Hz
"trrring"; it also writes them as `android/app/build/ring-*.wav` to listen to). Add
`-TestApi http://127.0.0.1:4100 -TestEmail … -TestPassword …` to also sign in to a running **local** API with a test
admin and check `/api/live/waiting` there (never the live API).

On a phone (an emulator can't show what battery saving does): install a build, sign in, lock the phone, then place
an order on the website. Within ~10 s the phone should ring and show the order. Also try: the app swiped away from
recent apps, the phone left locked for 15+ minutes first, flight mode for a minute (the notification says "No
connection"), and signing out in the panel on another device.

```bash
adb logcat -s BiteVoAdmin
adb shell dumpsys activity services in.bitevo.admin
adb shell dumpsys deviceidle force-idle
```

The last one puts the phone in deep sleep at once; new orders should still ring (`adb shell dumpsys deviceidle
unforce` ends it).

## Code

```
scripts/build-android.ps1   the build (Java and SDK from D:\Android or Android Studio), -AppUrl, -Bundle, -Test
android/app/build.gradle    the address (appUrl), signing, versions
android/app/src/main/AndroidManifest.xml
android/app/src/main/java/com/bitevo/admin/
  MainActivity.kt           the WebView, window.BiteVoAdmin, notification and battery prompts, photo picker
  OrderWatchService.kt      the background bell: checks, rings, notifications, "Signed out"
  WaitingOrders.kt          asking the API which orders are waiting, and which are new (no Android classes)
  RingSound.kt              the loud ring and the soft bell, as samples (no Android classes)
  Ring.kt                   plays them on the alarm volume, and buzzes
  Settings.kt               what the app remembers; whether it's on screen
  BootReceiver.kt           starts watching again after a restart or update
android/app/src/test/java/com/bitevo/admin/   WaitingOrdersTest, RingSoundTest
```
