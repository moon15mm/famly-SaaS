import XCTest
@testable import MinBuyutna

final class DrivingTests: XCTestCase {
    func testSessionComesFromCookieAndSetCookieHeaders() {
        XCTAssertEqual(Driving.sessionCookie("session=abc; HttpOnly; Max-Age=604800; Path=/; SameSite=lax; Secure"), "abc")
        XCTAssertEqual(Driving.sessionCookie("theme=light; session=xyz"), "xyz")
        XCTAssertNil(Driving.sessionCookie("theme=light"))
        XCTAssertNil(Driving.sessionCookie("session=; Path=/"))
        XCTAssertNil(Driving.sessionCookie(nil))
    }

    func testMoneyAndDistanceAreReadable() {
        XCTAssertEqual(Driving.money(2500), "25 ر.س")
        XCTAssertEqual(Driving.money(2505), "25.05 ر.س")
        XCTAssertEqual(Driving.distance(0.85), "850 م")
        XCTAssertEqual(Driving.distance(2.34), "2.3 كم")
        XCTAssertNil(Driving.distance(nil))
    }

    func testProofCodesAreRequiredOnlyAtHandovers() {
        XCTAssertEqual(Driving.nextStep("assigned")?.next, "picked_up")
        XCTAssertNotNil(Driving.nextStep("assigned")?.codeHint)
        XCTAssertNil(Driving.nextStep("picked_up")?.codeHint)
        XCTAssertNotNil(Driving.nextStep("in_transit")?.codeHint)
        XCTAssertNil(Driving.nextStep("delivered"))
        XCTAssertEqual(Driving.cleanCode("12a3٤45678"), "123456")
    }

    func testServerTimesShowInRiyadhTime() {
        XCTAssertEqual(Driving.localTime("2026-10-31T12:00:00"), "31/10 15:00")
        XCTAssertEqual(Driving.localTime("2026-10-31T12:00:00.123456"), "31/10 15:00")
        XCTAssertEqual(Driving.localTime("2026-10-31T12:00:00Z"), "31/10 15:00")
        XCTAssertEqual(Driving.localTime("2026-10-31T15:00:00+03:00"), "31/10 15:00")
        XCTAssertEqual(Driving.localTime("not a date"), "not a date")
        XCTAssertEqual(Driving.minutesLeft("2026-10-31T13:00:00", now: Driving.instant("2026-10-31T12:00:00")!), 60)
    }

    func testDirectionsPreferCoordinates() {
        let exact = Driving.mapsURL(latitude: 24.7, longitude: 46.6, address: "ا")!.absoluteString
        XCTAssertTrue(exact.hasPrefix("https://maps.apple.com/?daddr=24.7,46.6"), exact)
        XCTAssertEqual(Driving.mapsURL(latitude: nil, longitude: nil, address: "Riyadh Center")?.absoluteString,
                       "https://maps.apple.com/?daddr=Riyadh%20Center")
    }

    func testRequiredDocumentsShowStateAndUploadNeed() {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        XCTAssertEqual(Driving.isoDate(Date(timeIntervalSince1970: 1_803_859_200), calendar: utc), "2027-03-01")
        XCTAssertEqual(Driving.documentState("expiring"), "ينتهي قريبًا")
        XCTAssertTrue(Driving.needsUpload("missing") && Driving.needsUpload("rejected") && Driving.needsUpload("expired"))
        XCTAssertTrue(!Driving.needsUpload("pending") && !Driving.needsUpload("accepted"))
    }

    func testOnlyUnseenOffersAlert() {
        XCTAssertEqual(Driving.newOffers(["a", "b", "c"], seen: ["a", "b"]), ["c"])
        XCTAssertEqual(Driving.newOffers(["a"], seen: ["a"]), [])
    }

    func testPathSegmentsCannotEscape() {
        XCTAssertEqual(DriverAPI.encode("../admin?x=1"), "..%2Fadmin%3Fx%3D1")
        XCTAssertEqual(DriverAPI.encode("abc-123_~."), "abc-123_~.")
    }
}
