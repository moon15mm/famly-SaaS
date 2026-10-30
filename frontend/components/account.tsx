"use client";
import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  UserRound,
  Store,
  Truck,
  Settings,
  LogOut,
  Heart,
  ShoppingBag,
  Bell,
  ArrowLeft,
} from "lucide-react";
import { api, post, Order, Product, money, date, status } from "@/lib/api";
import { useStore } from "./provider";
import { AccountSecurity } from "./account-tools";
import { ProductGrid } from "./products";
export function Gate({
  role,
  children,
}: {
  role?: string;
  children: React.ReactNode;
}) {
  const { user, loaded } = useStore();
  return !loaded ? (
    <div className="empty">جارٍ التحقق من حسابك…</div>
  ) : !user ? (
    <div className="empty page">
      <h1>حيّاك، سجّل دخولك للمتابعة</h1>
      <Link className="button" href="/login">
        تسجيل الدخول
      </Link>
    </div>
  ) : role && user.role !== role ? (
    <div className="empty page">
      <h1>
        هذه المساحة خاصة بحساب{" "}
        {role === "seller" ? "الأسرة" : role === "admin" ? "الإدارة" : "السائق"}
      </h1>
      <Link className="button" href="/account">
        العودة لحسابي
      </Link>
    </div>
  ) : (
    <>{children}</>
  );
}
export function Account() {
  return (
    <Gate>
      <AccountContent />
    </Gate>
  );
}
function AccountContent() {
  const { user, refresh, toast } = useStore(),
    router = useRouter();
  const [busy, setBusy] = useState(false),
    [notifications, setNotifications] = useState<
      { id: string; message: string; created_at: string }[]
    >([]);
  useEffect(() => {
    api<typeof notifications>("/notifications")
      .then(setNotifications)
      .catch((e) => toast(e.message));
  }, [toast]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/account", {
        method: "PUT",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      await refresh();
      toast("تم حفظ بياناتك");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await post("/auth/logout");
      await refresh();
      router.push("/");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div className="container page">
      <div className="page-title">
        <span className="overline">مساحتك في من بيوتنا</span>
        <h1>حيّاك يا {user?.name}</h1>
      </div>
      <div className="dashboard">
        <aside className="dashboard-sidebar">
          <h2>حسابي</h2>
          <Link href="/orders">
            <ShoppingBag size={17} />
            طلباتي
          </Link>
          <Link href="/favorites">
            <Heart size={17} />
            المفضلة
          </Link>
          {user?.role === "seller" && (
            <Link href="/seller">
              <Store size={17} />
              لوحة الأسرة
            </Link>
          )}
          {user?.role === "driver" && (
            <Link href="/driver">
              <Truck size={17} />
              لوحة السائق
            </Link>
          )}
          {user?.role === "admin" && (
            <Link href="/admin">
              <Settings size={17} />
              إدارة المنصة
            </Link>
          )}
          <button onClick={logout}>
            <LogOut size={17} />
            تسجيل الخروج
          </button>
        </aside>
        <div className="dashboard-content">
          <form method="post" className="panel form-stack" onSubmit={save}>
            <h2>بياناتي وعنواني</h2>
            <label>
              الاسم
              <input
                name="name"
                defaultValue={user?.name}
                required
                minLength={2}
                maxLength={100}
                autoComplete="name"
              />
            </label>
            <label>
              البريد الإلكتروني
              <input value={user?.email} readOnly dir="ltr" />
            </label>
            <label>
              عنوان التوصيل
              <textarea
                name="address"
                defaultValue={user?.address}
                maxLength={1000}
                autoComplete="street-address"
              />
            </label>
            <button className="button" disabled={busy}>
              حفظ البيانات
            </button>
          </form>
          <AccountSecurity />
          <section className="section">
            <div className="toolbar">
              <h2>
                <Bell size={22} /> إشعاراتك
              </h2>
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await post("/notifications/read");
                    toast("تم تعليم الإشعارات كمقروءة");
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                تعليم الكل كمقروء
              </button>
            </div>
            <div className="panel">
              {notifications.length ? (
                notifications.map((n) => (
                  <div className="notification" key={n.id}>
                    {n.message}
                    <small>{date(n.created_at)}</small>
                  </div>
                ))
              ) : (
                <p>لا توجد إشعارات جديدة.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
export function Favorites() {
  const { user } = useStore();
  const [products, setProducts] = useState<Product[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (user)
      api<Product[]>("/favorites")
        .then(setProducts)
        .catch((e) => setError(e.message));
  }, [user]);
  return (
    <Gate>
      <div className="container page">
        <div className="page-title">
          <span className="overline">أشياء قريبة لقلبك</span>
          <h1>مفضلتك</h1>
        </div>
        {error && <p role="alert">{error}</p>}
        <ProductGrid products={products} />
      </div>
    </Gate>
  );
}
export function Orders({ id }: { id?: string }) {
  return <Gate>{id ? <OrderDetail id={id} /> : <OrderList />}</Gate>;
}
export function OrderList({ embedded = false }: { embedded?: boolean }) {
  const [orders, setOrders] = useState<Order[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    api<Order[]>("/orders")
      .then(setOrders)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div className={embedded ? "" : "container page"}>
      <div className="page-title">
        <span className="overline">كل حكايات طلباتك</span>
        <h1>الطلبات</h1>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p>جارٍ تحميل الطلبات…</p>
      ) : !orders.length ? (
        <div className="empty">
          <ShoppingBag size={40} />
          <h2>ما عندك طلبات إلى الآن</h2>
          <Link className="button" href="/search">
            اكتشف المنتجات
          </Link>
        </div>
      ) : (
        <div className="order-list">
          {orders.map((o) => (
            <Link className="order-card" href={"/orders/" + o.id} key={o.id}>
              <div className="order-card-top">
                <div>
                  <span className="overline">طلب #{o.id.slice(0, 8)}</span>
                  <h3>{o.household_name}</h3>
                  <p>
                    {o.items.map((i) => `${i.name} × ${i.quantity}`).join("، ")}
                  </p>
                </div>
                <span
                  className={
                    "badge " +
                    (["delivered", "completed"].includes(o.status)
                      ? "success"
                      : "")
                  }
                >
                  {status[o.status]}
                </span>
              </div>
              <div className="order-card-bottom">
                <span>{date(o.scheduled_at)}</span>
                <strong>{money(o.total)} ر.س</strong>
                <span className="text-link">
                  عرض الطلب <ArrowLeft size={14} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
function OrderDetail({ id }: { id: string }) {
  const [issueReason, setIssueReason] = useState(""),
    [cancelNote, setCancelNote] = useState("");
  const [order, setOrder] = useState<Order | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [proof, setProof] = useState("");
  const { user, toast } = useStore();
  function load() {
    api<Order>("/orders/" + id)
      .then(setOrder)
      .catch((e) => setError(e.message));
  }
  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [id]);
  async function action(path: string) {
    setBusy(true);
    setError("");
    try {
      await post(path);
      load();
      toast("تم تحديث الطلب");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function review(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await post("/orders/" + id + "/review", {
        rating: Number(form.get("rating")),
        comment: form.get("comment"),
      });
      toast("شكرًا لمشاركة تجربتك");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function support(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await post("/support", {
        order_id: id,
        message: new FormData(e.currentTarget).get("message"),
      });
      toast("تم تسجيل طلب الدعم");
      e.currentTarget?.reset();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  if (!order)
    return (
      <div className="container page">
        <p role="alert">{error || "جارٍ تحميل الطلب…"}</p>
      </div>
    );
  const seller = user?.role === "seller",
    customer = user?.role === "customer",
    driver = user?.role === "driver";
  const nextSeller: Record<string, string> = {
    pending_acceptance: "confirmed",
    confirmed: "preparing",
    preparing: "ready",
    ...(order.delivery_method === "pickup"
      ? { ready: "completed" }
      : order.delivery_method === "free"
        ? { ready: "in_transit", in_transit: "delivered" }
        : {}),
  };
  const nextDriver: Record<string, string> = {
    assigned: "picked_up",
    picked_up: "in_transit",
    in_transit: "delivered",
  };
  return (
    <div className="container page">
      <div className="breadcrumb">
        <Link href="/orders">الطلبات</Link> / #{order.id.slice(0, 8)}
      </div>
      <div className="toolbar">
        <div>
          <span className="overline">طلبك من {order.household_name}</span>
          <h1>كل خطوة، توصلك للفرحة</h1>
        </div>
        <Link className="text-link" href={"/receipt/" + id}>
          إيصال الطلب وطباعته
        </Link>
        <button className="text-button" onClick={load}>
          تحديث الحالة
        </button>
      </div>
      <div className="order-progress">
        {[
          "pending_acceptance",
          "confirmed",
          "preparing",
          "ready",
          order.delivery_method === "pickup" ? "completed" : "delivered",
        ].map((s) => (
          <span key={s} className={order.status === s ? "done" : ""}>
            {status[s]}
          </span>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="order-detail-grid">
        <div>
          <div className="panel">
            <h2>تفاصيل الطلب</h2>
            {order.items.map((i) => (
              <div
                className="order-card-bottom"
                key={i.product_id + ":" + (i.option_id || "")}
              >
                <span>
                  {i.name} {i.option_label} × {i.quantity}
                </span>
                <strong>{money(i.quantity * i.unit_price)} ر.س</strong>
              </div>
            ))}
            <div className="order-actions">
              {customer && order.status === "pending_payment" && (
                <>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => action("/payments/test/" + id)}
                  >
                    محاكاة نجاح الدفع · {money(order.total)} ر.س
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      action("/payments/test/" + id + "?outcome=failed")
                    }
                  >
                    اختبار فشل الدفع
                  </button>
                </>
              )}
              {seller && nextSeller[order.status] && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    action(
                      "/orders/" +
                        id +
                        "/transition?state=" +
                        nextSeller[order.status],
                    )
                  }
                >
                  تحديث: {status[nextSeller[order.status]]}
                </button>
              )}
              {((customer &&
                ["pending_payment", "pending_acceptance", "confirmed"].includes(
                  order.status,
                )) ||
                (seller &&
                  ["pending_acceptance", "confirmed"].includes(
                    order.status,
                  ))) && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    action("/orders/" + id + "/transition?state=cancelled")
                  }
                >
                  إلغاء الطلب {seller ? "أو رفضه" : ""}
                </button>
              )}
              {driver && nextDriver[order.status] && (
                <>
                  <input
                    aria-label="رمز إثبات العملية"
                    placeholder="رمز الاستلام من الأسرة أو رمز التسليم عند الوصول"
                    value={proof}
                    onChange={(e) => setProof(e.target.value)}
                    inputMode="numeric"
                  />
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      action(
                        "/driver/trips/" +
                          id +
                          "/transition?state=" +
                          nextDriver[order.status] +
                          "&code=" +
                          encodeURIComponent(proof),
                      )
                    }
                  >
                    {status[nextDriver[order.status]]}
                  </button>
                </>
              )}
            </div>
          </div>
          {driver &&
            ["assigned", "picked_up", "in_transit"].includes(order.status) && (
              <form
                method="post"
                className="panel form-stack section"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await post("/driver/trips/" + id + "/issue", {
                      reason: issueReason,
                    });
                    toast("سجلت المشكلة وأشعرت الإدارة");
                    load();
                  } catch (error) {
                    toast((error as Error).message);
                  }
                }}
              >
                <h2>تعذر إكمال الرحلة؟</h2>
                <label>
                  وصف المشكلة
                  <textarea
                    value={issueReason}
                    onChange={(e) => setIssueReason(e.target.value)}
                    required
                    minLength={10}
                    maxLength={1000}
                  />
                </label>
                <p className="hint">
                  قبل استلام المنتج يعاد عرض المشوار. بعد الاستلام تتدخل الإدارة
                  بعد التحقق من موقع الطلب.
                </p>
                <button className="button">تسجيل تعثر الرحلة</button>
              </form>
            )}
          {customer && ["delivered", "completed"].includes(order.status) && (
            <form
              method="post"
              className="panel form-stack section"
              onSubmit={review}
            >
              <h2>كيف كانت تجربتك؟</h2>
              <label>
                التقييم
                <select name="rating">
                  <option value="5">5 — ممتازة</option>
                  <option value="4">4 — جيدة جدًا</option>
                  <option value="3">3 — جيدة</option>
                  <option value="2">2 — تحتاج تحسين</option>
                  <option value="1">1 — لم ترضني</option>
                </select>
              </label>
              <label>
                ملاحظتك
                <textarea
                  name="comment"
                  required
                  minLength={3}
                  maxLength={1000}
                />
              </label>
              <button className="button">مشاركة التقييم</button>
            </form>
          )}
          <form
            method="post"
            className="panel form-stack section"
            onSubmit={support}
          >
            <h2>تحتاج مساعدة بهذا الطلب؟</h2>
            <label>
              وضح طلبك
              <textarea
                name="message"
                required
                minLength={10}
                maxLength={3000}
              />
            </label>
            <button className="button">إرسال طلب دعم</button>
          </form>
        </div>
        <aside className="panel summary">
          <h2>ملخص الحالة</h2>
          <div>
            <span>الطلب</span>
            <strong>{status[order.status]}</strong>
          </div>
          <div>
            <span>الدفع</span>
            <strong>{status[order.payment_status]}</strong>
          </div>
          <div>
            <span>المنتجات</span>
            <strong>{money(order.subtotal)} ر.س</strong>
          </div>
          <div>
            <span>التوصيل</span>
            <strong>{money(order.delivery_fee)} ر.س</strong>
          </div>
          <div>
            <span>الإجمالي</span>
            <strong>{money(order.total)} ر.س</strong>
          </div>
          {order.refunded > 0 && (
            <div>
              <span>المسترد</span>
              <strong>{money(order.refunded)} ر.س</strong>
            </div>
          )}
          <hr />
          <p>الموعد: {date(order.scheduled_at)}</p>
          <p>
            {order.delivery_method === "pickup"
              ? "استلام من الأسرة"
              : order.delivery_method === "free"
                ? "توصيل تقدمه الأسرة"
                : "توصيل بسائق — تجريبي"}
          </p>
          {order.address && <p>{order.address}</p>}
          {order.pickup_address && <p>موقع الاستلام: {order.pickup_address}</p>}
          {driver && order.pickup_address && (
            <a
              className="text-link"
              target="_blank"
              rel="noreferrer"
              href={
                "https://www.google.com/maps/dir/?api=1&origin=" +
                encodeURIComponent(order.pickup_address) +
                "&destination=" +
                encodeURIComponent(
                  order.latitude != null && order.longitude != null
                    ? `${order.latitude},${order.longitude}`
                    : order.address || "",
                )
              }
            >
              فتح اتجاهات الاستلام والتسليم
            </a>
          )}
          <p className="notice">
            هذا طلب تجريبي ولا يثبت دفعًا أو توصيلًا فعليًا. رمز إثبات العملية
            يظهر في إشعارات العميل بعد قبول السائق.
          </p>
          {user?.role === "admin" &&
            [
              "pending_payment",
              "pending_acceptance",
              "confirmed",
              "preparing",
              "ready",
            ].includes(order.status) && (
              <form
                method="post"
                className="form-stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    await post("/admin/orders/" + id + "/cancel", {
                      note: cancelNote,
                    });
                    setCancelNote("");
                    load();
                    toast("أُلغي الطلب، وأُعيد المخزون");
                  } catch (error) {
                    setError((error as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  سبب إلغاء الإدارة
                  <textarea
                    value={cancelNote}
                    onChange={(e) => setCancelNote(e.target.value)}
                    required
                    minLength={10}
                    maxLength={1000}
                  />
                </label>
                <p className="hint">
                  مثلًا: لم يتوفر سائق حتى الموعد. الطلب المدفوع يصبح بانتظار
                  الاسترداد.
                </p>
                <button className="text-button" disabled={busy}>
                  إلغاء الطلب من الإدارة
                </button>
              </form>
            )}
          {user?.role === "admin" && (
            <form
              method="post"
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                await action(
                  "/payments/refund/" +
                    id +
                    "?amount=" +
                    Math.round(Number(data.get("amount")) * 100) +
                    "&event_id=" +
                    crypto.randomUUID(),
                );
              }}
            >
              <label>
                مبلغ الاسترداد التجريبي (ريال)
                <input
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                />
              </label>
              <button className="button" disabled={busy}>
                تنفيذ استرداد تجريبي
              </button>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
