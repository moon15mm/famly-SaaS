"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, post, money, date, Order } from "@/lib/api";
import { useStore } from "./provider";
import { PaymentResult, usePaymentProvider } from "./payment-mode";
export type PlanDetails = {
  id: string;
  name: string;
  monthly_price: number;
  annual_price: number | null;
  product_limit: number;
  trial_days: number;
};
export type Invoice = {
  id: string;
  household_id: string;
  plan_name: string;
  amount: number;
  status: string;
  provider: string;
  interval: string;
  created_at: string;
  paid_at: string | null;
  period_start: string | null;
  period_end: string | null;
};
type Subscription = {
  status: string;
  plan_id: string | null;
  interval: string | null;
  ends_at: string | null;
  auto_renew: boolean;
  invoices: Invoice[];
};
export function SubscriptionPanel() {
  const [plans, setPlans] = useState<PlanDetails[]>([]),
    [subscription, setSubscription] = useState<Subscription | null>(null),
    [planId, setPlanId] = useState(""),
    [interval, setInterval] = useState("monthly"),
    [busy, setBusy] = useState(false);
  const key = useRef("");
  const { toast } = useStore();
  const provider = usePaymentProvider();
  function load() {
    api<PlanDetails[]>("/plans")
      .then((p) => {
        setPlans(p);
        setPlanId((old) => old || p[0]?.id || "");
      })
      .catch((e) => toast(e.message));
    api<Subscription>("/seller/subscription")
      .then(setSubscription)
      .catch((e) => toast(e.message));
  }
  useEffect(() => {
    key.current = crypto.randomUUID();
    load();
  }, []);
  useEffect(() => {
    key.current = crypto.randomUUID();
  }, [planId, interval]);
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/seller/subscription/invoices", {
        plan_id: planId,
        interval,
        idempotency_key: key.current,
      });
      load();
      toast("الفاتورة جاهزة للدفع");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function pay(id: string, outcome: string) {
    setBusy(true);
    try {
      await post(
        "/seller/subscription/invoices/" + id + "/test-pay?outcome=" + outcome,
      );
      load();
      if (outcome === "paid") key.current = crypto.randomUUID();
      toast(
        outcome === "paid"
          ? "تم تفعيل الاشتراك تجريبيًا"
          : "تم تسجيل فشل الدفع التجريبي",
      );
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const chosen = plans.find((p) => p.id === planId);
  return (
    <section className="panel form-stack">
      <h2>اشتراك الأسرة وفواتيره</h2>
      <p>
        الحالة:{" "}
        <strong>
          {(
            {
              trial: "فترة تجريبية",
              active: "نشط",
              expired: "منتهٍ",
              pending: "بانتظار الدفع",
            } as Record<string, string>
          )[subscription?.status || ""] || subscription?.status}
        </strong>
        {subscription?.ends_at && " · حتى " + date(subscription.ends_at)}
      </p>
      <form method="post" className="form-stack" onSubmit={create}>
        <label>
          الباقة
          <select
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            required
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.product_limit} منتج
              </option>
            ))}
          </select>
        </label>
        <fieldset className="delivery-options">
          <legend>مدة الاشتراك</legend>
          <label className="choice">
            <input
              type="radio"
              name="interval"
              checked={interval === "monthly"}
              onChange={() => setInterval("monthly")}
            />
            شهري · {money(chosen?.monthly_price || 0)} ر.س
          </label>
          <label className="choice">
            <input
              type="radio"
              name="interval"
              checked={interval === "annual"}
              disabled={chosen?.annual_price == null}
              onChange={() => setInterval("annual")}
            />
            سنوي ·{" "}
            {chosen?.annual_price == null
              ? "غير متاح لهذه الباقة"
              : money(chosen.annual_price) + " ر.س"}
          </label>
        </fieldset>
        <button className="button" disabled={busy || !planId}>
          {provider === "tap" ? "إصدار فاتورة الاشتراك" : "إنشاء فاتورة اشتراك تجريبية"}
        </button>
      </form>
      {subscription?.status === "active" && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={subscription.auto_renew}
            disabled={busy}
            onChange={async (e) => {
              const enabled = e.currentTarget.checked;
              const previous = subscription.auto_renew;
              setSubscription((current) =>
                current ? { ...current, auto_renew: enabled } : current,
              );
              setBusy(true);
              try {
                await post("/seller/subscription/renewal?enabled=" + enabled);
                load();
              } catch (e) {
                setSubscription((current) =>
                  current ? { ...current, auto_renew: previous } : current,
                );
                toast((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />{" "}
          إصدار فاتورة تجديد وإشعاري قبل انتهاء الاشتراك
        </label>
      )}
      <PaymentResult subject="subscription" />
      <p className="notice">
        {provider === "tap"
          ? "الدفع هنا عبر بوابة Tap ويُخصم فعليًا. الإيصالات داخلية وليست فواتير ضريبية. التجديد يصدر فاتورة ولا يخصم تلقائيًا."
          : "الفواتير والمدفوعات هنا محاكاة محلية وليست فواتير ضريبية أو تحصيلًا فعليًا. التجديد لا يخصم أموالًا تلقائيًا."}
      </p>
      <div className="order-list">
        {subscription?.invoices.map((i) => (
          <article className="order-card" key={i.id}>
            <div className="order-card-top">
              <div>
                <h3>
                  {i.plan_name} · {i.interval === "annual" ? "سنوي" : "شهري"}
                </h3>
                <p>
                  {date(i.created_at)} · {money(i.amount)} ر.س
                </p>
              </div>
              <span className="badge">
                {i.status === "paid"
                  ? i.provider === "tap"
                    ? "مدفوعة عبر Tap"
                    : "مدفوعة تجريبيًا"
                  : i.status === "failed"
                    ? "تعذر الدفع"
                    : "غير مدفوعة"}
              </span>
            </div>
            {i.period_end && <p>صالح حتى {date(i.period_end)}</p>}
            <div className="order-actions">
              <Link className="text-link" href={"/invoices/" + i.id}>
                عرض الإيصال وطباعته
              </Link>
              {i.status !== "paid" && (
                <>
                  {provider === "tap" && (
                  <button
                    disabled={busy}
                    className="button"
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const res = await post<{ checkout_url?: string }>(
                          "/payments/tap/subscription/" + i.id,
                        );
                        if (res?.checkout_url) {
                          window.location.href = res.checkout_url;
                          return;
                        }
                      } catch (e) {
                        toast((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    دفع الاشتراك عبر Tap (مدى / Apple Pay) · {money(i.amount)} ر.س
                  </button>
                  )}
                  {provider === "test" && (
                    <button
                      disabled={busy}
                      className="text-button"
                      onClick={() => pay(i.id, "paid")}
                    >
                      محاكاة دفع تجريبية
                    </button>
                  )}
                </>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
type DocumentRow = {
  id: string;
  owner_id: string;
  household_id: string | null;
  kind: string;
  status: string;
  reviewer_note: string;
  created_at: string;
  requirement_id?: string | null;
  expires_on?: string | null;
};
export function DocumentsPanel({ admin = false }: { admin?: boolean }) {
  const [items, setItems] = useState<DocumentRow[]>([]),
    [links, setLinks] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  const { toast } = useStore();
  function load() {
    api<DocumentRow[]>("/verification/documents")
      .then(setItems)
      .catch((e) => toast(e.message));
  }
  useEffect(load, []);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      d = new FormData(form),
      file = d.get("file");
    if (!(file instanceof File)) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      await api(
        "/verification/documents?kind=" +
          encodeURIComponent(String(d.get("kind"))),
        { method: "POST", body },
      );
      form.reset();
      load();
      toast("حفظ المستند في التخزين الخاص");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel form-stack">
      <h2>{admin ? "مراجعة مستندات الاعتماد" : "مستندات الاعتماد الخاصة"}</h2>
      <p className="hint">
        المستندات لا تظهر في المتجر. روابط التنزيل مؤقتة ومقيدة بحساب صاحبها أو
        الإدارة. الاعتماد الإداري لا يمثل توثيقًا حكوميًا.
      </p>
      {!admin && (
        <form method="post" className="form-stack" onSubmit={upload}>
          <label>
            نوع الوثيقة
            <input
              name="kind"
              required
              minLength={2}
              maxLength={80}
              placeholder="رخصة أو وثيقة نشاط"
            />
          </label>
          <label>
            صورة واضحة للمستند
            <input
              name="file"
              type="file"
              required
              accept="image/jpeg,image/png,image/webp"
            />
          </label>
          <p className="hint">
            صور JPG أو PNG أو WebP حتى 5 ميجابايت. لا ترفع المستند ضمن صور
            المنتجات العامة.
          </p>
          <button className="button" disabled={busy}>
            رفع المستند الخاص
          </button>
        </form>
      )}
      <div className="order-list">
        {items.map((d) => (
          <article className="order-card" key={d.id}>
            <div className="order-card-top">
              <h3>{d.kind}</h3>
              <span className="badge">
                {d.status === "accepted"
                  ? "تمت مراجعته وقبوله"
                  : d.status === "rejected"
                    ? "مرفوض"
                    : "بانتظار المراجعة"}
              </span>
            </div>
            <p>
              {date(d.created_at)}
              {d.expires_on ? " · ينتهي في " + d.expires_on : ""}
            </p>
            {admin && <small>معرف المالك: {d.owner_id.slice(0, 10)}</small>}
            {d.reviewer_note && <p>{d.reviewer_note}</p>}
            <button
              className="text-button"
              onClick={async () => {
                try {
                  const r = await post<{ url: string }>(
                    "/verification/documents/" + d.id + "/link",
                  );
                  setLinks({ ...links, [d.id]: r.url });
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            >
              إنشاء رابط تنزيل آمن لخمس دقائق
            </button>
            {links[d.id] && (
              <a className="text-link" href={links[d.id]}>
                تنزيل المستند
              </a>
            )}
            {admin && (
              <form
                className="form-stack"
                method="post"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const values = Object.fromEntries(
                    new FormData(e.currentTarget),
                  );
                  // An empty date field means "keep the uploaded expiry".
                  const body = {
                    ...values,
                    expires_on: values.expires_on || null,
                  };
                  try {
                    await post("/admin/verification/" + d.id + "/review", body);
                    load();
                    toast("سجلت نتيجة المراجعة");
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                <label>
                  قرار المراجعة
                  <select name="status">
                    <option value="accepted">قبول المستند بعد التحقق</option>
                    <option value="rejected">رفض المستند</option>
                  </select>
                </label>
                <label>
                  تاريخ الانتهاء — يُصحَّح عند الحاجة
                  <input
                    name="expires_on"
                    type="date"
                    defaultValue={d.expires_on || ""}
                  />
                </label>
                <label>
                  ملاحظة للأسرة أو السائق
                  <input name="note" maxLength={1000} />
                </label>
                <button className="button">حفظ نتيجة المراجعة</button>
              </form>
            )}
          </article>
        ))}
      </div>
      {!items.length && <p>لا توجد مستندات مرفوعة.</p>}
    </section>
  );
}
export type FinancialReport = {
  orders: number;
  paid_orders: number;
  product_sales: number;
  delivery_charges: number;
  refunds: number;
  daily: {
    day: string;
    orders: number;
    product_sales: number;
    delivery_charges: number;
    refunds: number;
  }[];
};
export function ReportPanel({ scope }: { scope: "admin" | "seller" }) {
  const [report, setReport] = useState<FinancialReport | null>(null);
  const { toast } = useStore();
  useEffect(() => {
    api<FinancialReport>("/" + scope + "/reports")
      .then(setReport)
      .catch((e) => toast(e.message));
  }, [scope]);
  function csv() {
    if (!report) return;
    const rows = [
      [
        "اليوم",
        "الطلبات",
        "المنتجات بالهللة",
        "التوصيل بالهللة",
        "الاستردادات بالهللة",
      ],
      ...report.daily.map((r) => [
        r.day,
        r.orders,
        r.product_sales,
        r.delivery_charges,
        r.refunds,
      ]),
    ];
    const blob = new Blob(
        ["\ufeff" + rows.map((r) => r.join(",")).join("\n")],
        { type: "text/csv;charset=utf-8" },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "sales-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="section">
      <div className="toolbar">
        <h2>تقرير آخر 90 يومًا</h2>
        <button className="text-button" onClick={csv} disabled={!report}>
          تنزيل التقرير CSV
        </button>
      </div>
      {report && (
        <>
          <div className="stats-grid">
            {[
              ["الطلبات", report.orders],
              ["مبيعات المنتجات", money(report.product_sales) + " ر.س"],
              ["الاستردادات", money(report.refunds) + " ر.س"],
            ].map(([t, v]) => (
              <div className="stat" key={String(t)}>
                <small>{t}</small>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>اليوم — توقيت السعودية</th>
                  <th>الطلبات</th>
                  <th>المنتجات</th>
                  <th>التوصيل</th>
                  <th>الاستردادات</th>
                </tr>
              </thead>
              <tbody>
                {report.daily.map((r) => (
                  <tr key={r.day}>
                    <td>{r.day}</td>
                    <td>{r.orders}</td>
                    <td>{money(r.product_sales)} ر.س</td>
                    <td>{money(r.delivery_charges)} ر.س</td>
                    <td>{money(r.refunds)} ر.س</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="notice">
        أرقام اختبار مسجلة في النظام. لا تعرض صافي أرباح أو مستحقات مسددة لعدم
        وجود رسوم وتحويلات فعلية مؤكدة.
      </p>
    </section>
  );
}
export function ReceiptPage({
  id,
  subscription = false,
}: {
  id: string;
  subscription?: boolean;
}) {
  const [order, setOrder] = useState<Order | null>(null),
    [invoice, setInvoice] = useState<Invoice | null>(null),
    [error, setError] = useState("");
  const provider = usePaymentProvider();
  const real = provider === "tap";
  useEffect(() => {
    if (subscription)
      api<Invoice>("/subscription/invoices/" + id)
        .then(setInvoice)
        .catch((e) => setError(e.message));
    else
      api<{ order: Order }>("/orders/" + id + "/receipt")
        .then((r) => setOrder(r.order))
        .catch((e) => setError(e.message));
  }, [id, subscription]);
  return (
    <div className="container page narrow">
      <div className="panel printable">
        <h1>
          {subscription ? "إيصال اشتراك" : "إيصال طلب"}
          {real ? "" : " تجريبي"}
        </h1>
        <p>من بيوتنا · #{id.slice(0, 10)}</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {order && (
          <>
            <h2>{order.household_name}</h2>
            {order.items.map((i, n) => (
              <p key={n}>
                {i.name} {i.option_label} × {i.quantity} —{" "}
                {money(i.unit_price * i.quantity)} ر.س
              </p>
            ))}
            <hr />
            <p>قيمة المنتجات: {money(order.subtotal)} ر.س</p>
            <p>التوصيل: {money(order.delivery_fee)} ر.س</p>
            <h2>الإجمالي: {money(order.total)} ر.س</h2>
          </>
        )}
        {invoice && (
          <>
            <h2>{invoice.plan_name}</h2>
            <p>
              {invoice.interval === "annual" ? "اشتراك سنوي" : "اشتراك شهري"}
            </p>
            <h2>{money(invoice.amount)} ر.س</h2>
            <p>
              الحالة:{" "}
              {invoice.status === "paid"
                ? invoice.provider === "tap"
                  ? "مدفوع عبر Tap"
                  : "مدفوع تجريبيًا"
                : "غير مدفوع"}
            </p>
            {invoice.period_end && (
              <p>نهاية الفترة: {date(invoice.period_end)}</p>
            )}
          </>
        )}
        <p className="notice">
          {real
            ? "هذا إيصال داخلي لدفعة عبر بوابة Tap، وليس فاتورة ضريبية معتمدة. لا يطبق حساب ضريبة."
            : "هذا إيصال داخلي تجريبي، وليس فاتورة ضريبية معتمدة أو إثبات تحصيل أموال. لا يطبق حساب ضريبة افتراضيًا."}
        </p>
        <button className="button no-print" onClick={() => window.print()}>
          طباعة الإيصال أو حفظه
        </button>
      </div>
    </div>
  );
}
