# نشر تطبيقي من بيوتنا على Google Play وApp Store

هذا الدليل يكمل ما لا يمكن تنفيذه من المستودع: الحسابات والتوقيع وإدخال بيانات المتجر.

## 1. أندرويد — Google Play

### مفتاح الرفع (مرة واحدة، على جهازك)

```bash
keytool -genkeypair -v -keystore minbuyutna-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
```

احفظ الملف وكلمتي المرور في مكان آمن خارج المستودع. Play App Signing يحتفظ بمفتاح التوقيع النهائي، وهذا المفتاح للرفع فقط ويمكن استبداله عبر الدعم إذا فُقد.

### أسرار GitHub (Settings ← Secrets and variables ← Actions)

| الاسم | القيمة |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | ناتج `base64 -w0 minbuyutna-upload.jks` (على Windows: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("minbuyutna-upload.jks"))`) |
| `ANDROID_KEYSTORE_PASSWORD` | كلمة مرور الملف |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | كلمة مرور المفتاح |

بعدها كل تشغيل لمسار «Android app» ينتج `app-release.aab` موقّعًا في Artifacts باسم android-release. رقم الإصدار (versionCode) يزيد تلقائيًا مع كل تشغيل.

للبناء المحلي بدل GitHub: ضع المتغيرات نفسها بأسماء `MINBUYUTNA_KEYSTORE` (مسار الملف) و`MINBUYUTNA_KEYSTORE_PASSWORD` و`MINBUYUTNA_KEY_ALIAS` و`MINBUYUTNA_KEY_PASSWORD` في `~/.gradle/gradle.properties` ثم `./gradlew bundleRelease`.

### Play Console

1. أنشئ التطبيق باسم «من بيوتنا» وحزمة `sa.minbuyutna.app`، وفعّل Play App Signing.
2. ارفع `app-release.aab` إلى مسار الاختبار الداخلي أولًا ثم الإنتاج.
3. Store listing: الأيقونة `store/android/play-icon-512.png`، والصورة البارزة `store/android/feature-graphic-1024x500.png`، ولقطتا شاشة هاتف على الأقل.
4. سياسة الخصوصية: `https://buyutna.wardat.xyz/privacy`.
5. Data safety: الاسم والبريد والهاتف والعنوان والموقع الدقيق والصور وسجل الطلبات — تُجمع لوظائف التطبيق، مشفرة أثناء النقل، ولا تُشارك لأغراض إعلانية، ويمكن طلب حذف الحساب من صفحة الحساب.
6. **إقرار خدمة الموقع الأمامية (FOREGROUND_SERVICE_LOCATION)**: اشرح أنها لمشاركة موقع السائق مع العميل أثناء الدوام والتوصيل فقط، وارفع فيديو قصيرًا يُظهر تفعيل الدوام والإشعار الثابت.
7. حساب تجريبي للمراجعين: سائق وعميل على المنصة المستضافة (ليس حساب العرض المحلي).

## 2. iOS — App Store

### المتطلبات

- عضوية Apple Developer Program (99 دولارًا سنويًا).
- في App Store Connect: أنشئ التطبيق بمعرّف `sa.minbuyutna.app` واسم «من بيوتنا».
- مفتاح API من App Store Connect ← Users and Access ← Integrations ← App Store Connect API، بدور **Admin** (يلزم للتوقيع السحابي التلقائي).

### أسرار GitHub

| الاسم | القيمة |
|---|---|
| `ASC_KEY_ID` | Key ID |
| `ASC_ISSUER_ID` | Issuer ID |
| `ASC_KEY_P8` | محتوى ملف `AuthKey_XXXX.p8` كاملًا |
| `APPLE_TEAM_ID` | Team ID من صفحة Membership |

ثم من تبويب Actions ← «iOS app» ← Run workflow مع تفعيل upload. يُوقَّع الأرشيف تلقائيًا ويُرفع إلى TestFlight.

### صفحة المتجر

1. لقطات شاشة iPhone 6.9 بوصة وiPad 13 بوصة.
2. سياسة الخصوصية: `https://buyutna.wardat.xyz/privacy`، وبيانات App Privacy مطابقة لملف `PrivacyInfo.xcprivacy`.
3. ملاحظات المراجعة (App Review Information): حساب سائق وحساب عميل للتجربة، واشرح أن الموقع في الخلفية يُستخدم أثناء دوام السائق فقط لمشاركة موقعه مع العميل حتى التسليم، وأن حذف الحساب متاح من صفحة الحساب.
4. التصدير والتشفير: التطبيق يستخدم HTTPS فقط (`ITSAppUsesNonExemptEncryption = NO`).

## 3. قبل الإطلاق التجاري

تقرير القبول في المستودع ينص على أن المدفوعات والتوصيل تجريبيان. Apple وGoogle ترفضان تطبيقًا يعرض شراء منتجات حقيقية بدفع وهمي، أو يبدو غير مكتمل. أغلق بوابات تقرير القبول (مزود دفع حقيقي، سياسات نهائية) قبل الإرسال للمراجعة.
