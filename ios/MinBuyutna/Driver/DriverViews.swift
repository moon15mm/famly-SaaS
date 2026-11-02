import PhotosUI
import SwiftUI
import UIKit

struct DriverRootView: View {
    @EnvironmentObject private var state: AppState
    @StateObject private var model = DriverModel()
    @Environment(\.scenePhase) private var phase

    var body: some View {
        Group {
            if model.signedIn {
                DriverTabs(model: model)
            } else {
                DriverLoginView(model: model)
            }
        }
        .font(Theme.font(.body))
        .background(Theme.paper.ignoresSafeArea())
        .overlay(alignment: .bottom) { Toast(message: $model.message).padding(.bottom, 64) }
        .onAppear { applyPendingTab() }
        .onChange(of: state.pendingTab) { _ in applyPendingTab() }
        .task(id: phase == .active) {
            guard phase == .active else { return }
            model.reloadSession()
            while !Task.isCancelled {
                model.refresh()
                try? await Task.sleep(nanoseconds: 15_000_000_000)
            }
        }
    }

    private func applyPendingTab() {
        guard let key = state.pendingTab else { return }
        state.pendingTab = nil
        model.open(DriverTab(rawValue: key) ?? .home)
    }
}

// MARK: - Shared pieces

struct Toast: View {
    @Binding var message: String?

    var body: some View {
        if let text = message {
            Text(text)
                .font(Theme.font(.subheadline))
                .foregroundColor(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .background(Color.black.opacity(0.82), in: RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 20)
                .transition(.opacity)
                .onTapGesture { message = nil }
                .task(id: text) {
                    try? await Task.sleep(nanoseconds: 3_500_000_000)
                    if message == text { withAnimation { message = nil } }
                }
                .accessibilityAddTraits(.isStaticText)
        }
    }
}

struct Card<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(Theme.font(.headline, bold: true))
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.mist, lineWidth: 1))
    }
}

struct Note: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View { Text(text).font(Theme.font(.footnote)).foregroundColor(.secondary) }
}

struct EmptyState: View {
    let text: String
    var action: String?
    var onAction: () -> Void = {}

    var body: some View {
        VStack(spacing: 16) {
            Text(text).font(Theme.font(.body)).multilineTextAlignment(.center)
            if let action { Button(action, action: onAction).buttonStyle(.borderedProminent) }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct Primary: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.font(.body, bold: true))
            .frame(maxWidth: .infinity, minHeight: 46)
            .foregroundColor(.white)
            .background((enabled ? Theme.plum : Color.gray).opacity(configuration.isPressed ? 0.8 : 1), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct Secondary: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.font(.body))
            .padding(.horizontal, 14)
            .frame(minHeight: 42)
            .foregroundColor(enabled ? Theme.plum : .gray)
            .background(RoundedRectangle(cornerRadius: 12).stroke(enabled ? Theme.plum : Color.gray, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// A content column that stays readable on iPad.
private struct Page<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) { content }
                .padding(16)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
        }
        .background(Theme.paper)
    }
}

// MARK: - Sign in

struct DriverLoginView: View {
    @EnvironmentObject private var state: AppState
    @ObservedObject var model: DriverModel
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        Page {
            Text("من بيوتنا").font(Theme.font(.largeTitle, bold: true)).foregroundColor(Theme.plum)
            Text("دخول السائقين").font(Theme.font(.title2, bold: true))
            Text("العروض والرحلات ومشاركة الموقع ورموز الإثبات في مكان واحد.")
            VStack(spacing: 12) {
                TextField("البريد الإلكتروني", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .environment(\.layoutDirection, .leftToRight)
                    .multilineTextAlignment(.leading)
                    .padding(12)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 10))
                SecureField("كلمة المرور", text: $password)
                    .textContentType(.password)
                    .environment(\.layoutDirection, .leftToRight)
                    .padding(12)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 10))
                    .onSubmit(login)
            }
            .padding(.top, 8)
            Button(model.busy ? "جارٍ الدخول…" : "دخول", action: login)
                .buttonStyle(Primary())
                .disabled(model.busy || email.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty)
            Button("نسيت كلمة المرور؟") { state.openWeb("/forgot-password") }
            Button("تسجيل سائق جديد") { state.openWeb("/register") }
            Button("العودة إلى المتجر") { state.openWeb("/") }
        }
    }

    private func login() {
        guard !model.busy, !email.isEmpty, !password.isEmpty else { return }
        model.login(email: email, password: password)
    }
}

