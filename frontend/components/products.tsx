"use client";
import Image from "next/image";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {
  Heart,
  Plus,
  MapPin,
  ArrowLeft,
  Clock,
  PackageCheck,
} from "lucide-react";
import { Product, money, post } from "@/lib/api";
import { useStore } from "./provider";
export function ProductCard({ product: p }: { product: Product }) {
  const { add, user, toast } = useStore();
  const router=useRouter();
  async function favorite() {
    if (!user) {
      toast("سجّل دخولك لحفظ مفضلتك");
      return;
    }
    try {
      const r = await post<{ saved: boolean }>("/favorites/" + p.id);
      toast(r.saved ? "تم الحفظ في المفضلة" : "تم الحذف من المفضلة");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <article className="product-card">
      <div className="product-photo">
        <Link href={"/product/" + p.id}>
          {p.images[0] ? (
            <Image
              src={p.images[0]}
              alt={p.name}
              fill
              sizes="(max-width: 600px) 48vw, (max-width: 1000px) 33vw, 25vw"
            />
          ) : (
            <div className="image-empty">صُنع بحب</div>
          )}
        </Link>
        <button
          className="favorite"
          onClick={favorite}
          aria-label={"حفظ " + p.name + " في المفضلة"}
        >
          <Heart size={18} />
        </button>
        {p.featured && <span className="product-tag">اختياراتنا لك</span>}
        {!p.stock && <span className="sold-out">نفدت الكمية</span>}
      </div>
      <div className="product-info">
        <Link className="store-caption" href={"/household/" + p.household_id}>
          <span className="tiny-house">⌂</span>{" "}
          {p.household_name || "من إبداعات أسرنا"}
        </Link>
        <h3>
          <Link href={"/product/" + p.id}>{p.name}</Link>
        </h3>
        <div className="product-meta">
          <span>
            <MapPin size={12} />
            {p.city || "السعودية"}
          </span>
          <span>
            <Clock size={12} />
            {p.prep_hours} ساعة للتجهيز
          </span>
        </div>
        <div className="product-bottom">
          <span className="price">
            {money(p.price)} <small>ر.س</small>
          </span>
          <button
            className="add-button"
            disabled={!p.stock}
            onClick={() => p.options?.length?router.push("/product/"+p.id):add(p)}
            aria-label={"أضف " + p.name + " إلى السلة"}
          >
            <Plus size={19} />
          </button>
        </div>
      </div>
    </article>
  );
}
export function ProductGrid({ products }: { products: Product[] }) {
  return products.length ? (
    <div className="product-grid">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  ) : (
    <div className="empty">
      <PackageCheck size={40} />
      <h3>قريبًا، إبداعات جديدة هنا</h3>
      <p>جرّب تصنيفًا آخر أو عد لاكتشاف منتجات أسرنا لاحقًا.</p>
      <Link className="button" href="/search">
        تصفح كل المنتجات <ArrowLeft size={16} />
      </Link>
    </div>
  );
}
