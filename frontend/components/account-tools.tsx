"use client";
import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, post, date } from "@/lib/api";
import { useStore } from "./provider";
import { MapPicker, Point } from "./map-picker";
export interface SavedAddress extends Point {
  id: string;
  label: string;
  city: string;
  details: string;
  phone: string;
  is_default: boolean;
}
export function AccountSecurity() {
  const { user, refresh, toast } = useStore();
  const [mailbox, setMailbox] = useState(false),
    [busy, setBusy] = useState(false);
  async function change(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    try {
      await post(
        "/auth/change-password",
        Object.fromEntries(new FormData(form)),
      );
      await refresh();
      form.reset();
      toast("تم تغيير كلمة المرور وإغلاق الجلسات السابقة");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportData() {
    try {
      const data = await api("/account/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "my-account.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <section className="section">
      <div className="panel form-stack">
        <h2>أمان حسابك وخصوصيته</h2>
        <p className="badge">
          {user?.email_verified
            ? "بريدك الإلكتروني مؤكد"
            : "لم يؤكد البريد الإلكتروني بعد"}
        </p>
        {!user?.email_verified && (
          <button
            className="button"
            onClick={async () => {
              try {
                const r = await post<{ local_mailbox: boolean }>(
                  "/auth/verification",
                );
                setMailbox(r.local_mailbox);
                toast("أرسلت تعليمات التحقق إلى البريد");
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            إرسال رابط تأكيد البريد
          </button>
        )}
        {mailbox && (
          <Link
            className="text-link"
            href={"/mailbox?email=" + encodeURIComponent(user?.email || "")}
          >
            فتح بريد التجربة المحلي
          </Link>
        )}
        <Link className="text-link" href="/addresses">
          إدارة عناويني المحفوظة
        </Link>
        {["seller", "driver"].includes(user?.role || "") && (
          <Link className="text-link" href="/verification">
            مستندات الاعتماد الخاصة
          </Link>
        )}
        <form method="post" className="form-stack" onSubmit={change}>
          <h3>تغيير كلمة المرور</h3>
          <label>
            كلمة المرور الحالية
            <input
              type="password"
              name="current_password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          <label>
            كلمة المرور الجديدة
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          <button className="button" disabled={busy}>
            حفظ كلمة المرور الجديدة
          </button>
        </form>
        <div className="order-actions">
          <button className="text-button" onClick={exportData}>
            تنزيل نسخة من بياناتي
          </button>
          <button
            className="text-button"
            onClick={async () => {
              try {
                const r = await post<{ message: string }>(
                  "/account/deletion-request",
                );
                toast(r.message);
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            طلب محو بيانات الحساب للمراجعة
          </button>
        </div>
        <p className="hint">
          طلبات المحو تراجع وفق الطلبات القائمة والالتزامات النظامية ولا تلغي
          السجلات المالية تلقائيًا.
        </p>
      </div>
    </section>
  );
}
export function AddressBook() {
  const [items, setItems] = useState<SavedAddress[]>([]),
    [point, setPoint] = useState<Point>({ latitude: null, longitude: null }),
    [editing, setEditing] = useState<SavedAddress | null>(null),
    [busy, setBusy] = useState(false);
  const { toast } = useStore();
  function load() {
    api<SavedAddress[]>("/addresses")
      .then(setItems)
      .catch((e) => toast(e.message));
  }
  useEffect(load, []);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    setBusy(true);
    try {
      await api("/addresses" + (editing ? "/" + editing.id : ""), {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({
          ...Object.fromEntries(data),
          ...point,
          is_default: data.has("is_default"),
        }),
      });
      setEditing(null);
      setPoint({ latitude: null, longitude: null });
      form.reset();
      load();
      toast("تم حفظ العنوان");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container page">
      <div className="page-title">
        <span className="overline">أقرب لباب بيتك</span>
        <h1>عناويني</h1>
      </div>
      <div className="checkout-grid">
        <div className="order-list">
          {items.map((a) => (
            <article className="panel" key={a.id}>
              <h2>
                {a.label}{" "}
                {a.is_default && <span className="badge">الافتراضي</span>}
              </h2>
              <p>
                {a.city} · {a.details}
              </p>
              <p dir="ltr">{a.phone}</p>
              {a.latitude !== null && a.longitude !== null && (
                <a
                  target="_blank"
                  rel="noreferrer"
                  className="text-link"
                  href={`https://www.openstreetmap.org/?mlat=${a.latitude}&mlon=${a.longitude}#map=16/${a.latitude}/${a.longitude}`}
                >
                  عرض الموقع
                </a>
              )}
              <div className="order-actions">
                <button
                  className="text-button"
                  onClick={() => {
                    setEditing(a);
                    setPoint({ latitude: a.latitude, longitude: a.longitude });
                  }}
                >
                  تعديل العنوان
                </button>
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await api("/addresses/" + a.id, { method: "DELETE" });
                      load();
                      toast("حذف العنوان المحفوظ");
                    } catch (e) {
                      toast((e as Error).message);
                    }
                  }}
                >
                  حذف العنوان
                </button>
              </div>
            </article>
          ))}
          {!items.length && <p className="empty">لم تحفظ عنوانًا بعد.</p>}
        </div>
        <form
          key={editing?.id || "new"}
          className="panel form-stack"
          method="post"
          onSubmit={save}
        >
          <h2>{editing ? "تعديل العنوان" : "عنوان جديد"}</h2>
          <label>
            اسم العنوان
            <input
              name="label"
              required
              minLength={2}
              maxLength={80}
              defaultValue={editing?.label}
              placeholder="المنزل أو العمل"
            />
          </label>
          <label>
            المدينة
            <input
              name="city"
              required
              minLength={2}
              maxLength={80}
              defaultValue={editing?.city}
              autoComplete="address-level2"
            />
          </label>
          <label>
            تفاصيل العنوان
            <textarea
              name="details"
              required
              minLength={10}
              maxLength={1000}
              defaultValue={editing?.details}
              autoComplete="street-address"
            />
          </label>
          <label>
            رقم التواصل
            <input
              name="phone"
              type="tel"
              pattern="\+?[0-9 ]*"
              maxLength={20}
              defaultValue={editing?.phone}
              autoComplete="tel"
              dir="ltr"
            />
          </label>
          <MapPicker value={point} onChange={setPoint} />
          <label className="check-label">
            <input
              name="is_default"
              type="checkbox"
              defaultChecked={editing?.is_default}
            />{" "}
            العنوان الافتراضي
          </label>
          <button className="button" disabled={busy}>
            حفظ العنوان
          </button>
          {editing && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setEditing(null);
                setPoint({ latitude: null, longitude: null });
              }}
            >
              إضافة عنوان آخر
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
export function Recovery({ mode }: { mode: "forgot" | "reset" | "verify" }) {
  const params = useSearchParams();
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [local, setLocal] = useState(false),
    [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false);
  const { refresh } = useStore();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "forgot") {
        const r = await post<{ message: string; local_mailbox: boolean }>(
          "/auth/forgot-password",
          { email },
        );
        setMessage(r.message);
        setLocal(r.local_mailbox);
      } else {
        const data = Object.fromEntries(new FormData(e.currentTarget));
        await post(
          mode === "reset" ? "/auth/reset-password" : "/auth/verify-email",
          { ...data, token: params.get("token") || "" },
        );
        setMessage(
          mode === "reset"
            ? "تم تغيير كلمة المرور. سجل دخولك بالكلمة الجديدة."
            : "تم تأكيد بريدك الإلكتروني",
        );
        await refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container page narrow">
      <form method="post" className="panel form-stack" onSubmit={submit}>
        <span className="overline">حسابك بأمان</span>
        <h1>
          {mode === "forgot"
            ? "استعادة الحساب"
            : mode === "reset"
              ? "كلمة مرور جديدة"
              : "تأكيد بريدك الإلكتروني"}
        </h1>
        {mode === "forgot" && (
          <label>
            البريد الإلكتروني
            <input
              type="email"
              value={email}
              required
              autoComplete="email"
              maxLength={254}
              onChange={(e) => setEmail(e.target.value)}
              dir="ltr"
            />
          </label>
        )}
        {mode === "reset" && (
          <label>
            كلمة المرور الجديدة
            <input
              name="password"
              type="password"
              minLength={12}
              maxLength={128}
              required
              autoComplete="new-password"
            />
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <button
          className="button"
          disabled={busy || (!!message && mode !== "forgot")}
        >
          {busy
            ? "جارٍ الإرسال…"
            : mode === "forgot"
              ? "إرسال تعليمات الاستعادة"
              : mode === "reset"
                ? "حفظ كلمة المرور"
                : "تأكيد البريد"}
        </button>
        {local && (
          <Link
            className="text-link"
            href={"/mailbox?email=" + encodeURIComponent(email)}
          >
            فتح بريد التجربة المحلي
          </Link>
        )}
        <Link className="text-link" href="/login">
          العودة لتسجيل الدخول
        </Link>
      </form>
    </div>
  );
}
export function Mailbox() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") || ""),
    [items, setItems] = useState<
      { id: string; subject: string; body: string; created_at: string }[]
    >([]),
    [error, setError] = useState("");
  async function load(e?: FormEvent) {
    e?.preventDefault();
    try {
      setItems(
        await api<typeof items>(
          "/dev/mailbox?email=" + encodeURIComponent(email),
        ),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (email) load();
  }, []);
  return (
    <div className="container page narrow">
      <h1>بريد التجربة المحلي</h1>
      <p className="notice">
        خاص ببيئة التطوير المحلية، ولا يظهر في الإنتاج. لا يرسل بريدًا حقيقيًا.
      </p>
      <form className="form-stack panel" onSubmit={load}>
        <label>
          البريد المطلوب
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            dir="ltr"
          />
        </label>
        <button className="button">تحديث الرسائل</button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {items.map((m) => {
        const link = m.body.match(/https?:\/\/[^\s]+/)?.[0];
        return (
          <article className="panel section" key={m.id}>
            <h2>{m.subject}</h2>
            <small>{date(m.created_at)}</small>
            <p>رابط لمرة واحدة، صالح 30 دقيقة.</p>
            {link && (
              <Link className="button" href={link}>
                فتح رابط الرسالة
              </Link>
            )}
          </article>
        );
      })}
      {!items.length && !error && (
        <p className="empty">لا رسائل صالحة لهذا البريد.</p>
      )}
    </div>
  );
}
