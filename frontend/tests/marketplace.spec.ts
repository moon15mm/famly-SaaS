import { test, expect, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(process.cwd(), "..");
const env = fs.readFileSync(path.join(root, ".env"), "utf8");
const password = env.match(/^DEMO_PASSWORD=(.+)$/m)?.[1]?.trim();
test.skip(
  !password,
  "Requires explicitly seeded local test accounts; never run against production.",
);
const origin = "http://localhost:3000";
async function login(page: Page, email: string, pass: string = password!) {
  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("home and mobile layout, search, cart, accessibility basics", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "دفء بيوتنا",
  );
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".product-card")).toHaveCount(8);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(root, "reports/home-desktop.png"),
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page
    .getByRole("button", { name: /أضف .*كيكة/ })
    .first()
    .click();
  await page.getByRole("link", { name: /السلة،/ }).click();
  await expect(
    page.getByRole("heading", { name: "كيكة الشوكولاتة الغنية" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(root, "reports/home-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "قائمة التنقل" }).click();
  await expect(
    page
      .locator("#primary-navigation")
      .getByRole("link", { name: /انضم كأسرة منتجة/ }),
  ).toBeVisible();
  const missingAlt = await page.locator("img:not([alt])").count();
  expect(missingAlt).toBe(0);
});

test("seller registration, draft, admin approval, publish, buyer pickup and paid delivery", async ({
  browser,
}) => {
  const stamp = Date.now().toString(),
    sellerContext = await browser.newContext({ baseURL: origin }),
    customerContext = await browser.newContext({ baseURL: origin }),
    adminContext = await browser.newContext({ baseURL: origin }),
    driverContext = await browser.newContext({ baseURL: origin });
  for (const context of [
    sellerContext,
    customerContext,
    adminContext,
    driverContext,
  ]) {
    context.setDefaultTimeout(15000);
    context.setDefaultNavigationTimeout(30000);
  }
  const seller = await sellerContext.newPage(),
    customer = await customerContext.newPage(),
    admin = await adminContext.newPage(),
    driver = await driverContext.newPage();
  const name = "أسرة اختبار " + stamp,
    product = "منتج رحلة " + stamp,
    email = "seller-" + stamp + "@example.test",
    customerEmail = "buyer-" + stamp + "@example.test";
  const pass = "browser-only-long-password-" + stamp;
  await seller.goto(origin + "/join");
  await seller.getByLabel("اسمك").fill(name);
  await seller.getByLabel("البريد الإلكتروني").fill(email);
  await seller.getByLabel("كلمة المرور", { exact: true }).fill(pass);
  await seller.getByRole("checkbox").check();
  await seller
    .getByRole("button", { name: "إنشاء الحساب", exact: true })
    .click();
  await expect(seller).toHaveURL(/\/seller$/);
  await seller
    .getByRole("button", { name: "إعدادات المتجر", exact: true })
    .click();
  await seller.getByLabel("اسم المتجر").fill(name);
  await seller.getByLabel("المدينة", { exact: true }).fill("الرياض");
  await seller
    .getByLabel("موقع الاستلام")
    .fill("عنوان استلام تجريبي لا يمثل موقعًا حقيقيًا");
  await seller.getByRole("button", { name: "حفظ الإعدادات" }).click();
  await expect(seller.getByRole("status")).toContainText("تم تحديث");
  await seller.getByRole("button", { name: "المنتجات", exact: true }).click();
  await seller.getByRole("button", { name: "أضف منتجًا" }).click();
  await seller.getByLabel("اسم المنتج", { exact: true }).fill(product);
  await seller
    .getByLabel("وصف صادق وواضح")
    .fill("منتج خاص بالاختبار الآلي، لا يباع فعليًا.");
  await seller.getByLabel("السعر بالريال").fill("85");
  await seller.getByLabel("الكمية المتاحة").fill("10");
  await seller.getByLabel("مدة التجهيز بالساعات").fill("1");
  await seller.getByRole("button", { name: "إضافة خيار للمنتج" }).click();
  await seller.getByLabel("اسم الخيار", { exact: true }).fill("عبوة كبيرة");
  await seller
    .getByLabel("صور المنتج الحقيقية")
    .setInputFiles(path.join(root, "data/media/demo-0.webp"));
  await expect(seller.locator(".upload-list img")).toHaveCount(1);
  await seller
    .getByRole("button", { name: "معاينة بيانات المنتج الحالية" })
    .click();
  await expect(
    seller
      .getByRole("dialog")
      .getByRole("heading", { name: product, exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      seller
        .getByRole("dialog")
        .getByRole("img", { name: product, exact: true })
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
    )
    .toBe(true);
  await seller.getByRole("button", { name: "حفظ المنتج", exact: true }).click();
  await expect(seller.getByRole("dialog")).not.toBeVisible();
  await login(admin, "admin@example.test");
  await admin.goto(origin + "/admin");
  const row = admin.getByRole("row").filter({ hasText: name });
  await row
    .getByRole("button", { name: "اعتماد بعد مراجعة المستندات خارج المنصة" })
    .click();
  await expect(row).toContainText("معتمدة");
  const productRow = seller.getByRole("row").filter({ hasText: product });
  await productRow.getByRole("button", { name: "تعديل ومعاينة" }).click();
  await seller.getByLabel("حالة المنتج").selectOption("published");
  await seller.getByRole("button", { name: "حفظ المنتج", exact: true }).click();
  await expect(seller.getByRole("dialog")).not.toBeVisible();
  await customer.goto(origin + "/register");
  await customer.getByLabel("اسمك").fill("عميل رحلة " + stamp);
  await customer.getByLabel("البريد الإلكتروني").fill(customerEmail);
  await customer.getByLabel("كلمة المرور", { exact: true }).fill(pass);
  await customer.getByRole("checkbox").check();
  await customer
    .getByRole("button", { name: "إنشاء الحساب", exact: true })
    .click();
  await expect(customer).toHaveURL(/\/account$/);
  async function buy(method: "pickup" | "paid") {
    await customer.goto(origin + "/search?q=" + encodeURIComponent(product));
    await customer.getByRole("heading", { name: product, exact: true }).click();
    await customer
      .getByLabel("خيارات المنتج", { exact: true })
      .selectOption({ index: 1 });
    await customer.getByRole("button", { name: /أضف إلى السلة/ }).click();
    await customer.goto(origin + "/checkout");
    if (method === "paid") {
      await customer.getByRole("radio", { name: /توصيل مع سائق/ }).check();
      await customer
        .getByLabel("عنوان التوصيل بالتفصيل")
        .fill("الرياض، حي تجريبي، شارع الاختبار، مبنى 10");
    }
    await customer.getByRole("checkbox").check();
    await customer
      .getByRole("button", { name: "مراجعة السعر والتوفر" })
      .click();
    await customer
      .getByRole("button", { name: /إنشاء الطلب التجريبي/ })
      .click();
    await expect(customer).toHaveURL(/\/orders\/[a-f0-9]+$/);
    const id = customer.url().split("/").pop()!;
    await customer.getByRole("button", { name: /محاكاة نجاح الدفع/ }).click();
    await expect(
      customer
        .locator(".summary")
        .getByText("بانتظار موافقة الأسرة", { exact: true }),
    ).toBeVisible();
    return id;
  }
  async function progress(id: string, complete: boolean) {
    await seller.goto(origin + "/orders/" + id);
    for (const text of [
      "تحديث: مؤكد",
      "تحديث: قيد التجهيز",
      "تحديث: جاهز للاستلام",
    ]) {
      await seller.getByRole("button", { name: text, exact: true }).click();
    }
    if (complete)
      await seller
        .getByRole("button", { name: "تحديث: مكتمل", exact: true })
        .click();
    await expect(
      seller
        .locator(".summary")
        .getByText(complete ? "مكتمل" : "جاهز للاستلام", { exact: true }),
    ).toBeVisible();
  }
  const pickup = await buy("pickup");
  await progress(pickup, true);
  await customer.reload();
  await expect(
    customer.getByRole("heading", { name: "كيف كانت تجربتك؟" }),
  ).toBeVisible();
  await customer
    .getByLabel("ملاحظتك")
    .fill("اكتملت رحلة الطلب التجريبي بنجاح.");
  await customer.getByRole("button", { name: "مشاركة التقييم" }).click();
  await expect(customer.getByRole("status")).toContainText("شكرًا");
  const delivery = await buy("paid");
  await progress(delivery, false);
  const driverName = "سائق رحلة " + stamp;
  await driver.goto(origin + "/register");
  await driver.getByLabel("اسمك", { exact: true }).fill(driverName);
  await driver
    .getByLabel("البريد الإلكتروني", { exact: true })
    .fill("driver-" + stamp + "@example.test");
  await driver.getByLabel("كلمة المرور", { exact: true }).fill(pass);
  await driver
    .getByRole("combobox", { name: /نوع الحساب/ })
    .selectOption("driver");
  await driver.getByRole("checkbox").check();
  await driver
    .getByRole("button", { name: "إنشاء الحساب", exact: true })
    .click();
  await expect(driver).toHaveURL(/\/driver$/);
  await admin.goto(origin + "/admin");
  await admin
    .getByRole("button", { name: "الحسابات والسائقون", exact: true })
    .click();
  const driverRow = admin.getByRole("row").filter({ hasText: driverName });
  await driverRow
    .getByRole("button", { name: "اعتماد السائق بعد التحقق", exact: true })
    .click();
  await expect(
    driverRow.getByRole("button", { name: "تعليق أهلية السائق", exact: true }),
  ).toBeVisible();
  await driver.goto(origin + "/driver");
  const available = driver.getByRole("button", {
    name: "تفعيل التوفر",
    exact: true,
  });
  if (await available.isVisible()) await available.click();
  await driver.getByRole("button", { name: "تحديث العروض" }).click();
  const offer = driver
    .locator(".panel")
    .filter({ hasText: delivery.slice(0, 8) });
  await offer.getByRole("button", { name: "قبول المشوار" }).click();
  await expect(driver.getByRole("status")).toContainText("تم قبول المشوار");
  await seller.goto(origin + "/account");
  const pickupText = await seller
    .locator(".notification")
    .filter({
      hasText: "رمز إثبات الاستلام من الأسرة لطلب " + delivery.slice(0, 8),
    })
    .innerText();
  const pickupCode = pickupText.match(/:\s*(\d{6})/)?.[1];
  expect(pickupCode).toBeTruthy();
  await driver.goto(origin + "/orders/" + delivery);
  await driver.getByLabel("رمز إثبات العملية").fill(pickupCode!);
  await driver
    .getByRole("button", { name: "استلم السائق الطلب", exact: true })
    .click();
  await driver.getByRole("button", { name: "في الطريق", exact: true }).click();
  await customer.goto(origin + "/account");
  const notification = customer
    .locator(".notification")
    .filter({ hasText: "رمز إثبات التسليم لطلب " + delivery.slice(0, 8) });
  const text = await notification.innerText();
  const code = text.match(/:\s*(\d{6})/)?.[1];
  expect(code).toBeTruthy();
  await driver.getByLabel("رمز إثبات العملية").fill(code!);
  await driver.getByRole("button", { name: "تم التسليم", exact: true }).click();
  await expect(
    driver.locator(".summary").getByText("تم التسليم", { exact: true }),
  ).toBeVisible();
  await customer.goto(origin + "/orders/" + delivery);
  await expect(
    customer.getByRole("heading", { name: "كيف كانت تجربتك؟" }),
  ).toBeVisible();
  await customer.screenshot({
    path: path.join(root, "reports/order-delivered.png"),
    fullPage: true,
  });
  await seller.goto(origin + "/seller");
  const finishedProduct = seller.getByRole("row").filter({ hasText: product });
  await finishedProduct
    .getByRole("button", { name: "إيقاف البيع", exact: true })
    .click();
  await expect(
    finishedProduct.getByText("متوقف", { exact: true }),
  ).toBeVisible();
  const householdResponse = await seller.request.get(
    origin + "/api/seller/household",
  );
  const finishedHousehold = await householdResponse.json();
  const cleanupResponse = await admin.request.post(
    origin +
      "/api/admin/households/" +
      finishedHousehold.id +
      "/verify?verified=false",
    { headers: { Origin: origin } },
  );
  expect(cleanupResponse.ok()).toBe(true);
  for (const context of [
    sellerContext,
    customerContext,
    adminContext,
    driverContext,
  ])
    await context.close();
});
