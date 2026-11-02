import SwiftUI
import UIKit
import WebKit

enum DriverTab: String, CaseIterable, Identifiable {
    case home, offers, trip, history, more
    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "الدوام"
        case .offers: return "العروض"
        case .trip: return "الرحلة"
        case .history: return "السجل"
        case .more: return "المزيد"
        }
    }

    var icon: String {
        switch self {
        case .home: return "house.fill"
        case .offers: return "bell.fill"
        case .trip: return "mappin.and.ellipse"
        case .history: return "calendar"
        case .more: return "line.3.horizontal"
        }
    }
}

/// Native screens for drivers; other roles keep using the platform website.
@MainActor
final class DriverModel: ObservableObject {
    private let session = DriverSession.shared
    private(set) var origin = Platform.origin()

    @Published private(set) var signedIn = false
    @Published private(set) var driverName = ""
    @Published var tab: DriverTab = .home
    @Published private(set) var busy = false
    @Published var message: String?
    @Published private(set) var summary: Summary?
    @Published private(set) var offers: [Offer] = []
    @Published private(set) var trip: Trip?
    @Published private(set) var history: [PastTrip] = []
    @Published private(set) var notices: [Notice] = []
    @Published private(set) var compliance: Compliance?

    init() { reloadSession() }

    private func api() -> DriverAPI {
        let origin = origin
        return DriverAPI(origin: origin) { DriverSession.shared.token(origin: origin) }
    }

    /// Runs a request; `action` marks user actions so buttons stay disabled until they finish.
    private func call(action: Bool = true, _ block: @escaping (DriverAPI) async throws -> Void) {
        Task {
            if action { busy = true }
            defer { if action { busy = false } }
            do {
                try await block(api())
            } catch let error as ApiError {
                if error.status == 401 && signedIn { expire("انتهت الجلسة؛ يلزم تسجيل الدخول من جديد") } else { message = error.message }
            } catch {
                message = error.localizedDescription
            }
        }
    }

    func open(_ next: DriverTab) {
        tab = next
        refresh()
    }

    func reloadSession() {
        origin = Platform.origin()
        signedIn = session.token(origin: origin) != nil
        driverName = session.name
        if !signedIn { ShiftManager.shared.stop() }
    }

    func refresh() {
        guard signedIn else { return }
        call(action: false) { api in try await self.load(api) }
    }

    private func load(_ api: DriverAPI) async throws {
        let current = try await api.summary()
        summary = current
        driverName = current.name
        offers = current.verified && current.available && current.activeTripId == nil ? try await api.offers() : []
        if let id = current.activeTripId { trip = try await api.trip(id) } else { trip = nil }
        switch tab {
        case .history: history = try await api.history()
        case .more:
            notices = try await api.notices()
            compliance = try await api.compliance()
        default: break
        }
        ShiftManager.shared.sync(current)
    }

