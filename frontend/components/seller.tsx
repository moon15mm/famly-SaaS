"use client";
import { useEffect, useRef, useState, FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Store,
  Package,
  ShoppingBag,
  Settings,
  Send,
  ChartNoAxesCombined,
  Plus,
  X,
  Eye,
} from "lucide-react";
import { api, post, Product, Category, Household, money } from "@/lib/api";
import { useStore } from "./provider";
import { Gate, OrderList } from "./account";
import {
  SubscriptionPanel,
  ReportPanel,
  DocumentsPanel,
} from "./business-tools";
export function Seller() {
  return (
    <Gate role="seller">
      <SellerContent />
    </Gate>
  );
}
function SellerContent() {
  const [tab, setTab] = useState("products"),
    [products, setProducts] = useState<Product[]>([]),
    [store, setStore] = useState<Household | null>(null),
    [editor, setEditor] = useState<Product | null | undefined>(undefined),
    [deleting, setDeleting] = useState(""),
    [error, setError] = useState("");
  const { toast } = useStore();
  async function pause(p: Product) {
    try {
      await api("/seller/products/" + p.id, {
        method: "PUT",
        body: JSON.stringify({
          name: p.name,
          description: p.description,
          category_id: p.category_id,
          price: p.price,
          stock: p.stock,
          prep_hours: p.prep_hours,
          images: p.images,
          options: p.options || [],
          status: "paused",
        }),
      });
      load();
      toast("تم إيقاف بيع المنتج");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function remove(p: Product) {
    try {
      await api("/seller/products/" + p.id, { method: "DELETE" });
      setDeleting("");
      load();
      toast("حُذف المنتج وتحرر مكانه في الباقة");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  function load() {
    api<Product[]>("/seller/products")
      .then(setProducts)
      .catch((e) => setError(e.message));
    api<Household>("/seller/household")
      .then(setStore)
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);
  return (
    <div className="container page">
      <div className="page-title">
        <span className="overline">إبداعك، له بيت هنا</span>
        <h1>لوحة الأسرة</h1>
        <p>
          {store?.name} ·{" "}
          {store?.verified
            ? "تمت مراجعة الأسرة"
            : "بانتظار مراجعة واعتماد الإدارة قبل النشر"}
        </p>
        {store?.verified && store.storefront_visible === false && (
          <p className="notice" role="alert">
            متجرك مخفي عن العملاء ولا يستقبل طلبات جديدة لانتهاء الاشتراك أو
            الفترة التجريبية. الطلبات القائمة تبقى متاحة، ويعود المتجر بعد
            التجديد من «المبيعات والاشتراك».
          </p>
        )}
      </div>
      <div className="dashboard">
        <aside className="dashboard-sidebar">
          <h2>متجري</h2>
          {[
            [Package, "products", "المنتجات"],
            [ShoppingBag, "orders", "الطلبات"],
            [Settings, "settings", "إعدادات المتجر"],
            [Send, "telegram", "ربط Telegram"],
            [ChartNoAxesCombined, "reports", "المبيعات والاشتراك"],
            [Settings, "documents", "مستندات الاعتماد"],
          ].map(([Icon, key, label]) => {
            const I = Icon as typeof Store;
            return (
              <button
                key={key as string}
                className={tab === key ? "selected" : ""}
                onClick={() => setTab(key as string)}
              >
                <I size={17} />
                {label as string}
              </button>
            );
          })}
          {store?.storefront_visible && (
            <Link href={"/household/" + store.id}>
              <Eye size={17} />
              عرض متجري
            </Link>
          )}
        </aside>
        <div className="dashboard-content">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {tab === "products" && (
            <>
              <div className="stats-grid">
                <div className="stat">
                  <small>كل منتجاتك</small>
                  <strong>{products.length}</strong>
                </div>
                <div className="stat">
                  <small>منتجات منشورة</small>
                  <strong>
                    {products.filter((p) => p.status === "published").length}
                  </strong>
                </div>
                <div className="stat">
                  <small>مسودات تنتظر لمستك</small>
                  <strong>
                    {products.filter((p) => p.status === "draft").length}
                  </strong>
                </div>
              </div>
              <div className="toolbar">
                <h2>منتجاتك</h2>
                <button className="button" onClick={() => setEditor(null)}>
                  <Plus size={17} />
                  أضف منتجًا
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>المنتج</th>
                      <th>السعر</th>
                      <th>الكمية</th>
                      <th>الحالة</th>
                      <th>إدارة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>{money(p.price)} ر.س</td>
                        <td>{p.stock}</td>
                        <td>
                          <span className="badge">
                            {p.status === "published"
                              ? "منشور"
                              : p.status === "draft"
                                ? "مسودة"
                                : "متوقف"}
                          </span>
                        </td>
                        <td className="table-actions">
                          <button
                            className="text-button"
                            onClick={() => setEditor(p)}
                          >
                            تعديل ومعاينة
                          </button>
                          {p.status === "published" && (
                            <button
                              className="text-button"
                              onClick={() => pause(p)}
                            >
                              إيقاف البيع
                            </button>
                          )}
                          {deleting === p.id ? (
                            <>
                              <button
                                className="text-button"
                                onClick={() => remove(p)}
                              >
                                تأكيد حذف «{p.name}»
                              </button>
                              <button
                                className="text-button"
                                onClick={() => setDeleting("")}
                              >
                                تراجع
                              </button>
                            </>
                          ) : (
                            <button
                              className="text-button"
                              onClick={() => setDeleting(p.id)}
                            >
                              حذف
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!products.length && (
                  <p className="empty">ابدأ بإضافة أول منتج لك.</p>
                )}
              </div>
            </>
          )}
          {tab === "orders" && <OrderList embedded />}
          {tab === "settings" && store && (
            <StoreSettings store={store} done={load} />
          )}{" "}
          {tab === "telegram" && (
            <TelegramPanel linked={store?.telegram_linked || false} />
          )}{" "}
          {tab === "reports" && (
            <>
              <SubscriptionPanel />
              <ReportPanel scope="seller" />
              <SellerReports />
            </>
          )}
          {tab === "documents" && <DocumentsPanel />}
        </div>
      </div>
      {editor !== undefined && (
        <ProductEditor
          product={editor}
          close={() => setEditor(undefined)}
          done={() => {
            setEditor(undefined);
            load();
          }}
        />
      )}
    </div>
  );
}
function ProductEditor({
  product,
  close,
  done,
}: {
  product: Product | null;
  close: () => void;
  done: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [images, setImages] = useState<string[]>(product?.images || []),
    [categories, setCategories] = useState<Category[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false),
    [options, setOptions] = useState(product?.options || []);
  const editorForm = useRef<HTMLFormElement>(null);
  const [previewData, setPreviewData] = useState({
    name: "",
    description: "",
    price: 0,
  });
  function capturePreview() {
    if (!editorForm.current) return;
    const fields = new FormData(editorForm.current);
    setPreviewData({
      name: String(fields.get("name") || "اسم المنتج"),
      description: String(fields.get("description") || ""),
      price: Math.round(Number(fields.get("price") || 0) * 100),
    });
  }
  const { toast } = useStore();
  useEffect(() => {
    dialog.current?.showModal();
    api<Category[]>("/categories")
      .then(setCategories)
      .catch((e) => setError(e.message));
  }, []);
  async function upload(files: FileList | null) {
    if (!files) return;
    setBusy(true);
    setError("");
    try {
      const added = [];
      for (const file of Array.from(files).slice(0, 8 - images.length)) {
        const data = new FormData();
        data.set("file", file);
        const r = await api<{ url: string }>("/seller/media", {
          method: "POST",
          body: data,
        });
        added.push(r.url);
      }
      setImages([...images, ...added]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const d = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const data = {
        ...d,
        price: Math.round(Number(d.price) * 100),
        stock: Number(d.stock),
        prep_hours: Number(d.prep_hours),
        images,
        options,
      };
      await api("/seller/products" + (product ? "/" + product.id : ""), {
        method: product ? "PUT" : "POST",
        body: JSON.stringify(data),
      });
      toast("تم حفظ المنتج");
      done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      className="editor"
      ref={dialog}
      onClose={close}
      aria-labelledby="product-editor-title"
    >
      <div className="editor-heading">
        <h2 id="product-editor-title">
          {product ? "تعديل المنتج" : "منتج جديد من إبداعك"}
        </h2>
        <button aria-label="إغلاق" onClick={() => dialog.current?.close()}>
          <X size={18} />
        </button>
      </div>
      <form
        ref={editorForm}
        method="post"
        onSubmit={submit}
        onInput={() => {
          if (preview) capturePreview();
        }}
        className="form-stack"
      >
        <label>
          اسم المنتج
          <input
            name="name"
            required
            minLength={2}
            maxLength={150}
            defaultValue={product?.name}
          />
        </label>
        <label>
          وصف صادق وواضح
          <textarea
            name="description"
            required
            maxLength={5000}
            defaultValue={product?.description}
          />
        </label>
        <div className="form-row">
          <label>
            السعر بالريال
            <input
              type="number"
              name="price"
              min="1"
              max="100000"
              step="0.01"
              required
              defaultValue={product ? product.price / 100 : ""}
            />
          </label>
          <label>
            الكمية المتاحة
            <input
              type="number"
              name="stock"
              min="0"
              max="100000"
              required
              defaultValue={product?.stock || 0}
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            التصنيف
            <select
              name="category_id"
              defaultValue={product?.category_id || "other"}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            مدة التجهيز بالساعات
            <input
              type="number"
              min="0"
              max="720"
              name="prep_hours"
              required
              defaultValue={product?.prep_hours ?? 24}
            />
          </label>
        </div>
        <label>
          صور المنتج الحقيقية — حتى 8 صور
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => upload(e.target.files)}
          />
          <small>
            5 ميجابايت للصورة. نحول الصور إلى WebP ونزيل بياناتها الوصفية.
          </small>
        </label>
        <div className="upload-list">
          {images.map((url, i) => (
            <div key={url}>
              <Image
                unoptimized
                src={url}
                alt={"صورة المنتج " + (i + 1)}
                width={75}
                height={75}
              />
              <button
                type="button"
                aria-label={"حذف الصورة " + (i + 1)}
                onClick={() => setImages(images.filter((x) => x !== url))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <fieldset className="form-stack">
          <legend>خيارات المنتج — المخزون مشترك بين الخيارات</legend>
          {options.map((o, i) => (
            <div className="form-row" key={o.id}>
              <label>
                اسم الخيار
                <input
                  required
                  value={o.name}
                  onChange={(e) =>
                    setOptions(
                      options.map((x, n) =>
                        n === i ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                فرق السعر بالريال
                <input
                  type="number"
                  step="0.01"
                  value={o.price_delta / 100}
                  onChange={(e) =>
                    setOptions(
                      options.map((x, n) =>
                        n === i
                          ? {
                              ...x,
                              price_delta: Math.round(
                                Number(e.target.value) * 100,
                              ),
                            }
                          : x,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="text-button"
                onClick={() => setOptions(options.filter((_, n) => n !== i))}
              >
                حذف الخيار
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-button"
            disabled={options.length >= 20}
            onClick={() =>
              setOptions([
                ...options,
                { id: crypto.randomUUID(), name: "", price_delta: 0 },
              ])
            }
          >
            إضافة خيار للمنتج
          </button>
        </fieldset>
        <label>
          حالة المنتج
          <select name="status" defaultValue={product?.status || "draft"}>
            <option value="draft">حفظ كمسودة</option>
            <option value="published">نشر بعد اعتماد الأسرة</option>
            <option value="paused">إيقاف البيع</option>
          </select>
        </label>
        <p className="notice">
          راجِع السعر والمخزون والمكونات والحساسية بنفسك. لا تنشر اعتمادًا أو
          تصريحًا لم تحصل عليه.
        </p>
        <button
          className="text-button"
          type="button"
          onClick={() => {
            capturePreview();
            setPreview(!preview);
          }}
        >
          معاينة بيانات المنتج الحالية
        </button>
        {preview && (
          <article className="panel">
            {images[0] && (
              <Image
                src={images[0]}
                alt={previewData.name}
                unoptimized
                width={360}
                height={240}
                style={{ objectFit: "cover", borderRadius: 10 }}
              />
            )}
            <h3>{previewData.name}</h3>
            <p>{previewData.description}</p>
            <strong>{money(previewData.price)} ر.س</strong>
            {options.map((o) => (
              <p key={o.id}>
                {o.name} · {money(previewData.price + o.price_delta)} ر.س
              </p>
            ))}
            <p className="hint">معاينة التعديلات الحالية قبل الحفظ والنشر.</p>
          </article>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="button" disabled={busy}>
          {busy ? "جارٍ الحفظ أو الرفع…" : "حفظ المنتج"}
        </button>
      </form>
    </dialog>
  );
}
function StoreSettings({
  store,
  done,
}: {
  store: Household;
  done: () => void;
}) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api("/seller/household", {
        method: "PUT",
        body: JSON.stringify({
          ...Object.fromEntries(d),
          opening_hour: Number(d.get("opening_hour")),
          closing_hour: Number(d.get("closing_hour")),
          slot_capacity: Number(d.get("slot_capacity")),
          free_delivery: d.has("free_delivery"),
          delivery_enabled: d.has("delivery_enabled"),
          on_vacation: d.has("on_vacation"),
        }),
      });
      toast("تم تحديث المتجر");
      done();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form method="post" className="panel form-stack" onSubmit={submit}>
      <h2>تفاصيل بيتك الإبداعي</h2>
      <label>
        اسم المتجر
        <input
          name="name"
          required
          minLength={2}
          maxLength={100}
          defaultValue={store.name}
        />
      </label>
      <label>
        نبذة عن الأسرة
        <textarea
          name="description"
          maxLength={2000}
          defaultValue={store.description}
        />
      </label>
      <label>
        المدينة
        <input name="city" required defaultValue={store.city} maxLength={80} />
      </label>
      <label>
        موقع الاستلام — يُعرض بعد تأكيد الطلب
        <textarea
          name="pickup_address"
          required
          minLength={8}
          maxLength={1000}
          defaultValue={store.pickup_address}
        />
      </label>
      <div className="form-row">
        <label>
          ساعة الافتتاح
          <input
            name="opening_hour"
            type="number"
            min="0"
            max="22"
            defaultValue={store.opening_hour}
          />
        </label>
        <label>
          ساعة الإغلاق
          <input
            name="closing_hour"
            type="number"
            min="1"
            max="23"
            defaultValue={store.closing_hour}
          />
        </label>
      </div>
      <label>
        الحد الأقصى للطلبات لكل ساعة
        <input
          name="slot_capacity"
          type="number"
          min="1"
          max="100"
          required
          defaultValue={store.slot_capacity || 10}
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          name="free_delivery"
          defaultChecked={store.free_delivery}
        />{" "}
        أقدم توصيلًا مجانيًا وأتحمل تكلفته
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          name="delivery_enabled"
          defaultChecked={store.delivery_enabled}
        />{" "}
        أسمح بالتوصيل المدفوع التجريبي
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          name="on_vacation"
          defaultChecked={store.on_vacation}
        />{" "}
        المتجر في إجازة ولا يستقبل طلبات
      </label>
      <button className="button" disabled={busy}>
        حفظ الإعدادات
      </button>
    </form>
  );
}
function TelegramPanel({ linked }: { linked: boolean }) {
  const [command, setCommand] = useState(""),
    [configured, setConfigured] = useState(false);
  const { toast } = useStore();
  return (
    <div className="panel form-stack">
      <h2>منتجاتك برسالة</h2>
      <p>
        أرسل صورة منتجك وتعليقًا مثل: «كيكة شوكولاتة، السعر 85، الكمية 5،
        التجهيز 24 ساعة» لتحويلها إلى مسودة غير منشورة.
      </p>
      <p className="badge">
        {linked ? "حساب Telegram مرتبط" : "الحساب غير مرتبط"}
      </p>
      <button
        className="button"
        onClick={async () => {
          try {
            const r = await post<{ command: string; configured: boolean }>(
              "/telegram/link",
            );
            setCommand(r.command);
            setConfigured(r.configured);
          } catch (e) {
            toast((e as Error).message);
          }
        }}
      >
        إنشاء رمز ربط مؤقت
      </button>
      {command && (
        <>
          <p className="notice">
            {configured
              ? "أرسل هذا الأمر إلى بوت المنصة خلال 10 دقائق."
              : "البوت غير مهيأ. يلزم ضبط رمز البوت وWebhook في الخادم أولًا."}
          </p>
          <code dir="ltr">{command}</code>
        </>
      )}
      <p className="hint">
        استخراج نصي حتمي حاليًا؛ لم يُفعّل اتصال نموذج متعدد الوسائط. تراجع
        الأسرة كل مسودة وتعتمد النشر صراحة.
      </p>
    </div>
  );
}
function SellerReports() {
  const [rows, setRows] = useState<
      { order_id: string; kind: string; amount: number; note: string }[]
    >([]),
    [plans, setPlans] = useState<
      {
        id: string;
        name: string;
        monthly_price: number;
        product_limit: number;
      }[]
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    api<typeof rows>("/seller/ledger")
      .then(setRows)
      .catch((e) => setError(e.message));
    api<typeof plans>("/plans")
      .then(setPlans)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <h2>سجل المبيعات والاشتراكات</h2>
      <p className="notice">
        المبالغ هنا تجريبية. لا تمثل أرباحًا صافية أو مستحقات مسددة. لم يُعتمد
        مزود دفع أو نموذج توزيع أموال.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="stats-grid">
        <div className="stat">
          <small>إجمالي قيمة المنتجات المسجلة</small>
          <strong>
            {money(
              rows
                .filter((r) => r.kind === "product_sales")
                .reduce((s, r) => s + r.amount, 0),
            )}{" "}
            ر.س
          </strong>
        </div>
        <div className="stat">
          <small>الاستردادات المسجلة</small>
          <strong>
            {money(
              -rows
                .filter((r) => r.kind === "refund")
                .reduce((s, r) => s + r.amount, 0),
            )}{" "}
            ر.س
          </strong>
        </div>
        <div className="stat">
          <small>التسويات الفعلية</small>
          <strong>غير مفعلة</strong>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>الطلب</th>
              <th>الحدث</th>
              <th>المبلغ</th>
              <th>الوصف</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.order_id.slice(0, 8)}</td>
                <td>{r.kind}</td>
                <td>{money(r.amount)} ر.س</td>
                <td>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="section">
        <h2>باقات قابلة للتهيئة</h2>
        <div className="stats-grid">
          {plans.map((p) => (
            <div className="stat" key={p.id}>
              <small>{p.name}</small>
              <strong>{money(p.monthly_price)} ر.س / شهر</strong>
              <p>{p.product_limit} منتج</p>
            </div>
          ))}
        </div>
        <p className="hint">
          التجربة الأولية 14 يومًا. الاشتراكات المدفوعة والتجديد والفوترة
          الفعلية تنتظر ربط مزود الدفع.
        </p>
      </section>
    </>
  );
}
