"use client";
import { useEffect, useRef, useState, FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ShoppingBag,
  ArrowLeft,
  Minus,
  Plus,
  Trash2,
  ShieldCheck,
} from "lucide-react";
import { useStore, lineKey, linePrice, optionLabel } from "./provider";
import { api, post, money, Order, date } from "@/lib/api";
import { MapPicker, Point } from "./map-picker";
import type { SavedAddress } from "./account-tools";
export function Cart() {
  const { cart, quantity, clear } = useStore();
  const total = cart.reduce((s, x) => s + linePrice(x) * x.quantity, 0);
  return (
    <div className="container page">
      <div className="page-title">
        <span className="overline">اختياراتك الحلوة</span>
        <h1>
          سلتك <ShoppingBag size={30} />
        </h1>
      </div>
      {!cart.length ? (
        <div className="empty">
          <ShoppingBag size={45} />
          <h2>سلتك تنتظر شيئًا جميلًا</h2>
          <p>اكتشف منتجات أسرنا واختر ما تحب.</p>
          <Link href="/search" className="button">
            ابدأ التسوق <ArrowLeft size={17} />
          </Link>
        </div>
      ) : (
        <div className="checkout-grid">
          <div>
            <p className="notice">
              طلب من أسرة واحدة: {cart[0].product.household_name} · أتمم هذا
              الطلب قبل الطلب من أسرة أخرى.
            </p>
            {cart.map((line) => {
              const { product: p, quantity: qty } = line;
              return (
                <div className="cart-line" key={lineKey(line)}>
                  {p.images[0] && (
                    <Image
                      src={p.images[0]}
                      alt={p.name}
                      width={100}
                      height={100}
                    />
                  )}
                  <div className="cart-line-copy">
                    <Link href={"/product/" + p.id}>
                      <h3>{p.name}</h3>
                    </Link>
                    <p>
                      {optionLabel(line)} · {money(linePrice(line))} ر.س
                    </p>
                    <div className="quantity-control">
                      <button
                        aria-label={"تقليل " + p.name}
                        onClick={() => quantity(lineKey(line), qty - 1)}
                      >
                        <Minus size={15} />
                      </button>
                      <span>{qty}</span>
                      <button
                        aria-label={"زيادة " + p.name}
                        disabled={qty >= p.stock}
                        onClick={() => quantity(lineKey(line), qty + 1)}
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                  </div>
                  <strong>{money(linePrice(line) * qty)} ر.س</strong>
                  <button
                    className="icon-button"
                    aria-label={"حذف " + p.name}
                    onClick={() => quantity(lineKey(line), 0)}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              );
            })}
            <button className="text-button" onClick={clear}>
              إفراغ السلة
            </button>
          </div>
          <aside className="summary panel">
            <h2>ملخص الطلب</h2>
            <div>
              <span>قيمة المنتجات</span>
              <strong>{money(total)} ر.س</strong>
            </div>
            <div>
              <span>التوصيل</span>
              <span>يُحدد في الخطوة التالية</span>
            </div>
            <hr />
            <div>
              <strong>المجموع المبدئي</strong>
              <strong>{money(total)} ر.س</strong>
            </div>
            <Link href="/checkout" className="button">
              متابعة إتمام الطلب <ArrowLeft size={17} />
            </Link>
            <p className="hint">
              <ShieldCheck size={15} /> لا يُخصم أي مبلغ في البيئة التجريبية.
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
export function Checkout() {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]),
    [point, setPoint] = useState<Point>({ latitude: null, longitude: null }),
    [slots, setSlots] = useState<
      { scheduled_at: string; remaining: number; available: boolean }[]
    >([]);
  const { cart, user, loaded, clear } = useStore(),
    router = useRouter();
  const [method, setMethod] = useState("pickup"),
    [address, setAddress] = useState(""),
    [scheduled, setScheduled] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [quote, setQuote] = useState<{
      subtotal: number;
      delivery_fee: number;
      total: number;
      quote?: { breakdown: string };
      items: {
        product_id: string;
        name: string;
        quantity: number;
        unit_price: number;
        option_id: string;
        option_label: string;
      }[];
    } | null>(null);
  const key = useRef("");
  useEffect(() => {
    key.current = crypto.randomUUID();
    const d = new Date(Date.now() + 2 * 86400000);
    setScheduled(d.toISOString().slice(0, 10) + "T15:00");
  }, []);
  useEffect(() => {
    if (user) {
      setAddress(user.address || "");
      api<SavedAddress[]>("/addresses")
        .then(setAddresses)
        .catch(() => {});
    }
  }, [user]);
  useEffect(() => {
    if (!cart.length) return;
    api<typeof slots>(
      "/households/" + cart[0].product.household_id + "/slots?days=14",
    )
      .then(setSlots)
      .catch(() => setSlots([]));
  }, [cart]);
  useEffect(() => {
    setQuote(null);
    setError("");
    key.current = crypto.randomUUID();
  }, [method, address, scheduled, cart, point]);
  function payload() {
    return {
      items: cart.map((x) => ({
        product_id: x.product.id,
        quantity: x.quantity,
        option_id: x.option_id || "",
      })),
      delivery_method: method,
      address: method === "pickup" ? "" : address,
      scheduled_at: scheduled + "+03:00",
      idempotency_key: key.current,
      latitude: method === "pickup" ? null : point.latitude,
      longitude: method === "pickup" ? null : point.longitude,
      quoted_total: quote?.total,
    };
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (!quote) {
        setQuote(await post("/checkout/quote", payload()));
      } else {
        const order = await post<Order>("/orders", payload());
        clear();
        router.push("/orders/" + order.id);
      }
    } catch (e) {
      setError((e as Error).message);
      setQuote(null);
    } finally {
      setBusy(false);
    }
  }
  if (!loaded) return <div className="empty">جارٍ التحقق من الحساب…</div>;
  if (!user)
    return (
      <div className="empty page">
        <h1>باقي خطوة، ونكمل طلبك</h1>
        <p>سجّل دخولك لحفظ طلبك ومتابعته.</p>
        <Link className="button" href="/login?next=/checkout">
          تسجيل الدخول
        </Link>
      </div>
    );
  if (user.role !== "customer")
    return (
      <div className="empty page">
        <h1>الشراء متاح من حساب عميل</h1>
        <Link className="button" href="/account">
          حسابي
        </Link>
      </div>
    );
  if (!cart.length) return <Cart />;
  return (
    <div className="container page">
      <div className="page-title">
        <span className="overline">سلتك ← تفاصيل الاستلام ← مراجعة الطلب</span>
        <h1>خلّنا نجهّز فرحتك</h1>
      </div>
      <form method="post" onSubmit={submit} className="checkout-grid">
        <div className="panel form-stack">
          <h2>كيف تحب تستلم طلبك؟</h2>
          {method !== "pickup" && addresses.length > 0 && (
            <label>
              اختر عنوانًا محفوظًا
              <select
                defaultValue=""
                onChange={(e) => {
                  const a = addresses.find((a) => a.id === e.target.value);
                  if (a) {
                    setAddress(
                      a.city +
                        "، " +
                        a.details +
                        (a.phone ? "، تواصل: " + a.phone : ""),
                    );
                    setPoint({ latitude: a.latitude, longitude: a.longitude });
                  } else {
                    setAddress("");
                    setPoint({ latitude: null, longitude: null });
                  }
                }}
              >
                <option value="">عنوان آخر</option>
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} · {a.city}
                  </option>
                ))}
              </select>
            </label>
          )}
          <fieldset className="delivery-options">
            <legend className="sr-only">طريقة التسليم</legend>
            {[
              ["pickup", "استلام من الأسرة", "بدون رسوم توصيل"],
              ["free", "توصيل تقدمه الأسرة", "حسب توفر الخدمة لدى الأسرة"],
              [
                "paid",
                "توصيل مع سائق — تجريبي",
                "الرسوم والمسافة للاختبار فقط",
              ],
            ].map(([v, t, d]) => (
              <label
                className={method === v ? "choice selected" : "choice"}
                key={v}
              >
                <input
                  type="radio"
                  name="delivery_method"
                  value={v}
                  checked={method === v}
                  onChange={() => setMethod(v)}
                />
                <span>
                  <strong>{t}</strong>
                  <small>{d}</small>
                </span>
              </label>
            ))}
          </fieldset>
          {method !== "pickup" && (
            <label>
              عنوان التوصيل بالتفصيل
              <textarea
                autoComplete="street-address"
                required
                minLength={10}
                maxLength={1000}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="المدينة، الحي، الشارع، المبنى والعلامة المميزة"
              />
            </label>
          )}
          <label>
            موعد الاستلام أو التسليم — بتوقيت السعودية
            <input
              type="datetime-local"
              required
              value={scheduled}
              onChange={(e) => setScheduled(e.target.value)}
            />
          </label>
          {method !== "pickup" && (
            <MapPicker value={point} onChange={setPoint} />
          )}
          {slots.length > 0 && (
            <label>
              المواعيد المتاحة خلال أسبوعين
              <select
                aria-label="المواعيد المتاحة"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) setScheduled(e.target.value.slice(0, 16));
                }}
              >
                <option value="">اختر موعدًا أو استخدم الحقل أعلاه</option>
                {slots
                  .filter(
                    (s) =>
                      s.available &&
                      new Date(s.scheduled_at).getTime() >=
                        Date.now() +
                          Math.max(...cart.map((x) => x.product.prep_hours)) *
                            3600000,
                  )
                  .map((s) => (
                    <option key={s.scheduled_at} value={s.scheduled_at}>
                      {date(s.scheduled_at)} · {s.remaining} طلب متاح
                    </option>
                  ))}
              </select>
            </label>
          )}
          <p className="hint">
            اختر موعدًا بعد مدة التجهيز وفي أوقات عمل الأسرة. الخادم يتحقق من
            توفره قبل تأكيد الطلب.
          </p>
          <label className="check-label">
            <input type="checkbox" required /> أوافق على{" "}
            <Link href="/policies/terms">الشروط</Link> و
            <Link href="/policies/refund">سياسة الإلغاء</Link>.
          </label>
        </div>
        <aside className="panel summary">
          <h2>مراجعة طلبك</h2>
          {(
            quote?.items ||
            cart.map((x) => ({
              product_id: x.product.id,
              name: x.product.name,
              option_id: x.option_id || "",
              option_label: optionLabel(x),
              quantity: x.quantity,
              unit_price: linePrice(x),
            }))
          ).map((x) => (
            <div key={x.product_id + ":" + x.option_id}>
              <span>
                {x.name} {x.option_label} × {x.quantity}
              </span>
              <strong>{money(x.unit_price * x.quantity)} ر.س</strong>
            </div>
          ))}
          <hr />
          {quote ? (
            <>
              <div>
                <span>المنتجات</span>
                <strong>{money(quote.subtotal)} ر.س</strong>
              </div>
              <div>
                <span>التوصيل</span>
                <strong>{money(quote.delivery_fee)} ر.س</strong>
              </div>
              <div className="total">
                <strong>الإجمالي</strong>
                <strong>{money(quote.total)} ر.س</strong>
              </div>
              {quote.quote && <p className="notice">{quote.quote.breakdown}</p>}
            </>
          ) : (
            <p className="hint">
              نراجع السعر والتوفر من الخادم قبل إنشاء الطلب.
            </p>
          )}
          <p className="notice">
            وضع تجريبي. لا يتم تحصيل أموال أو إرسال طلب إلى أسرة حقيقية.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button" disabled={busy}>
            {busy
              ? "لحظات…"
              : quote
                ? `إنشاء الطلب التجريبي · ${money(quote.total)} ر.س`
                : "مراجعة السعر والتوفر"}
            <ArrowLeft size={17} />
          </button>
        </aside>
      </form>
    </div>
  );
}
