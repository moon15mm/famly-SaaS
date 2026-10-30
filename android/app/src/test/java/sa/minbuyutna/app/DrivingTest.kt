package sa.minbuyutna.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DrivingTest {
    @Test fun sessionComesFromCookieAndSetCookieHeaders() {
        assertEquals("abc", Driving.sessionCookie("session=abc; HttpOnly; Max-Age=604800; Path=/; SameSite=lax; Secure"))
        assertEquals("xyz", Driving.sessionCookie("theme=light; session=xyz"))
        assertNull(Driving.sessionCookie("theme=light"))
        assertNull(Driving.sessionCookie("session=; Path=/"))
        assertNull(Driving.sessionCookie(null))
    }

    @Test fun moneyAndDistanceAreReadable() {
        assertEquals("25 ر.س", Driving.money(2500))
        assertEquals("25.05 ر.س", Driving.money(2505))
        assertEquals("850 م", Driving.distance(0.85))
        assertEquals("2.3 كم", Driving.distance(2.34))
        assertNull(Driving.distance(null))
    }

    @Test fun proofCodesAreRequiredOnlyAtHandovers() {
        assertEquals("picked_up", Driving.nextStep("assigned")?.next)
        assertTrue(Driving.nextStep("assigned")?.codeHint != null)
        assertNull(Driving.nextStep("picked_up")?.codeHint)
        assertTrue(Driving.nextStep("in_transit")?.codeHint != null)
        assertNull(Driving.nextStep("delivered"))
    }

    @Test fun serverTimesShowInRiyadhTime() {
        assertEquals("31/10 15:00", Driving.localTime("2026-10-31T12:00:00"))
        assertEquals("31/10 15:00", Driving.localTime("2026-10-31T12:00:00.123456"))
        assertEquals("31/10 15:00", Driving.localTime("2026-10-31T12:00:00Z"))
        assertEquals("not a date", Driving.localTime("not a date"))
        assertEquals(60L, Driving.minutesLeft("2026-10-31T13:00:00", Driving.instant("2026-10-31T12:00:00")!!.toEpochMilli()))
    }

    @Test fun directionsPreferCoordinates() {
        assertEquals("geo:24.7,46.6?q=24.7,46.6(%D8%A7)", Driving.mapsUri(24.7, 46.6, "ا"))
        assertEquals("geo:0,0?q=Riyadh%20Center", Driving.mapsUri(null, null, "Riyadh Center"))
        assertEquals("https://www.google.com/maps/dir/?api=1&destination=24.7,46.6", Driving.webMapsUrl(24.7, 46.6, "x"))
    }

    @Test fun onlyUnseenOffersAlert() {
        assertEquals(listOf("c"), Driving.newOffers(listOf("a", "b", "c"), setOf("a", "b")))
        assertEquals(emptyList<String>(), Driving.newOffers(listOf("a"), setOf("a")))
    }
}
