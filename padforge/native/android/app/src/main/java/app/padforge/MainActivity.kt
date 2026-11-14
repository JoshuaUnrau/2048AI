package app.padforge

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import java.util.Locale

/**
 * PadForge for Android: a full-screen WebView showing the controller served by the
 * PadForge bridge, plus the things a web page can't do on its own:
 *  - the phone's volume buttons become controller inputs (AudioVolumeUp/Down key events)
 *  - gyroscope + accelerometer are read natively and fed to the page ("pf-devicemotion")
 *  - vibration (navigator.vibrate) for haptics and game rumble
 */
class MainActivity : Activity(), SensorEventListener {

    private lateinit var web: WebView
    private val prefs by lazy { getSharedPreferences("padforge", Context.MODE_PRIVATE) }
    private var onController = false
    private var sensors: SensorManager? = null
    private val accel = FloatArray(3)
    private var hasAccel = false
    private var lastGyroNs = 0L

    private val vibrator: Vibrator by lazy {
        if (Build.VERSION.SDK_INT >= 31) {
            (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web = WebView(this)
        web.setBackgroundColor(0xFF0D0F14.toInt())
        setContentView(web)
        hideSystemBars()

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.addJavascriptInterface(NativeBridge(), "PadForgeNative")
        web.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                onController = url.startsWith("http")
            }

            override fun onPageFinished(view: WebView, url: String) {
                view.evaluateJavascript(SHIM, null)
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame && onController) {
                    showSetup("Couldn't reach the bridge at ${request.url.host}. Is it running, and is the phone on the same Wi-Fi?")
                }
            }
        }

        sensors = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val saved = prefs.getString("url", null)
        if (saved != null) web.loadUrl(saved) else showSetup(null)
    }

    private fun showSetup(error: String?) {
        onController = false
        var hash = "u=" + Uri.encode(prefs.getString("url", "") ?: "")
        if (error != null) hash += "&e=" + Uri.encode(error)
        web.loadUrl("file:///android_asset/setup.html#$hash")
    }

    // ---------------------------------------------------------------- volume buttons

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val key = when (event.keyCode) {
            KeyEvent.KEYCODE_VOLUME_UP -> "AudioVolumeUp"
            KeyEvent.KEYCODE_VOLUME_DOWN -> "AudioVolumeDown"
            else -> null
        }
        if (key != null && onController) {
            // Consume the key so the volume doesn't change; forward press and release.
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) sendKey("keydown", key)
            else if (event.action == KeyEvent.ACTION_UP) sendKey("keyup", key)
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun sendKey(type: String, key: String) {
        web.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('$type',{key:'$key'}))", null)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (onController) showSetup(null) else @Suppress("DEPRECATION") super.onBackPressed()
    }

    // ---------------------------------------------------------------- motion sensors

    override fun onResume() {
        super.onResume()
        hideSystemBars()
        val sm = sensors ?: return
        sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
        sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
    }

    override fun onPause() {
        super.onPause()
        sensors?.unregisterListener(this)
        // Let go of anything held by the volume keys if the app is backgrounded.
        if (onController) {
            sendKey("keyup", "AudioVolumeUp")
            sendKey("keyup", "AudioVolumeDown")
        }
    }

    override fun onSensorChanged(e: SensorEvent) {
        when (e.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> { System.arraycopy(e.values, 0, accel, 0, 3); hasAccel = true }
            Sensor.TYPE_GYROSCOPE -> {
                if (!onController) return
                val intervalMs = if (lastGyroNs == 0L) 16.0 else (e.timestamp - lastGyroNs) / 1e6
                lastGyroNs = e.timestamp
                // Same shape and units as the browser's DeviceMotionEvent:
                // rotationRate in deg/s (alpha = z, beta = x, gamma = y), acceleration in m/s².
                val d = Math.toDegrees(1.0)
                val js = String.format(
                    Locale.US,
                    "window.dispatchEvent(Object.assign(new Event('pf-devicemotion'),{rotationRate:{alpha:%.3f,beta:%.3f,gamma:%.3f},accelerationIncludingGravity:%s,interval:%.2f}))",
                    e.values[2] * d, e.values[0] * d, e.values[1] * d,
                    if (hasAccel) String.format(Locale.US, "{x:%.4f,y:%.4f,z:%.4f}", accel[0], accel[1], accel[2]) else "null",
                    intervalMs,
                )
                web.evaluateJavascript(js, null)
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}

    // ---------------------------------------------------------------- page -> app

    inner class NativeBridge {
        @JavascriptInterface
        fun connect(url: String) {
            val uri = Uri.parse(url)
            if (uri.scheme != "http" && uri.scheme != "https") return
            prefs.edit().putString("url", url).apply()
            runOnUiThread { web.loadUrl(url) }
        }

        @JavascriptInterface
        fun setup() = runOnUiThread { showSetup(null) }

        @JavascriptInterface
        fun vibrate(ms: Int) {
            if (ms <= 0) { vibrator.cancel(); return }
            vibrator.vibrate(VibrationEffect.createOneShot(ms.coerceAtMost(1000).toLong(), VibrationEffect.DEFAULT_AMPLITUDE))
        }
    }

    // ---------------------------------------------------------------- full screen

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    companion object {
        // Runs in every page: marks the page as running inside the app and routes
        // navigator.vibrate (haptics + rumble) to the phone's vibration motor.
        private const val SHIM = """
            (function () {
              window.__pfNative = 'android';
              navigator.vibrate = function (p) {
                var ms = Array.isArray(p) ? (p[0] || 0) : (p || 0);
                PadForgeNative.vibrate(Math.round(ms));
                return true;
              };
            })();
        """
    }
}
