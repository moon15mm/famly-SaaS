"use client";
import { FormEvent, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Heart,
  House,
  ShieldCheck,
} from "lucide-react";
import { post, User } from "@/lib/api";
import { useStore } from "./provider";
export function Auth({
  register = false,
  seller = false,
}: {
  register?: boolean;
  seller?: boolean;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [visible, setVisible] = useState(false);
  const { refresh } = useStore(),
    router = useRouter(),
    params = useSearchParams();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const payload = Object.fromEntries(data);
      if (seller) payload.role = "seller";
      const user = await post<User>(
        register ? "/auth/register" : "/auth/login",
        payload,
      );
      await refresh();
      const next = params.get("next");
      router.push(
        next?.startsWith("/") && !next.startsWith("//")
          ? next
          : user.role === "seller"
            ? "/seller"
            : user.role === "driver"
              ? "/driver"
              : user.role === "admin"
                ? "/admin"
                : "/account",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container auth-page">
      <div className="auth-story">
        <span className="overline">
          {seller ? "من شغفك، تبدأ الحكاية" : "حيّاك في من بيوتنا"}
        </span>
        <h1>
          {seller ? (
            <>
              كل إبداع كبير،
              <br />
              يبدأ من <em>البيت.</em>
            </>
          ) : (
            <>
              أقرب للبيت.
              <br />
              أقرب <em>لقلبك.</em>
            </>
          )}
        </h1>
        <p>
          {seller
            ? "مساحة لمنتجاتك، وأدوات بسيطة لإدارة طلباتك. أنشئ حساب الأسرة ثم أكمل بيانات المتجر ليتم مراجعته قبل النشر."
            : "نكهات تصنع الذكريات، وهدايا تقول الكثير، ومنتجات فيها من روح أصحابها."}
        </p>
        <House size={110} strokeWidth={0.7} />
        <span className="story-note">
          <Heart size={16} /> من أيادٍ سعودية، بكل حب
        </span>
      </div>
      <form
        method="post"
        className="panel form-stack auth-form"
        onSubmit={submit}
      >
        <span className="overline">
          {register ? "أهلًا ببداية جديدة" : "نورت من جديد"}
        </span>
        <h2>
          {register
            ? seller
              ? "افتح متجر أسرتك"
              : "أنشئ حسابك"
            : "تسجيل الدخول"}
        </h2>
        {register && (
          <label>
            اسمك
            <input
              name="name"
              required
              minLength={2}
              maxLength={100}
              autoComplete="name"
            />
          </label>
        )}
        <label>
          البريد الإلكتروني
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="username"
            dir="ltr"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <label>
          كلمة المرور
          <div className="password-field">
            <input
              aria-label="كلمة المرور"
              name="password"
              type={visible ? "text" : "password"}
              required
              minLength={register ? 12 : 1}
              maxLength={128}
              autoComplete={register ? "new-password" : "current-password"}
              dir="ltr"
            />
            <button
              type="button"
              aria-label={visible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          </div>
          {register && (
            <small>12 حرفًا على الأقل. استخدم كلمة مرور فريدة.</small>
          )}
        </label>
        {!register && (
          <label>
            رمز المصادقة للمدير — عند تفعيله
            <input
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              placeholder="اختياري للحسابات الأخرى"
              dir="ltr"
            />
          </label>
        )}
        {register && !seller && (
          <label>
            نوع الحساب
            <select name="role" defaultValue="customer">
              <option value="customer">عميل</option>
              <option value="seller">أسرة منتجة</option>
              <option value="driver">سائق — يتطلب اعتمادًا</option>
            </select>
          </label>
        )}
        {register && (
          <label className="check-label">
            <input type="checkbox" required /> أوافق على{" "}
            <Link href="/policies/terms">الشروط</Link> و
            <Link href="/policies/privacy">الخصوصية</Link>.
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button" disabled={busy}>
          {busy ? "جارٍ المتابعة…" : register ? "إنشاء الحساب" : "دخول"}
          <ArrowLeft size={18} />
        </button>
        {!register&&<Link href="/forgot-password" className="text-link">نسيت كلمة المرور؟</Link>}
        <p className="auth-switch">
          {register ? "عندك حساب؟" : "أول مرة معنا؟"}{" "}
          <Link href={register ? "/login" : "/register"}>
            {register ? "سجّل دخولك" : "أنشئ حسابك"}
          </Link>
        </p>
        <p className="hint">
          <ShieldCheck size={14} /> لا نطلب منك بيانات بطاقة في البيئة
          التجريبية.
        </p>
      </form>
    </div>
  );
}
