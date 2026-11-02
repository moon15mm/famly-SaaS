import Foundation

struct ApiError: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }

    static let offline = ApiError(status: 0, message: "تعذر الاتصال بالمنصة؛ تحقق من الإنترنت")
}

struct Account { let role: String; let name: String }

struct Summary {
    let name: String
    let verified: Bool
    let available: Bool
    let activeTripId: String?
    let activeTripStatus: String?
    let deliveredTrips: Int
    let declaredFees: Int
    let complete: Bool
    let missing: [String]
}

struct Offer: Identifiable { let id: String; let city: String; let scheduledAt: String; let fee: Int; let expiresAt: String; let distanceKm: Double? }

struct TripItem: Hashable { let name: String; let quantity: Int; let option: String }

struct Trip {
    let id: String
    let status: String
    let fee: Int
    let scheduledAt: String
    let householdName: String
    let pickupAddress: String
    let pickupLatitude: Double?
    let pickupLongitude: Double?
    let address: String
    let latitude: Double?
    let longitude: Double?
    let items: [TripItem]
}

struct PastTrip: Identifiable { let id: String; let household: String; let status: String; let fee: Int; let scheduledAt: String }

struct Notice: Hashable { let message: String; let read: Bool; let createdAt: String }

struct ContractInfo { let id: String; let version: Int; let title: String; let body: String; let accepted: Bool; let acceptedAt: String }

struct Requirement: Identifiable {
    let id: String
    let title: String
    let description: String
    let required: Bool
    let needsExpiry: Bool
    let state: String
    let expiresOn: String
    let note: String
}

struct Compliance { let complete: Bool; let missing: [String]; let contract: ContractInfo?; let documents: [Requirement] }

private typealias JSON = [String: Any]

private extension Dictionary where Key == String, Value == Any {
    func text(_ name: String) -> String {
        switch self[name] {
        case let value as String: return value
        case let value as NSNumber: return value.stringValue
        default: return ""
        }
    }
    func int(_ name: String) -> Int { (self[name] as? NSNumber)?.intValue ?? 0 }
    func bool(_ name: String, _ fallback: Bool = false) -> Bool { (self[name] as? Bool) ?? fallback }
    func decimal(_ name: String) -> Double? { (self[name] as? NSNumber)?.doubleValue }
    func object(_ name: String) -> JSON? { self[name] as? JSON }
    func objects(_ name: String) -> [JSON] { self[name] as? [JSON] ?? [] }
    func texts(_ name: String) -> [String] { self[name] as? [String] ?? [] }
}

