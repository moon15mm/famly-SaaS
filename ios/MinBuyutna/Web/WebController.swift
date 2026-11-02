import SwiftUI
import UIKit
import WebKit

/// Keeps WebKit from retaining the controller through the user content controller.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

/// The platform website for customers, families and admins. The iOS counterpart of Android's MainActivity:
/// same-origin navigation only, other links open outside, no TLS bypass, downloads saved with the user's consent.
@MainActor
final class WebController: NSObject, ObservableObject {
    @Published private(set) var progress: Double = 0
    @Published private(set) var loading = false
    @Published private(set) var offline = false
    @Published private(set) var canGoBack = false
    @Published var message: String?
    @Published private(set) var origin: String

    let webView: WKWebView
    private var transfer: NativeBridge.Transfer?
    private var downloadBusy = false
    private var checkedSession = ""
    private var observers: [NSKeyValueObservation] = []
    private var exportFolder: URL?
    private var downloadFiles: [ObjectIdentifier: (url: URL, mime: String)] = [:]

    init(path: String, stayWeb: Bool) {
        origin = Platform.origin()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = "MinBuyutnaIOS/" + Platform.version
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.allowsInlineMediaPlayback = true
        configuration.dataDetectorTypes = []
        if #available(iOS 14.0, *) { configuration.defaultWebpagePreferences.allowsContentJavaScript = true }
        configuration.preferences.isFraudulentWebsiteWarningEnabled = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        let scripts = configuration.userContentController
        scripts.addUserScript(WKUserScript(source: NativeBridge.script, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        scripts.add(WeakHandler(self), contentWorld: .page, name: NativeBridge.handler)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = Theme.paperUI
        webView.scrollView.backgroundColor = Theme.paperUI
        if #available(iOS 16.4, *) { webView.isInspectable = Platform.debug }
        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(pulled(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh
        observers = [
            webView.observe(\.estimatedProgress, options: [.new]) { [weak self] view, _ in
                Task { @MainActor in self?.progress = view.estimatedProgress }
            },
            webView.observe(\.canGoBack, options: [.new]) { [weak self] view, _ in
                Task { @MainActor in self?.canGoBack = view.canGoBack }
            },
        ]
        Task {
            // Opened on purpose from the driver screens: only a new sign-in should switch back.
            if stayWeb, let current = await sessionCookie() { checkedSession = current }
            load(path)
        }
    }

    // MARK: Actions

    func load(_ path: String) {
        guard let url = URL(string: origin + path) else { return }
        webView.load(URLRequest(url: url))
    }

    func home() { load("/") }

    func reload() {
        if offline || webView.url == nil { home() } else { webView.reload() }
    }

    func goBack() { if webView.canGoBack { webView.goBack() } }

    @objc private func pulled(_ control: UIRefreshControl) {
        reload()
        control.endRefreshing()
    }

    /// Development builds only: point the app at another platform host.
    func change(origin value: String) throws {
        guard Platform.customOrigin else { return }
        let next = try EndpointPolicy.normalize(value, debug: Platform.debug)
        if downloadBusy { message = "أكمل حفظ الملف أولًا"; return }
        webView.stopLoading()
        WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.origin = next
                Platform.save(origin: next)
                DriverSession.shared.clear()
                self.checkedSession = ""
                self.home()
            }
        }
    }

    func printPage() {
        guard EndpointPolicy.sameOrigin(origin, webView.url) else { return }
        let printer = UIPrintInteractionController.shared
        let info = UIPrintInfo.printInfo()
        info.jobName = "من بيوتنا"
        info.outputType = .general
        printer.printInfo = info
        printer.printFormatter = webView.viewPrintFormatter()
        if UIDevice.current.userInterfaceIdiom == .pad {
            printer.present(from: CGRect(x: webView.bounds.midX, y: webView.bounds.minY + 40, width: 1, height: 1), in: webView, animated: true)
        } else {
            printer.present(animated: true)
        }
    }

    private func openExternal(_ url: URL) {
        guard EndpointPolicy.externalAllowed(url.absoluteString) else {
            message = "هذا النوع من الروابط غير مدعوم"
            return
        }
        UIApplication.shared.open(url) { [weak self] opened in
            if !opened { Task { @MainActor in self?.message = "لا يوجد تطبيق مناسب لفتح الرابط" } }
        }
    }

    // MARK: Driver hand-off

    private func sessionCookie() async -> String? {
        let host = Platform.host(origin)
        let cookies = await withCheckedContinuation { continuation in
            WKWebsiteDataStore.default().httpCookieStore.getAllCookies { continuation.resume(returning: $0) }
        }
        return cookies.first { cookie in
            let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
            return cookie.name == "session" && domain.caseInsensitiveCompare(host) == .orderedSame && !cookie.value.isEmpty
        }?.value
    }

    /// After a sign-in on the website, a driver account moves to the native driver screens.
    private func detectDriver() {
        let base = origin
        Task {
            guard let token = await sessionCookie(), token != checkedSession else { return }
            checkedSession = token
            guard let account = await DriverLaunch.account(origin: base, token: token), account.role == "driver", base == origin else { return }
            DriverSession.shared.save(origin: base, token: token, name: account.name)
            AppState.shared.openDriver(tab: "home")
        }
    }

    // MARK: Saving files

    private func presentExport(_ data: Data, name: String) {
        do {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("exports", isDirectory: true)
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let file = folder.appendingPathComponent(NativeBridge.safeName(name))
            try data.write(to: file, options: [.atomic, .completeFileProtection])
            presentExport(file: file, folder: folder)
        } catch {
            downloadBusy = false
            message = "تعذر حفظ الملف"
        }
    }

    private func presentExport(file: URL, folder: URL) {
        guard let top = UIApplication.shared.topViewController else {
            try? FileManager.default.removeItem(at: folder)
            downloadBusy = false
            return
        }
        exportFolder = folder
        let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
        picker.delegate = self
        top.present(picker, animated: true)
    }

    private func finishExport(saved: Bool) {
        if let folder = exportFolder { try? FileManager.default.removeItem(at: folder) }
        exportFolder = nil
        downloadBusy = false
        if saved { message = "تم حفظ الملف" }
    }
}

// MARK: - Navigation

extension WebController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        let mainFrame = action.targetFrame?.isMainFrame ?? true
        if action.shouldPerformDownload {
            decisionHandler(EndpointPolicy.sameOrigin(origin, url) ? .download : .cancel)
            return
        }
        if EndpointPolicy.sameOrigin(origin, url) { return decisionHandler(.allow) }
        // Subframes may load about:blank or HTTPS embeds; they stay in their own origin sandbox.
        if !mainFrame && (url.scheme == "https" || url.absoluteString == "about:blank") { return decisionHandler(.allow) }
        if mainFrame { openExternal(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let http = response.response as? HTTPURLResponse
        let attachment = (http?.value(forHTTPHeaderField: "Content-Disposition") ?? "").lowercased().hasPrefix("attachment")
        if response.isForMainFrame, attachment || !response.canShowMIMEType {
            decisionHandler(EndpointPolicy.sameOrigin(origin, response.response.url) ? .download : .cancel)
            return
        }
        if response.isForMainFrame, let status = http?.statusCode, status >= 500 { offline = true }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        transfer = nil
        if exportFolder == nil { downloadBusy = false }
        loading = true
        offline = false
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading = false
        if EndpointPolicy.sameOrigin(origin, webView.url) && !offline { detectDriver() }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    private func failed(_ error: Error) {
        loading = false
        let code = (error as NSError).code
        // Cancelled loads and policy hand-offs (downloads, external links) are not connection failures.
        if code == NSURLErrorCancelled || code == 102 || code == 204 { return }
        offline = true
    }
}

// MARK: - Dialogs and windows

extension WebController: WKUIDelegate {
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if EndpointPolicy.sameOrigin(origin, url) { webView.load(action.request) } else { openExternal(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage text: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        guard let top = UIApplication.shared.topViewController else { return completionHandler() }
        let alert = UIAlertController(title: nil, message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "حسنًا", style: .default) { _ in completionHandler() })
        top.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage text: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        guard let top = UIApplication.shared.topViewController else { return completionHandler(false) }
        let alert = UIAlertController(title: nil, message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "إلغاء", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "تأكيد", style: .default) { _ in completionHandler(true) })
        top.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        guard let top = UIApplication.shared.topViewController else { return completionHandler(nil) }
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "إلغاء", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "تأكيد", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        top.present(alert, animated: true)
    }
}

// MARK: - Page bridge

extension WebController: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let frame = message.frameInfo
        let security = frame.securityOrigin
        guard frame.isMainFrame,
              EndpointPolicy.sameOrigin(origin, scheme: security.protocol, host: security.host, port: security.port),
              EndpointPolicy.sameOrigin(origin, webView.url),
              let raw = message.body as? String else { return }
        do {
            if transfer == nil, downloadBusy, raw.contains("\"start\"") {
                self.message = "أكمل حفظ الملف الحالي أولًا"
                return
            }
            switch try NativeBridge.receive(raw, transfer: &transfer) {
            case .print: printPage()
            case .failed: self.message = "تعذر تجهيز الملف للتنزيل"
            case .started: downloadBusy = true
            case let .finished(data, name, _): presentExport(data, name: name)
            case .ignored: break
            }
        } catch {
            transfer = nil
            if exportFolder == nil { downloadBusy = false }
            self.message = "الملف غير مدعوم أو يتجاوز 10 ميجابايت"
        }
    }
}