// MARK: - Tabs

struct DriverTabs: View {
    @ObservedObject var model: DriverModel

    var body: some View {
        TabView(selection: Binding(get: { model.tab }, set: { model.open($0) })) {
            ForEach(DriverTab.allCases) { tab in
                NavigationStack {
                    screen(tab)
                        .navigationTitle(tab.title)
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .navigationBarTrailing) {
                                Button { model.refresh() } label: { Image(systemName: "arrow.clockwise") }
                                    .accessibilityLabel("تحديث")
                            }
                        }
                }
                .tabItem { Label(tab.title, systemImage: tab.icon) }
                .badge(tab == .offers && !model.offers.isEmpty ? model.offers.count : 0)
                .tag(tab)
            }
        }
    }

    @ViewBuilder
    private func screen(_ tab: DriverTab) -> some View {
        switch tab {
        case .home: HomeScreen(model: model)
        case .offers: OffersScreen(model: model)
        case .trip: TripScreen(model: model)
        case .history: HistoryScreen(model: model)
        case .more: MoreScreen(model: model)
        }
    }
}

private func openSettings() {
    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
}

struct HomeScreen: View {
    @ObservedObject var model: DriverModel
    @ObservedObject private var shift = ShiftManager.shared

    var body: some View {
        Page {
            Text("أهلًا " + model.driverName).font(Theme.font(.title2, bold: true))
            if let summary = model.summary {
                if !summary.verified {
                    Card(title: "حسابك بانتظار الاعتماد") {
                        Text("تعتمد الإدارة الحساب بعد توقيع العقد واعتماد المستندات المطلوبة.")
                        Button("العقد والمستندات") { model.open(.more) }.buttonStyle(Primary())
                    }
                } else {
                    Card(title: "الدوام") {
                        Toggle(isOn: Binding(get: { summary.available }, set: { on in on ? model.startShift() : model.setAvailable(false) })) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(summary.available ? "متاح الآن" : "خارج الدوام")
                                    .font(Theme.font(.body, bold: true))
                                    .foregroundColor(summary.available ? Theme.leaf : Theme.plum)
                                Note(summary.available ? "تصل العروض فورًا، ويُشارك الموقع أثناء التوصيل." : "لا تصل عروض حتى تفعيل التوفر.")
                            }
                        }
                        .disabled(model.busy)
                        .tint(Theme.leaf)
                        if shift.locationDenied {
                            Note("إذن الموقع مرفوض؛ فعّله من الإعدادات لبدء الدوام.")
                            Button("فتح الإعدادات", action: openSettings).buttonStyle(Secondary())
                        }
                    }
                }
                if !summary.complete {
                    Card(title: "متطلبات العمل") {
                        Text("قبل بدء الدوام يلزم إكمال:")
                        ForEach(summary.missing, id: \.self) { Text("• " + $0) }
                        Button("إكمال العقد والمستندات") { model.open(.more) }.buttonStyle(Primary())
                    }
                }
                if summary.activeTripId != nil {
                    Card(title: "رحلة جارية") {
                        Text(Driving.status(summary.activeTripStatus ?? ""))
                        Button("متابعة الرحلة") { model.open(.trip) }.buttonStyle(Primary())
                    }
                }
                HStack(alignment: .top, spacing: 12) {
                    Card(title: "رحلات مكتملة") {
                        Text("\(summary.deliveredTrips)").font(Theme.font(.title, bold: true)).foregroundColor(Theme.plum)
                    }
                    Card(title: "مستحقات معلنة") {
                        Text(Driving.money(summary.declaredFees)).font(Theme.font(.title3, bold: true)).foregroundColor(Theme.plum)
                        Note("تجريبية؛ ليست مبالغ مسددة")
                    }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(24)
            }
            Card(title: "وصول التنبيهات") {
                Text("أثناء الدوام يظهر مؤشر الموقع الأزرق، وتصل التنبيهات ما دام التطبيق يعمل. لا توقف التطبيق من مبدّل التطبيقات أثناء الدوام، ويُفضّل إيقاف وضع توفير الطاقة.")
                Button("إعدادات التطبيق", action: openSettings).buttonStyle(Secondary())
            }
        }
    }
}

