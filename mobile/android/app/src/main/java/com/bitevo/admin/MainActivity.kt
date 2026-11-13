// The app's one screen: the admin panel (the live https://admin.bitevo.in, or the dev server in test builds) in a
// WebView, plus what a web page can't do by itself: keep ringing for new orders and showing them in the
// notification bar while the app is closed or the screen is off (OrderWatchService). The panel reaches the app
// through `window.BiteVoAdmin` (Bridge below): its bell (components/OrderBell.jsx) sends its settings there, and
// asks whether the app already rang for an order while it was closed.
package com.bitevo.admin

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings as AndroidSettings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.window.OnBackInvokedDispatcher
import org.json.JSONObject

private const val REQ_FILE = 10
private const val REQ_NOTIFICATIONS = 11

class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var errorView: View
    private lateinit var settings: Settings
    private var loadFailed = false
    private var pageReady = false
    private var fileAnswer: ValueCallback<Array<Uri>>? = null // the page's file input waiting for a photo
    private lateinit var appUrl: String
    private val appOrigin get() = origin(appUrl)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        settings = Settings(this)
        appUrl = settings.appUrl
        web = WebView(this)
        errorView = errorView()
        setContentView(layout())
        setUpWebView()
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { back() }
        }
        // Opened from a new order's notification: straight to that order.
        val order = intent.getStringExtra(OrderWatchService.EXTRA_ORDER)
        web.loadUrl(if (order != null) appUrl + orderPath(order) else appUrl)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.getStringExtra(OrderWatchService.EXTRA_ORDER)?.let { openOrder(it) }
    }

    override fun onStart() {
        super.onStart()
        AppState.onScreen = true
        web.onResume()
        web.resumeTimers()
        OrderWatchService.screenChanged(this)
        // Signed in on the panel: the background bell watches (again, if "Stop" was tapped on its notification).
        if (signedIn() && !OrderWatchService.running) OrderWatchService.start(this)
    }

    override fun onStop() {
        AppState.onScreen = false
        CookieManager.getInstance().flush() // the session cookie, on disk for the service
        // The page sleeps while the app isn't on screen; OrderWatchService rings for new orders meanwhile.
        web.onPause()
        web.pauseTimers()
        OrderWatchService.screenChanged(this)
        super.onStop()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_FILE) {
            fileAnswer?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileAnswer = null
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_NOTIFICATIONS) askAboutBattery()
    }

    @Deprecated("Below Android 13; newer phones use the OnBackInvokedCallback above")
    override fun onBackPressed() = back()

    // Back goes back in the panel, and from its first page to the home screen (the app and its bell keep running).
    private fun back() {
        if (web.canGoBack()) web.goBack() else moveTaskToBack(true)
    }

    private fun signedIn() = CookieManager.getInstance().getCookie(appUrl)?.contains("${WaitingOrders.COOKIE}=") == true

    // window.BiteVoAdmin in the page. Called on a WebView thread; only the app's own pages are listened to.
    private inner class Bridge {
        // The panel's bell settings { sound, style, remind }, sent when it starts (someone is signed in) and on
        // each change: the background bell uses the same ones, and starts watching.
        @JavascriptInterface
        fun bell(json: String) = fromPage {
            val p = runCatching { JSONObject(json) }.getOrNull() ?: return@fromPage
            settings.sound = p.optBoolean("sound", true)
            settings.style = p.optString("style", "loud")
            settings.remind = p.optBoolean("remind", true)
            if (!OrderWatchService.running) OrderWatchService.start(this@MainActivity)
            askForNotifications()
        }

        // Whether the app rang for this order while it was closed (the panel then doesn't ring for it again).
        @JavascriptInterface
        fun announced(orderId: String): Boolean = OrderWatchService.announced.contains(orderId)

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME

        private fun fromPage(action: () -> Unit) = runOnUiThread {
            if (origin(web.url.orEmpty()) == appOrigin) action()
        }
    }

    // Android 13+: new orders can only show in the notification bar once this is allowed. Asked once.
    private fun askForNotifications() {
        if (Build.VERSION.SDK_INT < 33 || settings.askedNotifications) return askAboutBattery()
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return askAboutBattery()
        settings.askedNotifications = true
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFICATIONS)
    }

    // Battery saving can stop the checks while the phone sleeps: ask once to be left out of it.
    private fun askAboutBattery() {
        if (Build.VERSION.SDK_INT < 23 || settings.askedBattery) return
        val power = getSystemService(PowerManager::class.java) ?: return
        if (power.isIgnoringBatteryOptimizations(packageName)) return
        settings.askedBattery = true
        AlertDialog.Builder(this)
            .setTitle(R.string.ask_battery_title)
            .setMessage(R.string.ask_battery_text)
            .setPositiveButton(R.string.continue_) { _, _ ->
                @SuppressLint("BatteryLife") // the bell must keep checking with the screen off; asked once, after explaining why
                val intent = Intent(AndroidSettings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
                try { startActivity(intent) } catch (e: ActivityNotFoundException) { /* not on this phone */ }
            }
            .setNegativeButton(R.string.not_now, null)
            .show()
    }

    private fun orderPath(id: String) = "/orders?order=${Uri.encode(id)}"

    // Shows an order in the panel already open, without reloading it (its router follows the address change).
    private fun openOrder(id: String) {
        if (!pageReady || loadFailed) return web.loadUrl(appUrl + orderPath(id))
        val path = JSONObject.quote(orderPath(id))
        web.evaluateJavascript("history.pushState({}, '', $path); dispatchEvent(new PopStateEvent('popstate'))", null)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setUpWebView() {
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false // the panel's own bell rings without a tap first
            allowFileAccess = false
            allowContentAccess = false
            userAgentString = "$userAgentString BiteVoAdmin/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        // Test builds (for the dev server) can be inspected from the PC's Chrome (chrome://inspect).
        if (Server.canChange) WebView.setWebContentsDebuggingEnabled(true)

        web.addJavascriptInterface(Bridge(), "BiteVoAdmin")
        web.webChromeClient = object : WebChromeClient() {
            // Product photos: the phone's file picker or gallery.
            override fun onShowFileChooser(view: WebView, answer: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileAnswer?.onReceiveValue(null)
                return try {
                    startActivityForResult(params.createIntent(), REQ_FILE)
                    fileAnswer = answer
                    true
                } catch (e: ActivityNotFoundException) {
                    answer.onReceiveValue(null)
                    false
                }
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (origin(request.url.toString()) == appOrigin) return false
                openOutside(request.url)
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                pageReady = true
                if (!loadFailed) errorView.visibility = View.GONE
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                loadFailed = true
                errorView.visibility = View.VISIBLE
            }
        }
    }

    // Phone numbers, maps and any other site open in their own apps.
    private fun openOutside(uri: Uri) {
        val intent = when (uri.scheme) {
            "tel" -> Intent(Intent.ACTION_DIAL, uri)
            "http", "https", "mailto", "geo", "upi" -> Intent(Intent.ACTION_VIEW, uri)
            else -> return
        }
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            // No app for it on this phone.
        }
    }

    // The page between two bands the colour of the bars around it: red under the status bar, white under the
    // navigation bar (and the keyboard). Android 15+ always draws apps edge to edge, so the app handles it.
    private fun layout(): View {
        val top = View(this).apply { setBackgroundColor(getColor(R.color.brand)) }
        val bottom = View(this).apply { setBackgroundColor(getColor(R.color.page)) }
        val page = FrameLayout(this).apply {
            addView(web, MATCH_PARENT, MATCH_PARENT)
            addView(errorView, MATCH_PARENT, MATCH_PARENT)
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(getColor(R.color.page))
            addView(top, LinearLayout.LayoutParams(MATCH_PARENT, 0))
            addView(page, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
            addView(bottom, LinearLayout.LayoutParams(MATCH_PARENT, 0))
        }
        if (Build.VERSION.SDK_INT >= 30) {
            edgeToEdge()
            window.insetsController?.setSystemBarsAppearance(
                WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
            )
            root.setOnApplyWindowInsetsListener { _, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                val keyboard = insets.getInsets(WindowInsets.Type.ime())
                top.layoutParams.height = bars.top
                bottom.layoutParams.height = maxOf(bars.bottom, keyboard.bottom)
                root.setPadding(bars.left, 0, bars.right, 0)
                top.requestLayout()
                bottom.requestLayout()
                WindowInsets.CONSUMED
            }
        }
        return root
    }

    @Suppress("DEPRECATION") // Android 15+ does all this by itself
    private fun edgeToEdge() {
        window.setDecorFitsSystemWindows(false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
    }

    // Shown instead of the browser's error page when the panel can't be reached. Test builds (for an http address)
    // also let you type another address here, e.g. the PC's new Wi-Fi address.
    private fun errorView(): View {
        val dp = resources.displayMetrics.density
        val wrap = { LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT) }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding((32 * dp).toInt(), 0, (32 * dp).toInt(), 0)
            setBackgroundColor(getColor(R.color.page))
            visibility = View.GONE
            addView(TextView(context).apply {
                setText(R.string.error_title)
                textSize = 20f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(Color.rgb(31, 31, 31))
                gravity = Gravity.CENTER
            })
            addView(TextView(context).apply {
                setText(R.string.error_text)
                textSize = 15f
                setTextColor(Color.rgb(97, 97, 97))
                gravity = Gravity.CENTER
                setPadding(0, (8 * dp).toInt(), 0, (16 * dp).toInt())
            })
            addView(Button(context).apply {
                setText(R.string.try_again)
                setOnClickListener { open(appUrl) }
            }, wrap())
            if (!Server.canChange) return@apply
            val address = EditText(context).apply {
                setText(appUrl)
                setSingleLine()
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
                imeOptions = EditorInfo.IME_ACTION_GO
                textSize = 15f
            }
            addView(TextView(context).apply {
                setText(R.string.server_address)
                textSize = 13f
                setTextColor(Color.rgb(97, 97, 97))
                setPadding(0, (32 * dp).toInt(), 0, 0)
            }, LinearLayout.LayoutParams(MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            addView(address, LinearLayout.LayoutParams(MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            val use: () -> Unit = {
                val url = Server.normalise(address.text.toString())
                if (url == null) address.error = getString(R.string.server_address_wrong)
                else { settings.appUrl = url; open(url) }
            }
            address.setOnEditorActionListener { _, _, _ -> use(); true }
            addView(Button(context).apply {
                setText(R.string.server_address_use)
                setOnClickListener { use() }
            }, wrap())
        }
    }

    private fun open(url: String) {
        appUrl = url
        loadFailed = false
        pageReady = false
        web.loadUrl(url)
    }
}

// "https://admin.bitevo.in:443/x" → "https://admin.bitevo.in:443"
private fun origin(url: String): String {
    val uri = Uri.parse(url)
    return "${uri.scheme}://${uri.authority}".lowercase()
}
