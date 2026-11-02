import Foundation

/// Pure helpers for the driver screens, free of UIKit so they run in unit tests. Mirrors Android's Driving.kt.
enum Driving {
    /// The next trip transition, with the proof code it needs (nil when none).
    struct Step: Equatable {
        let next: String
        let label: String
        let codeHint: String?
    }

    private static let statuses: [String: String] = [
        "ready": "جاهز للاستلام",
        "assigned": "في الطريق إلى الأسرة",
        "picked_up": "استُلم من الأسرة",
        "in_transit": "في الطريق إلى العميل",
        "delivered": "تم التسليم",
        "completed": "مكتمل",
        "cancelled": "ملغي",
    ]

    static func status(_ value: String) -> String { statuses[value] ?? value }

    static func nextStep(_ status: String) -> Step? {
        switch status {
        case "assigned": return Step(next: "picked_up", label: "تأكيد الاستلام من الأسرة", codeHint: "رمز الاستلام من الأسرة")
        case "picked_up": return Step(next: "in_transit", label: "بدء التوصيل إلى العميل", codeHint: nil)
        case "in_transit": return Step(next: "delivered", label: "تأكيد التسليم للعميل", codeHint: "رمز التسليم من العميل")
        default: return nil
        }
    }

    /// The session value from a Cookie header ("a=b; session=x") or a Set-Cookie header ("session=x; Path=/").
    static func sessionCookie(_ header: String?) -> String? {
        guard let header else { return nil }
        for part in header.split(separator: ";") {
            let item = part.trimmingCharacters(in: .whitespaces)
            if item.hasPrefix("session=") {
                let value = String(item.dropFirst("session=".count))
                return value.isEmpty ? nil : value
            }
        }
        return nil
    }

    /// Amounts arrive in halalas.
    static func money(_ halalas: Int) -> String {
        let riyals = halalas / 100
        let rest = halalas % 100
        return rest == 0 ? "\(riyals) ر.س" : String(format: "%d.%02d ر.س", locale: Locale(identifier: "en_US_POSIX"), riyals, rest)
    }

    static func distance(_ km: Double?) -> String? {
        guard let km else { return nil }
        if km < 1 { return "\(Int((km * 100).rounded()) * 10) م" }
        return String(format: "%.1f كم", locale: Locale(identifier: "en_US_POSIX"), km)
    }

    private static let iso: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    /// Server times are naive UTC ("2026-10-31T12:00:00", optionally with fractions); offsets are accepted too.
    static func instant(_ value: String) -> Date? {
        var text = value.trimmingCharacters(in: .whitespaces)
        var zone = "Z"
        if text.hasSuffix("Z") || text.hasSuffix("z") {
            text.removeLast()
        } else if let range = text.range(of: "[+-]\\d{2}:?\\d{2}$", options: .regularExpression),
                  let time = text.firstIndex(of: "T"), range.lowerBound > time {
            var offset = String(text[range])
            if !offset.contains(":") { offset.insert(":", at: offset.index(offset.startIndex, offsetBy: 3)) }
            zone = offset
            text.removeSubrange(range)
        }
        if let dot = text.firstIndex(of: ".") { text = String(text[..<dot]) }
        return iso.date(from: text + zone)
    }

    private static let shortTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Riyadh")
        formatter.dateFormat = "d/M HH:mm"
        return formatter
    }()

    static func localTime(_ value: String) -> String { instant(value).map { shortTime.string(from: $0) } ?? value }

    static func minutesLeft(_ value: String, now: Date) -> Int? {
        instant(value).map { Int($0.timeIntervalSince(now) / 60) }
    }

    /// Directions in Apple Maps, preferring exact coordinates.
    static func mapsURL(latitude: Double?, longitude: Double?, address: String) -> URL? {
        var parts = URLComponents(string: "https://maps.apple.com/")!
        if let latitude, let longitude {
            parts.queryItems = [
                URLQueryItem(name: "daddr", value: "\(latitude),\(longitude)"),
                URLQueryItem(name: "q", value: address.isEmpty ? "الوجهة" : address),
            ]
        } else {
            parts.queryItems = [URLQueryItem(name: "daddr", value: address)]
        }
        return parts.url
    }

    static func newOffers(_ current: [String], seen: Set<String>) -> [String] { current.filter { !seen.contains($0) } }

    /// The calendar date picked in a SwiftUI DatePicker, as an ISO date in the device calendar day.
    static func isoDate(_ date: Date, calendar: Calendar = .current) -> String {
        let day = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", locale: Locale(identifier: "en_US_POSIX"), day.year ?? 0, day.month ?? 0, day.day ?? 0)
    }

    private static let documentStates: [String: String] = [
        "missing": "لم يُرفع",
        "pending": "بانتظار المراجعة",
        "rejected": "مرفوض",
        "expired": "منتهي",
        "expiring": "ينتهي قريبًا",
        "accepted": "مقبول",
    ]

    static func documentState(_ value: String) -> String { documentStates[value] ?? value }

    /// Documents still needing an upload: anything not under review and not currently valid.
    static func needsUpload(_ state: String) -> Bool { state != "pending" && state != "accepted" }

    /// Six-digit proof codes only.
    static func cleanCode(_ value: String) -> String { String(value.filter(\.isASCII).filter(\.isNumber).prefix(6)) }
}