struct OffersScreen: View {
    @ObservedObject var model: DriverModel

    var body: some View {
        if let summary = model.summary {
            if !summary.verified {
                EmptyState(text: "تظهر العروض بعد اعتماد الحساب من الإدارة.")
            } else if summary.activeTripId != nil {
                EmptyState(text: "تظهر العروض الجديدة بعد إكمال الرحلة الحالية.", action: "متابعة الرحلة") { model.open(.trip) }
            } else if !summary.available {
                EmptyState(text: "تظهر العروض بعد تفعيل التوفر.", action: "الذهاب إلى الدوام") { model.open(.home) }
            } else if model.offers.isEmpty {
                EmptyState(text: "لا توجد عروض الآن. يصل تنبيه فور وصول عرض جديد.")
            } else {
                Page {
                    ForEach(model.offers) { offer in
                        Card(title: Driving.money(offer.fee) + " • " + offer.city) {
                            if let distance = Driving.distance(offer.distanceKm) { Text("يبعد \(distance) عن موقع الاستلام") }
                            Text("موعد التسليم " + Driving.localTime(offer.scheduledAt))
                            if let minutes = Driving.minutesLeft(offer.expiresAt, now: Date()) { Note("ينتهي العرض خلال \(max(0, minutes)) دقيقة") }
                            Note("تفاصيل الأسرة والعميل تظهر بعد القبول.")
                            HStack(spacing: 8) {
                                Button("قبول المشوار") { model.accept(offer.id) }.buttonStyle(Primary())
                                Button("رفض") { model.reject(offer.id) }.buttonStyle(Secondary())
                            }
                            .disabled(model.busy)
                        }
                    }
                }
            }
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct TripScreen: View {
    @ObservedObject var model: DriverModel
    @State private var code = ""
    @State private var reason = ""

    var body: some View {
        if let trip = model.trip {
            let step = Driving.nextStep(trip.status)
            Page {
                TripSteps(status: trip.status)
                Card(title: "الاستلام من " + trip.householdName) {
                    Text(trip.pickupAddress)
                    if trip.pickupLatitude == nil { Note("لم تحدد الأسرة نقطة على الخريطة؛ الاتجاهات حسب العنوان.") }
                    Button("الاتجاهات إلى الأسرة") { navigate(trip.pickupLatitude, trip.pickupLongitude, trip.pickupAddress) }.buttonStyle(Primary())
                }
                Card(title: "الطلب") {
                    ForEach(trip.items, id: \.self) { item in
                        Text("• " + item.name + (item.option.isEmpty ? "" : " (" + item.option + ")") + " × \(item.quantity)")
                    }
                    Divider()
                    Text("أجرة المشوار " + Driving.money(trip.fee)).font(Theme.font(.body, bold: true))
                    Text("موعد التسليم " + Driving.localTime(trip.scheduledAt))
                }
                Card(title: "التسليم للعميل") {
                    Text(trip.address)
                    Button("الاتجاهات إلى العميل") { navigate(trip.latitude, trip.longitude, trip.address) }.buttonStyle(Primary())
                }
                if let step {
                    Card(title: step.label) {
                        if let hint = step.codeHint {
                            TextField(hint, text: $code)
                                .keyboardType(.numberPad)
                                .textContentType(.oneTimeCode)
                                .font(Theme.font(.title2, bold: true))
                                .environment(\.layoutDirection, .leftToRight)
                                .padding(12)
                                .background(Theme.mist, in: RoundedRectangle(cornerRadius: 10))
                                .onChange(of: code) { value in
                                    let clean = Driving.cleanCode(value)
                                    if clean != value { code = clean }
                                }
                            Note(step.next == "picked_up" ? "تعطيك الأسرة الرمز عند تسليم الطلب." : "يقرأ العميل الرمز من إشعاراته عند الاستلام.")
                        }
                        Button(step.label) { model.advance(code: code) }
                            .buttonStyle(Primary())
                            .disabled(model.busy || (step.codeHint != nil && code.count != 6))
                    }
                }
                Card(title: "تعذر إكمال الرحلة؟") {
                    TextEditor(text: $reason)
                        .frame(minHeight: 90)
                        .padding(6)
                        .background(Theme.mist, in: RoundedRectangle(cornerRadius: 10))
                        .onChange(of: reason) { value in if value.count > 1000 { reason = String(value.prefix(1000)) } }
                        .accessibilityLabel("وصف المشكلة")
                    Note(trip.status == "assigned" ? "قبل الاستلام يُعرض المشوار على سائق آخر." : "بعد الاستلام تتابع الإدارة الرحلة.")
                    Button("الإبلاغ عن تعثر") { model.report(reason) }
                        .buttonStyle(Secondary())
                        .disabled(model.busy || reason.trimmingCharacters(in: .whitespacesAndNewlines).count < 10)
                }
                Note("يظهر موقعك للعميل والأسرة من قبول المشوار حتى التسليم فقط.")
            }
            .onChange(of: trip.status) { _ in code = "" }
        } else if model.summary == nil {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            EmptyState(text: "لا توجد رحلة جارية؛ تبدأ الرحلة بعد قبول أحد العروض.", action: "عرض المشاوير") { model.open(.offers) }
        }
    }

    private func navigate(_ latitude: Double?, _ longitude: Double?, _ address: String) {
        if let url = Driving.mapsURL(latitude: latitude, longitude: longitude, address: address) { UIApplication.shared.open(url) }
    }
}

private struct TripSteps: View {
    let status: String
    private let steps = [("assigned", "إلى الأسرة"), ("picked_up", "تم الاستلام"), ("in_transit", "إلى العميل"), ("delivered", "التسليم")]

    var body: some View {
        let reached = steps.firstIndex { $0.0 == status } ?? -1
        HStack(spacing: 6) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                Text(step.1)
                    .font(Theme.font(.caption, bold: true))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .foregroundColor(index <= reached ? .white : .secondary)
                    .background(index <= reached ? Theme.plum : Theme.mist, in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }
}

struct HistoryScreen: View {
    @ObservedObject var model: DriverModel

    var body: some View {
        Group {
            if model.history.isEmpty {
                EmptyState(text: "لا رحلات بعد.")
            } else {
                Page {
                    ForEach(model.history) { past in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(past.household).font(Theme.font(.body, bold: true))
                                Note(Driving.localTime(past.scheduledAt) + " • " + Driving.status(past.status))
                            }
                            Spacer()
                            Text(Driving.money(past.fee)).font(Theme.font(.body, bold: true)).foregroundColor(Theme.plum)
                        }
                        .padding(16)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 14))
                    }
                }
            }
        }
        .onAppear { model.loadHistory() }
    }
}

