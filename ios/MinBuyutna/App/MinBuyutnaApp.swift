import SwiftUI
import UserNotifications

@main
struct MinBuyutnaApp: App {
    @StateObject private var state = AppState.shared

    init() {
        UNUserNotificationCenter.current().delegate = NotificationRouter.shared
        Theme.install()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                switch state.screen {
                case .driver:
                    DriverRootView()
                case let .web(path, stayWeb):
                    WebRootView(path: path, stayWeb: stayWeb)
                        .id(path + String(stayWeb))
                }
            }
            .environmentObject(state)
            // The interface is Arabic even on devices set to another language.
            .environment(\.layoutDirection, .rightToLeft)
            .environment(\.locale, Locale(identifier: "ar"))
            .tint(Theme.plum)
        }
    }
}
