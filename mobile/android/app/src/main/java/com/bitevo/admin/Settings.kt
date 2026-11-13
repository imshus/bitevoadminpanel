// What the app remembers on the phone: the bell settings the panel last sent (its own Ring / Sound / Ring again
// switches), whether the background bell should be watching, which questions were asked once, and in test builds
// the address typed on the "Can't reach BiteVo" screen.
package com.bitevo.admin

import android.content.Context

const val TAG = "BiteVoAdmin"

// Whether the app is on screen. Then the panel itself rings (and shows a toast) and the service stays quiet.
object AppState {
    @Volatile var onScreen = false
}

class Settings(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("admin", Context.MODE_PRIVATE)

    var sound: Boolean
        get() = prefs.getBoolean("sound", true)
        set(v) = prefs.edit().putBoolean("sound", v).apply()
    var style: String
        get() = prefs.getString("style", "loud") ?: "loud"
        set(v) = prefs.edit().putString("style", if (v == "soft") "soft" else "loud").apply()
    var remind: Boolean
        get() = prefs.getBoolean("remind", true)
        set(v) = prefs.edit().putBoolean("remind", v).apply()

    // On once someone is signed in on the panel; off when the session ends or "Stop" is tapped on the notification.
    var watching: Boolean
        get() = prefs.getBoolean("watching", false)
        set(v) = prefs.edit().putBoolean("watching", v).apply()

    var askedNotifications: Boolean
        get() = prefs.getBoolean("askedNotifications", false)
        set(v) = prefs.edit().putBoolean("askedNotifications", v).apply()
    var askedBattery: Boolean
        get() = prefs.getBoolean("askedBattery", false)
        set(v) = prefs.edit().putBoolean("askedBattery", v).apply()

    // The panel's address: the one the app was built for, or in test builds (http) one typed in the app.
    var appUrl: String
        get() = (if (Server.canChange) prefs.getString("appUrl", null) else null) ?: BuildConfig.APP_URL
        set(v) = prefs.edit().putString("appUrl", v).apply()
}

object Server {
    val canChange = BuildConfig.APP_URL.startsWith("http:")

    // "192.168.1.20:2001" → "http://192.168.1.20:2001". Null if it isn't an http(s) address.
    fun normalise(typed: String): String? {
        var url = typed.trim().trimEnd('/')
        if (!url.contains("://")) url = "http://$url"
        return url.takeIf { Regex("^https?://[^/\\s]+$", RegexOption.IGNORE_CASE).matches(it) }
    }
}