    func login(email: String, password: String) {
        call { api in
            let token = try await api.login(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            let signed = DriverAPI(origin: self.origin) { token }
            let account = try await signed.me()
            guard account.role == "driver" else {
                try? await signed.logout()
                self.message = "هذا الحساب ليس حساب سائق؛ يُستخدم من المتجر"
                return
            }
            self.session.save(origin: self.origin, token: token, name: account.name)
            self.driverName = account.name
            self.signedIn = true
            self.tab = .home
            try await self.load(self.api())
        }
    }

    func setAvailable(_ on: Bool) {
        call { api in
            try await api.availability(on)
            self.message = on ? "بدأ الدوام؛ ستصل تنبيهات العروض" : "انتهى الدوام"
            try await self.load(api)
        }
    }

    /// Asks for permissions first, the way Android does before starting the shift.
    func startShift() {
        guard let summary else { return }
        guard summary.complete else {
            message = "يلزم إكمال العقد والمستندات المطلوبة أولًا من تبويب «المزيد»"
            return
        }
        Task {
            if await ShiftManager.shared.requestPermissions() {
                setAvailable(true)
            } else {
                message = "يلزم إذن الموقع لبدء الدوام ومشاركة الموقع أثناء التوصيل؛ فعّله من الإعدادات"
            }
        }
    }

    func accept(_ id: String) {
        call { api in
            try await api.accept(id)
            self.tab = .trip
            self.message = "قُبل المشوار؛ التفاصيل في تبويب الرحلة"
            try await self.load(api)
        }
    }

    func reject(_ id: String) {
        call { api in
            try await api.reject(id)
            try await self.load(api)
        }
    }

    func advance(code: String) {
        guard let current = trip, let step = Driving.nextStep(current.status) else { return }
        call { api in
            try await api.advance(current.id, state: step.next, code: code.trimmingCharacters(in: .whitespaces))
            self.message = step.next == "delivered" ? "تم تسليم الطلب، أحسنت" : Driving.status(step.next)
            if step.next == "delivered" { self.tab = .home }
            try await self.load(api)
        }
    }

    func report(_ reason: String) {
        guard let current = trip else { return }
        call { api in
            try await api.issue(current.id, reason: reason.trimmingCharacters(in: .whitespacesAndNewlines))
            self.message = "سُجّل التعثر وأُبلغت الإدارة"
            try await self.load(api)
        }
    }

    func loadHistory() { call(action: false) { api in self.history = try await api.history() } }

    func loadMore() {
        call(action: false) { api in
            self.notices = try await api.notices()
            self.compliance = try await api.compliance()
        }
    }

    func sign(fullName: String) {
        guard let contract = compliance?.contract else { return }
        call { api in
            try await api.acceptContract(contract.id, fullName: fullName.trimmingCharacters(in: .whitespacesAndNewlines))
            self.message = "تم توقيع العقد"
            self.compliance = try await api.compliance()
            try await self.load(api)
        }
    }

    func markRead() {
        call { api in
            try await api.markRead()
            self.notices = try await api.notices()
        }
    }

    /// Re-encodes the picked photo as JPEG: drops HEIC and the photo's location metadata before upload.
    func upload(imageData: Data, requirement: Requirement, expiresOn: String?) {
        call { api in
            guard let jpeg = Self.documentJPEG(imageData) else { throw ApiError(status: 0, message: "اختر صورة واضحة للمستند") }
            if jpeg.count > 5 * 1024 * 1024 { throw ApiError(status: 0, message: "حجم الصورة يتجاوز 5 ميجابايت") }
            try await api.uploadRequirement(requirement.id, expiresOn: expiresOn,
                                            file: DriverAPI.Upload(name: "document.jpg", mime: "image/jpeg", bytes: jpeg))
            self.message = "رُفع «" + requirement.title + "» للمراجعة"
            self.compliance = try await api.compliance()
        }
    }

    nonisolated static func documentJPEG(_ data: Data) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        let longest = max(image.size.width, image.size.height)
        let scale = longest > 2560 ? 2560 / longest : 1
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        for quality in [0.85, 0.7, 0.5] as [CGFloat] {
            if let jpeg = resized.jpegData(compressionQuality: quality), jpeg.count <= 5 * 1024 * 1024 { return jpeg }
        }
        return resized.jpegData(compressionQuality: 0.4)
    }

    func logout() {
        Task {
            busy = true
            let api = api()
            if let current = summary, current.available, current.activeTripId == nil { try? await api.availability(false) }
            try? await api.logout()
            busy = false
            expire(nil)
        }
    }

    private func expire(_ text: String?) {
        session.clear()
        ShiftManager.shared.stop()
        // The website shares the cookie store; clearing it keeps both screens signed out.
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
            for cookie in cookies { WKWebsiteDataStore.default().httpCookieStore.delete(cookie) }
        }
        signedIn = false
        summary = nil
        offers = []
        trip = nil
        history = []
        notices = []
        compliance = nil
        tab = .home
        message = text
    }
}

/// Entry points for the website screen.
enum DriverLaunch {
    /// Returns [role, name] for a valid session, or nil.
    static func account(origin: String, token: String) async -> Account? {
        try? await DriverAPI(origin: origin) { token }.me()
    }
}
