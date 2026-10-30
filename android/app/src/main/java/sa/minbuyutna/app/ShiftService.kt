package sa.minbuyutna.app

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Runs while the driver is available or on a trip: shares the location and alerts on new offers.
 * Without push accounts the alerts come from polling, so they arrive only during a shift.
 */
class ShiftService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var poller: Job? = null
    private var locations: LocationManager? = null
    private val seen = mutableSetOf<String>()

    @Volatile private var latest: Location? = null
    @Volatile private var sentAt = 0L
    @Volatile private var onTrip = false

    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            latest = location
            scope.launch { share() }
        }

        override fun onProviderEnabled(provider: String) = Unit

        override fun onProviderDisabled(provider: String) = Unit

        @Deprecated("Still called on Android 9 and earlier")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        DriverNotifications.channels(this)
        if (!foreground("متاح لاستقبال المشاوير")) {
            stopSelf()
            return START_NOT_STICKY
        }
        listen()
        if (intent?.action == ACTION_END) {
            scope.launch { endShift() }
        } else if (poller?.isActive != true) {
            poller = scope.launch { poll() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        locations?.removeUpdates(listener)
        locations = null
        scope.cancel()
        super.onDestroy()
    }

    private fun foreground(text: String): Boolean = try {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
        ServiceCompat.startForeground(this, ID, ongoing(text), type)
        true
    } catch (error: Exception) {
        // Missing location permission or a background start the system refused.
        false
    }

    private fun ongoing(text: String): Notification = NotificationCompat.Builder(this, DriverNotifications.SHIFT)
        .setSmallIcon(R.drawable.ic_stat_driver)
        .setContentTitle("من بيوتنا — السائق")
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setContentIntent(DriverNotifications.openApp(this, "home", ID))
        .addAction(
            0,
            "إنهاء الدوام",
            PendingIntent.getService(
                this,
                1,
                Intent(this, ShiftService::class.java).setAction(ACTION_END),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            ),
        )
        .build()

    private fun update(text: String) {
        try {
            NotificationManagerCompat.from(this).notify(ID, ongoing(text))
        } catch (error: SecurityException) {
            // The shift keeps running when notifications are blocked.
        }
    }

    private fun listen() {
        if (locations != null) return
        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) return
        val manager = getSystemService(LocationManager::class.java) ?: return
        try {
            for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                if (provider !in manager.allProviders || (provider == LocationManager.GPS_PROVIDER && !fine)) continue
                manager.requestLocationUpdates(provider, 10_000L, 15f, listener, Looper.getMainLooper())
                val known = manager.getLastKnownLocation(provider)
                val current = latest
                if (known != null && (current == null || known.time > current.time)) latest = known
            }
            locations = manager
        } catch (error: SecurityException) {
            manager.removeUpdates(listener)
        }
    }

    private fun api(): DriverApi? {
        val origin = Platform.origin(this)
        val session = DriverSession(this)
        if (session.token(origin) == null) return null
        return DriverApi(origin) { session.token(origin) }
    }

    /** Sends the newest point at most every 8 s on a trip and every 25 s while waiting for offers. */
    private suspend fun share() {
        val location = latest ?: return
        val now = System.currentTimeMillis()
        if (now - sentAt < if (onTrip) 8_000 else 25_000) return
        sentAt = now
        try {
            api()?.location(location.latitude, location.longitude, if (location.hasAccuracy()) location.accuracy else null)
        } catch (error: ApiException) {
            // A 409 means the shift ended elsewhere; the next poll stops the service.
        }
    }

    private suspend fun poll() {
        while (currentCoroutineContext().isActive) {
            val api = api()
            if (api == null) {
                finish("انتهت جلسة السائق؛ يلزم تسجيل الدخول من التطبيق")
                return
            }
            try {
                val summary = api.summary()
                onTrip = summary.activeTripId != null
                if (!summary.available && !onTrip) {
                    finish(null)
                    return
                }
                if (summary.available && !onTrip && summary.verified) announce(api.offers())
                share()
                update(
                    if (onTrip) "رحلة جارية • " + Driving.status(summary.activeTripStatus.orEmpty()) + " • الموقع يُشارك حتى التسليم"
                    else "متاح لاستقبال المشاوير • " + if (latest == null) "بانتظار تحديد الموقع" else "الموقع مفعّل",
                )
            } catch (error: ApiException) {
                if (error.status == 401) {
                    DriverSession(this).clear()
                    finish("انتهت جلسة السائق؛ يلزم تسجيل الدخول من التطبيق")
                    return
                }
            }
            delay(15_000)
        }
    }

    private fun announce(offers: List<Offer>) {
        val ids = offers.map { it.id }
        val fresh = Driving.newOffers(ids, seen).toSet()
        seen.retainAll(ids.toSet())
        seen.addAll(ids)
        for (offer in offers.filter { it.id in fresh }.take(3)) {
            val details = listOfNotNull(
                offer.city,
                Driving.distance(offer.distanceKm)?.let { "يبعد $it" },
                "الموعد " + Driving.localTime(offer.scheduledAt),
            ).joinToString(" • ")
            DriverNotifications.post(this, offer.id.hashCode(), DriverNotifications.OFFERS, "عرض مشوار جديد • " + Driving.money(offer.fee), details, "offers")
        }
    }

    private suspend fun endShift() {
        try {
            api()?.availability(false)
        } catch (error: ApiException) {
            // The next poll reports the real state.
        }
        // A trip in progress keeps the service running until delivery; otherwise the poll stops it now.
        poller?.cancel()
        poller = scope.launch { poll() }
    }

    private suspend fun finish(message: String?) = withContext(Dispatchers.Main) {
        if (message != null) DriverNotifications.post(this@ShiftService, ID + 1, DriverNotifications.TRIP, "انتهى الدوام", message, "home")
        locations?.removeUpdates(listener)
        locations = null
        ServiceCompat.stopForeground(this@ShiftService, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    companion object {
        const val ACTION_END = "sa.minbuyutna.app.END_SHIFT"
        private const val ID = 4100

        fun start(context: Context): Boolean = try {
            ContextCompat.startForegroundService(context, Intent(context, ShiftService::class.java))
            true
        } catch (error: IllegalStateException) {
            // Android refuses foreground starts from the background; the screen retries when visible.
            false
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, ShiftService::class.java))
        }
    }
}
