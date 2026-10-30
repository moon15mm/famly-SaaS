"use client";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { api, post, Product, Category, money, date } from "@/lib/api";
import { useStore } from "./provider";
import { DocumentsPanel, ReportPanel, PlanDetails } from "./business-tools";
type Job = {
  id: string;
  kind: string;
  attempts: number;
  dead_letter: boolean;
  last_error: string;
  sent_at: string | null;
  claimed_until: string | null;
};
type Privacy = {
  id: string;
  user_id: string;
  status: string;
  kind: string;
  note: string;
};
type Issue = {
  id: string;
  order_id: string;
  driver_id: string;
  reason: string;
  resolved: boolean;
};
type Waiting = {
  order_id: string;
  household_name: string;
  scheduled_at: string;
  overdue: boolean;
};
export function AdminOperations({ tab }: { tab: string }) {
  const { toast } = useStore();
  const [products, setProducts] = useState<Product[]>([]),
    [categories, setCategories] = useState<Category[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [privacy, setPrivacy] = useState<Privacy[]>([]),
    [issues, setIssues] = useState<Issue[]>([]),
    [waiting, setWaiting] = useState<Waiting[]>([]),
    [plans, setPlans] = useState<(PlanDetails & { active: boolean })[]>([]),
    [editing, setEditing] = useState<Category | null>(null),
    [error, setError] = useState("");
  function load() {
    setError("");
    if (tab === "products")
      api<Product[]>("/admin/products")
        .then(setProducts)
        .catch((e) => setError(e.message));
    if (tab === "categories")
      api<Category[]>("/categories")
        .then(setCategories)
        .catch((e) => setError(e.message));
    if (tab === "outbox")
      api<Job[]>("/admin/outbox")
        .then(setJobs)
        .catch((e) => setError(e.message));
    if (tab === "privacy")
      api<Privacy[]>("/admin/privacy-requests")
        .then(setPrivacy)
        .catch((e) => setError(e.message));
    if (tab === "issues") {
      api<Issue[]>("/admin/delivery-issues")
        .then(setIssues)
        .catch((e) => setError(e.message));
      api<Waiting[]>("/admin/delivery/waiting")
        .then(setWaiting)
        .catch((e) => setError(e.message));
    }
    if (tab === "plans")
      api<typeof plans>("/admin/plans")
        .then(setPlans)
        .catch((e) => setError(e.message));
  }
  useEffect(load, [tab]);
  async function act(path: string, body?: unknown) {
    try {
      await post(path, body);
      toast("تم حفظ التحديث");
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function category(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      d = new FormData(form);
    try {
      await api("/admin/categories/" + d.get("id"), {
        method: "PUT",
        body: JSON.stringify({ name: d.get("name"), icon: "gift" }),
      });
      setEditing(null);
      form.reset();
      load();
      toast("تم حفظ التصنيف");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  if (tab === "documents") return <DocumentsPanel admin />;
  if (tab === "reports") return <ReportPanel scope="admin" />;
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {tab === "products" && (
        <>
          <h2>إشراف المنتجات</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th>الأسرة</th>
                  <th>السعر</th>
                  <th>الحالة</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.household_name}</td>
                    <td>{money(p.price)} ر.س</td>
                    <td>
                      {p.status === "published"
                        ? "منشور"
                        : p.status === "draft"
                          ? "مسودة"
                          : p.status === "archived"
                            ? "حذفته الأسرة"
                            : "متوقف"}
                    </td>
                    <td>
                      {p.status !== "archived" && (
                        <>
                          <button
                            className="text-button"
                            onClick={() =>
                              act("/admin/products/" + p.id + "/status", {
                                status:
                                  p.status === "published"
                                    ? "paused"
                                    : "published",
                                featured: p.featured,
                              })
                            }
                          >
                            {p.status === "published"
                              ? "إيقاف"
                              : "نشر بعد التحقق"}
                          </button>
                          <button
                            className="text-button"
                            onClick={() =>
                              act("/admin/products/" + p.id + "/status", {
                                status: p.status,
                                featured: !p.featured,
                              })
                            }
                          >
                            {p.featured ? "إلغاء التمييز" : "تمييز في السوق"}
                          </button>
                        </>
                      )}
                      {p.status === "published" && (
                        <Link className="text-link" href={"/product/" + p.id}>
                          المعاينة
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === "categories" && (
        <div className="checkout-grid">
          <div className="order-list">
            {categories.map((c) => (
              <article key={c.id} className="panel">
                <h3>{c.name}</h3>
                <small>{c.id}</small>
                <div className="order-actions">
                  <button className="text-button" onClick={() => setEditing(c)}>
                    تعديل
                  </button>
                  <button
                    className="text-button"
                    onClick={async () => {
                      try {
                        await api("/admin/categories/" + c.id, {
                          method: "DELETE",
                        });
                        load();
                        toast("حذف التصنيف");
                      } catch (e) {
                        toast((e as Error).message);
                      }
                    }}
                  >
                    حذف إن لم يرتبط بمنتجات
                  </button>
                </div>
              </article>
            ))}
          </div>
          <form
            key={editing?.id || "new"}
            method="post"
            className="panel form-stack"
            onSubmit={category}
          >
            <h2>{editing ? "تعديل تصنيف" : "تصنيف جديد"}</h2>
            <label>
              معرف التصنيف
              <input
                name="id"
                pattern="[a-z0-9-]{2,50}"
                required
                defaultValue={editing?.id}
                readOnly={!!editing}
                dir="ltr"
              />
            </label>
            <label>
              اسم التصنيف
              <input
                name="name"
                required
                minLength={2}
                maxLength={80}
                defaultValue={editing?.name}
              />
            </label>
            <button className="button">حفظ التصنيف</button>
            {editing && (
              <button
                className="text-button"
                type="button"
                onClick={() => setEditing(null)}
              >
                إنشاء تصنيف آخر
              </button>
            )}
          </form>
        </div>
      )}
      {tab === "plans" && (
        <section className="section">
          <h2>إعدادات الباقات الحالية</h2>
          <div className="order-list">
            {plans.map((p) => (
              <form
                key={p.id}
                method="post"
                className="panel form-stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  try {
                    await api("/admin/plans/" + p.id, {
                      method: "PUT",
                      body: JSON.stringify({
                        name: d.get("name"),
                        monthly_price: Math.round(
                          Number(d.get("monthly_price")) * 100,
                        ),
                        annual_price:
                          d.get("annual_price") === ""
                            ? null
                            : Math.round(Number(d.get("annual_price")) * 100),
                        product_limit: Number(d.get("product_limit")),
                        trial_days: Number(d.get("trial_days")),
                        active: d.has("active"),
                      }),
                    });
                    load();
                    toast("تم تحديث الباقة");
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                <label>
                  اسم الباقة
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={100}
                    defaultValue={p.name}
                  />
                </label>
                <div className="form-row">
                  <label>
                    شهري بالريال
                    <input
                      name="monthly_price"
                      type="number"
                      required
                      min="0"
                      step="0.01"
                      defaultValue={p.monthly_price / 100}
                    />
                  </label>
                  <label>
                    سنوي بالريال — اختياري
                    <input
                      name="annual_price"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={
                        p.annual_price == null ? "" : p.annual_price / 100
                      }
                    />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    حد المنتجات
                    <input
                      name="product_limit"
                      type="number"
                      required
                      min="1"
                      max="10000"
                      defaultValue={p.product_limit}
                    />
                  </label>
                  <label>
                    أيام التجربة للحسابات الجديدة
                    <input
                      name="trial_days"
                      type="number"
                      required
                      min="0"
                      max="90"
                      defaultValue={p.trial_days}
                    />
                  </label>
                </div>
                <label className="check-label">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={p.active}
                  />
                  متاحة للاشتراكات الجديدة
                </label>
                <button className="button">حفظ إعدادات الباقة</button>
              </form>
            ))}
          </div>
        </section>
      )}
      {tab === "outbox" && (
        <>
          <h2>متابعة رسائل النظام</h2>
          <p className="hint">
            تظهر حالة الإرسال دون محتوى الرسائل أو روابط الاستعادة. الرسائل
            المتعذرة تتوقف بعد ثماني محاولات وتحتاج مراجعة.
          </p>
          <button className="text-button" onClick={load}>
            تحديث
          </button>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>النوع</th>
                  <th>المحاولات</th>
                  <th>الحالة</th>
                  <th>آخر خطأ</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{j.kind}</td>
                    <td>{j.attempts}</td>
                    <td>
                      {j.sent_at
                        ? "مرسلة"
                        : j.dead_letter
                          ? "متعذرة"
                          : j.claimed_until
                            ? "قيد المعالجة"
                            : "في الانتظار"}
                    </td>
                    <td>{j.last_error || "—"}</td>
                    <td>
                      {!j.sent_at && (
                        <button
                          className="text-button"
                          onClick={() =>
                            act("/admin/outbox/" + j.id + "/retry")
                          }
                        >
                          إعادة المحاولة بعد المعالجة
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === "privacy" && (
        <>
          <h2>طلبات الخصوصية</h2>
          <p className="notice">
            لا تمحَ سجلات قانونية أو مالية دون سياسة احتفاظ معتمدة. الطلبات هنا
            للمراجعة والمتابعة.
          </p>
          {privacy.map((d) => (
            <form
              key={d.id}
              method="post"
              className="panel form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                act(
                  "/admin/privacy-requests/" + d.id + "/review",
                  Object.fromEntries(new FormData(e.currentTarget)),
                );
              }}
            >
              <h3>طلب محو #{d.id.slice(0, 8)}</h3>
              <p>
                معرف المستخدم {d.user_id.slice(0, 10)} · {d.status}
              </p>
              <label>
                الحالة
                <select
                  name="status"
                  defaultValue={
                    d.status === "rejected" ? "rejected" : "in_review"
                  }
                >
                  <option value="in_review">قيد المراجعة</option>
                  <option value="rejected">رفض مع توضيح السبب</option>
                </select>
              </label>
              <label>
                ملاحظة المعالجة
                <textarea
                  name="note"
                  required
                  minLength={10}
                  maxLength={1000}
                  defaultValue={d.note}
                />
              </label>
              <button className="button">حفظ متابعة الطلب</button>
            </form>
          ))}
          {!privacy.length && <p className="empty">لا طلبات خصوصية.</p>}
        </>
      )}
      {tab === "issues" && (
        <>
          <h2>طلبات تنتظر سائقًا</h2>
          <p className="hint">
            يستمر عرض هذه الطلبات على السائقين. إن تجاوز الطلب موعده دون سائق
            فافتح تفاصيله لإلغائه مع ذكر السبب، ثم نفّذ الاسترداد.
          </p>
          <div className="order-list">
            {waiting.map((w) => (
              <article key={w.order_id} className="panel">
                <h3>
                  طلب #{w.order_id.slice(0, 8)} · {w.household_name}
                </h3>
                <p>الموعد: {date(w.scheduled_at)}</p>
                <span className="badge">
                  {w.overdue ? "تجاوز الموعد" : "قبل الموعد"}
                </span>
                <Link className="text-link" href={"/orders/" + w.order_id}>
                  تفاصيل الطلب
                </Link>
              </article>
            ))}
          </div>
          {!waiting.length && (
            <p className="empty">لا طلبات توصيل تنتظر سائقًا.</p>
          )}
          <h2>تعثر رحلات التوصيل</h2>
          {issues.map((i) => (
            <form
              key={i.id}
              method="post"
              className="panel form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                act("/admin/delivery/" + i.order_id + "/reassign", {
                  note: d.get("note"),
                  returned_to_seller: d.has("returned"),
                });
              }}
            >
              <h3>طلب #{i.order_id.slice(0, 8)}</h3>
              <p>{i.reason}</p>
              <span className="badge">
                {i.resolved ? "عولجت" : "تحتاج متابعة"}
              </span>
              <Link className="text-link" href={"/orders/" + i.order_id}>
                تفاصيل الطلب
              </Link>
              {!i.resolved && (
                <>
                  <label>
                    تقرير المعالجة والتحقق التشغيلي
                    <textarea
                      name="note"
                      minLength={10}
                      maxLength={1000}
                      required
                    />
                  </label>
                  <label className="check-label">
                    <input type="checkbox" name="returned" />
                    تحققت من عودة الطلب فعليًا للأسرة إذا سبق استلامه من السائق
                  </label>
                  <button className="button">
                    إعادة عرض التوصيل بعد التحقق
                  </button>
                </>
              )}
            </form>
          ))}
          {!issues.length && <p className="empty">لا مشكلات توصيل مسجلة.</p>}
        </>
      )}
    </>
  );
}
