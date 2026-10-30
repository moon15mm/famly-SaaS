import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowUpLeft,
  Leaf,
  Heart,
  ShoppingBag,
  Truck,
  ShieldCheck,
  CakeSlice,
  CookingPot,
  Gift,
  Sparkles,
  Flower2,
  Palette,
  Star,
  HandHeart,
} from "lucide-react";
import { ProductGrid } from "@/components/products";
import { Product, Household, Category } from "@/lib/api";
export const dynamic = "force-dynamic";
const apiBase = process.env.API_INTERNAL_URL || "http://127.0.0.1:8000";
async function data<T>(path: string, fallback: T): Promise<T> {
  try {
    const r = await fetch(apiBase + "/api" + path, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    return r.ok ? await r.json() : fallback;
  } catch {
    return fallback;
  }
}
const categoryIcons: Record<string, React.ReactNode> = {
  food: <CookingPot />,
  sweets: <CakeSlice />,
  perfume: <Flower2 />,
  gifts: <Gift />,
  crafts: <Palette />,
  other: <Sparkles />,
};
export default async function Home() {
  const [catalog, stores, categories, health] = await Promise.all([
    data<{ items: Product[]; total: number }>("/products", {
      items: [],
      total: 0,
    }),
    data<Household[]>("/households", []),
    data<Category[]>("/categories", []),
    data<{ status: string }>("/health", { status: "unavailable" }),
  ]);
  const hero =
    catalog.items.find((p) => p.category_id === "sweets" && p.images[0]) ||
    catalog.items[0];
  return (
    <>
      <div className="container">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <span /> من بيوت سعودية، بكل حب
            </span>
            <h1>
              أشياء تشبهنا.
              <br />
              وتحمل <span>دفء بيوتنا.</span>
            </h1>
            <p>
              نكهة بيت، ولمسة يد، وحكاية شغف.
              <br />
              اكتشف منتجات صنعتها أسرنا بعناية، واختَر ما يسعدك.
            </p>
            <Link className="button cream" href="/search">
              اكتشف منتجات أسرنا <ArrowLeft size={19} />
            </Link>
            <div className="hero-note">
              <HandHeart size={23} />
              <span>وراء كل منتج، أسرة تصنع فرقًا.</span>
            </div>
          </div>
          <div className="hero-visual">
            <span className="hero-doodle one">✳</span>
            <div className="hero-arch">
              {hero?.images[0] ? (
                <Image
                  src={hero.images[0]}
                  alt="من حلويات أسرنا — صورة عرض تجريبية"
                  fill
                  sizes="(max-width:700px) 90vw, 50vw"
                  preload
                />
              ) : (
                <div className="hero-placeholder">
                  <CookingPot size={100} />
                </div>
              )}
            </div>
            <div className="hero-stamp">
              <Heart size={20} />
              <span>
                صُنع بحب<small>من بيوتنا لكم</small>
              </span>
            </div>
            <span className="hero-doodle two">✧</span>
            <div className="photo-note">تفاصيل صغيرة، سعادة كبيرة</div>
          </div>
        </section>
        <div className="values-strip">
          <span>
            <HandHeart /> منتجات من صنع الأسر
          </span>
          <span>
            <ShoppingBag /> اطلب من الأسرة مباشرة
          </span>
          <span>
            <Truck /> استلام أو توصيل يناسبك
          </span>
          <span>
            <ShieldCheck /> تفاصيل واضحة قبل الطلب
          </span>
        </div>
        {health.status !== "ok" && (
          <p className="notice" role="alert">
            خدمة البيانات غير متاحة حاليًا. أعد المحاولة بعد تشغيل الخادم وترحيل
            قاعدة البيانات.
          </p>
        )}
        <section className="section categories-section">
          <div className="section-heading">
            <div>
              <span className="overline">لكل ذوق، حكاية</span>
              <h2>وش ودّك تكتشف اليوم؟</h2>
            </div>
            <Link href="/search" className="text-link">
              كل التصنيفات <ArrowLeft size={17} />
            </Link>
          </div>
          <div className="category-grid">
            {categories.map((c, i) => (
              <Link
                href={"/search?category=" + c.id}
                className={"category category-" + i}
                key={c.id}
              >
                <span>{categoryIcons[c.id] || <Gift />}</span>
                <h3>{c.name}</h3>
                <small>
                  اكتشف المزيد <ArrowUpLeft size={12} />
                </small>
              </Link>
            ))}
          </div>
        </section>
        <section className="section">
          <div className="section-heading">
            <div>
              <span className="overline">تستاهل تكون في سلتك</span>
              <h2>
                اختيارات من القلب <span className="heading-flower">✳</span>
              </h2>
              <p>منتجات مميزة من إبداعات أسرنا، جمعناها لك في مكان واحد.</p>
            </div>
            <Link href="/search" className="text-link">
              تسوق كل المنتجات <ArrowLeft size={17} />
            </Link>
          </div>
          <ProductGrid products={catalog.items.slice(0, 8)} />
        </section>
        <section className="season-banner">
          <div>
            <span className="overline">للجمعة الحلوة</span>
            <h2>
              ضيافة تفتح النفس،
              <br />
              وتكمّل لَمّتكم.
            </h2>
            <p>حلا منزلي ولمسات هدايا، لكل مناسبة غالية.</p>
            <Link className="button" href="/search?category=sweets">
              جهّز ضيافتك <ArrowLeft size={17} />
            </Link>
          </div>
          <div className="season-art">
            <CakeSlice size={100} strokeWidth={0.8} />
            <span>لَمّة وألف حكاية</span>
            <Sparkles size={35} />
          </div>
        </section>
        <section className="section">
          <div className="section-heading">
            <div>
              <span className="overline">تعرّف على الأيادي المبدعة</span>
              <h2>بيوت مليانة شغف</h2>
              <p>أسر محلية، حكايات ملهمة، وأشياء ما تشبه إلا أصحابها.</p>
            </div>
            <Link href="/households" className="text-link">
              كل الأسر <ArrowLeft size={17} />
            </Link>
          </div>
          <div className="household-grid">
            {stores.slice(0, 3).map((h, i) => (
              <Link
                href={"/household/" + h.id}
                key={h.id}
                className="household-card"
              >
                <div className={"household-avatar avatar-" + i}>
                  {h.name.slice(0, 1)}
                  <Leaf size={20} />
                </div>
                <div>
                  <h3>
                    {h.name} <ShieldCheck size={15} />
                  </h3>
                  <span>
                    <MapPinIcon />
                    {h.city}
                  </span>
                  <p>{h.description.slice(0, 65)}</p>
                </div>
                <ArrowUpLeft size={22} />
              </Link>
            ))}
          </div>
        </section>
        <section className="how-section">
          <span className="overline">من بيتهم، لباب بيتك</span>
          <h2>حكاية طلبك تبدأ بخطوات بسيطة</h2>
          <div className="steps">
            {[
              [
                ShoppingBag,
                "01",
                "اكتشف واختر",
                "تصفح المنتجات وأضف ما تحب من أسرة واحدة.",
              ],
              [
                Heart,
                "02",
                "خلّها على ذوقك",
                "اختر الكمية والوقت الذي يناسبك.",
              ],
              [
                Truck,
                "03",
                "استلمها بكل حب",
                "استلام من الأسرة أو توصيل حسب الخيارات المتاحة.",
              ],
            ].map(([Icon, num, title, text]) => {
              const I = Icon as typeof ShoppingBag;
              return (
                <div key={num as string}>
                  <span className="step-icon">
                    <I />
                    <small>{num as string}</small>
                  </span>
                  <h3>{title as string}</h3>
                  <p>{text as string}</p>
                </div>
              );
            })}
          </div>
        </section>
        <section className="join-banner">
          <span className="join-symbol">
            ⌂<Heart size={30} />
          </span>
          <div>
            <span className="overline">إبداعك يستاهل يوصل</span>
            <h2>لديك شغف؟ خلّنا نكبر معك.</h2>
            <p>افتح متجرك، شارك منتجاتك، ووصل إبداعك لعملاء جدد.</p>
          </div>
          <Link className="button cream" href="/join">
            ابدأ حكاية متجرك <ArrowUpLeft size={19} />
          </Link>
        </section>
      </div>
    </>
  );
}
function MapPinIcon() {
  return <span aria-hidden="true">⌖ </span>;
}
