// After the phone restarts or the app is updated, the background bell starts watching again by itself if it was
// watching before, so a kitchen phone that rebooted overnight still rings without anyone opening the app.
package com.bitevo.admin

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (Settings(context).watching) OrderWatchService.start(context)
    }
}
