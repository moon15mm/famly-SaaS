# من بيوتنا

سوق عربي RTL للأسر المنتجة، مع Next.js وFastAPI وSQLAlchemy/Alembic. قاعدة التطوير SQLite وقاعدة الإنتاج PostgreSQL. التطبيق **بيئة اختبار ولا يستقبل أموالًا حقيقية**. راجع تقرير القبول لمعرفة ما اختُبر والقيود المتبقية.

## بدء التطوير على Windows

من جذر المشروع، باستخدام Python 3.11+ وNode 24 LTS (Node 24.22.1 متاح محليًا واستُخدم للتحقق النهائي؛ إصدار النظام القديم20 ليس المستخدم الحالي):

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock
npm.cmd ci --prefix frontend
.\.venv\Scripts\python.exe scripts/prepare_local.py
.\.venv\Scripts\python.exe scripts/fetch_assets.py
$env:PYTHONPATH='backend'
.\.venv\Scripts\python.exe -m alembic -c backend/alembic.ini upgrade head
.\.venv\Scripts\python.exe -m app.seed
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

في نافذة أخرى من `frontend`:

```powershell
npm.cmd run dev
```

شغّل العامل في نافذة ثالثة من جذر المشروع لتحرير حجز المخزون المنتهي ومعالجة outbox:

```powershell
$env:PYTHONPATH='backend'
.\.venv\Scripts\python.exe -m app.worker
```

للتجربة من البناء الإنتاجي، شغّل `npm.cmd run build` ثم `npm.cmd run start` داخل frontend؛ يشغّل الأمر مخرج standalone على loopback. للتشغيل المستمر المخفي على Windows استخدم scripts/start-local.ps1 من جذر المشروع، وللإيقاف scripts/stop-local.ps1. توقف خدمات المشروع قبل إعادة البناء أو الترحيل، ثم أعد تشغيلها. العمليات الحالية تبقى قيد التشغيل بطلب المستخدم.

المتجر: [localhost:3000](http://localhost:3000). توثيق API المحلي: [localhost:8000/api/docs](http://localhost:8000/api/docs). استخدم اسم المضيف `localhost` عند التصفح ليطابق PUBLIC_ORIGIN ويحمي الطلبات من المصادر الأخرى.

الحسابات المحلية: `customer@example.test` و`seller1@example.test` و`seller2@example.test` و`seller3@example.test` و`driver@example.test` و`admin@example.test`. كلمة مرور التطوير مولدة عشوائيًا في `DEMO_PASSWORD` داخل `.env` المحلي. لا تنشر هذا الملف ولا ترسله في المحادثة. حسابات العرض لا تُنشأ تلقائيًا في الإنتاج، وseed يرفض وضع الإنتاج.

## التحقق

```powershell
$testDir=Join-Path (Get-Location) ('data/pytest-'+[guid]::NewGuid().ToString('N'))
.\.venv\Scripts\python.exe -m pytest -q --basetemp $testDir
.\.venv\Scripts\python.exe -m ruff check backend scripts
.\.venv\Scripts\python.exe -m bandit -r backend/app -ll
.\.venv\Scripts\python.exe scripts/verify_local_backup.py
npm.cmd run build --prefix frontend
cd frontend
npx.cmd playwright test tests/account-business.spec.ts tests/marketplace.spec.ts
cd ..
./scripts/start-local.ps1 -Restart
cd frontend
npx.cmd playwright test tests/role-play.spec.ts
cd ..
```

اختبارات المتصفح تتطلب تشغيل الخادمين وبيانات التطوير وMicrosoft Edge. لا تشغلها على الإنتاج؛ تنشئ حسابات وطلبات اختبار. على Linux استبدل channel في إعداد Playwright بمتصفح الاختبار المثبت. نتيجة CI المقترحة ليست نتيجة منفذة على GitHub.

## تنظيم المشروع

- `backend/app`: الهوية، السوق والوسائط، الطلبات، الدفع، التوصيل، الحساب، الإدارة، Telegram والعامل الخلفي.
- `backend/migrations`: ترحيلات مخططة ومثبتة، لا إنشاء تلقائي للجداول عند تشغيل التطبيق.
- `frontend`: السوق والشراء واللوحات والسياسات العربية.
- `deploy` و`compose.yaml`: إعداد VPS وHTTPS.
- `scripts`: الإعداد المحلي والأصول والنسخ الاحتياطي وإنشاء المدير.
- `reports` و`docs`: أدلة التحقق والتشغيل والتكامل والاعتمادات.

## حدود النسخة

سلة لأسرة واحدة. المدفوعات والتوصيل التجريبيان لا يتصلان بمزود مالي أو شركة توصيل. Telegram يحتاج مفاتيحه وضبط Webhook، وموصل Gemini متعدد الوسائط اختياري ولم يختبر باتصال حقيقي. استعادة الحساب والعناوين والخريطة والوثائق الخاصة وخيارات المنتجات والاشتراك الشهري/السنوي والتجديد والفواتير والتقارير منفذة محليًا. SMTP يحتاج حسابًا واختبار إرسال فعلي. الفوترة الضريبية والتسويات والتحصيل الفعلي غير مفعلة. لا تطلق تجاريًا قبل إغلاق بوابات تقرير القبول.

## اختبار PostgreSQL مستقل
الاختبار الفعلي استخدم PostgreSQL 17.10 على 127.0.0.1:55432 في مخططات مؤقتة، مع بقاء التطبيق على SQLite. لتكرار الاختبار على جهاز Windows نفسه شغل scripts/local_postgres.py ثم scripts/run_postgres_tests.py ثم scripts/verify_postgres_migrations.py بواسطة Python البيئة الافتراضية. الحزمة الثنائية الاختيارية موجودة في data/pg-tools وغير مضمّنة في تسليم المصدر؛ يلزم تثبيتها هناك أو استخدام PostgreSQL محلي مستقل وقاعدة اسمها min_buyutna_test_* مع TEST_DATABASE_URL. بيانات اتصال الاختبار لا تدخل المستودع.

لتثبيت أدوات اختبار PostgreSQL الاختيارية على Windows في مسار البيانات المستثنى: `npm install --prefix data/pg-tools --no-audit --no-fund @embedded-postgres/windows-x64@17.10.0-beta.17`. هذه حزمة توزيع اختبارية وليست تبعية التطبيق أو خدمة النظام.

يمكن تحديد مسار Node24 باستخدام `scripts/start-local.ps1 -NodeExecutable FULL_PATH_TO_NODE_EXE`؛ يحفظ المشغل الاختيار محليًا خارج المصدر لإعادة التشغيل التالية، ويرفض Node20 القديم.

تقرير تدقيق الأدوار النهائي: reports/ROLE_PLAY_REPORT.md. شغل اختبارات المتصفح على جولتين كما أعلاه؛ تنشئ الجولة الكاملة أربعة حسابات، وحد التسجيل خمسة خلال خمس دقائق. إعادة تشغيل خدمات التطوير بينهما تعيد محدد الذاكرة دون تخفيض الحماية. استخدم Node24 المدعوم عند تشغيل أوامر npm/npx، أو مساره الكامل إذا كان إصدار النظام أقدم.
