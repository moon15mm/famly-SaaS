import Foundation
import Security

/// The driver's session token in the Keychain, bound to one platform origin and to this device only.
final class DriverSession {
    static let shared = DriverSession()

    private struct Stored: Codable {
        let origin: String
        let token: String
        let name: String
    }

    private let service = "sa.minbuyutna.driver-session"
    private let account = "driver"

    func token(origin: String) -> String? {
        guard let stored = load(), stored.origin == origin else { return nil }
        return stored.token
    }

    var name: String { load()?.name ?? "" }

    func save(origin: String, token: String, name: String) {
        guard let data = try? JSONEncoder().encode(Stored(origin: origin, token: token, name: name)) else { return }
        clear()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            // Readable after the first unlock so the shift keeps sharing the location with the screen locked.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data,
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }

    /// Keychain items survive deleting the app; a fresh install must not inherit an old session.
    func clearAfterReinstall() {
        let key = "installed"
        if !UserDefaults.standard.bool(forKey: key) {
            clear()
            UserDefaults.standard.set(true, forKey: key)
        }
    }

    private func load() -> Stored? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(Stored.self, from: data)
    }
}
