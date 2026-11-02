import XCTest
@testable import MinBuyutna

final class EndpointPolicyTests: XCTestCase {
    func testCanonicalOrigin() throws {
        XCTAssertEqual(try EndpointPolicy.normalize(" HTTPS://EXAMPLE.TEST:443/ ", debug: false), "https://example.test")
        XCTAssertEqual(try EndpointPolicy.normalize("http://localhost:3000", debug: true), "http://localhost:3000")
    }

    func testRejectsAmbiguousOrUnsafeEndpoints() {
        for value in ["http://example.test", "https://user:secret@example.test", "https://example.test/path",
                      "https://example.test?token=a", "https://example.test#x", "file:///data/private", "javascript:alert(1)",
                      "http://localhost.evil.test:3000", "http://192.168.1.2:3000", "https://example.test:65536",
                      "https://example.test:0"] {
            XCTAssertThrowsError(try EndpointPolicy.normalize(value, debug: true), value)
        }
        XCTAssertThrowsError(try EndpointPolicy.normalize("http://localhost:3000", debug: false))
    }

    func testSameOriginIncludesSchemeHostAndPort() {
        XCTAssertTrue(EndpointPolicy.sameOrigin("https://example.test", "https://EXAMPLE.TEST:443/account"))
        XCTAssertTrue(EndpointPolicy.sameOrigin("http://localhost:3000", "http://localhost:3000/api/docs?x=1"))
        XCTAssertTrue(EndpointPolicy.sameOrigin("https://example.test", scheme: "https", host: "example.test", port: 0))
        XCTAssertTrue(EndpointPolicy.sameOrigin("https://example.test", scheme: "https", host: "example.test", port: 443))
        XCTAssertFalse(EndpointPolicy.sameOrigin("https://example.test", scheme: "https", host: "evil.test", port: 0))
        for value in ["https://example.test.evil.test", "http://example.test", "https://example.test:444", "https://user@example.test",
                      "blob:https://example.test/a", "content://example.test/a", "javascript:alert(1)"] {
            XCTAssertFalse(EndpointPolicy.sameOrigin("https://example.test", value), value)
        }
        XCTAssertFalse(EndpointPolicy.sameOrigin("https://example.test", nil as String?))
    }

    func testOnlySafeExternalSchemes() {
        XCTAssertTrue(EndpointPolicy.externalAllowed("https://maps.example.test/"))
        XCTAssertTrue(EndpointPolicy.externalAllowed("tel:+966500000000"))
        XCTAssertTrue(EndpointPolicy.externalAllowed("mailto:help@example.test"))
        for value in ["intent://anything", "file:///data/private", "javascript:alert(1)", "http://example.test", "data:text/html,x"] {
            XCTAssertFalse(EndpointPolicy.externalAllowed(value), value)
        }
    }
}
