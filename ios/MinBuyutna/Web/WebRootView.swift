import SwiftUI
import WebKit

private struct WebViewHost: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ view: WKWebView, context: Context) {}
}

struct WebRootView: View {
    @EnvironmentObject private var state: AppState
    @StateObject private var web: WebController
    @State private var editingOrigin = false
    @State private var originText = ""
    @State private var originError: String?

    init(path: String, stayWeb: Bool) {
        _web = StateObject(wrappedValue: WebController(path: path, stayWeb: stayWeb))
    }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            if Platform.customOrigin {
                Text(web.origin.hasPrefix("http:") ? "نسخة محلية تجريبية" : "متصل بمنصتك • " + Platform.host(web.origin))
                    .font(Theme.font(.caption))
                    .foregroundColor(Theme.plum)
                    .padding(.bottom, 4)
            }
            ProgressView(value: web.progress)
                .progressViewStyle(.linear)
                .tint(Theme.plum)
                .opacity(web.loading ? 1 : 0)
                .frame(height: 3)
            ZStack {
                WebViewHost(webView: web.webView)
                if web.offline { offlineView }
            }
        }
        .background(Theme.paper.ignoresSafeArea())
        .overlay(alignment: .bottom) { Toast(message: $web.message).padding(.bottom, 24) }
        .alert("رابط المنصة", isPresented: $editingOrigin) {
            TextField("https://", text: $originText)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("إلغاء", role: .cancel) {}
            Button("اتصال") {
                do { try web.change(origin: originText) } catch { web.message = error.localizedDescription }
            }
        } message: {
            Text("استخدم رابط HTTPS لاستضافة منصتك. تغيير الرابط يغلق جلسة التطبيق الحالية.")
        }
    }

    private var toolbar: some View {
        HStack(spacing: 4) {
            if web.canGoBack {
                Button { web.goBack() } label: { Image(systemName: "chevron.forward") }
                    .accessibilityLabel("رجوع")
                    .padding(.horizontal, 6)
            }
            Text("من بيوتنا").font(Theme.font(.title3, bold: true)).foregroundColor(Theme.plum)
            Spacer()
            Button("الرئيسية") { web.home() }
            Button("تحديث") { web.reload() }
            Menu {
                Button("دخول السائقين") { state.openDriver() }
                Button("طباعة الصفحة أو حفظ PDF") { web.printPage() }
                if Platform.customOrigin { Button("رابط المنصة", action: showOrigin) }
            } label: {
                Text("المزيد")
            }
        }
        .font(Theme.font(.subheadline))
        .foregroundColor(Theme.plum)
        .padding(.horizontal, 12)
        .frame(height: 50)
    }

    private var offlineView: some View {
        VStack(spacing: 20) {
            Text("تعذر الاتصال بالمنصة").font(Theme.font(.title2, bold: true)).foregroundColor(Theme.plum)
            Text("تحقق من اتصال الجهاز بالإنترنت ثم أعد المحاولة. الحسابات والطلبات تحتاج اتصالًا بالخادم.")
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)
            Button("إعادة المحاولة") { web.home() }
            if Platform.customOrigin { Button("رابط المنصة", action: showOrigin) }
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.paper)
    }

    private func showOrigin() {
        originText = web.origin
        editingOrigin = true
    }
}