/// Refuses every redirect: the API answers directly, and a redirect must never carry the session elsewhere.
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// The platform API with the driver's session cookie; the same origin and CSRF rules as the website.
final class DriverAPI {
    struct Upload { let name: String; let mime: String; let bytes: Data }
    struct Reply { let data: Data; let response: HTTPURLResponse }

    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 60
        configuration.tlsMinimumSupportedProtocolVersion = .TLSv12
        return URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }()

    let origin: String
    private let token: () -> String?

    init(origin: String, token: @escaping () -> String?) {
        self.origin = origin
        self.token = token
    }

    static func encode(_ value: String) -> String {
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    }

    /// Path segments from the server are encoded so they cannot change the request path.
    private static func segment(_ value: String) -> String { encode(value) }

    private func send(_ method: String, _ path: String, json: JSON? = nil, upload: Upload? = nil) async throws -> Reply {
        guard let url = URL(string: origin + "/api" + path), EndpointPolicy.sameOrigin(origin, url) else { throw ApiError.offline }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        // The API accepts state changes only from its own origin, as it does for the website.
        request.setValue(origin, forHTTPHeaderField: "Origin")
        request.setValue("MinBuyutnaDriverIOS/" + Platform.version, forHTTPHeaderField: "User-Agent")
        if let token = token() { request.setValue("session=" + token, forHTTPHeaderField: "Cookie") }
        if let upload {
            let boundary = "MinBuyutna" + UUID().uuidString
            request.setValue("multipart/form-data; boundary=" + boundary, forHTTPHeaderField: "Content-Type")
            var body = Data()
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(upload.name)\"\r\nContent-Type: \(upload.mime)\r\n\r\n".utf8))
            body.append(upload.bytes)
            body.append(Data("\r\n--\(boundary)--\r\n".utf8))
            request.httpBody = body
        } else if let json {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: json)
        } else if method == "POST" {
            request.httpBody = Data()
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await Self.session.data(for: request)
        } catch {
            throw ApiError.offline
        }
        guard let http = response as? HTTPURLResponse else { throw ApiError.offline }
        if !(200..<300).contains(http.statusCode) { throw ApiError(status: http.statusCode, message: Self.detail(data, http.statusCode)) }
        return Reply(data: data, response: http)
    }

    private static func detail(_ data: Data, _ status: Int) -> String {
        if let json = try? JSONSerialization.jsonObject(with: data) as? JSON, let detail = json["detail"] as? String, !detail.isEmpty {
            return detail
        }
        switch status {
        case 401: return "انتهت الجلسة؛ يلزم تسجيل الدخول من جديد"
        case 429: return "طلبات كثيرة؛ حاول بعد قليل"
        case 500...: return "تعذر إكمال الطلب لدى الخادم؛ حاول لاحقًا"
        default: return "تحقق من البيانات وحاول مجددًا"
        }
    }

    private func object(_ path: String) async throws -> JSON {
        let reply = try await send("GET", path)
        guard let json = try? JSONSerialization.jsonObject(with: reply.data) as? JSON else { throw ApiError(status: 0, message: "استجابة غير متوقعة من المنصة") }
        return json
    }

    private func list(_ path: String) async throws -> [JSON] {
        let reply = try await send("GET", path)
        guard let json = try? JSONSerialization.jsonObject(with: reply.data) as? [JSON] else { throw ApiError(status: 0, message: "استجابة غير متوقعة من المنصة") }
        return json
    }

    @discardableResult
    private func post(_ path: String, _ json: JSON? = nil) async throws -> Reply { try await send("POST", path, json: json) }

    /// Signs in and returns the new session token from the response cookie.
    func login(email: String, password: String) async throws -> String {
        let reply = try await post("/auth/login", ["email": email, "password": password])
        let headers = reply.response.allHeaderFields.reduce(into: [String: String]()) { result, item in
            if let key = item.key as? String, let value = item.value as? String { result[key] = value }
        }
        guard let url = reply.response.url,
              let token = HTTPCookie.cookies(withResponseHeaderFields: headers, for: url).first(where: { $0.name == "session" })?.value,
              !token.isEmpty else {
            throw ApiError(status: 0, message: "لم تُنشأ جلسة؛ حاول مجددًا")
        }
        return token
    }

    func me() async throws -> Account {
        let json = try await object("/auth/me")
        return Account(role: json.text("role"), name: json.text("name"))
    }

    func logout() async throws { try await post("/auth/logout") }

    func summary() async throws -> Summary {
        let json = try await object("/driver/summary")
        let trip = json.object("active_trip")
        let compliance = json.object("compliance")
        return Summary(
            name: json.text("name"),
            verified: json.bool("driver_verified"),
            available: json.bool("available"),
            activeTripId: trip?.text("id"),
            activeTripStatus: trip?.text("status"),
            deliveredTrips: json.int("delivered_trips"),
            declaredFees: json.int("declared_fees"),
            complete: compliance?.bool("complete", true) ?? true,
            missing: compliance?.texts("missing") ?? []
        )
    }

    func availability(_ on: Bool) async throws { try await post("/driver/availability?available=\(on)") }

    func offers() async throws -> [Offer] {
        try await list("/driver/offers").map {
            Offer(id: $0.text("id"), city: $0.text("city"), scheduledAt: $0.text("scheduled_at"), fee: $0.int("fee"),
                  expiresAt: $0.text("expires_at"), distanceKm: $0.decimal("distance_km"))
        }
    }

    func accept(_ id: String) async throws { try await post("/driver/offers/\(Self.segment(id))/accept") }

    func reject(_ id: String) async throws { try await post("/driver/offers/\(Self.segment(id))/reject") }

    func trip(_ id: String) async throws -> Trip {
        let json = try await object("/driver/trips/\(Self.segment(id))")
        return Trip(
            id: json.text("id"),
            status: json.text("status"),
            fee: json.int("fee"),
            scheduledAt: json.text("scheduled_at"),
            householdName: json.text("household_name"),
            pickupAddress: json.text("pickup_address"),
            pickupLatitude: json.decimal("pickup_latitude"),
            pickupLongitude: json.decimal("pickup_longitude"),
            address: json.text("address"),
            latitude: json.decimal("latitude"),
            longitude: json.decimal("longitude"),
            items: json.objects("items").map { TripItem(name: $0.text("name"), quantity: $0.int("quantity"), option: $0.text("option_label")) }
        )
    }

    func advance(_ id: String, state: String, code: String) async throws {
        try await post("/driver/trips/\(Self.segment(id))/transition?state=\(Self.encode(state))&code=\(Self.encode(code))")
    }

    func issue(_ id: String, reason: String) async throws { try await post("/driver/trips/\(Self.segment(id))/issue", ["reason": reason]) }

    func location(latitude: Double, longitude: Double, accuracy: Double?) async throws {
        var json: JSON = ["latitude": latitude, "longitude": longitude]
        if let accuracy, accuracy >= 0 { json["accuracy"] = accuracy }
        try await post("/driver/location", json)
    }

    func history() async throws -> [PastTrip] {
        try await list("/orders").map {
            PastTrip(id: $0.text("id"), household: $0.text("household_name"), status: $0.text("status"),
                     fee: $0.int("delivery_fee"), scheduledAt: $0.text("scheduled_at"))
        }
    }

    func notices() async throws -> [Notice] {
        try await list("/notifications").map { Notice(message: $0.text("message"), read: $0.bool("read"), createdAt: $0.text("created_at")) }
    }

    func markRead() async throws { try await post("/notifications/read") }

    func compliance() async throws -> Compliance {
        let json = try await object("/compliance")
        let contract = json.object("contract").map {
            ContractInfo(id: $0.text("id"), version: $0.int("version"), title: $0.text("title"), body: $0.text("body"),
                         accepted: $0.bool("accepted"), acceptedAt: $0.text("accepted_at"))
        }
        return Compliance(
            complete: json.bool("complete"),
            missing: json.texts("missing"),
            contract: contract,
            documents: json.objects("documents").map {
                Requirement(id: $0.text("id"), title: $0.text("title"), description: $0.text("description"),
                            required: $0.bool("required"), needsExpiry: $0.bool("needs_expiry"), state: $0.text("state"),
                            expiresOn: $0.text("expires_on"), note: $0.text("note"))
            }
        )
    }

    func acceptContract(_ contractId: String, fullName: String) async throws {
        try await post("/compliance/contract", ["contract_id": contractId, "full_name": fullName, "agree": true])
    }

    /// Uploads a required document; `expiresOn` is an ISO date for documents that expire.
    func uploadRequirement(_ requirementId: String, expiresOn: String?, file: Upload) async throws {
        var query = "requirement_id=" + Self.encode(requirementId)
        if let expiresOn { query += "&expires_on=" + Self.encode(expiresOn) }
        _ = try await send("POST", "/verification/documents?" + query, upload: file)
    }
}
