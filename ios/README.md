# تطبيق من بيوتنا لـ iPhone وiPad

نسخة iOS من تطبيق أندرويد، بالحسابات والصلاحيات والطلبات نفسها. شاشات السائق أصلية (SwiftUI)، وبقية الأدوار — العميل والأسرة والإدارة — تستخدم صفحات المنصة داخل WKWebView. يتطلب iOS/iPadOS 16 أو أحدث، ويعمل على iPhone وiPad (كل الاتجاهات على iPad).

## ما يطابق أندرويد

| أندرويد | iOS |
|---|---|
| MainActivity + WebView | `Web/WebController.swift` + WKWebView |
| EndpointPolicy | `Platform/EndpointPolicy.swift` (الاختبارات نفسها) |
| native-bridge.js (MessagePort) | `Web/NativeBridge.swift` (script message handler للإطار الرئيسي ومصدر المنصة فقط) |
| حفظ الملفات عبر ACTION_CREATE_DOCUMENT | لوحة «حفظ في الملفات» (UIDocumentPicker) |
| الطباعة | UIPrintInteractionController |
| DriverActivity + Compose | `Driver/DriverViews.swift` (SwiftUI) |
| DriverSession بمفتاح Keystore | Keychain بخاصية `AfterFirstUnlockThisDeviceOnly` |
| ShiftService (خدمة أمامية) | `Driver/ShiftManager.swift`: موقع في الخلفية مع مؤشر الموقع الأزرق |
| إشعارات العروض | إشعارات محلية (UNUserNotificationCenter) أثناء الدوام |

الفروق: لا يوجد في iOS إشعار ثابت بزر «إنهاء الدوام»؛ يظهر بدلًا منه مؤشر الموقع الأزرق، ويُنهى الدوام من التطبيق. الاتجاهات تفتح خرائط Apple. صور المستندات تُعاد ترميزها JPEG قبل الرفع، فتُحذف بيانات موقع الصورة وصيغة HEIC.

## الأمان

- نسخة المتجر (Release) مقفلة على `PLATFORM_URL` في `project.yml`؛ خيار «رابط المنصة» موجود في نسخة التطوير (Debug) فقط.
- لا تنقل داخل التطبيق إلا لمصدر المنصة نفسه (scheme + host + port). الروابط الأخرى تفتح خارجه، ويُسمح فقط بـ https وtel وmailto.
- لا تجاوز لأخطاء شهادات TLS، وATS يمنع HTTP (عدا الشبكة المحلية للتطوير).
- طلبات السائق عبر جلسة URLSession مؤقتة بلا كوكيز مشتركة ولا ذاكرة مؤقتة، وتمنع إعادة التوجيه، وTLS 1.2 كحد أدنى.
- جسر التنزيل يقبل الرسائل من الإطار الرئيسي ومن مصدر المنصة فقط، بحد 10MiB وأنواع ملفات محددة.
- فحص الويب (Web Inspector) مفعّل في Debug فقط. ملف الخصوصية `PrivacyInfo.xcprivacy` مضمّن.

## البناء على Mac

```bash
brew install xcodegen
```

```bash
cd ios && xcodegen generate && open MinBuyutna.xcodeproj
```

اختر فريقك في Signing & Capabilities ثم شغّل. الاختبارات: Product ← Test.

## البناء والنشر بدون Mac

مسار العمل `.github/workflows/ios.yml` يبني ويختبر على أجهزة macOS في GitHub. للتوقيع والرفع إلى TestFlight أضف الأسرار المذكورة في `docs/MOBILE_RELEASE.md` ثم شغّل المسار يدويًا مع خيار upload.
