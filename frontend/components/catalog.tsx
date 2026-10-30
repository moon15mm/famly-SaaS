"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Clock,
  Heart,
  Minus,
  Plus,
  ShieldCheck,
  Store,
  Truck,
  MapPin,
} from "lucide-react";
import { api, Product, Household, Category, money, post } from "@/lib/api";
import { ProductGrid } from "./products";
import { useStore } from "./provider";
export function Catalog({ householdId }: { householdId?: string }) {
  const params = useSearchParams(),
    [products, setProducts] = useState<Product[]>([]),
    [categories, setCategories] = useState<Category[]>([]),
    [store, setStore] = useState<Household | null>(null),
    [total, setTotal] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [sort, setSort] = useState("featured"),
    [page, setPage] = useState(1);
  const category = params.get("category") || "",
    q = params.get("q") || "";
  useEffect(() => {
    api<Category[]>("/categories")
      .then(setCategories)
      .catch(() => {});
    if (householdId)
      api<Household>("/households/" + householdId)
        .then(setStore)
        .catch((e) => setError(e.message));
  }, [householdId]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const qs = new URLSearchParams({
      q,
      category,
      sort,
      page: String(page),
      household_id: householdId || "",
    });
    api<{ items: Product[]; total: number }>("/products?" + qs)
      .then((r) => {
        if (active) {
          setProducts(r.items);
          setTotal(r.total);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [q, category, sort, page, householdId]);
  useEffect(() => {
    setPage(1);
  }, [q, category, sort]);
  return (
    <div className="container page">
      <div className="breadcrumb">
        <Link href="/">الرئيسية</Link> / {store ? store.name : "اكتشف المنتجات"}
      </div>
      {store ? (
        <div className="store-hero">
          <span className="big-avatar">{store.name[0]}</span>
          <div>
            <span className="overline">بيت من بيوتنا</span>
            <h1>
              {store.name} <ShieldCheck size={25} />
            </h1>
            <p>{store.description}</p>
            <span>
              <MapPin size={15} />
              {store.city} ·{" "}
              {store.on_vacation
                ? "في إجازة حاليًا"
                : `أوقات العمل ${store.opening_hour}:00 – ${store.closing_hour}:00`}
            </span>
          </div>
        </div>
      ) : (
        <div className="page-title">
          <span className="overline">أشياء جميلة تنتظرك</span>
          <h1>{q ? `نتائج البحث عن «${q}»` : "اكتشف إبداعات أسرنا"}</h1>
          <p>من مطابخ دافئة وأيادٍ مبدعة، إلى يومك.</p>
        </div>
      )}
      <div className="filter-bar">
        <div className="filter-chips">
          <Link className={!category ? "selected" : ""} href="/search">
            الكل
          </Link>
          {categories.map((c) => (
            <Link
              className={category === c.id ? "selected" : ""}
              href={"/search?category=" + c.id}
              key={c.id}
            >
              {c.name}
            </Link>
          ))}
        </div>
        <label className="sort">
          الترتيب
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="featured">اختياراتنا</option>
            <option value="newest">الأحدث</option>
            <option value="price_asc">السعر: الأقل أولًا</option>
            <option value="price_desc">السعر: الأعلى أولًا</option>
          </select>
        </label>
      </div>
      <p className="muted">{total} منتج من إبداعات أسرنا</p>
      {error ? (
        <div role="alert" className="notice">
          {error}
        </div>
      ) : loading ? (
        <div className="product-grid">
          {[1, 2, 3, 4].map((n) => (
            <div className="skeleton skeleton-card" key={n} />
          ))}
        </div>
      ) : (
        <ProductGrid products={products} />
      )}
      <div className="pagination">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          السابق
        </button>
        <span>صفحة {page}</span>
        <button disabled={page * 24 >= total} onClick={() => setPage(page + 1)}>
          التالي
        </button>
      </div>
    </div>
  );
}
export function ProductDetail({ id }: { id: string }) {
  const [optionId, setOptionId] = useState("");
  const [p, setProduct] = useState<Product | null>(null),
    [error, setError] = useState(""),
    [qty, setQty] = useState(1),
    [image, setImage] = useState(0);
  const { add, user, toast } = useStore();
  useEffect(() => {
    api<Product>("/products/" + id)
      .then(setProduct)
      .catch((e) => setError(e.message));
  }, [id]);
  if (error)
    return (
      <div className="empty page">
        <h1>{error}</h1>
        <Link href="/search" className="button">
          تصفح المنتجات
        </Link>
      </div>
    );
  if (!p)
    return (
      <div
        className="container page skeleton skeleton-detail"
        aria-label="جارٍ تحميل المنتج"
      />
    );
  return (
    <div className="container page">
      <div className="breadcrumb">
        <Link href="/">الرئيسية</Link> / <Link href="/search">المنتجات</Link> /{" "}
        {p.name}
      </div>
      <div className="product-detail">
        <div>
          <div className="detail-image">
            {p.images[image] && (
              <Image
                src={p.images[image]}
                alt={p.name}
                fill
                sizes="(max-width:700px) 100vw, 50vw"
                preload
              />
            )}
          </div>
          {p.images.length > 1 && (
            <div className="thumbnails">
              {p.images.map((url, i) => (
                <button
                  key={url}
                  className={image === i ? "selected" : ""}
                  onClick={() => setImage(i)}
                  aria-label={"الصورة " + (i + 1)}
                >
                  <Image src={url} width={70} height={70} alt={p.name} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="detail-copy">
          <Link href={"/household/" + p.household_id} className="store-caption">
            <Store size={18} />
            {p.household_name}
            <ShieldCheck size={16} />
          </Link>
          <h1>{p.name}</h1>
          <p className="detail-price">
            {money(
              p.price +
                (p.options?.find((o) => o.id === optionId)?.price_delta || 0),
            )}{" "}
            <small>ر.س</small>
          </p>
          <p className="description">{p.description}</p>
          <div className="detail-facts">
            <span>
              <Clock /> التجهيز خلال {p.prep_hours} ساعة
            </span>
            <span>
              <Check /> {p.stock > 0 ? `${p.stock} قطعة متاحة` : "نفدت الكمية"}
            </span>
            <span>
              <MapPin /> {p.city}
            </span>
            <span>
              <Truck /> استلام{" "}
              {p.household?.delivery_enabled ? "أو توصيل حسب المتاح" : ""}
            </span>
          </div>
          {!!p.options?.length && (
            <label className="form-stack">
              خيارات المنتج
              <select
                aria-label="خيارات المنتج"
                value={optionId}
                onChange={(e) => setOptionId(e.target.value)}
              >
                <option value="">اختر خيارًا</option>
                {p.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} · {money(p.price + o.price_delta)} ر.س
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="quantity-label">الكمية</label>
          <div className="purchase-row">
            <div className="quantity-control">
              <button
                aria-label="تقليل الكمية"
                disabled={qty <= 1}
                onClick={() => setQty(qty - 1)}
              >
                <Minus size={16} />
              </button>
              <span>{qty}</span>
              <button
                aria-label="زيادة الكمية"
                disabled={qty >= p.stock}
                onClick={() => setQty(qty + 1)}
              >
                <Plus size={16} />
              </button>
            </div>
            <button
              className="button"
              disabled={!p.stock}
              onClick={() => add(p, qty, optionId)}
            >
              أضف إلى السلة ·{" "}
              {money(
                (p.price +
                  (p.options?.find((o) => o.id === optionId)?.price_delta ||
                    0)) *
                  qty,
              )}{" "}
              ر.س <Plus size={17} />
            </button>
          </div>
          <p className="hint">
            سلة واحدة لكل أسرة. يمكنك تأكيد الرسوم والموعد قبل إنشاء الطلب.
          </p>
          <div className="soft-box">
            <Heart size={21} />
            <span>شراء صغير منك، يعني الكثير لأسرة منتجة.</span>
          </div>
          <Link href={"/household/" + p.household_id} className="text-link">
            زور متجر الأسرة <ArrowLeft size={16} />
          </Link>
        </div>
      </div>
      <section className="section">
        <h2>تجارب العملاء مع الأسرة</h2>
        {p.reviews?.length ? (
          p.reviews.map((r, i) => (
            <div className="panel" key={i}>
              <strong>{r.rating} / 5</strong>
              <p>{r.comment}</p>
            </div>
          ))
        ) : (
          <p className="muted">
            لم تُضف تقييمات بعد. التقييم متاح لأصحاب الطلبات المكتملة فقط.
          </p>
        )}
      </section>
    </div>
  );
}
export function Households() {
  const [items, setItems] = useState<Household[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    api<Household[]>("/households")
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="container page">
      <div className="page-title">
        <span className="overline">أيادٍ مبدعة، وحكايات قريبة</span>
        <h1>تعرّف على أسرنا</h1>
        <p>كل متجر هنا بدأ بفكرة، وكبر بشغف.</p>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="household-grid">
        {items.map((h) => (
          <Link
            className="household-card"
            href={"/household/" + h.id}
            key={h.id}
          >
            <span className="household-avatar">{h.name[0]}</span>
            <div>
              <h2>{h.name}</h2>
              <span>{h.city}</span>
              <p>{h.description}</p>
            </div>
            <ArrowLeft size={20} />
          </Link>
        ))}
      </div>
      {!items.length && !error && (
        <p className="empty">لا توجد أسر منشورة بعد.</p>
      )}
    </div>
  );
}
