# نشر «من بيوتنا» على سيرفر wardat.xyz

المنصة على https://buyutna.wardat.xyz بوضع staging، **والدفع حقيقي عبر Tap** (`PAYMENT_PROVIDER=tap`)؛ التوصيل يُسعَّر بقاعدة المنصة. تشغيل الدفع والاسترداد في `docs/OPERATIONS.md`. ربط واتساب (Evolution API على نفس السيرفر) مضاف في الكود والإعداد لكنه غير مفعّل في `main.py`، ومفتاحه في `.env` فقط.

## ما يوجد على السيرفر

- **الكود:** `/opt/min-buyutna` على السيرفر `3.78.128.161` (اسمه في إعداد SSH المحلي `backup-server`).
- **الحاويات:** مشروع Compose باسم `min-buyutna` من `deploy/server/compose.yaml`، بقاعدة PostgreSQL خاصة به. الواجهة على `127.0.0.1:8431` والـAPI على `127.0.0.1:8430`، فلا يُفتح أي منفذ للإنترنت.
- **الأسرار:** `deploy/server/.env` على السيرفر فقط، بصلاحية root، وفيه كلمة مرور قاعدة البيانات ومفاتيح التوقيع. أُنشئ على السيرفر ولا يدخل Git.
- **nginx:** ملف واحد `/etc/nginx/sites-available/buyutna.wardat.xyz` (نسخته في `deploy/server/nginx.conf`) مع رابطه في `sites-enabled`.
- **الشهادة:** `/etc/letsencrypt/live/buyutna.wardat.xyz`، ويجددها مؤقت certbot الموجود على السيرفر.

لا يمس هذا الإعداد بقية تطبيقات السيرفر ولا إعدادات nginx العامة ولا الجدار الناري.

## حسابات التجربة

نفس حسابات النسخة المحلية: `customer@example.test` و`seller1@example.test` و`driver@example.test` و`admin@example.test`، بكلمة المرور `DEMO_PASSWORD` الموجودة في `.env` المحلي. لا تُخزَّن كلمة المرور على السيرفر.

تطبيق الأندرويد من الإصدار 0.2.1 يفتح هذا الرابط مباشرة، دون كابل USB أو تشغيل الكمبيوتر. في النسخ الأقدم يُضبط الرابط على `https://buyutna.wardat.xyz` من قائمة «المزيد ← رابط المنصة».

## الأوامر اليومية

من المجلد `/opt/min-buyutna/deploy/server` على السيرفر:

```bash
docker compose ps
docker compose logs --tail 100 backend
docker compose restart
```

## التحديث

من جذر المشروع على الجهاز المحلي، بعد عمل commit للتعديلات:

```bash
git -c core.autocrlf=false archive HEAD | ssh backup-server 'tar -x -C /opt/min-buyutna'
ssh backup-server 'cd /opt/min-buyutna/deploy/server && docker compose up -d --build'
```

يعيد البناء تشغيل الترحيلات تلقائيًا قبل الخادم. البناء يستهلك المعالج بضع دقائق، والأفضل تنفيذه في وقت قليل الحركة.

## النسخ الاحتياطي

```bash
ssh backup-server 'cd /opt/min-buyutna/deploy/server && BACKUP_DIR=/var/backups/min-buyutna sh ../../scripts/backup.sh'
```

## الإزالة الكاملة

الأمر الأول يحذف قاعدة البيانات والصور المرفوعة نهائيًا:

```bash
ssh backup-server 'cd /opt/min-buyutna/deploy/server && docker compose down -v --rmi local'
ssh backup-server 'rm /etc/nginx/sites-enabled/buyutna.wardat.xyz /etc/nginx/sites-available/buyutna.wardat.xyz && nginx -t && systemctl reload nginx'
ssh backup-server 'certbot delete --cert-name buyutna.wardat.xyz --non-interactive && rm -rf /opt/min-buyutna'
```