// MARK: - Server downloads (Content-Disposition: attachment)

extension WebController: WKDownloadDelegate {
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        guard EndpointPolicy.sameOrigin(origin, download.originalRequest?.url), !downloadBusy,
              response.expectedContentLength <= Int64(NativeBridge.maxFile),
              let mime = NativeBridge.safeMime(response.mimeType) else {
            message = downloadBusy ? "أكمل حفظ الملف الحالي أولًا" : "تعذر تنزيل الملف؛ تحقق من الاتصال وصلاحية الرابط"
            return completionHandler(nil)
        }
        downloadBusy = true
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("exports", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent(NativeBridge.safeName(suggestedFilename))
        downloadFiles[ObjectIdentifier(download)] = (file, mime)
        completionHandler(file)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let entry = downloadFiles.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let size = (try? entry.url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        let folder = entry.url.deletingLastPathComponent()
        if size > NativeBridge.maxFile {
            try? FileManager.default.removeItem(at: folder)
            downloadBusy = false
            message = "الملف يتجاوز 10 ميجابايت"
            return
        }
        presentExport(file: entry.url, folder: folder)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let entry = downloadFiles.removeValue(forKey: ObjectIdentifier(download)) {
            try? FileManager.default.removeItem(at: entry.url.deletingLastPathComponent())
        }
        downloadBusy = false
        message = "تعذر تنزيل الملف؛ تحقق من الاتصال وصلاحية الرابط"
    }
}

extension WebController: UIDocumentPickerDelegate {
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finishExport(saved: true) }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finishExport(saved: false) }
}

extension UIApplication {
    var topViewController: UIViewController? {
        let scene = connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
            ?? connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var top = scene?.windows.first { $0.isKeyWindow }?.rootViewController ?? scene?.windows.first?.rootViewController
        while let next = top?.presentedViewController { top = next }
        return top
    }
}
