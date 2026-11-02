import SwiftUI
import UserNotifications

/// Which part of the app is showing: the platform website, or the native driver screens.
@MainActor
final class AppState: ObservableObject {
    static let shared = AppState()

    enum Screen: Equatable {
        case web(path: String, stayWeb: Bool)
        case driver
    }

    @Published var screen: Screen
    /// A driver tab to open, e.g. from a tapped notification.
    @Published var pendingTab: String?

    private init() {
        DriverSession.shared.clearAfterReinstall()
        let origin = Platform.origin()
        screen = DriverSession.shared.token(origin: origin) != nil ? .driver : .web(path: "/", stayWeb: false)
    }

    func openDriver(tab: String? = nil) {
        if let tab { pendingTab = tab }
        screen = .driver
    }

    func openWeb(_ path: String) {
        let known = ["/", "/register", "/forgot-password", "/login"]
        screen = .web(path: known.contains(path) ? path : "/", stayWeb: true)
    }
}

/// Shows offer alerts while the app is open and routes taps to the right driver tab.
final class NotificationRouter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationRouter()

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let tab = response.notification.request.content.userInfo["tab"] as? String ?? "home"
        Task { @MainActor in
            if DriverSession.shared.token(origin: Platform.origin()) != nil { AppState.shared.openDriver(tab: tab) }
            completionHandler()
        }
    }
}
