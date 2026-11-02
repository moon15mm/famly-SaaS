import Foundation

/// The platform origin the app talks to. Store builds are locked to the origin they were built for.
enum Platform {
    static let fallback = "https://buyutna.wardat.xyz"

    #if DEBUG
    static let debug = true
    /// Only development builds let the user point the app at another host («رابط المنصة»).
    static let customOrigin = true
    #else
    static let debug = false
    static let customOrigin = false
    #endif

    static var builtIn: String {
        (Bundle.main.object(forInfoDictionaryKey: "PlatformURL") as? String).flatMap { $0.isEmpty ? nil : $0 } ?? fallback
    }

    static func origin() -> String {
        if customOrigin, let saved = UserDefaults.standard.string(forKey: "origin"),
           let origin = try? EndpointPolicy.normalize(saved, debug: debug) {
            return origin
        }
        return (try? EndpointPolicy.normalize(builtIn, debug: debug)) ?? fallback
    }

    static func save(origin: String) {
        guard customOrigin else { return }
        UserDefaults.standard.set(origin, forKey: "origin")
    }

    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    }

    static func host(_ origin: String) -> String { URLComponents(string: origin)?.host ?? origin }
}
