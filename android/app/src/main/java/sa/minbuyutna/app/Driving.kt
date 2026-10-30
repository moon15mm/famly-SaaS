package sa.minbuyutna.app

import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

/** Pure helpers for the driver screens, free of Android types so they run in unit tests. */
object Driving {
    private val riyadh: ZoneId = ZoneId.of("Asia/Riyadh")
    private val shortTime: DateTimeFormatter = DateTimeFormatter.ofPattern("d/M HH:mm", Locale.ROOT)

    /** The next trip transition, with the proof code it needs (null when none). */
    data class Step(val next: String, val label: String, val codeHint: String?)

    private val statuses = mapOf(
        "ready" to "جاهز للاستلام",
        "assigned" to "في الطريق إلى الأسرة",
        "picked_up" to "استُلم من الأسرة",
        "in_transit" to "في الطريق إلى العميل",
        "delivered" to "تم التسليم",
        "completed" to "مكتمل",
        "cancelled" to "ملغي",
    )

    fun status(value: String): String = statuses[value] ?: value

    fun nextStep(status: String): Step? = when (status) {
        "assigned" -> Step("picked_up", "تأكيد الاستلام من الأسرة", "رمز الاستلام من الأسرة")
        "picked_up" -> Step("in_transit", "بدء التوصيل إلى العميل", null)
        "in_transit" -> Step("delivered", "تأكيد التسليم للعميل", "رمز التسليم من العميل")
        else -> null
    }

    /** The session value from a Cookie header ("a=b; session=x") or a Set-Cookie header ("session=x; Path=/"). */
    fun sessionCookie(header: String?): String? = header
        ?.split(";")
        ?.map { it.trim() }
        ?.firstOrNull { it.startsWith("session=") }
        ?.removePrefix("session=")
        ?.takeIf { it.isNotEmpty() }

    /** Amounts arrive in halalas. */
    fun money(halalas: Int): String {
        val riyals = halalas / 100
        val rest = halalas % 100
        return if (rest == 0) "$riyals ر.س" else String.format(Locale.ROOT, "%d.%02d ر.س", riyals, rest)
    }

    fun distance(km: Double?): String? = when {
        km == null -> null
        km < 1 -> "${(km * 100).roundToInt() * 10} م"
        else -> String.format(Locale.ROOT, "%.1f كم", km)
    }

    /** Server times are naive UTC ("2026-10-31T12:00:00"); offsets are accepted too. */
    fun instant(value: String): Instant? = try {
        if (value.endsWith("Z") || value.contains('+')) OffsetDateTime.parse(value).toInstant()
        else LocalDateTime.parse(value).toInstant(ZoneOffset.UTC)
    } catch (error: Exception) {
        null
    }

    fun localTime(value: String): String = instant(value)?.atZone(riyadh)?.format(shortTime) ?: value

    fun minutesLeft(value: String, nowMillis: Long): Long? = instant(value)?.let { (it.toEpochMilli() - nowMillis) / 60_000 }

    /** A geo: link any installed maps app can open, preferring exact coordinates. */
    fun mapsUri(latitude: Double?, longitude: Double?, address: String): String =
        if (latitude != null && longitude != null) "geo:$latitude,$longitude?q=$latitude,$longitude(${encode(address.ifBlank { "الوجهة" })})"
        else "geo:0,0?q=" + encode(address)

    fun webMapsUrl(latitude: Double?, longitude: Double?, address: String): String =
        "https://www.google.com/maps/dir/?api=1&destination=" +
            if (latitude != null && longitude != null) "$latitude,$longitude" else encode(address)

    fun newOffers(current: List<String>, seen: Set<String>): List<String> = current.filter { it !in seen }

    private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
}
