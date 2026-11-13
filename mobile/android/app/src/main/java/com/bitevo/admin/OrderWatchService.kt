// The background bell. A foreground service that asks the admin API which orders are waiting to be accepted
// (WaitingOrders: every 10 s while the app isn't on screen, every 20 s while it is), as the admin signed in on the
// panel. While the app is closed, in the background or the screen is off, a new order:
//  - rings (Ring: the panel's own sound, on the alarm volume) and buzzes,
//  - shows in the notification bar ("New order BV1113-004 · Rahul · 2 items · ₹318"; tapping it opens the order),
// and while orders are waiting it rings again every 30 s, like the panel. The settings are the panel's own (Ring
// for new orders, Loud ring / Soft bell, Ring again every 30 s), sent to the app by the panel (MainActivity.Bridge).
// While the app is on screen the panel rings by itself, so the service only keeps count.
// It runs from the moment someone is signed in on the panel until the session ends (then "Signed out" shows, so
// a kitchen doesn't miss orders unknowingly) or "Stop" is tapped on its notification; it starts again by itself
// after the phone restarts.
package com.bitevo.admin

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import android.webkit.CookieManager
import java.util.Collections

class OrderWatchService : Service() {
    companion object {
        private const val WATCH_ID = 1
        private const val SIGNED_OUT_ID = 2
        private const val ORDER_TAG = "order"
        private const val ACTION_STOP = "in.bitevo.admin.STOP"
        private const val CLOSED_MS = 10_000L
        private const val ON_SCREEN_MS = 20_000L
        private const val REMIND_MS = 30_000L
        private const val FAILURES_TO_SAY = 3 // ~30 s without an answer: the notification says so
        const val CHANNEL_WATCH = "watch"
        const val CHANNEL_ORDERS = "orders"
        const val CHANNEL_ALERTS = "alerts"
        const val EXTRA_ORDER = "orderId"

        @Volatile private var instance: OrderWatchService? = null

        // Orders the app rang for while it was closed: the panel doesn't ring for them again when it's opened.
        val announced: MutableSet<String> = Collections.synchronizedSet(HashSet())

        val running get() = instance != null

        // Starts watching (someone is signed in on the panel). False if Android didn't allow it.
        fun start(context: Context): Boolean {
            Settings(context).watching = true
            val intent = Intent(context, OrderWatchService::class.java)
            return try {
                if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
                true
            } catch (e: Exception) { // e.g. Android 12+ refusing a start from the background
                Log.w(TAG, "Couldn't start watching: ${e.message}")
                false
            }
        }

        // The app came on screen or left it: on screen, the bell stops and its notifications go (the panel shows the
        // orders); either way the next check comes now, in the new mode.
        fun screenChanged(context: Context) {
            if (AppState.onScreen) {
                Ring.stop()
                clearOrderNotifications(context)
            }
            instance?.checkNow()
        }

        fun clearOrderNotifications(context: Context) {
            val nm = context.getSystemService(NotificationManager::class.java) ?: return
            if (Build.VERSION.SDK_INT >= 23) {
                nm.activeNotifications.filter { it.tag == ORDER_TAG }.forEach { nm.cancel(ORDER_TAG, it.id) }
            }
            nm.cancel(SIGNED_OUT_ID)
        }
    }

