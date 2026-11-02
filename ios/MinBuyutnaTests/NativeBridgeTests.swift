import XCTest
@testable import MinBuyutna

final class NativeBridgeTests: XCTestCase {
    private func message(_ json: [String: Any]) -> String {
        String(data: try! JSONSerialization.data(withJSONObject: json), encoding: .utf8)!
    }

    func testTransferAssemblesDeclaredBytes() throws {
        var transfer: NativeBridge.Transfer?
        _ = try NativeBridge.receive(message(["type": "start", "id": "1", "name": "../x/report.csv", "mime": "text/csv; charset=utf-8", "size": 4]), transfer: &transfer)
        XCTAssertEqual(transfer?.name, "_x_report.csv")
        _ = try NativeBridge.receive(message(["type": "chunk", "id": "1", "data": Data("ab".utf8).base64EncodedString()]), transfer: &transfer)
        _ = try NativeBridge.receive(message(["type": "chunk", "id": "1", "data": Data("cd".utf8).base64EncodedString()]), transfer: &transfer)
        guard case let .finished(data, name, mime) = try NativeBridge.receive(message(["type": "finish", "id": "1"]), transfer: &transfer) else {
            return XCTFail("transfer did not finish")
        }
        XCTAssertEqual(String(data: data, encoding: .utf8), "abcd")
        XCTAssertEqual(name, "_x_report.csv")
        XCTAssertEqual(mime, "text/csv")
        XCTAssertNil(transfer)
    }

    func testRejectsOversizedUnknownOrOverflowingTransfers() {
        var transfer: NativeBridge.Transfer?
        XCTAssertThrowsError(try NativeBridge.receive(message(["type": "start", "id": "1", "name": "a", "mime": "text/csv", "size": 11 * 1024 * 1024]), transfer: &transfer))
        XCTAssertThrowsError(try NativeBridge.receive(message(["type": "start", "id": "1", "name": "a", "mime": "text/html", "size": 3]), transfer: &transfer))
        XCTAssertNoThrow(try NativeBridge.receive(message(["type": "start", "id": "1", "name": "a", "mime": "text/plain", "size": 1]), transfer: &transfer))
        XCTAssertThrowsError(try NativeBridge.receive(message(["type": "chunk", "id": "1", "data": Data("ab".utf8).base64EncodedString()]), transfer: &transfer))
        XCTAssertThrowsError(try NativeBridge.receive(String(repeating: "x", count: 100_001), transfer: &transfer))
    }

    func testOtherTransferIdsAreIgnored() throws {
        var transfer: NativeBridge.Transfer?
        _ = try NativeBridge.receive(message(["type": "start", "id": "1", "name": "a", "mime": "text/plain", "size": 1]), transfer: &transfer)
        guard case .ignored = try NativeBridge.receive(message(["type": "finish", "id": "2"]), transfer: &transfer) else { return XCTFail() }
        XCTAssertNotNil(transfer)
    }
}
