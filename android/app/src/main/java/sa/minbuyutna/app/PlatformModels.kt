package sa.minbuyutna.app

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class UserProfile(
    val id: String,
    val name: String,
    val email: String,
    val role: String,
    val sessionToken: String? = null
)

data class HouseholdStore(
    val id: String,
    val name: String,
    val city: String,
    val verified: Boolean,
    val description: String,
    val pickupAddress: String,
    val rating: Double = 4.9
)

data class ProductOption(
    val id: String,
    val name: String,
    val priceDiff: Int
)

data class NativeProduct(
    val id: String,
    val householdId: String,
    val householdName: String,
    val name: String,
    val description: String,
    val price: Int, // Price in Halalas (e.g. 3500 = 35.00 SAR)
    val category: String, // food, sweets, crafts
    val images: List<String>,
    val prepHours: Int,
    val stock: Boolean,
    val city: String,
    val options: List<ProductOption> = emptyList()
) {
    val priceSar: String
        get() = String.format(Locale.US, "%.2f", price / 100.0)
    
    val fullImageUrl: String?
        get() = images.firstOrNull()?.let {
            if (it.startsWith("http")) it else "${BuildConfig.PLATFORM_URL}$it"
        }
}

data class NativeCartItem(
    val product: NativeProduct,
    var quantity: Int = 1,
    var selectedOption: String? = null,
    var note: String = "",
    /** The family's own option (size, filling…) as defined on the platform; its price delta is charged. */
    val optionId: String? = null,
    val optionDelta: Int = 0
) {
    val unitHalalas: Int
        get() = product.price + optionDelta

    val totalHalalas: Int
        get() = unitHalalas * quantity

    val totalSar: String
        get() = String.format(Locale.US, "%.2f", totalHalalas / 100.0)
}

data class NativeOrderItem(
    val name: String,
    val quantity: Int,
    val unitPrice: Int,
    val option: String?
)

data class NativeOrder(
    val id: String,
    val householdName: String,
    val status: String,
    val subtotal: Int,
    val deliveryFee: Int,
    val total: Int,
    val scheduledAt: String,
    val address: String,
    val pickupOtp: String? = null,
    val deliveryOtp: String? = null,
    val items: List<NativeOrderItem> = emptyList(),
    val driverName: String? = null,
    val driverPhone: String? = null,
    val deliveryMethod: String = "pickup",
    val paymentStatus: String = "unpaid",
    val serviceFee: Int = 0,
    val merchantFee: Int = 0,
    val merchantPayout: Int = 0,
    val createdAt: String = "",
    val pickupAddress: String? = null
) {
    val shortId: String
        get() = id.take(8)

    val totalSar: String
        get() = String.format(Locale.US, "%.2f", total / 100.0)

    val statusArabic: String
        get() = when (status) {
            "draft" -> "مسودة"
            "pending_payment" -> "بانتظار السداد"
            "pending_acceptance" -> "بانتظار قبول الأسرة"
            "confirmed" -> "مدفوع وبانتظار بدء التجهيز"
            "preparing" -> "جاري الطهي والتجهيز 🍳"
            "ready" -> "جاهز للتسليم في المطبخ 📦"
            "assigned", "driver_assigned" -> "تم تعيين كابتن التوصيل 🛵"
            "picked_up" -> "استلم الكابتن الطلب ساخناً 🍲"
            "in_transit" -> "في الطريق إليك الآن 🚀"
            "delivered" -> "تم التسليم بالهناء والعافية ✓"
            "completed" -> "تم الاستلام من الأسرة ✓"
            "cancelled" -> "ملغي"
            else -> status
        }
}

data class VillageOption(
    val name: String,
    val distanceKm: Double,
    val estimatedMinutes: Int
)

val AL_DARB_VILLAGES = listOf(
    VillageOption("وسط محافظة الدرب", 2.0, 15),
    VillageOption("حي القائم", 3.5, 20),
    VillageOption("أبو السداد", 5.0, 25),
    VillageOption("قرية منشبة", 7.0, 30),
    VillageOption("مركز الشقيق والشاطئ", 18.0, 40),
    VillageOption("قرية عتود", 14.0, 35),
    VillageOption("سمرة الجد", 11.0, 30),
    VillageOption("مركز ريم", 16.0, 35)
)

/** Shown before the server quote; the server adds exactly this per order. */
const val CUSTOMER_SERVICE_FEE_HALALAS = 150 // 1.50 SAR

/** Earliest bookable time: preparation hours from now, rounded up to the next full hour. */
fun earliestSlotMillis(nowMillis: Long, prepHours: Int, zone: TimeZone = TimeZone.getTimeZone("Asia/Riyadh")): Long {
    val calendar = Calendar.getInstance(zone).apply {
        timeInMillis = nowMillis + prepHours.coerceAtLeast(0) * 3_600_000L
    }
    if (calendar.get(Calendar.MINUTE) != 0 || calendar.get(Calendar.SECOND) != 0 || calendar.get(Calendar.MILLISECOND) != 0) {
        calendar.add(Calendar.HOUR_OF_DAY, 1)
    }
    calendar.set(Calendar.MINUTE, 0)
    calendar.set(Calendar.SECOND, 0)
    calendar.set(Calendar.MILLISECOND, 0)
    return calendar.timeInMillis
}

/** ISO-8601 with an explicit offset, which the platform requires for scheduled orders. */
fun isoWithOffset(millis: Long, zone: TimeZone = TimeZone.getTimeZone("Asia/Riyadh")): String =
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).apply { timeZone = zone }.format(Date(millis))

/** Groups platform order states into the kitchen's columns. */
fun kitchenStage(status: String): String = when (status) {
    "pending_acceptance", "pending_payment" -> "new"
    "confirmed", "preparing" -> "cooking"
    "ready" -> "ready"
    "assigned", "picked_up", "in_transit", "delivered", "completed" -> "done"
    else -> "closed"
}

/** The family's next step for an order, as (target state, button label); null when it waits on someone else. */
fun nextKitchenAction(status: String, deliveryMethod: String): Pair<String, String>? = when {
    status == "pending_acceptance" -> "pending_payment" to "قبول الطلب وتأكيد التوفر"
    status == "confirmed" -> "preparing" to "بدء التجهيز 🍳"
    status == "preparing" -> "ready" to "الطلب جاهز 📦"
    status == "ready" && deliveryMethod == "pickup" -> "completed" to "تم التسليم للعميل ✓"
    status == "ready" && deliveryMethod == "free" -> "in_transit" to "بدء التوصيل بنفسي"
    status == "in_transit" && deliveryMethod == "free" -> "delivered" to "تم التوصيل ✓"
    else -> null
}

/** States in which the family may still decline or cancel. */
fun kitchenCanCancel(status: String): Boolean = status in setOf("pending_acceptance", "pending_payment", "confirmed")

fun halalasToSar(value: Int): String = String.format(Locale.US, "%.2f", value / 100.0)

/** The platform stores times in UTC without an offset; families and customers read them in Riyadh time. */
fun riyadhTime(utc: String): String {
    if (utc.length < 16) return utc
    return try {
        val parser = SimpleDateFormat("yyyy-MM-dd'T'HH:mm", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        val date = parser.parse(utc.take(16)) ?: return utc
        SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).apply { timeZone = TimeZone.getTimeZone("Asia/Riyadh") }.format(date)
    } catch (_: Exception) {
        utc
    }
}
