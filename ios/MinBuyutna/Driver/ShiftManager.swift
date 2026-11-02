import CoreLocation
import UserNotifications

/// Runs while the driver is available or on a trip: shares the location and alerts on new offers.
/// The iOS counterpart of Android's ShiftService. Background location (with the system's blue location
/// indicator) keeps the app running during the shift; without push accounts the alerts come from polling.
@MainActor
final class ShiftManager: NSObject, ObservableObject {
    static let shared = ShiftManager()

    @Published private(set) var running = false
    @Published private(set) var authorization: CLAuthorizationStatus

    private let manager = CLLocationManager()
    private var poller: Task<Void, Never>?
    private var latest: CLLocation?
    private var sentAt = Date.distantPast
    private var onTrip = false
    private var seen = Set<String>()
    private var waiters: [CheckedContinuation<Void, Never>] = []

    private override init() {
        authorization = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 15
        manager.activityType = .automotiveNavigation
        manager.pausesLocationUpdatesAutomatically = false
    }

    var hasLocation: Bool { authorization == .authorizedWhenInUse || authorization == .authorizedAlways }

    var locationDenied: Bool { authorization == .denied || authorization == .restricted }

    /// Asks for location (while using the app) and notifications; returns whether location is allowed.
    func requestPermissions() async -> Bool {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        if authorization == .notDetermined {
            await withCheckedContinuation { continuation in
                waiters.append(continuation)
                manager.requestWhenInUseAuthorization()
            }
        }
        return hasLocation
    }

    func start() {
        guard hasLocation else { return }
        if !running {
            manager.allowsBackgroundLocationUpdates = true
            manager.showsBackgroundLocationIndicator = true
            manager.startUpdatingLocation()
            running = true
        }
        if poller == nil { poller = Task { await poll() } }
    }

    func stop() {
        poller?.cancel()
        poller = nil
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        running = false
        latest = nil
        seen.removeAll()
    }

    /// Keeps the shift in step with the server, e.g. after availability changed on the website.
    func sync(_ summary: Summary) {
        if summary.available || summary.activeTripId != nil {
            start()
        } else {
            stop()
        }
    }

    private func api() -> DriverAPI? {
        let origin = Platform.origin()
        guard DriverSession.shared.token(origin: origin) != nil else { return nil }
        return DriverAPI(origin: origin) { DriverSession.shared.token(origin: origin) }
    }

    /// Sends the newest point at most every 8 s on a trip and every 25 s while waiting for offers.
    private func share() async {
        guard let location = latest, let api = api() else { return }
        let now = Date()
        if now.timeIntervalSince(sentAt) < (onTrip ? 8 : 25) { return }
        sentAt = now
        // A 409 means the shift ended elsewhere; the next poll stops the shift.
        try? await api.location(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude,
                                accuracy: location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil)
    }

    private func poll() async {
        while !Task.isCancelled {
            guard let api = api() else {
                finish("انتهت جلسة السائق؛ يلزم تسجيل الدخول من التطبيق")
                return
            }
            do {
                let summary = try await api.summary()
                onTrip = summary.activeTripId != nil
                if !summary.available && !onTrip {
                    finish(nil)
                    return
                }
                if summary.available && !onTrip && summary.verified { announce(try await api.offers()) }
                await share()
            } catch let error as ApiError where error.status == 401 {
                DriverSession.shared.clear()
                finish("انتهت جلسة السائق؛ يلزم تسجيل الدخول من التطبيق")
                return
            } catch {
                // Offline for now; try again on the next round.
            }
            try? await Task.sleep(nanoseconds: 15_000_000_000)
        }
    }

    private func announce(_ offers: [Offer]) {
        let ids = offers.map(\.id)
        let fresh = Set(Driving.newOffers(ids, seen: seen))
        seen.formIntersection(ids)
        seen.formUnion(ids)
        for offer in offers.filter({ fresh.contains($0.id) }).prefix(3) {
            let details = [offer.city, Driving.distance(offer.distanceKm).map { "يبعد \($0)" }, "الموعد " + Driving.localTime(offer.scheduledAt)]
                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " • ")
            Self.notify(id: "offer-" + offer.id, title: "عرض مشوار جديد • " + Driving.money(offer.fee), body: details, tab: "offers", urgent: true)
        }
    }

    private func finish(_ message: String?) {
        if let message { Self.notify(id: "shift-ended", title: "انتهى الدوام", body: message, tab: "home", urgent: false) }
        stop()
    }

    static func notify(id: String, title: String, body: String, tab: String, urgent: Bool) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = ["tab": tab]
        if urgent { content.interruptionLevel = .timeSensitive }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }
}

extension ShiftManager: CLLocationManagerDelegate {
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        Task { @MainActor in
            self.latest = location
            await self.share()
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            self.authorization = status
            let waiting = self.waiters
            self.waiters.removeAll()
            waiting.forEach { $0.resume() }
            if !self.hasLocation && self.running { self.stop() }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Temporary location failures keep the shift running; the next fix is shared as usual.
    }
}