struct MoreScreen: View {
    @EnvironmentObject private var state: AppState
    @ObservedObject var model: DriverModel

    var body: some View {
        Page {
            Card(title: "الحساب") {
                Text(model.driverName).font(Theme.font(.body, bold: true))
                Note("المنصة: " + Platform.host(model.origin))
                Button("تسجيل الخروج") { model.logout() }.buttonStyle(Secondary()).disabled(model.busy)
            }
            if let compliance = model.compliance {
                if let contract = compliance.contract { ContractCard(model: model, contract: contract) }
                Card(title: "المستندات المطلوبة") {
                    ForEach(compliance.documents) { requirement in
                        RequirementRow(model: model, requirement: requirement)
                        Divider()
                    }
                    Note("صور واضحة حتى 5 ميجابايت، تُعاد معالجتها على الخادم وتبقى خاصة بالإدارة.")
                }
            } else {
                Card(title: "العقد والمستندات") { Note("جارٍ التحميل…") }
            }
            Card(title: "الإشعارات") {
                if model.notices.isEmpty { Note("لا إشعارات.") }
                if model.notices.contains(where: { !$0.read }) { Button("تعليم الكل كمقروء") { model.markRead() } }
                ForEach(Array(model.notices.prefix(20).enumerated()), id: \.offset) { _, notice in
                    Text(notice.message).font(Theme.font(.body, bold: !notice.read))
                    Note(Driving.localTime(notice.createdAt))
                }
            }
            Card(title: "التنبيهات والموقع") {
                Note("يمكنك ضبط الإشعارات وإذن الموقع من إعدادات التطبيق.")
                Button("إعدادات التطبيق", action: openSettings).buttonStyle(Secondary())
            }
            Button("فتح المتجر") { state.openWeb("/") }
        }
        .onAppear { model.loadMore() }
    }
}

