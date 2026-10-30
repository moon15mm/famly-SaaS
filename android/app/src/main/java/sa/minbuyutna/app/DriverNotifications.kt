package sa.minbuyutna.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object DriverNotifications {
    const val SHIFT = "driver-shift"
    const val OFFERS = "driver-offers"
    const val TRIP = "driver-trip"

    fun channels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannels(
            listOf(
                NotificationChannel(SHIFT, "الدوام ومشاركة الموقع", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "إشعار ثابت ما دام السائق متاحًا أو في رحلة"
                },
                NotificationChannel(OFFERS, "عروض المشاوير", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "تنبيه بصوت عند وصول عرض مشوار جديد"
                    enableVibration(true)
                },
                NotificationChannel(TRIP, "تحديثات الدوام والرحلة", NotificationManager.IMPORTANCE_DEFAULT),
            ),
        )
    }

    fun openApp(context: Context, tab: String, request: Int): PendingIntent = PendingIntent.getActivity(
        context,
        request,
        Intent(context, DriverActivity::class.java)
            .putExtra(DriverActivity.EXTRA_TAB, tab)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    fun post(context: Context, id: Int, channel: String, title: String, text: String, tab: String) {
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_driver)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(if (channel == OFFERS) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(openApp(context, tab, id))
            .build()
        try {
            NotificationManagerCompat.from(context).notify(id, notification)
        } catch (error: SecurityException) {
            // Notifications are not allowed; offers stay visible inside the app.
        }
    }
}
