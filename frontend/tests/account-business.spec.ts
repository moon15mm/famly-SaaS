import { test, expect, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(process.cwd(), "..");
const password = fs
  .readFileSync(path.join(root, ".env"), "utf8")
  .match(/^DEMO_PASSWORD=(.+)$/m)?.[1]
  ?.trim();
test.skip(!password, "Local seeded accounts required.");
async function login(page: Page, email: string, pass = password!) {
  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني", { exact: true }).fill(email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
test("account verification, saved coordinates, export and one-time recovery", async ({
  page,
}) => {
  const email = "account-" + Date.now() + "@example.test";
  const pass = "browser-account-password-" + Date.now();
  await page.goto("/register");
  await page.getByLabel("اسمك", { exact: true }).fill("عميل اختبار الحساب");
  await page.getByLabel("البريد الإلكتروني", { exact: true }).fill(email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(pass);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "إنشاء الحساب", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole("button", { name: "إرسال رابط تأكيد البريد" }).click();
  await page.getByRole("link", { name: "فتح بريد التجربة المحلي" }).click();
  await page.getByRole("link", { name: "فتح رابط الرسالة" }).click();
  await page.getByRole("button", { name: "تأكيد البريد", exact: true }).click();
  await expect(page.locator("main").getByRole("status")).toContainText(
    "تم تأكيد",
  );
  await page.goto("/account");
  await expect(
    page.getByText("بريدك الإلكتروني مؤكد", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "إدارة عناويني المحفوظة" }).click();
  await page.getByLabel("اسم العنوان", { exact: true }).fill("منزل الاختبار");
  await page.getByLabel("المدينة", { exact: true }).fill("الرياض");
  await page
    .getByLabel("تفاصيل العنوان", { exact: true })
    .fill("عنوان وهمي لاختبار حفظ العناوين فقط");
  await page.getByLabel("رقم التواصل", { exact: true }).fill("0500000000");
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      contentType: "image/gif",
      body: Buffer.from(
        "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
        "base64",
      ),
    }),
  );
  await page
    .getByRole("button", { name: "اختيار الموقع على الخريطة", exact: true })
    .click();
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await page
    .locator(".leaflet-container")
    .click({ position: { x: 120, y: 120 } });
  await expect(page.getByLabel("خط العرض", { exact: true })).not.toHaveValue(
    "",
  );
  await page.getByLabel("خط العرض", { exact: true }).fill("24.7136");
  await page.getByLabel("خط الطول", { exact: true }).fill("46.6753");
  await page.getByRole("button", { name: "حفظ العنوان", exact: true }).click();
  const card = page.locator("article").filter({ hasText: "منزل الاختبار" });
  await expect(card.getByText("الافتراضي", { exact: true })).toBeVisible();
  await expect(card.getByRole("link", { name: "عرض الموقع" })).toHaveAttribute(
    "href",
    /24\.7136/,
  );
  await card.getByRole("button", { name: "تعديل العنوان" }).click();
  await page.screenshot({
    path: path.join(root, "reports/addresses.png"),
    fullPage: true,
  });
  await expect(page.getByLabel("خط العرض", { exact: true })).toHaveValue(
    "24.7136",
  );
  await page.goto("/account");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "تنزيل نسخة من بياناتي" }).click();
  const exportedFile = await download;
  expect(exportedFile.suggestedFilename()).toBe("my-account.json");
  const exportPath = path.join(
    root,
    "data/local-run/verified-account-export.json",
  );
  fs.mkdirSync(path.dirname(exportPath), { recursive: true });
  await exportedFile.saveAs(exportPath);
  const exportedData = JSON.parse(fs.readFileSync(exportPath, "utf8"));
  expect(exportedData.account.email).toBe(email);
  expect(exportedData.addresses[0].latitude).toBe(24.7136);
  expect(JSON.stringify(exportedData)).not.toMatch(
    /"password_hash"|"token_hash"|"totp"/,
  );
  await page.goto("/forgot-password");
  await page.getByLabel("البريد الإلكتروني", { exact: true }).fill(email);
  await page.getByRole("button", { name: "إرسال تعليمات الاستعادة" }).click();
  await page.getByRole("link", { name: "فتح بريد التجربة المحلي" }).click();
  const reset = page.locator("article").filter({ hasText: "استعادة حسابك" });
  await reset.getByRole("link", { name: "فتح رابط الرسالة" }).click();
  const resetUrl = page.url();
  const changed = pass + "-new";
  await page.getByLabel("كلمة المرور الجديدة", { exact: true }).fill(changed);
  await page
    .getByRole("button", { name: "حفظ كلمة المرور", exact: true })
    .click();
  await expect(page.locator("main").getByRole("status")).toContainText(
    "تم تغيير",
  );
  await login(page, email, changed);
  await page.goto(resetUrl);
  await page
    .getByLabel("كلمة المرور الجديدة", { exact: true })
    .fill(changed + "-again");
  await page
    .getByRole("button", { name: "حفظ كلمة المرور", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "الرابط غير صالح",
  );
});
test("annual subscription invoice, private document review and administrator categories", async ({
  browser,
}) => {
  const sellerContext = await browser.newContext({
    baseURL: "http://localhost:3000",
  });
  const adminContext = await browser.newContext({
    baseURL: "http://localhost:3000",
  });
  const seller = await sellerContext.newPage(),
    admin = await adminContext.newPage();
  await login(admin, "admin@example.test");
  await admin.goto("/admin");
  await admin.getByRole("button", { name: "الباقات", exact: true }).click();
  const plan = admin
    .locator("form")
    .filter({ has: admin.getByRole("button", { name: "حفظ إعدادات الباقة" }) })
    .first();
  await plan.getByLabel("سنوي بالريال — اختياري").fill("490");
  await plan.getByRole("button", { name: "حفظ إعدادات الباقة" }).click();
  await expect(admin.getByRole("status")).toContainText("تم تحديث الباقة");
  await login(seller, "seller1@example.test");
  await seller.goto("/seller");
  await seller
    .getByRole("button", { name: "المبيعات والاشتراك", exact: true })
    .click();
  const subscription = seller
    .locator("section")
    .filter({
      has: seller.getByRole("heading", { name: "اشتراك الأسرة وفواتيره" }),
    })
    .first();
  await subscription.getByRole("radio", { name: /سنوي/ }).check();
  await subscription
    .getByRole("button", { name: "إنشاء فاتورة اشتراك تجريبية" })
    .click();
  const invoice = subscription.locator("article").first();
  await invoice.getByRole("button", { name: "اختبار فشل الدفع" }).click();
  await expect(invoice).toContainText("تعذر الدفع");
  await invoice.getByRole("button", { name: /محاكاة دفع/ }).click();
  await expect(invoice).toContainText("مدفوعة تجريبيًا");
  const csvEvent = seller.waitForEvent("download");
  await seller.getByRole("button", { name: "تنزيل التقرير CSV" }).click();
  const csvPath = path.join(root, "data/local-run/verified-sales-report.csv");
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  await (await csvEvent).saveAs(csvPath);
  const csvContent = fs.readFileSync(csvPath, "utf8");
  expect(csvContent.startsWith("\ufeff")).toBe(true);
  expect(csvContent).toContain("اليوم");
  await invoice.getByRole("link", { name: "عرض الإيصال وطباعته" }).click();
  await expect(
    seller.getByRole("heading", { name: "إيصال اشتراك تجريبي" }),
  ).toBeVisible();
  await expect(seller.getByText("اشتراك سنوي", { exact: true })).toBeVisible();
  await seller.goto("/verification");
  const kind = "وثيقة اختبار " + Date.now();
  await seller.getByLabel("نوع الوثيقة", { exact: true }).fill(kind);
  await seller
    .getByLabel("صورة واضحة للمستند")
    .setInputFiles(path.join(root, "data/media/demo-0.webp"));
  await seller.getByRole("button", { name: "رفع المستند الخاص" }).click();
  const doc = seller.locator("article").filter({ hasText: kind });
  await expect(doc).toContainText("بانتظار المراجعة");
  await doc
    .getByRole("button", { name: "إنشاء رابط تنزيل آمن لخمس دقائق" })
    .click();
  const downloaded = seller.waitForEvent("download");
  await doc.getByRole("link", { name: "تنزيل المستند" }).click();
  const downloadedDocument = await downloaded;
  expect(downloadedDocument.suggestedFilename()).toMatch(/\.webp$/);
  const documentPath = path.join(
    root,
    "data/local-run/verified-private-document.webp",
  );
  await downloadedDocument.saveAs(documentPath);
  const content = fs.readFileSync(documentPath);
  expect(content.subarray(0, 4).toString()).toBe("RIFF");
  expect(content.subarray(8, 12).toString()).toBe("WEBP");
  await admin.getByRole("button", { name: "المستندات", exact: true }).click();
  const review = admin.locator("article").filter({ hasText: kind });
  await review
    .getByLabel("ملاحظة للأسرة أو السائق")
    .fill("مستند وهمي مقبول للاختبار المحلي فقط");
  await review.getByRole("button", { name: "حفظ نتيجة المراجعة" }).click();
  await expect(review).toContainText("تمت مراجعته وقبوله");
  await seller.reload();
  await expect(
    seller.locator("article").filter({ hasText: kind }),
  ).toContainText("تمت مراجعته وقبوله");
  await admin.getByRole("button", { name: "التصنيفات", exact: true }).click();
  const cat = "test-" + Date.now();
  await admin.getByLabel("معرف التصنيف", { exact: true }).fill(cat);
  await admin
    .getByLabel("اسم التصنيف", { exact: true })
    .fill("تصنيف اختبار مؤقت");
  await admin.getByRole("button", { name: "حفظ التصنيف", exact: true }).click();
  const category = admin.locator("article").filter({ hasText: cat });
  await expect(category).toBeVisible();
  await category
    .getByRole("button", { name: "حذف إن لم يرتبط بمنتجات" })
    .click();
  await expect(category).toHaveCount(0);
  await sellerContext.close();
  await adminContext.close();
});
