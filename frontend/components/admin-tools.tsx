"use client";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { api, post, Product, Category, money, date, status } from "@/lib/api";
import { useStore } from "./provider";
import { DocumentsPanel, ReportPanel, PlanDetails } from "./business-tools";
import { ContractsAdmin } from "./compliance";
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
type ActiveTrip = {
  order_id: string;
  status: string;
  household_name: string;
  driver_name: string;
  position_updated_at: string | null;
  stale: boolean;
};
export function AdminOperations({ tab }: { tab: string }) {
  const { toast } = useStore();
  const [products, setProducts] = useState<Product[]>([]),
    [categories, setCategories] = useState<Category[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [privacy, setPrivacy] = useState<Privacy[]>([]),
    [issues, setIssues] = useState<Issue[]>([]),
    [waiting, setWaiting] = useState<Waiting[]>([]),
    [trips, setTrips] = useState<ActiveTrip[]>([]),
    [plans, setPlans] = useState<(PlanDetails & { active: boolean })[]>([]),
    [editing, setEditing] = useState<Category | null>(null),
    [productSearch, setProductSearch] = useState(""),
    [productStatusFilter, setProductStatusFilter] = useState<"all" | "published" | "paused" | "draft">("all"),
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
      api<ActiveTrip[]>("/admin/deliveries/active")
        .then(setTrips)
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
  if (tab === "contracts") return <ContractsAdmin />;
  if (tab === "reports") return <ReportPanel scope="admin" />;
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {tab === "products" && (() => {
        const filteredProducts = products.filter((p) => {
          const s = productSearch.trim().toLowerCase();
          const matchesSearch =
            !s ||
            p.name.toLowerCase().includes(s) ||
            (p.household_name && p.household_name.toLowerCase().includes(s));
          const matchesStatus =
            productStatusFilter === "all" ||
            (productStatusFilter === "published" && p.status === "published") ||
            (productStatusFilter === "paused" && p.status === "paused") ||
            (productStatusFilter === "draft" && (p.status === "draft" || p.status === "archived"));
          return matchesSearch && matchesStatus;
        });
        const publishedCount = products.filter((p) => p.status === "published").length;
        const pausedCount = products.filter((p) => p.status === "paused").length;
        const draftCount = products.filter((p) => p.status === "draft" || p.status === "archived").length;

        return (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "bold" }}>إشراف وإدارة بيع المنتجات 🛍️</h2>
                <p style={{ margin: "4px 0 0", color: "#666", fontSize: "13px" }}>
                  التحكم الفوري في إتاحة أو إيقاف بيع أي منتج محدد للأسر في السوق
                </p>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <span style={{ background: "#e0f2fe", color: "#0369a1", padding: "6px 12px", borderRadius: "8px", fontSize: "13px", fontWeight: "bold" }}>
                  الإجمالي: {products.length}
                </span>
                <span style={{ background: "#dcfce7", color: "#15803d", padding: "6px 12px", borderRadius: "8px", fontSize: "13px", fontWeight: "bold" }}>
                  معروض للبيع: {publishedCount}
                </span>
                <span style={{ background: "#fee2e2", color: "#b91c1c", padding: "6px 12px", borderRadius: "8px", fontSize: "13px", fontWeight: "bold" }}>
                  موقوف عن البيع: {pausedCount}
                </span>
              </div>
            </div>

            {/* Search and Filters */}
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px", alignItems: "center" }}>
              <input
                type="text"
                placeholder="🔍 بحث باسم المنتج أو الأسرة المنتجة..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                style={{
                  flex: "1",
                  minWidth: "260px",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid #d1d5db",
                  fontSize: "14px"
                }}
              />
              <div style={{ display: "flex", gap: "6px" }}>
                {(
                  [
                    ["all", `الكل (${products.length})`],
                    ["published", `المعروضة للبيع (${publishedCount})`],
                    ["paused", `الموقوفة 🛑 (${pausedCount})`],
                    ["draft", `المسودات (${draftCount})`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setProductStatusFilter(key)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: "8px",
                      border: productStatusFilter === key ? "2px solid #5a1926" : "1px solid #d1d5db",
                      background: productStatusFilter === key ? "#5a1926" : "white",
                      color: productStatusFilter === key ? "white" : "#374151",
                      fontSize: "12px",
                      fontWeight: productStatusFilter === key ? "bold" : "normal",
                      cursor: "pointer"
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>المنتج</th>
                    <th>الأسرة المنتجة</th>
                    <th>السعر</th>
                    <th>حالة البيع في السوق</th>
                    <th>التحكم والإجراء الفوري</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: "24px", color: "#888" }}>
                        لا توجد منتجات مطابقة لخيارات البحث أو التصفية
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.name}</strong>
                          {p.featured && (
                            <span style={{ marginRight: "6px", background: "#fef3c7", color: "#b45309", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", fontWeight: "bold" }}>
                              ⭐ مميز
                            </span>
                          )}
                        </td>
                        <td>{p.household_name || "—"}</td>
                        <td>{money(p.price)} ر.س</td>
                        <td>
                          {p.status === "published" ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "#dcfce7", color: "#15803d", padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: "bold" }}>
                              ✓ متاح للبيع في السوق
                            </span>
                          ) : p.status === "paused" ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "#fee2e2", color: "#b91c1c", padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: "bold" }}>
                              🛑 موقوف من الإدارة
                            </span>
                          ) : p.status === "draft" ? (
                            <span style={{ background: "#f3f4f6", color: "#4b5563", padding: "4px 8px", borderRadius: "6px", fontSize: "12px" }}>
                              مسودة
                            </span>
                          ) : (
                            <span style={{ background: "#f3f4f6", color: "#9ca3af", padding: "4px 8px", borderRadius: "6px", fontSize: "12px" }}>
                              حذفته الأسرة
                            </span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                            {p.status === "published" && (
                              <button
                                type="button"
                                style={{
                                  background: "#fee2e2",
                                  color: "#b91c1c",
                                  border: "1px solid #f87171",
                                  padding: "6px 14px",
                                  borderRadius: "6px",
                                  fontWeight: "bold",
                                  cursor: "pointer",
                                  fontSize: "12px"
                                }}
                                onClick={() => {
                                  if (confirm(`هل أنت متأكد من إيقاف بيع المنتج (${p.name}) فوراً من المنصة والتطبيق؟`)) {
                                    act("/admin/products/" + p.id + "/status", {
                                      status: "paused",
                                      featured: p.featured,
                                    });
                                  }
                                }}
                              >
                                🛑 إيقاف البيع فوراً
                              </button>
                            )}

                            {p.status === "paused" && (
                              <button
                                type="button"
                                style={{
                                  background: "#dcfce7",
                                  color: "#15803d",
                                  border: "1px solid #86efac",
                                  padding: "6px 14px",
                                  borderRadius: "6px",
                                  fontWeight: "bold",
                                  cursor: "pointer",
                                  fontSize: "12px"
                                }}
                                onClick={() => {
                                  act("/admin/products/" + p.id + "/status", {
                                    status: "published",
                                    featured: p.featured,
                                  });
                                }}
                              >
                                ✓ إعادة تفعيل البيع
                              </button>
                            )}

                            {p.status === "draft" && (
                              <button
                                type="button"
                                style={{
                                  background: "#fef3c7",
                                  color: "#92400e",
                                  border: "1px solid #fcd34d",
                                  padding: "6px 12px",
                                  borderRadius: "6px",
                                  fontSize: "12px",
                                  cursor: "pointer"
                                }}
                                onClick={() =>
                                  act("/admin/products/" + p.id + "/status", {
                                    status: "published",
                                    featured: p.featured,
                                  })
                                }
                              >
                                نشر بالسوق
                              </button>
                            )}

                            {p.status !== "archived" && (
                              <button
                                type="button"
                                className="text-button"
                                style={{ fontSize: "11px" }}
                                onClick={() =>
                                  act("/admin/products/" + p.id + "/status", {
                                    status: p.status,
                                    featured: !p.featured,
                                  })
                                }
                              >
                                {p.featured ? "إلغاء التمييز" : "تمييز"}
                              </button>
                            )}

                            {p.status === "published" && (
                              <Link className="text-link" href={"/product/" + p.id} target="_blank" style={{ fontSize: "11px" }}>
                                👁️ معاينة
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        );
      })()}
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
          <h2>رحلات جارية</h2>
          <div className="order-list">
            {trips.map((t) => (
              <article key={t.order_id} className="panel">
                <h3>
                  طلب #{t.order_id.slice(0, 8)} · {t.household_name}
                </h3>
                <p>
                  السائق {t.driver_name} · {status[t.status]}
                </p>
                <span className="badge">
                  {!t.position_updated_at
                    ? "لا يشارك موقعه"
                    : t.stale
                      ? "آخر موقع قديم"
                      : "الموقع محدّث"}
                </span>
                <Link className="text-link" href={"/orders/" + t.order_id}>
                  الخريطة وتفاصيل الطلب
                </Link>
              </article>
            ))}
          </div>
          {!trips.length && <p className="empty">لا رحلات جارية الآن.</p>}
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
