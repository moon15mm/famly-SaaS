import { test, expect, Page, BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "..");
const origin = "http://localhost:3000";
const demoPassword = fs
  .readFileSync(path.join(root, ".env"), "utf8")
  .match(/^DEMO_PASSWORD=(.+)$/m)?.[1]
  ?.trim();
test.skip(!demoPassword, "Local development accounts required");
test.setTimeout(1200000);

test("role play: owner, household, customer and drivers including failures and recovery", async ({
  browser,
}) => {
  const stamp = Date.now().toString();
  const password = "local-role-audit-" + stamp;
  const family = "أسرة تدقيق " + stamp;
  const productName = "منتج تدقيق " + stamp;
  const checkpoints: {
    id: string;
    role: string;
    title: string;
    status: string;
  }[] = [];
  const consoleErrors: { role: string; message: string }[] = [];
  const contexts: BrowserContext[] = [];
  const pages: Record<string, Page> = {};
  const productsToPause: string[] = [];
  const orderIds: string[] = [];
  let householdId = "",
    productId = "";
  let rule: Record<string, number> | undefined;
  let product: any;
  let sequence = 0;
  let finished = false;
  const reportPath = path.join(root, "reports/role-play.json");
  async function checkpoint(
    role: string,
    id: string,
    title: string,
    action: () => Promise<void>,
  ) {
    try {
      console.log(`ROLE ${role} | ${id} | ${title}`);
      await test.step(`${role} | ${id} | ${title}`, action);
      checkpoints.push({ id, role, title, status: "passed" });
    } catch (error) {
      checkpoints.push({ id, role, title, status: "failed" });
      throw error;
    }
  }
  function verify(role: string, id: string, title: string, passed: boolean) {
    checkpoints.push({ role, id, title, status: passed ? "passed" : "failed" });
    expect.soft(passed, `${role} | ${id} | ${title}`).toBe(true);
  }
  async function json(
    page: Page,
    method: string,
    route: string,
    data?: unknown,
    expected = 200,
  ) {
    const response = await page.request.fetch(origin + "/api" + route, {
      method,
      headers: { Origin: origin },
      ...(data === undefined ? {} : { data }),
    });
    expect(response.status(), `${method} ${route.split("?")[0]}`).toBe(
      expected,
    );
    return response.json();
  }
  async function makePage(role: string) {
    const context = await browser.newContext({ baseURL: origin });
    context.setDefaultTimeout(15000);
    contexts.push(context);
    const page = await context.newPage();
    page.on("pageerror", (error) =>
      consoleErrors.push({ role, message: error.message.slice(0, 350) }),
    );
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !/Failed to load resource.*status of (400|401|403|404|409|422|429)/.test(
          message.text(),
        )
      )
        consoleErrors.push({ role, message: message.text().slice(0, 350) });
    });
    page.on("response", (response) => {
      if (response.status() >= 500 && response.url().startsWith(origin))
        consoleErrors.push({
          role,
          message: `HTTP ${response.status()} ${new URL(response.url()).pathname}`,
        });
    });
    pages[role] = page;
    return page;
  }
  async function register(
    page: Page,
    name: string,
    email: string,
    role: "seller" | "customer" | "driver",
  ) {
    await page.goto(role === "seller" ? "/join" : "/register");
    await page.getByLabel("اسمك", { exact: true }).fill(name);
    await page.getByLabel("البريد الإلكتروني", { exact: true }).fill(email);
    await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
    if (role !== "seller")
      await page
        .getByRole("combobox", { name: /نوع الحساب/ })
        .selectOption(role);
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "إنشاء الحساب", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp("/" + (role === "customer" ? "account" : role) + "$"),
    );
  }
  function schedule() {
    const d = new Date(Date.now() + (3 + sequence++) * 86400000);
    return d.toISOString().slice(0, 10) + "T14:00";
  }
  async function screenshot(page: Page, name: string) {
    await page.screenshot({
      path: path.join(root, "reports/role-" + name + ".png"),
      fullPage: true,
    });
  }
  async function addOption(page: Page, option: number) {
    await page.goto("/product/" + productId);
    await page
      .getByLabel("خيارات المنتج", { exact: true })
      .selectOption({ index: option });
    await page.getByRole("button", { name: /أضف إلى السلة/ }).click();
    await expect(page.getByRole("status")).toContainText("أُضيف");
  }
  async function newOrder(method: "pickup" | "free" | "paid") {
    const customer = pages.customer;
    await addOption(customer, 1);
    await customer.goto("/checkout");
    if (method !== "pickup") {
      await customer
        .getByRole("radio", {
          name: method === "free" ? /توصيل تقدمه الأسرة/ : /توصيل مع سائق/,
        })
        .check();
      await customer
        .getByLabel("عنوان التوصيل بالتفصيل")
        .fill("عنوان تدقيق وهمي في الرياض شارع الاختبار");
    }
    await customer.getByLabel(/موعد الاستلام أو التسليم/).fill(schedule());
    await customer.getByRole("checkbox").check();
    await customer
      .getByRole("button", { name: "مراجعة السعر والتوفر" })
      .click();
    await customer
      .getByRole("button", { name: /إنشاء الطلب التجريبي/ })
      .click();
    await expect(customer).toHaveURL(/\/orders\/[a-f0-9]+$/);
    const id = customer.url().split("/").pop()!;
    orderIds.push(id);
    return id;
  }
  async function pay(id: string) {
    const c = pages.customer;
    await c.goto("/orders/" + id);
    await c.getByRole("button", { name: /محاكاة نجاح الدفع/ }).click();
    await expect(
      c.locator(".summary").getByText("بانتظار موافقة الأسرة", { exact: true }),
    ).toBeVisible();
  }
  async function prepare(id: string, delivery = false) {
    const s = pages.seller;
    await s.goto("/orders/" + id);
    for (const name of [
      "تحديث: مؤكد",
      "تحديث: قيد التجهيز",
      "تحديث: جاهز للاستلام",
      ...(delivery ? ["تحديث: في الطريق", "تحديث: تم التسليم"] : []),
    ]) {
      await s.getByRole("button", { name, exact: true }).click();
      await expect(s.getByRole("status")).toContainText("تم تحديث الطلب");
    }
  }
  async function accept(driver: Page, id: string) {
    await driver.goto("/driver");
    await expect(
      driver.getByRole("heading", { name: "مساحة السائق", exact: true }),
    ).toBeVisible();
    const available = driver.getByRole("button", {
      name: "تفعيل التوفر",
      exact: true,
    });
    if (await available.isVisible()) await available.click();
    await driver.getByRole("button", { name: "تحديث العروض" }).click();
    await driver
      .locator(".panel")
      .filter({ hasText: id.slice(0, 8) })
      .getByRole("button", { name: "قبول المشوار" })
      .click();
    await expect(driver.getByRole("status")).toContainText("تم قبول المشوار");
  }
  async function code(page: Page, id: string, kind: "pickup" | "delivery") {
    await page.goto("/account");
    const prefix =
      kind === "pickup"
        ? "رمز إثبات الاستلام من الأسرة لطلب "
        : "رمز إثبات التسليم لطلب ";
    const text = await page
      .locator(".notification")
      .filter({ hasText: prefix + id.slice(0, 8) })
      .first()
      .innerText();
    const value = text.match(/:\s*(\d{6})/)?.[1];
    expect(value).toBeTruthy();
    return value!;
  }
  async function deliver(driver: Page, id: string) {
    const pickup = await code(pages.seller, id, "pickup");
    await driver.goto("/orders/" + id);
    await driver.getByLabel("رمز إثبات العملية").fill(pickup);
    await driver
      .getByRole("button", { name: "استلم السائق الطلب", exact: true })
      .click();
    await driver
      .getByRole("button", { name: "في الطريق", exact: true })
      .click();
    const arrival = await code(pages.customer, id, "delivery");
    await driver.getByLabel("رمز إثبات العملية").fill(arrival);
    await driver
      .getByRole("button", { name: "تم التسليم", exact: true })
      .click();
    await expect(
      driver.locator(".summary").getByText("تم التسليم", { exact: true }),
    ).toBeVisible();
  }
  try {
    const owner = await makePage("owner"),
      seller = await makePage("seller"),
      customer = await makePage("customer"),
      driver = await makePage("driver"),
      driver2 = await makePage("driver2");
    const health = await owner.request.get(origin + "/api/health");
    expect((await health.json()).environment).toBe("development");
    await checkpoint(
      "المالك",
      "O1",
      "الدخول ومراجعة جميع أقسام الإدارة",
      async () => {
        await owner.goto("/login");
        await owner
          .getByLabel("البريد الإلكتروني", { exact: true })
          .fill("admin@example.test");
        await owner
          .getByLabel("كلمة المرور", { exact: true })
          .fill(demoPassword!);
        await owner.getByRole("button", { name: "دخول", exact: true }).click();
        await expect(owner).toHaveURL(/\/admin$/);
        for (const tab of [
          "اعتماد الأسر",
          "الحسابات والسائقون",
          "المنتجات",
          "التصنيفات",
          "الباقات",
          "الطلبات والاسترداد",
          "المستندات",
          "التقارير",
          "الدعم",
          "سجل التدقيق",
          "رسائل النظام",
          "الخصوصية",
          "تعثر التوصيل",
        ]) {
          await owner.getByRole("button", { name: tab, exact: true }).click();
          await expect(
            owner.getByRole("heading", {
              name: "صورة أوضح لكل التفاصيل",
              exact: true,
            }),
          ).toBeVisible();
        }
        rule = await json(owner, "GET", "/admin/delivery-rule");
        await owner
          .getByRole("button", { name: "تسعير التوصيل", exact: true })
          .click();
        await owner.getByLabel("الرسم الأساسي بالريال").fill("12");
        await owner.getByLabel("لكل كيلومتر بالريال").fill("2");
        await owner
          .getByRole("button", { name: "حفظ القاعدة", exact: true })
          .click();
        await expect(owner.getByRole("status")).toContainText(
          "تم تحديث قاعدة الاختبار",
        );
      },
    );
    await checkpoint(
      "الأسرة",
      "S1",
      "التسجيل وإعداد المتجر والتوصيل المجاني",
      async () => {
        await register(
          seller,
          family,
          "audit-seller-" + stamp + "@example.test",
          "seller",
        );
        await seller
          .getByRole("button", { name: "إعدادات المتجر", exact: true })
          .click();
        await seller.getByLabel("اسم المتجر", { exact: true }).fill(family);
        await seller
          .getByLabel(/موقع الاستلام/)
          .fill("موقع استلام وهمي لتدقيق الأدوار فقط");
        await seller.getByLabel("ساعة الافتتاح").fill("0");
        await seller.getByLabel("ساعة الإغلاق").fill("23");
        await seller.getByLabel("الحد الأقصى للطلبات لكل ساعة").fill("10");
        await seller.getByLabel(/أقدم توصيلًا مجانيًا/).check();
        await seller.getByRole("button", { name: "حفظ الإعدادات" }).click();
        await expect(seller.getByRole("status")).toContainText("تم تحديث");
        householdId = (await json(seller, "GET", "/seller/household")).id;
      },
    );
    await checkpoint(
      "الأسرة",
      "S2",
      "صورة ومسودة وخياران ومنع النشر قبل الاعتماد",
      async () => {
        await seller
          .getByRole("button", { name: "المنتجات", exact: true })
          .click();
        await seller.getByRole("button", { name: "أضف منتجًا" }).click();
        await seller
          .getByLabel("اسم المنتج", { exact: true })
          .fill(productName);
        await seller
          .getByLabel("وصف صادق وواضح")
          .fill("منتج وهمي لتجربة الأدوار، ليس للبيع الفعلي.");
        await seller.getByLabel("السعر بالريال").fill("70");
        await seller.getByLabel("الكمية المتاحة").fill("30");
        await seller.getByLabel("مدة التجهيز بالساعات").fill("0");
        await seller
          .getByLabel("صور المنتج الحقيقية")
          .setInputFiles(path.join(root, "data/media/demo-0.webp"));
        await expect(seller.locator(".upload-list img")).toHaveCount(1);
        for (const [i, name, delta] of [
          [0, "صغير", "0"],
          [1, "كبير", "10"],
        ] as const) {
          await seller
            .getByRole("button", { name: "إضافة خيار للمنتج" })
            .click();
          await seller
            .getByLabel("اسم الخيار", { exact: true })
            .nth(i)
            .fill(name);
          await seller
            .getByLabel("فرق السعر بالريال", { exact: true })
            .nth(i)
            .fill(delta);
        }
        await seller.getByLabel("حالة المنتج").selectOption("published");
        await seller
          .getByRole("button", { name: "حفظ المنتج", exact: true })
          .click();
        await expect(
          seller.getByRole("dialog").getByRole("alert"),
        ).toContainText("اعتماد");
        await seller.getByLabel("حالة المنتج").selectOption("draft");
        await seller
          .getByRole("button", { name: "حفظ المنتج", exact: true })
          .click();
        await expect(seller.getByRole("dialog")).not.toBeVisible();
        product = (await json(seller, "GET", "/seller/products")).find(
          (p: any) => p.name === productName,
        );
        productId = product.id;
        productsToPause.push(productId);
        expect(
          (await customer.request.get(origin + product.images[0])).status(),
        ).toBe(404);
        await screenshot(seller, "household");
      },
    );
    await checkpoint(
      "المالك",
      "O2",
      "اعتماد الأسرة ثم إتاحة نشر المنتج",
      async () => {
        await owner.goto("/admin");
        const row = owner.getByRole("row").filter({ hasText: family });
        await row
          .getByRole("button", {
            name: "اعتماد بعد مراجعة المستندات خارج المنصة",
          })
          .click();
        await expect(row).toContainText("معتمدة");
        await seller
          .getByRole("row")
          .filter({ hasText: productName })
          .getByRole("button", { name: "تعديل ومعاينة" })
          .click();
        await seller.getByLabel("حالة المنتج").selectOption("published");
        await seller
          .getByRole("button", { name: "حفظ المنتج", exact: true })
          .click();
        await expect(seller.getByRole("dialog")).not.toBeVisible();
        product = (await json(seller, "GET", "/seller/products")).find(
          (p: any) => p.id === productId,
        );
        await expect
          .poll(async () =>
            (
              await customer.request.get(origin + "/api/products/" + productId)
            ).status(),
          )
          .toBe(200);
      },
    );
    await checkpoint(
      "العميل",
      "C1",
      "التسجيل والعنوان والإحداثيات وجمع خيارين في السلة",
      async () => {
        await register(
          customer,
          "عميل تدقيق " + stamp,
          "audit-customer-" + stamp + "@example.test",
          "customer",
        );
        await customer.goto("/addresses");
        await customer
          .getByLabel("اسم العنوان", { exact: true })
          .fill("عنوان تدقيق");
        await customer.getByLabel("المدينة", { exact: true }).fill("الرياض");
        await customer
          .getByLabel("تفاصيل العنوان", { exact: true })
          .fill("عنوان وهمي لاختبار اختيار عنوان آخر");
        await customer.getByLabel("خط العرض", { exact: true }).fill("24.7");
        await customer.getByLabel("خط الطول", { exact: true }).fill("46.6");
        await customer
          .getByRole("button", { name: "حفظ العنوان", exact: true })
          .click();
        await expect(
          customer.locator("article").filter({ hasText: "عنوان تدقيق" }),
        ).toBeVisible();
        await addOption(customer, 1);
        await addOption(customer, 2);
        await customer.goto("/cart");
        await expect(customer.locator(".cart-line")).toHaveCount(2);
        const other = (await json(customer, "GET", "/products")).items.find(
          (p: any) => p.household_id !== householdId && !p.options?.length,
        );
        await customer.goto("/product/" + other.id);
        await customer.getByRole("button", { name: /أضف إلى السلة/ }).click();
        await expect(customer.getByRole("status")).toContainText(
          "أكمل طلب الأسرة الحالية",
        );
      },
    );
    let primary = "";
    await checkpoint(
      "العميل والأسرة",
      "C2",
      "اختيار عنوان آخر وتغير السعر بعد مراجعته",
      async () => {
        await customer.goto("/checkout");
        await customer.getByRole("radio", { name: /توصيل مع سائق/ }).check();
        const addresses = customer.getByRole("combobox", {
          name: /اختر عنوانًا محفوظًا/,
        });
        await addresses.selectOption({ index: 1 });
        await expect(customer.getByLabel("عنوان التوصيل بالتفصيل")).toHaveValue(
          /عنوان وهمي/,
        );
        await addresses.selectOption("");
        verify(
          "العميل",
          "C2.1",
          "عنوان آخر يمسح العنوان والإحداثيات السابقة",
          (await customer.getByLabel("عنوان التوصيل بالتفصيل").inputValue()) ===
            "" &&
            (await customer
              .getByLabel("خط العرض", { exact: true })
              .inputValue()) === "",
        );
        await customer
          .getByLabel("عنوان التوصيل بالتفصيل")
          .fill("عنوان توصيل وهمي جديد لاختبار الأدوار");
        await customer.getByLabel("خط العرض", { exact: true }).fill("24.71");
        await customer.getByLabel("خط الطول", { exact: true }).fill("46.61");
        await customer.getByLabel(/موعد الاستلام أو التسليم/).fill(schedule());
        await customer.getByRole("checkbox").check();
        await customer
          .getByRole("button", { name: "مراجعة السعر والتوفر" })
          .click();
        await expect(
          customer.getByRole("button", { name: /إنشاء الطلب التجريبي/ }),
        ).toBeVisible();
        await screenshot(customer, "customer-checkout");
        await json(seller, "PUT", "/seller/products/" + productId, {
          ...product,
          price: 7500,
        });
        const responsePromise = customer.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/api/orders" &&
            r.request().method() === "POST",
        );
        await customer
          .getByRole("button", { name: /إنشاء الطلب التجريبي/ })
          .click();
        const response = await responsePromise;
        verify(
          "العميل",
          "C2.2",
          "لا يتغير الإجمالي بعد الموافقة دون مراجعة جديدة",
          response.status() === 409,
        );
        if (response.status() === 409) {
          await customer
            .getByRole("button", { name: "مراجعة السعر والتوفر" })
            .click();
          await customer
            .getByRole("button", { name: /إنشاء الطلب التجريبي/ })
            .click();
          await expect(customer).toHaveURL(/\/orders\/[a-f0-9]+$/);
          primary = customer.url().split("/").pop()!;
        } else {
          primary = (await response.json()).id;
        }
        orderIds.push(primary);
        await pay(primary);
        const saved = await json(customer, "GET", "/orders/" + primary);
        expect(saved.subtotal).toBe(16000);
        expect(saved.delivery_fee).toBe(2200);
        expect(saved.items).toHaveLength(2);
        expect(
          (await json(customer, "POST", "/payments/test/" + primary)).duplicate,
        ).toBe(true);
      },
    );
    await checkpoint(
      "السائق والمالك",
      "D1",
      "تسجيل سائقين ومنع غير المعتمد ثم اعتماد الأهلية",
      async () => {
        for (const [page, suffix] of [
          [driver, "A"],
          [driver2, "B"],
        ] as const) {
          const name = "سائق تدقيق " + suffix + stamp;
          await register(
            page,
            name,
            "audit-driver-" + suffix + stamp + "@example.test",
            "driver",
          );
          await expect(
            page.getByRole("button", { name: "تفعيل التوفر", exact: true }),
          ).toBeDisabled();
          expect(
            (await page.request.get(origin + "/api/driver/offers")).status(),
          ).toBe(403);
          await owner.goto("/admin");
          await owner
            .getByRole("button", { name: "الحسابات والسائقون", exact: true })
            .click();
          const row = owner.getByRole("row").filter({ hasText: name });
          await row
            .getByRole("button", {
              name: "اعتماد السائق بعد التحقق",
              exact: true,
            })
            .click();
          await expect(
            row.getByRole("button", {
              name: "تعليق أهلية السائق",
              exact: true,
            }),
          ).toBeVisible();
          await page.reload();
        }
      },
    );
    let secondary = "";
    await checkpoint(
      "الأسرة والسائق",
      "D2",
      "جاهزية الطلب ورفض عرض مستقل وإسناد ذري",
      async () => {
        await prepare(primary);
        secondary = await newOrder("paid");
        await pay(secondary);
        await prepare(secondary);
        await driver.goto("/driver");
        await driver
          .getByRole("button", { name: "تفعيل التوفر", exact: true })
          .click();
        await driver.getByRole("button", { name: "تحديث العروض" }).click();
        const rejected = driver
          .locator(".panel")
          .filter({ hasText: secondary.slice(0, 8) });
        await rejected
          .getByRole("button", { name: "رفض العرض", exact: true })
          .click();
        await expect(rejected).toHaveCount(0);
        await accept(driver2, primary);
        expect(
          (
            await driver.request.post(
              origin + "/api/driver/offers/" + primary + "/accept",
              { headers: { Origin: origin } },
            )
          ).status(),
        ).toBe(409);
        expect(
          (
            await driver.request.get(origin + "/api/driver/trips/" + primary)
          ).status(),
        ).toBe(404);
        await driver2.goto("/orders/" + primary);
        await driver2.getByLabel("رمز إثبات العملية").fill("000000");
        await driver2
          .getByRole("button", { name: "استلم السائق الطلب", exact: true })
          .click();
        await expect(driver2.locator("main").getByRole("alert")).toContainText(
          "غير صحيح",
        );
      },
    );
    await checkpoint(
      "السائق",
      "D3",
      "التعثر قبل الاستلام وإعادة العرض لسائق آخر",
      async () => {
        await driver2
          .getByLabel("وصف المشكلة")
          .fill("تعذر الحضور التجريبي قبل استلام الطلب");
        await driver2
          .getByRole("button", { name: "تسجيل تعثر الرحلة" })
          .click();
        await expect(driver2.getByRole("status")).toContainText("سجلت المشكلة");
        await accept(driver, primary);
        const pickup = await code(seller, primary, "pickup");
        await driver.goto("/orders/" + primary);
        await driver.getByLabel("رمز إثبات العملية").fill(pickup);
        await driver
          .getByRole("button", { name: "استلم السائق الطلب", exact: true })
          .click();
        await expect(
          driver.getByRole("button", { name: "في الطريق", exact: true }),
        ).toBeVisible();
        await screenshot(driver, "driver");
      },
    );
    await checkpoint(
      "المالك والسائق",
      "D4",
      "التعثر بعد الاستلام والتحقق من عودة المنتج قبل إعادة الإسناد",
      async () => {
        await driver
          .getByLabel("وصف المشكلة")
          .fill("تعثر تجريبي بعد الاستلام وعاد الطلب للأسرة");
        await driver.getByRole("button", { name: "تسجيل تعثر الرحلة" }).click();
        await expect(driver.getByRole("status")).toContainText("سجلت المشكلة");
        await owner.goto("/admin");
        await owner
          .getByRole("button", { name: "تعثر التوصيل", exact: true })
          .click();
        const issue = owner
          .locator("form")
          .filter({ hasText: "طلب #" + primary.slice(0, 8) })
          .filter({ hasText: "بعد الاستلام" });
        await issue
          .getByLabel("تقرير المعالجة والتحقق التشغيلي")
          .fill("تحققت الإدارة التجريبية من عودة المنتج للأسرة");
        await issue
          .getByRole("button", { name: "إعادة عرض التوصيل بعد التحقق" })
          .click();
        await expect(owner.getByRole("status")).toContainText("عودة الطلب");
        expect((await json(owner, "GET", "/orders/" + primary)).status).toBe(
          "picked_up",
        );
        await issue.getByRole("checkbox").check();
        await issue
          .getByRole("button", { name: "إعادة عرض التوصيل بعد التحقق" })
          .click();
        await expect(issue).toContainText("عولجت");
        await accept(driver, primary);
        await deliver(driver, primary);
        await accept(driver2, secondary);
        await deliver(driver2, secondary);
      },
    );
    await checkpoint(
      "العميل والأسرة",
      "C3",
      "توصيل مجاني واستلام ذاتي وتقييم وإيصال",
      async () => {
        const free = await newOrder("free");
        await pay(free);
        expect(
          (await json(customer, "GET", "/orders/" + free)).delivery_fee,
        ).toBe(0);
        await prepare(free, true);
        const pickup = await newOrder("pickup");
        await pay(pickup);
        await prepare(pickup);
        await seller
          .getByRole("button", { name: "تحديث: مكتمل", exact: true })
          .click();
        await customer.goto("/orders/" + pickup);
        await customer
          .getByLabel("ملاحظتك")
          .fill("اكتملت التجربة من جميع الأدوار بنجاح");
        await customer.getByRole("button", { name: "مشاركة التقييم" }).click();
        await expect(customer.getByRole("status")).toContainText("شكرًا");
        await customer.getByRole("button", { name: "مشاركة التقييم" }).click();
        await expect(customer.getByRole("status")).toContainText("تم تقييم");
        await customer
          .getByRole("link", { name: "إيصال الطلب وطباعته" })
          .click();
        await expect(
          customer.getByRole("heading", {
            name: "إيصال طلب تجريبي",
            exact: true,
          }),
        ).toBeVisible();
      },
    );
    await checkpoint(
      "العميل والأسرة",
      "C4",
      "فشل الدفع والإلغاء ورفض الأسرة يعيدان المخزون مرة واحدة",
      async () => {
        const stock = (await json(seller, "GET", "/seller/products")).find(
          (p: any) => p.id === productId,
        ).stock;
        const failed = await newOrder("pickup");
        await customer
          .getByRole("button", { name: "اختبار فشل الدفع", exact: true })
          .click();
        await expect(
          customer.locator(".summary").getByText("ملغي", { exact: true }),
        ).toBeVisible();
        expect(
          (
            await json(
              customer,
              "POST",
              "/payments/test/" + failed + "?outcome=failed",
            )
          ).duplicate,
        ).toBe(true);
        const cancelled = await newOrder("pickup");
        await customer
          .getByRole("button", { name: "إلغاء الطلب", exact: true })
          .click();
        await expect(
          customer.locator(".summary").getByText("ملغي", { exact: true }),
        ).toBeVisible();
        const rejected = await newOrder("pickup");
        await pay(rejected);
        await seller.goto("/orders/" + rejected);
        await seller
          .getByRole("button", { name: "إلغاء الطلب أو رفضه", exact: true })
          .click();
        await expect(
          seller.locator(".summary").getByText("ملغي", { exact: true }),
        ).toBeVisible();
        const after = (await json(seller, "GET", "/seller/products")).find(
          (p: any) => p.id === productId,
        ).stock;
        expect(after).toBe(stock);
        await owner.goto("/orders/" + rejected);
        const refund = owner
          .locator("form")
          .filter({ has: owner.locator('input[name="amount"]') });
        await refund.locator('input[name="amount"]').fill("10");
        await refund.getByRole("button").click();
        await expect
          .poll(
            async () =>
              (await json(owner, "GET", "/orders/" + rejected)).refunded,
          )
          .toBe(1000);
        expect(
          (
            await owner.request.post(
              origin +
                "/api/payments/refund/" +
                rejected +
                "?amount=999999&event_id=" +
                crypto.randomUUID(),
              { headers: { Origin: origin } },
            )
          ).status(),
        ).toBe(422);
        await refund.locator('input[name="amount"]').fill("65");
        await refund.getByRole("button").click();
        await expect
          .poll(
            async () =>
              (await json(owner, "GET", "/orders/" + rejected)).payment_status,
          )
          .toBe("refunded");
      },
    );
    await checkpoint(
      "العميل والمالك",
      "O3",
      "الدعم والتقرير والتنزيل وسجل الأحداث",
      async () => {
        await customer.goto("/orders/" + primary);
        const message = "تذكرة تدقيق الأدوار " + stamp;
        await customer.getByLabel("وضح طلبك").fill(message);
        await customer.getByRole("button", { name: "إرسال طلب دعم" }).click();
        await expect(customer.getByRole("status")).toContainText(
          "تم تسجيل طلب الدعم",
        );
        await owner.goto("/admin");
        await owner.getByRole("button", { name: "الدعم", exact: true }).click();
        const ticket = owner.locator(".panel").filter({ hasText: message });
        await ticket.getByRole("button").click();
        await expect(ticket).toContainText("تمت معالجته");
        const report = await json(seller, "GET", "/seller/reports");
        expect(report.orders).toBe(7);
        expect(report.paid_orders).toBe(5);
        expect(report.product_sales).toBe(46000);
        expect(report.delivery_charges).toBe(4400);
        expect(report.refunds).toBe(7500);
        expect(report.net_profit).toBeNull();
        await owner
          .getByRole("button", { name: "التقارير", exact: true })
          .click();
        const download = owner.waitForEvent("download");
        await owner.getByRole("button", { name: "تنزيل التقرير CSV" }).click();
        expect((await download).suggestedFilename()).toBe("sales-report.csv");
        await screenshot(owner, "owner");
        expect(
          (await customer.request.get(origin + "/api/admin/reports")).status(),
        ).toBe(403);
        expect(
          (await driver.request.get(origin + "/api/seller/reports")).status(),
        ).toBe(403);
        expect(
          (await seller.request.get(origin + "/api/admin/users")).status(),
        ).toBe(403);
      },
    );
    await checkpoint(
      "العميل والمالك",
      "C5",
      "تصدير البيانات وطلب المحو ومراجعته دون محو السجلات المالية",
      async () => {
        await customer.goto("/account");
        const exported = customer.waitForEvent("download");
        await customer
          .getByRole("button", { name: "تنزيل نسخة من بياناتي" })
          .click();
        expect((await exported).suggestedFilename()).toBe("my-account.json");
        await customer
          .getByRole("button", { name: "طلب محو بيانات الحساب للمراجعة" })
          .click();
        await expect(customer.getByRole("status")).toContainText(
          "تم تسجيل الطلب للمراجعة",
        );
        const user = await json(customer, "GET", "/auth/me");
        await owner.goto("/admin");
        await owner
          .getByRole("button", { name: "الخصوصية", exact: true })
          .click();
        const request = owner
          .locator("form")
          .filter({ hasText: user.id.slice(0, 10) });
        await request
          .getByLabel("ملاحظة المعالجة")
          .fill(
            "طلب محو وهمي للتدقيق؛ تحفظ المعاملات حتى اعتماد سياسة الاحتفاظ",
          );
        await request.getByRole("button", { name: "حفظ متابعة الطلب" }).click();
        await expect(request).toContainText("in_review");
        expect((await json(customer, "GET", "/orders/" + primary)).status).toBe(
          "delivered",
        );
      },
    );
    await checkpoint(
      "الأسرة والعميل",
      "S4",
      "نفاد المخزون والإجازة يمنعان الشراء والعودة تتيح مراجعة السعر",
      async () => {
        const current = (await json(seller, "GET", "/seller/products")).find(
          (p: any) => p.id === productId,
        );
        await json(seller, "PUT", "/seller/products/" + productId, {
          ...current,
          stock: 0,
        });
        await customer.goto("/product/" + productId);
        await expect(
          customer.getByRole("button", { name: /أضف إلى السلة/ }),
        ).toBeDisabled();
        await json(seller, "PUT", "/seller/products/" + productId, current);
        await seller.goto("/seller");
        await seller
          .getByRole("button", { name: "إعدادات المتجر", exact: true })
          .click();
        await seller.getByLabel(/المتجر في إجازة/).check();
        await seller.getByRole("button", { name: "حفظ الإعدادات" }).click();
        await expect
          .poll(
            async () =>
              (await json(seller, "GET", "/seller/household")).on_vacation,
          )
          .toBe(true);
        await addOption(customer, 1);
        await customer.goto("/checkout");
        await customer.getByLabel(/موعد الاستلام أو التسليم/).fill(schedule());
        await customer.getByRole("checkbox").check();
        await customer
          .getByRole("button", { name: "مراجعة السعر والتوفر" })
          .click();
        await expect(customer.locator("main").getByRole("alert")).toContainText(
          "غير متاحة",
        );
        await seller.getByLabel(/المتجر في إجازة/).uncheck();
        await seller.getByRole("button", { name: "حفظ الإعدادات" }).click();
        await expect
          .poll(
            async () =>
              (await json(seller, "GET", "/seller/household")).on_vacation,
          )
          .toBe(false);
        await customer
          .getByRole("button", { name: "مراجعة السعر والتوفر" })
          .click();
        await expect(
          customer.getByRole("button", { name: /إنشاء الطلب التجريبي/ }),
        ).toBeVisible();
        await customer.goto("/cart");
        await customer
          .getByRole("button", { name: "إفراغ السلة", exact: true })
          .click();
      },
    );
    await checkpoint(
      "المالك",
      "O4",
      "منع حذف تصنيف مستخدم بالمنتجات",
      async () => {
        await owner
          .getByRole("button", { name: "التصنيفات", exact: true })
          .click();
        const category = owner
          .locator("article")
          .filter({ has: owner.getByText("other", { exact: true }) });
        await category
          .getByRole("button", { name: "حذف إن لم يرتبط بمنتجات" })
          .click();
        await expect(owner.getByRole("status")).toContainText("لا يمكن حذف");
        await expect(category).toBeVisible();
      },
    );
    await checkpoint(
      "الأسرة",
      "S3",
      "اشتراك شهري وفشل ونجاح وتجديد دون تمديد مكرر",
      async () => {
        await seller.goto("/seller");
        await seller
          .getByRole("button", { name: "المبيعات والاشتراك", exact: true })
          .click();
        const panel = seller
          .locator("section")
          .filter({
            has: seller.getByRole("heading", {
              name: "اشتراك الأسرة وفواتيره",
            }),
          })
          .first();
        await panel.getByRole("radio", { name: /شهري/ }).check();
        await panel
          .getByRole("button", { name: "إنشاء فاتورة اشتراك تجريبية" })
          .click();
        const invoice = panel.locator("article").first();
        await invoice.getByRole("button", { name: "اختبار فشل الدفع" }).click();
        await expect(invoice).toContainText("تعذر الدفع");
        await invoice.getByRole("button", { name: /محاكاة دفع/ }).click();
        await expect(invoice).toContainText("مدفوعة تجريبيًا");
        await panel.getByRole("checkbox").check();
        await expect
          .poll(
            async () =>
              (await json(seller, "GET", "/seller/subscription")).auto_renew,
          )
          .toBe(true);
        const before = await json(seller, "GET", "/seller/subscription");
        expect(before.auto_renew).toBe(true);
        expect(
          (
            await json(
              seller,
              "POST",
              "/seller/subscription/invoices/" +
                before.invoices[0].id +
                "/test-pay",
            )
          ).duplicate,
        ).toBe(true);
        expect(
          (await json(seller, "GET", "/seller/subscription")).ends_at,
        ).toBe(before.ends_at);
        await seller.route(
          /\/api\/seller\/subscription\/renewal\?enabled=false$/,
          (route) =>
            route.fulfill({
              status: 409,
              contentType: "application/json",
              body: JSON.stringify({ detail: "فشل حفظ التجديد التجريبي" }),
            }),
          { times: 1 },
        );
        await panel.getByRole("checkbox").click();
        await expect(seller.getByRole("status")).toContainText(
          "فشل حفظ التجديد التجريبي",
        );
        await expect(panel.getByRole("checkbox")).toBeChecked();
        verify(
          "الأسرة",
          "S3.1",
          "يبقى التجديد على حالته السابقة عند فشل الحفظ بمحاكاة HTTP409",
          (await json(seller, "GET", "/seller/subscription")).auto_renew ===
            true,
        );
      },
    );
    verify(
      "الواجهة",
      "UI1",
      "لا أخطاء JavaScript أو مفاتيح مكررة أو استجابات500 أثناء الأدوار",
      consoleErrors.length === 0,
    );
    finished = true;
  } finally {
    const owner = pages.owner,
      seller = pages.seller;
    if (seller)
      for (const id of productsToPause)
        await seller.request
          .delete(origin + "/api/seller/products/" + id, {
            headers: { Origin: origin },
          })
          .catch(() => {});
    if (owner && householdId)
      await owner.request
        .post(
          origin +
            "/api/admin/households/" +
            householdId +
            "/verify?verified=false",
          { headers: { Origin: origin } },
        )
        .catch(() => {});
    if (owner && rule)
      await owner.request
        .put(origin + "/api/admin/delivery-rule", {
          headers: { Origin: origin },
          data: rule,
        })
        .catch(() => {});
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          completed: finished,
          status:
            finished && checkpoints.every((c) => c.status === "passed")
              ? "passed"
              : "failed",
          date_saudi: new Date().toLocaleString("sv-SE", {
            timeZone: "Asia/Riyadh",
          }),
          node: process.version,
          checkpoints,
          console_errors: [
            ...new Map(
              consoleErrors.map((e) => [e.role + e.message, e]),
            ).values(),
          ],
          order_ids: orderIds,
          cleanup:
            "Only audit products paused and own household hidden; order history preserved; delivery rule restored",
          limits:
            "Local simulated money and delivery only; no external SMTP, Telegram, AI or gateway connection asserted",
        },
        null,
        2,
      ),
    );
    for (const context of contexts) await context.close();
  }
});
