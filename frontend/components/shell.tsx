"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  House,
  Search,
  ShoppingBag,
  UserRound,
  Heart,
  MapPin,
  ArrowUpLeft,
  Leaf,
  Store,
  Menu,
} from "lucide-react";
import { useStore } from "./provider";
import { useState } from "react";
export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="من بيوتنا، الرئيسية">
      <span className="logo-mark">
        <House size={25} />
        <Leaf size={13} />
      </span>
      <span>
        من بيوتنا<small>صُنع بحب، من قريب</small>
      </span>
    </Link>
  );
}
export function Header() {
  const { user, cart } = useStore(),
    pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="announcement">
        <span>أشياء نصنعها بحب… وتصل إليك بروح البيت</span>
        <span>نسخة تجريبية · لا تُحصّل أموال حقيقية</span>
      </div>
      <header>
        <div className="container header-main">
          <Logo />
          <form action="/search" className="search" role="search">
            <Search size={20} />
            <input
              name="q"
              aria-label="ابحث عن منتج أو أسرة"
              placeholder="وش خاطرك فيه اليوم؟"
              autoComplete="off"
            />
            <kbd>بحث</kbd>
          </form>
          <div className="header-actions">
            <span className="location">
              <MapPin size={19} />
              <span>
                <small>منتجات أسرنا في</small>السعودية
              </span>
            </span>
            <Link
              href="/favorites"
              aria-label="المفضلة"
              className="icon-button"
            >
              <Heart size={21} />
            </Link>
            <Link href={user ? "/account" : "/login"} className="account-link">
              <UserRound size={21} />
              <span>{user ? user.name.split(" ")[0] : "حسابي"}</span>
            </Link>
            <Link
              href="/cart"
              className="basket"
              aria-label={`السلة، ${cart.reduce((s, x) => s + x.quantity, 0)} منتجات`}
            >
              <ShoppingBag size={21} />
              <span>{cart.reduce((s, x) => s + x.quantity, 0)}</span>
            </Link>
            <button
              className="mobile-menu icon-button"
              aria-label="قائمة التنقل"
              aria-expanded={open}
              aria-controls="primary-navigation"
              onClick={() => setOpen(!open)}
            >
              <Menu />
            </button>
          </div>
        </div>
        <div className="nav-border">
          <nav
            id="primary-navigation"
            className={"container navigation " + (open ? "expanded" : "")}
            aria-label="التنقل الرئيسي"
          >
            <div className="nav-links">
              {[
                ["/", "الرئيسية"],
                ["/search", "تسوق كل المنتجات"],
                ["/search?category=food", "من مطابخنا"],
                ["/search?category=sweets", "حلا وضيافة"],
                ["/search?category=crafts", "حِرف وهدايا"],
                ["/households", "تعرّف على أسرنا"],
              ].map(([href, label]) => (
                <Link
                  onClick={() => setOpen(false)}
                  key={label}
                  href={href}
                  className={pathname === href ? "active" : ""}
                >
                  {label}
                </Link>
              ))}
            </div>
            <Link
              className="seller-link"
              href={user?.role === "seller" ? "/seller" : "/join"}
            >
              <Store size={16} />{" "}
              {user?.role === "seller" ? "لوحة متجري" : "انضم كأسرة منتجة"}
              <ArrowUpLeft size={15} />
            </Link>
          </nav>
        </div>
      </header>
    </>
  );
}
export function Footer() {
  return (
    <footer>
      <div className="container footer-grid">
        <div>
          <Logo />
          <p>
            كل بيت عنده حكاية، وكل منتج وراه شغف.
            <br />
            نقرّب لك إبداعات الأسر السعودية في مكان واحد.
          </p>
          <span className="footer-love">من أيادٍ سعودية، إلى قلبك ♡</span>
        </div>
        <div>
          <h3>اكتشف من بيوتنا</h3>
          <Link href="/search">كل المنتجات</Link>
          <Link href="/households">الأسر المنتجة</Link>
          <Link href="/join">ابدأ حكاية متجرك</Link>
        </div>
        <div>
          <h3>نحن هنا لمساعدتك</h3>
          <Link href="/orders">طلباتي وتتبع الطلب</Link>
          <Link href="/policies/delivery">التوصيل والاستلام</Link>
          <Link href="/account">حسابي والدعم</Link>
        </div>
        <div>
          <h3>معلومات تهمك</h3>
          <Link href="/policies/terms">الشروط والأحكام</Link>
          <Link href="/policies/privacy">سياسة الخصوصية</Link>
          <Link href="/policies/refund">الإلغاء والاسترداد</Link>
          <Link href="/policies/about">عن المنصة ومصادر الصور</Link>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} من بيوتنا. جميع الحقوق محفوظة.</span>
        <span>بيئة تطوير · الصور والمنتجات للعرض التجريبي</span>
        <span>
          صُنع في السعودية <Leaf size={15} />
        </span>
      </div>
    </footer>
  );
}