private struct ContractCard: View {
    @ObservedObject var model: DriverModel
    let contract: ContractInfo
    @State private var name = ""
    @State private var agree = false

    var body: some View {
        if contract.accepted {
            Card(title: "العقد") {
                Text("وُقّع «" + contract.title + "» — الإصدار \(contract.version)")
                if !contract.acceptedAt.isEmpty { Note("بتاريخ " + Driving.localTime(contract.acceptedAt)) }
            }
        } else {
            Card(title: contract.title + " — الإصدار \(contract.version)") {
                Text(contract.body).font(Theme.font(.subheadline))
                Divider()
                TextField("الاسم الكامل كما في الهوية", text: $name)
                    .textContentType(.name)
                    .padding(12)
                    .background(Theme.mist, in: RoundedRectangle(cornerRadius: 10))
                    .onChange(of: name) { value in if value.count > 100 { name = String(value.prefix(100)) } }
                Toggle("قرأت العقد وأوافق على الالتزام بجميع بنوده", isOn: $agree).tint(Theme.leaf)
                Button("توقيع العقد إلكترونيًا") { model.sign(fullName: name) }
                    .buttonStyle(Primary())
                    .disabled(model.busy || !agree || name.trimmingCharacters(in: .whitespaces).count < 3)
                Note("يُحفظ مع التوقيع الاسم والوقت وعنوان الاتصال لإثبات الموافقة.")
            }
        }
    }
}

private struct RequirementRow: View {
    @ObservedObject var model: DriverModel
    let requirement: Requirement
    @State private var picked: PhotosPickerItem?
    @State private var askingDate = false
    @State private var expiry = Calendar.current.date(byAdding: .year, value: 1, to: Date()) ?? Date()
    @State private var datedPick: PhotosPickerItem?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(requirement.title + (requirement.required ? "" : " (اختياري)")).font(Theme.font(.body, bold: true))
            Note(Driving.documentState(requirement.state) + (requirement.expiresOn.isEmpty ? "" : " • ينتهي " + requirement.expiresOn))
            if !requirement.note.isEmpty { Note("ملاحظة المراجعة: " + requirement.note) }
            if Driving.needsUpload(requirement.state) || requirement.state == "expiring" {
                let label = requirement.state == "missing" ? "رفع المستند" : "رفع نسخة جديدة"
                if requirement.needsExpiry {
                    Button(label) { askingDate = true }.buttonStyle(Secondary()).disabled(model.busy)
                } else {
                    PhotosPicker(selection: $picked, matching: .images, photoLibrary: .shared()) { Text(label) }
                        .buttonStyle(Secondary())
                        .disabled(model.busy)
                }
            }
        }
        .onChange(of: picked) { item in send(item, expiresOn: nil) }
        .sheet(isPresented: $askingDate) {
            NavigationStack {
                Form {
                    DatePicker("تاريخ انتهاء المستند", selection: $expiry, in: Date()..., displayedComponents: .date)
                        .datePickerStyle(.graphical)
                    PhotosPicker(selection: $datedPick, matching: .images, photoLibrary: .shared()) { Text("التالي: اختيار الصورة") }
                }
                .navigationTitle(requirement.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("إلغاء") { askingDate = false } } }
            }
            .environment(\.layoutDirection, .rightToLeft)
            .onChange(of: datedPick) { item in
                askingDate = false
                send(item, expiresOn: Driving.isoDate(expiry))
            }
        }
    }

    private func send(_ item: PhotosPickerItem?, expiresOn: String?) {
        guard let item else { return }
        picked = nil
        datedPick = nil
        Task {
            guard let data = try? await item.loadTransferable(type: Data.self) else {
                model.message = "تعذر قراءة الصورة"
                return
            }
            model.upload(imageData: data, requirement: requirement, expiresOn: expiresOn)
        }
    }
}
