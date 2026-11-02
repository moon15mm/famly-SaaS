"use client";
import { useEffect, useState, FormEvent } from "react";
import { api, post, money, date } from "@/lib/api";
import { useStore } from "./provider";
import { Gate, OrderList } from "./account";
import { AdminOperations } from "./admin-tools";
type StoreRow = { id: string; name: string; city: string; verified: boolean };
type UserRow = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  driver_verified: boolean;
};
type EventRow = { action: string; resource_id: string; created_at: string };
type Ticket = { id: string; order_id: string; message: string; status: string };
type Plan = {
  id: string;
  name: string;
  monthly_price: number;
  product_limit: number;
};
export function Admin() {
  return (
    <Gate role="admin">
      <AdminContent />
    </Gate>
  );
}
function AdminContent() {
  const [tab, setTab] = useState("households"),
    [overview, setOverview] = useState<Record<string, number>>({}),
    [stores, setStores] = useState<StoreRow[]>([]),
    [users, setUsers] = useState<UserRow[]>([]),
    [events, setEvents] = useState<EventRow[]>([]),
    [tickets, setTickets] = useState<Ticket[]>([]),
    [plans, setPlans] = useState<Plan[]>([]),
    [rule, setRule] = useState({ base_fee: 1500, per_km: 200, max_km: 30 });
  const { toast } = useStore();
  function load() {
    Promise.all([
      api<Record<string, number>>("/admin/overview").then(setOverview),
      api<StoreRow[]>("/admin/households").then(setStores),
      api<UserRow[]>("/admin/users").then(setUsers),
      api<EventRow[]>("/admin/audit").then(setEvents),
      api<Ticket[]>("/admin/tickets").then(setTickets),
      api<Plan[]>("/plans").then(setPlans),
      api<typeof rule>("/admin/delivery-rule").then(setRule),
    ]).catch((e) => toast(e.message));
  }
  useEffect(load, []);
  async function action(path: string) {
    try {
      await post(path);
      toast("تم التحديث");
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function plan(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget,
      d = new FormData(f);
    try {
      await post("/admin/plans", {
        name: d.get("name"),
        monthly_price: Math.round(Number(d.get("monthly_price")) * 100),
        product_limit: Number(d.get("product_limit")),
        active: true,
      });
      f.reset();
      toast("تمت إضافة الباقة");
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div className="container page">
      <div className="page-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <span className="overline">إدارة من بيوتنا</span>
          <h1 style={{ margin: 0 }}>صورة أوضح لكل التفاصيل</h1>
        </div>
        <a href="/ops" style={{ background: "#663440", color: "#ffffff", padding: "10px 18px", borderRadius: "10px", fontSize: "14px", fontWeight: "bold", textDecoration: "none", boxShadow: "0 4px 12px rgba(102, 52, 64, 0.2)" }}>
          🚨 غرفة العمليات والتدخل العاجل (الدرب)
        </a>
      </div>
      <div className="stats-grid">
        {[
          ["households", "الأسر المسجلة"],
          ["orders", "الطلبات"],
          ["gross_sales", "قيمة الطلبات المدفوعة التجريبية"],
        ].map(([key, label]) => (
          <div className="stat" key={key}>
            <small>{label}</small>
            <strong>
              {key === "gross_sales"
                ? money(overview[key] || 0) + " ر.س"
                : overview[key] || 0}
            </strong>
          </div>
        ))}
      </div>
      <div className="tabs">
        {[
          ["households", "اعتماد الأسر"],
          ["users", "الحسابات والسائقون"],
          ["orders", "الطلبات والاسترداد"],
          ["plans", "الباقات"],
          ["delivery", "تسعير التوصيل"],
          ["tickets", "الدعم"],
          ["audit", "سجل التدقيق"],
          ["products", "المنتجات"],
          ["categories", "التصنيفات"],
          ["documents", "المستندات"],
          ["contracts", "العقود والمتطلبات"],
          ["reports", "التقارير"],
          ["outbox", "رسائل النظام"],
          ["privacy", "الخصوصية"],
          ["issues", "تعثر التوصيل"],
        ].map(([v, t]) => (
          <button
            key={v}
            className={tab === v ? "selected" : ""}
            onClick={() => setTab(v)}
          >
            {t}
          </button>
        ))}
      </div>
      <AdminOperations tab={tab} />
      {tab === "households" && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الأسرة</th>
                <th>المدينة</th>
                <th>الحالة</th>
                <th>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((h) => (
                <tr key={h.id}>
                  <td>{h.name}</td>
                  <td>{h.city}</td>
                  <td>{h.verified ? "معتمدة" : "بانتظار التحقق"}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() =>
                        action(
                          "/admin/households/" +
                            h.id +
                            "/verify?verified=" +
                            !h.verified,
                        )
                      }
                    >
                      {h.verified
                        ? "تعليق الاعتماد"
                        : "اعتماد بعد مراجعة المستندات خارج المنصة"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === "users" && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>نوع الحساب</th>
                <th>الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.role}</td>
                  <td>{u.active ? "نشط" : "موقوف"}</td>
                  <td>
                    {u.role !== "admin" && (
                      <>
                        <button
                          className="text-button"
                          onClick={() =>
                            action(
                              "/admin/users/" +
                                u.id +
                                "/status?active=" +
                                !u.active +
                                "&driver_verified=" +
                                u.driver_verified,
                            )
                          }
                        >
                          {u.active ? "إيقاف" : "تفعيل"}
                        </button>
                        {u.role === "driver" && (
                          <button
                            className="text-button"
                            onClick={() =>
                              action(
                                "/admin/users/" +
                                  u.id +
                                  "/status?active=" +
                                  u.active +
                                  "&driver_verified=" +
                                  !u.driver_verified,
                              )
                            }
                          >
                            {u.driver_verified
                              ? "تعليق أهلية السائق"
                              : "اعتماد السائق بعد التحقق"}
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === "orders" && <OrderList embedded />}
      {tab === "audit" && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الحدث</th>
                <th>المورد</th>
                <th>الوقت</th>
              </tr>
            </thead>
            <tbody>
              {events.map((a, i) => (
                <tr key={i}>
                  <td>{a.action}</td>
                  <td>{a.resource_id.slice(0, 16)}</td>
                  <td>{date(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === "tickets" && (
        <div className="order-list">
          {tickets.map((t) => (
            <div className="panel" key={t.id}>
              <h3>طلب #{t.order_id.slice(0, 8)}</h3>
              <p>{t.message}</p>
              <span className="badge">
                {t.status === "open" ? "مفتوح" : "تمت معالجته"}
              </span>
              {t.status === "open" && (
                <button
                  className="text-button"
                  onClick={() => action("/admin/tickets/" + t.id + "/resolve")}
                >
                  تعليم كمعالج بعد التواصل
                </button>
              )}
            </div>
          ))}
          {!tickets.length && <p className="empty">لا توجد طلبات دعم.</p>}
        </div>
      )}
      {tab === "plans" && (
        <>
          <div className="stats-grid">
            {plans.map((p) => (
              <div className="stat" key={p.id}>
                <small>{p.name}</small>
                <strong>{money(p.monthly_price)} ر.س</strong>
                <p>{p.product_limit} منتج</p>
              </div>
            ))}
          </div>
          <form method="post" className="panel form-stack" onSubmit={plan}>
            <h2>إضافة باقة</h2>
            <label>
              اسم الباقة
              <input name="name" required minLength={2} maxLength={100} />
            </label>
            <div className="form-row">
              <label>
                السعر الشهري بالريال
                <input
                  type="number"
                  name="monthly_price"
                  min="0"
                  max="10000"
                  step="0.01"
                  required
                />
              </label>
              <label>
                حد المنتجات
                <input
                  type="number"
                  name="product_limit"
                  min="1"
                  max="10000"
                  required
                />
              </label>
            </div>
            <button className="button">حفظ الباقة</button>
            <p className="notice">
              تعريف الباقة لا يفعّل تحصيل الاشتراكات. الفوترة والتجديد ينتظران
              مزود الدفع.
            </p>
          </form>
        </>
      )}
      {tab === "delivery" && (
        <form
          method="post"
          className="panel form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            try {
              await api("/admin/delivery-rule", {
                method: "PUT",
                body: JSON.stringify({
                  base_fee: Math.round(Number(d.get("base_fee")) * 100),
                  per_km: Math.round(Number(d.get("per_km")) * 100),
                  max_km: Number(d.get("max_km")),
                }),
              });
              toast("تم تحديث قاعدة الاختبار");
              load();
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        >
          <h2>قواعد تسعير التوصيل التجريبي</h2>
          <label>
            الرسم الأساسي بالريال
            <input
              type="number"
              step="0.01"
              min="0"
              max="1000"
              name="base_fee"
              defaultValue={rule.base_fee / 100}
            />
          </label>
          <label>
            لكل كيلومتر بالريال
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              name="per_km"
              defaultValue={rule.per_km / 100}
            />
          </label>
          <label>
            أقصى مسافة بالكيلومتر
            <input
              type="number"
              min="1"
              max="100"
              name="max_km"
              defaultValue={rule.max_km}
            />
          </label>
          <button className="button">حفظ القاعدة</button>
          <p className="notice">
            المسار الافتراضي للاختبار 5 كم. لا يُستخدم هذا الموصل للتسعير
            التجاري أو لحساب مسارات الطرق.
          </p>
        </form>
      )}
    </div>
  );
}