    private lateinit var settings: Settings
    private lateinit var cookies: CookieManager
    private lateinit var worker: HandlerThread
    private lateinit var handler: Handler
    private val newOrders = NewOrders()
    private val posted = HashSet<String>() // orders given a notification (or seen on screen): never shown twice
    private var lastRing = 0L
    private var failures = 0
    private var waiting = 0
    private var wakeLock: PowerManager.WakeLock? = null
    private val tick = object : Runnable {
        override fun run() {
            check()
            handler.postDelayed(this, if (AppState.onScreen) ON_SCREEN_MS else CLOSED_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        settings = Settings(this)
        cookies = CookieManager.getInstance() // made here on the main thread; read from the worker thread
        makeChannels()
        goForeground()
        worker = HandlerThread("order-watch").apply { start() }
        handler = Handler(worker.looper)
        wakeLock = getSystemService(PowerManager::class.java)
            ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BiteVoAdmin:orders")
            ?.apply { setReferenceCounted(false) }
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        goForeground() // every start must do this within a few seconds, even one that stops at once
        // "Stop" on the notification: quiet until the app is opened again (MainActivity starts it then).
        if (intent?.action == ACTION_STOP) settings.watching = false
        if (!settings.watching) {
            stopSelf()
            return START_NOT_STICKY
        }
        checkNow()
        return START_STICKY // if Android stops it, it comes back and carries on
    }

    override fun onDestroy() {
        instance = null
        handler.removeCallbacksAndMessages(null)
        worker.quitSafely()
        wakeLock?.takeIf { it.isHeld }?.release()
        Ring.stop()
        super.onDestroy()
    }

    fun checkNow() {
        handler.removeCallbacks(tick)
        handler.post(tick)
    }

    // One check, on the worker thread.
    private fun check() {
        // While the app is closed the phone may sleep: hold it awake for the checks (renewed on each one).
        if (AppState.onScreen) wakeLock?.takeIf { it.isHeld }?.release() else wakeLock?.acquire(3 * 60_000L)
        val url = settings.appUrl
        when (val result = WaitingOrders.check(url, cookies.getCookie(url))) {
            is Check.Orders -> {
                failures = 0
                handle(result.orders)
            }
            is Check.SignedOut -> signedOut()
            is Check.Failed -> {
                failures++
                Log.i(TAG, "Check failed ($failures): ${result.reason}")
                if (failures == FAILURES_TO_SAY) updateWatchNotification()
            }
        }
    }

    private fun handle(orders: List<WaitingOrder>) {
        val fresh = newOrders.update(orders)
        val ids = orders.map { it.id }.toSet()
        val nm = getSystemService(NotificationManager::class.java)
        // Accepted (or cancelled) since: its notification goes.
        (posted - ids).forEach { nm?.cancel(ORDER_TAG, it.hashCode()) }
        posted.retainAll(ids)
        announced.retainAll(ids)
        waiting = orders.size
        if (AppState.onScreen) {
            posted += ids // the panel has shown these
        } else {
            orders.filter { it.id !in posted }.forEach { notifyOrder(it) }
            posted += ids
            val now = System.currentTimeMillis()
            if (fresh.isNotEmpty()) {
                Ring.play(this, "new", settings.style, settings.sound)
                announced += fresh.map { it.id }
                lastRing = now
            } else if (orders.isNotEmpty() && settings.sound && settings.remind && now - lastRing >= REMIND_MS) {
                Ring.play(this, "remind", settings.style, true)
                lastRing = now
            }
        }
        updateWatchNotification()
    }

    // The session ended (signed out, or it expired): stop, and say so if the app isn't on screen.
    private fun signedOut() {
        settings.watching = false
        newOrders.reset()
        clearOrderNotifications(this)
        if (!AppState.onScreen) {
            val n = builder(CHANNEL_ALERTS)
                .setContentTitle(getString(R.string.signed_out_title))
                .setContentText(getString(R.string.signed_out_text))
                .setStyle(Notification.BigTextStyle().bigText(getString(R.string.signed_out_text)))
                .setContentIntent(openApp(null))
                .setAutoCancel(true)
                .build()
            getSystemService(NotificationManager::class.java)?.notify(SIGNED_OUT_ID, n)
        }
        stopSelf()
    }

    private fun notifyOrder(o: WaitingOrder) {
        val title = getString(R.string.order_title, o.orderNo)
        val n = builder(CHANNEL_ORDERS)
            .setContentTitle(title)
            .setContentText(o.summary)
            .setContentIntent(openApp(o.id))
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setGroup("orders")
            // On a locked phone: that an order came in, without the customer's name.
            .setPublicVersion(builder(CHANNEL_ORDERS).setContentTitle(title).build())
            .apply {
                @Suppress("DEPRECATION")
                if (Build.VERSION.SDK_INT < 26) setPriority(Notification.PRIORITY_HIGH)
            }
            .build()
        getSystemService(NotificationManager::class.java)?.notify(ORDER_TAG, o.id.hashCode(), n)
    }

    private fun goForeground() {
        val n = watchNotification()
        if (Build.VERSION.SDK_INT >= 34) startForeground(WATCH_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(WATCH_ID, n)
    }

    private fun updateWatchNotification() {
        getSystemService(NotificationManager::class.java)?.notify(WATCH_ID, watchNotification())
    }

    private fun watchNotification(): Notification {
        val text = when {
            failures >= FAILURES_TO_SAY -> getString(R.string.watch_offline)
            waiting > 0 -> resources.getQuantityString(R.plurals.watch_waiting, waiting, waiting)
            else -> getString(R.string.watch_text)
        }
        val stop = PendingIntent.getService(
            this, 1, Intent(this, OrderWatchService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return builder(CHANNEL_WATCH)
            .setContentTitle(getString(R.string.watch_title))
            .setContentText(text)
            .setOngoing(true)
            .setShowWhen(false)
            .setContentIntent(openApp(null))
            .addAction(Notification.Action.Builder(null, getString(R.string.watch_stop), stop).build())
            .build()
    }

    private fun builder(channel: String): Notification.Builder {
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, channel) else @Suppress("DEPRECATION") Notification.Builder(this)
        return b.setSmallIcon(R.drawable.ic_notification).setColor(getColor(R.color.brand))
    }

    // Opens the app, on an order's page when there is one.
    private fun openApp(orderId: String?): PendingIntent {
        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (orderId != null) intent.putExtra(EXTRA_ORDER, orderId)
        return PendingIntent.getActivity(
            this, orderId?.hashCode() ?: 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private fun makeChannels() {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_WATCH, getString(R.string.channel_watch), NotificationManager.IMPORTANCE_LOW)
                .apply { description = getString(R.string.channel_watch_about); setShowBadge(false) },
        )
        // Pops up on the screen; silent itself, because the service rings the bell (louder, on the alarm volume).
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ORDERS, getString(R.string.channel_orders), NotificationManager.IMPORTANCE_HIGH).apply {
                description = getString(R.string.channel_orders_about)
                setSound(null, null)
                enableVibration(false)
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ALERTS, getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_DEFAULT)
                .apply { description = getString(R.string.channel_alerts_about) },
        )
    }
}
