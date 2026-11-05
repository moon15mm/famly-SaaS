package sa.minbuyutna.app

import org.junit.Assert.*
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class PlatformModelsTest {

    private val riyadh: TimeZone = TimeZone.getTimeZone("Asia/Riyadh")

    private fun product(price: Int, options: List<ProductOption> = emptyList()) = NativeProduct(
        id = "p1",
        householdId = "h1",
        householdName = "مطبخ أم محمد",
        name = "خمير ذرة مع بامية",
        description = "أكلة تهامية",
        price = price,
        category = "food",
        images = emptyList(),
        prepHours = 2,
        stock = true,
        city = "الدرب",
        options = options
    )

    private fun riyadhMillis(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long =
        Calendar.getInstance(riyadh).apply {
            clear()
            set(year, month - 1, day, hour, minute, 0)
        }.timeInMillis

    @Test
    fun testAlDarbVillagesConfiguration() {
        assertTrue(AL_DARB_VILLAGES.size >= 8)
        val villageNames = AL_DARB_VILLAGES.map { it.name }
        assertTrue(villageNames.contains("حي القائم"))
        assertTrue(villageNames.contains("قرية عتود"))
    }

    @Test
    fun testNativeProductPriceFormatting() {
        assertEquals("65.00", product(6500).priceSar)
        assertEquals("45.50", product(4550).priceSar)
        assertNull(product(4550).fullImageUrl)
    }

    @Test
    fun testCartChargesTheFamilysOptionPrice() {
        val family = ProductOption("opt-family", "عائلي", 2000)
        val plain = NativeCartItem(product = product(3500), quantity = 3, note = "بدون بصل")
        assertEquals(10500, plain.totalHalalas)
        assertEquals("105.00", plain.totalSar)
        assertNull(plain.optionId)

        val sized = NativeCartItem(product(3500, listOf(family)), 2, family.name, "", family.id, family.priceDiff)
        assertEquals(5500, sized.unitHalalas)
        assertEquals(11000, sized.totalHalalas)
        assertEquals("opt-family", sized.optionId)
    }

    @Test
    fun testOrderStatusArabicMapping() {
        fun makeOrder(status: String) = NativeOrder(
            id = "0123456789abcdef0123456789abcdef",
            householdName = "مطبخ الدرب",
            status = status,
            subtotal = 5000,
            deliveryFee = 1500,
            total = 6650,
            scheduledAt = "2026-11-04T12:00:00",
            address = "حي القائم"
        )
        assertEquals("بانتظار قبول الأسرة", makeOrder("pending_acceptance").statusArabic)
        assertEquals("مدفوع وبانتظار بدء التجهيز", makeOrder("confirmed").statusArabic)
        assertEquals("تم تعيين كابتن التوصيل 🛵", makeOrder("assigned").statusArabic)
        assertEquals("تم الاستلام من الأسرة ✓", makeOrder("completed").statusArabic)
        assertEquals("ملغي", makeOrder("cancelled").statusArabic)
        assertEquals("66.50", makeOrder("preparing").totalSar)
        assertEquals("01234567", makeOrder("ready").shortId)
    }

    @Test
    fun testEarliestSlotRespectsPreparationAndRoundsUp() {
        val now = riyadhMillis(2026, 11, 5, 9, 20)
        assertEquals(riyadhMillis(2026, 11, 5, 12, 0), earliestSlotMillis(now, 2, riyadh))
        // Exactly on the hour stays on that hour.
        assertEquals(riyadhMillis(2026, 11, 5, 11, 0), earliestSlotMillis(riyadhMillis(2026, 11, 5, 9, 0), 2, riyadh))
        assertEquals(riyadhMillis(2026, 11, 5, 10, 0), earliestSlotMillis(now, 0, riyadh))
    }

    @Test
    fun testScheduledTimeCarriesAnOffset() {
        assertEquals("2026-11-05T12:00:00+03:00", isoWithOffset(riyadhMillis(2026, 11, 5, 12, 0), riyadh))
        assertEquals("2026-11-05 15:00", riyadhTime("2026-11-05T12:00:00"))
        assertEquals("2026-11-05 15:00", riyadhTime("2026-11-05T12:00:00.123456"))
        assertEquals("غير صالح", riyadhTime("غير صالح"))
    }

    @Test
    fun testKitchenStagesAndActionsFollowThePlatform() {
        assertEquals("new", kitchenStage("pending_acceptance"))
        assertEquals("new", kitchenStage("pending_payment"))
        assertEquals("cooking", kitchenStage("confirmed"))
        assertEquals("ready", kitchenStage("ready"))
        assertEquals("done", kitchenStage("delivered"))
        assertEquals("closed", kitchenStage("cancelled"))

        assertEquals("pending_payment", nextKitchenAction("pending_acceptance", "pickup")?.first)
        // A family never confirms an order itself: payment does that.
        assertNull(nextKitchenAction("pending_payment", "pickup"))
        assertEquals("preparing", nextKitchenAction("confirmed", "paid")?.first)
        assertEquals("completed", nextKitchenAction("ready", "pickup")?.first)
        assertNull(nextKitchenAction("ready", "paid"))
        assertEquals("delivered", nextKitchenAction("in_transit", "free")?.first)

        assertTrue(kitchenCanCancel("pending_acceptance"))
        assertTrue(kitchenCanCancel("confirmed"))
        assertFalse(kitchenCanCancel("preparing"))
    }

    @Test
    fun testServiceFeeMatchesPlatform() {
        assertEquals(150, CUSTOMER_SERVICE_FEE_HALALAS)
        assertEquals("1.50", halalasToSar(CUSTOMER_SERVICE_FEE_HALALAS))
    }

    @Test
    fun testUserProfileAuthenticationModel() {
        val user = UserProfile(id = "usr_100", name = "سعد", email = "saad@example.test", role = "customer", sessionToken = "token")
        assertEquals("customer", user.role)
        assertEquals("token", user.sessionToken)
    }
}
