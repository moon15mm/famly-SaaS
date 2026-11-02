import Foundation

/// An explicit platform origin; trust is never inferred from a URL prefix. Mirrors the Android EndpointPolicy.
enum EndpointPolicy {
    struct InvalidOrigin: LocalizedError {
        var errorDescription: String? { "أدخل رابط HTTPS للمنصة، أو localhost للنسخة المحلية فقط" }
    }

    static func normalize(_ value: String, debug: Bool) throws -> String {
        guard let parts = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)) else { throw InvalidOrigin() }
        let scheme = (parts.scheme ?? "").lowercased()
        let host = (parts.host ?? "").lowercased()
        let path = parts.percentEncodedPath
        if host.isEmpty || parts.user != nil || parts.password != nil || parts.query != nil || parts.fragment != nil
            || !(path.isEmpty || path == "/") {
            throw InvalidOrigin()
        }
        if let port = parts.port, port <= 0 || port > 65535 { throw InvalidOrigin() }
        let local = host == "localhost" || host == "127.0.0.1"
        guard scheme == "https" || (debug && scheme == "http" && local) else { throw InvalidOrigin() }
        var port = parts.port
        if (scheme == "https" && port == 443) || (scheme == "http" && port == 80) { port = nil }
        var origin = URLComponents()
        origin.scheme = scheme
        origin.host = host
        origin.port = port
        guard let text = origin.string else { throw InvalidOrigin() }
        return text
    }

    static func sameOrigin(_ base: String, _ value: String?) -> Bool {
        guard let value, let parts = URLComponents(string: value), parts.user == nil, parts.password == nil,
              let scheme = parts.scheme, let host = parts.host else { return false }
        var origin = URLComponents()
        origin.scheme = scheme
        origin.host = host
        origin.port = parts.port
        guard let text = origin.string,
              let left = try? normalize(text, debug: true),
              let right = try? normalize(base, debug: true) else { return false }
        return left == right
    }

    static func sameOrigin(_ base: String, _ url: URL?) -> Bool { sameOrigin(base, url?.absoluteString) }

    /// Matches a WebKit security origin (from a script message or frame) against the platform origin.
    static func sameOrigin(_ base: String, scheme: String, host: String, port: Int) -> Bool {
        var origin = URLComponents()
        origin.scheme = scheme
        origin.host = host
        origin.port = port == 0 ? nil : port
        return sameOrigin(base, origin.string)
    }

    static func externalAllowed(_ value: String) -> Bool {
        guard let scheme = URLComponents(string: value)?.scheme?.lowercased() else { return false }
        return ["https", "tel", "mailto"].contains(scheme)
    }
}
