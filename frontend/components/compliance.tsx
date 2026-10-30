"use client";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { api, post, date } from "@/lib/api";
import { useStore } from "./provider";
export type ComplianceDocument = {
  id: string;
  title: string;
  description: string;
  required: boolean;
  needs_expiry: boolean;
  state: string;
  document_id: string | null;
  expires_on: string | null;
  note: string;
};
export type Compliance = {
  role: string;
  complete: boolean;
  missing: string[];
  documents: ComplianceDocument[];
  contract: null | {
    id: string;
    version: number;
    title: string;
    body?: string;
    accepted: boolean;
    acceptance_id: string | null;
    accepted_at: string | null;
  };
};
const states: Record<string, string> = {
  missing: "لم يُرفع",
  pending: "بانتظار المراجعة",
  rejected: "مرفوض",
  expired: "منتهي",
  expiring: "ينتهي قريبًا",
  accepted: "مقبول",
};
const today = () => new Date().toISOString().slice(0, 10);
export function CompliancePanel({
  onChange,
}: {
  onChange?: (state: Compliance) => void;
}) {
  const [state, setState] = useState<Compliance | null>(null),
    [name, setName] = useState(""),
    [agree, setAgree] = useState(false),
    [busy, setBusy] = useState(false);
  const { toast } = useStore();
  function load() {
    api<Compliance>("/compliance")
      .then((next) => {
        setState(next);
        onChange?.(next);
      })
      .catch((e) => toast(e.message));
  }
  useEffect(load, []);
  async function sign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!state?.contract) return;
    setBusy(true);
    try {
      await post("/compliance/contract", {
        contract_id: state.contract.id,
        full_name: name,
        agree,
      });
      toast("تم توقيع العقد");
      load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(
    e: FormEvent<HTMLFormElement>,
    item: ComplianceDocument,
  ) {
    e.preventDefault();
    const form = e.currentTarget,
      d = new FormData(form),
      file = d.get("file");
    if (!(file instanceof File)) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const expiry = String(d.get("expires_on") || "");
      await api(
        "/verification/documents?requirement_id=" +
          encodeURIComponent(item.id) +
          (expiry ? "&expires_on=" + encodeURIComponent(expiry) : ""),
        { method: "POST", body },
      );
      form.reset();
      toast("رُفع «" + item.title + "» للمراجعة");
      load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!state)
    return (
      <section className="panel">
        <p>جارٍ تحميل المتطلبات…</p>
      </section>
    );
  const contract = state.contract;
  return (
    <section className="panel form-stack" id="compliance">
      <h2>العقد والمتطلبات</h2>
      <p className="notice" role="status">
        {state.complete
          ? "اكتملت المتطلبات."
          : "المتبقي: " + state.missing.join("، ")}
      </p>
      {contract &&
        (contract.accepted ? (
          <p>
            وُقّع «{contract.title}» — الإصدار {contract.version}
            {contract.accepted_at
              ? " بتاريخ " + date(contract.accepted_at)
              : ""}
            .{" "}
            {contract.acceptance_id && (
              <Link
                className="text-link"
                href={"/contracts/" + contract.acceptance_id}
              >
                عرض نسخة العقد وطباعتها
              </Link>
            )}
          </p>
        ) : (
          <form method="post" className="form-stack" onSubmit={sign}>
            <h3>
              {contract.title} — الإصدار {contract.version}
            </h3>
            <div className="contract-text" tabIndex={0}>
              {contract.body}
            </div>
            <label>
              الاسم الكامل كما في الهوية
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={3}
                maxLength={100}
                autoComplete="name"
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
              />
              قرأت العقد وأوافق على الالتزام بجميع بنوده
            </label>
            <button className="button" disabled={busy || !agree}>
              توقيع العقد إلكترونيًا
            </button>
            <p className="hint">
              يُحفظ مع التوقيع الاسم والتاريخ والوقت وعنوان الاتصال لإثبات
              الموافقة.
            </p>
          </form>
        ))}
      <h3>المستندات</h3>
      <div className="order-list">
        {state.documents.map((item) => (
          <article className="order-card" key={item.id}>
            <div className="order-card-top">
              <h4>
                {item.title}
                {item.required ? "" : " (اختياري)"}
              </h4>
              <span
                className={
                  "badge " +
                  (["accepted", "expiring"].includes(item.state)
                    ? "success"
                    : "")
                }
              >
                {states[item.state] || item.state}
              </span>
            </div>
            {item.description && <p className="hint">{item.description}</p>}
            {item.expires_on && <p>ينتهي في {item.expires_on}</p>}
            {item.note && <p>ملاحظة المراجعة: {item.note}</p>}
            {item.state !== "pending" && item.state !== "accepted" && (
              <form
                method="post"
                className="form-stack"
                onSubmit={(e) => upload(e, item)}
              >
                <input
                  aria-label={"صورة " + item.title}
                  name="file"
                  type="file"
                  required
                  accept="image/jpeg,image/png,image/webp"
                />
                {item.needs_expiry && (
                  <label>
                    تاريخ انتهاء المستند
                    <input
                      name="expires_on"
                      type="date"
                      required
                      min={today()}
                    />
                  </label>
                )}
                <button className="text-button" disabled={busy}>
                  {item.state === "missing" ? "رفع المستند" : "رفع نسخة جديدة"}
                </button>
              </form>
            )}
          </article>
        ))}
      </div>
      <p className="hint">
        صور واضحة بصيغة JPG أو PNG أو WebP حتى 5 ميجابايت. المستندات خاصة
        بالإدارة ولا تظهر في المتجر.
      </p>
    </section>
  );
}
type Copy = {
  title: string;
  version: number;
  body: string;
  body_hash: string;
  published_at: string;
  full_name: string;
  accepted_at: string;
  ip: string;
  account_email: string;
};
export function ContractCopy({ id }: { id: string }) {
  const [copy, setCopy] = useState<Copy | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<Copy>("/contracts/acceptances/" + id)
      .then(setCopy)
      .catch((e) => setError(e.message));
  }, [id]);
  if (!copy)
    return (
      <div className="container page">
        <p role="alert">{error || "جارٍ تحميل نسخة العقد…"}</p>
      </div>
    );
  return (
    <div className="container page">
      <article className="panel form-stack">
        <span className="overline">نسخة عقد موقّع إلكترونيًا</span>
        <h1>{copy.title}</h1>
        <p>
          الإصدار {copy.version} — نُشر {date(copy.published_at)}
        </p>
        <div className="contract-text print-full">{copy.body}</div>
        <p>
          وقّعه إلكترونيًا: <strong>{copy.full_name}</strong> —{" "}
          {date(copy.accepted_at)}
        </p>
        <p className="hint">
          الحساب {copy.account_email} · عنوان الاتصال {copy.ip || "—"} · بصمة
          النص {copy.body_hash.slice(0, 16)}
        </p>
        <button className="button no-print" onClick={() => window.print()}>
          طباعة أو حفظ PDF
        </button>
      </article>
    </div>
  );
}
type ContractAdmin = {
  role: string;
  title: string;
  body: string;
  versions: {
    id: string;
    version: number;
    title: string;
    published_at: string;
    acceptances: number;
  }[];
};
type Requirement = {
  id: string;
  role: string;
  title: string;
  description: string;
  required: boolean;
  needs_expiry: boolean;
  active: boolean;
  position: number;
};
const roleName = (role: string) => (role === "driver" ? "السائقين" : "الأسر");
export function ContractsAdmin() {
  const [contracts, setContracts] = useState<ContractAdmin[]>([]),
    [requirements, setRequirements] = useState<Requirement[]>([]);
  const { toast } = useStore();
  function load() {
    api<ContractAdmin[]>("/admin/contracts")
      .then(setContracts)
      .catch((e) => toast(e.message));
    api<Requirement[]>("/admin/requirements")
      .then(setRequirements)
      .catch((e) => toast(e.message));
  }
  useEffect(load, []);
  async function publish(e: FormEvent<HTMLFormElement>, role: string) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    try {
      const r = await post<{ version: number }>("/admin/contracts", {
        role,
        title: d.get("title"),
        body: d.get("body"),
      });
      toast("نُشر الإصدار " + r.version + "؛ سيُطلب التوقيع من جديد");
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>, id?: string) {
    e.preventDefault();
    const form = e.currentTarget,
      d = new FormData(form);
    try {
      await api(
        "/admin/requirements/" + encodeURIComponent(id || String(d.get("id"))),
        {
          method: "PUT",
          body: JSON.stringify({
            role: d.get("role"),
            title: d.get("title"),
            description: d.get("description") || "",
            required: d.has("required"),
            needs_expiry: d.has("needs_expiry"),
            active: d.has("active"),
            position: Number(d.get("position") || 0),
          }),
        },
      );
      if (!id) form.reset();
      toast("حُفظ المتطلب");
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <>
      <h2>العقود</h2>
      <p className="notice">
        العقود مسودات تشغيلية تحتاج مراجعة قانونية. نشر إصدار جديد يطلب من كل
        الأسر أو السائقين التوقيع من جديد: لا تضيف الأسرة منتجات حتى توقّع، ولا
        يبدأ السائق دوامًا حتى يوقّع.
      </p>
      {contracts.map((c) => (
        <form
          key={c.role + c.versions.length}
          method="post"
          className="panel form-stack"
          onSubmit={(e) => publish(e, c.role)}
        >
          <h3>عقد {roleName(c.role)}</h3>
          <label>
            عنوان العقد
            <input
              name="title"
              required
              minLength={3}
              maxLength={150}
              defaultValue={c.title}
            />
          </label>
          <label>
            نص العقد
            <textarea
              name="body"
              required
              minLength={50}
              maxLength={50000}
              rows={14}
              defaultValue={c.body}
            />
          </label>
          <button className="button">نشر إصدار جديد</button>
          <ul>
            {c.versions.map((v) => (
              <li key={v.id}>
                الإصدار {v.version} — {date(v.published_at)} — وقّعه{" "}
                {v.acceptances}
              </li>
            ))}
          </ul>
        </form>
      ))}
      <h2>المستندات المطلوبة</h2>
      <div className="order-list">
        {requirements.map((r) => (
          <form
            key={r.id}
            method="post"
            className="panel form-stack"
            onSubmit={(e) => save(e, r.id)}
          >
            <h3>
              {r.title}{" "}
              <small>
                ({roleName(r.role)} · {r.id})
              </small>
            </h3>
            <input type="hidden" name="role" value={r.role} />
            <RequirementFields value={r} />
            <button className="text-button">حفظ</button>
          </form>
        ))}
      </div>
      <form
        method="post"
        className="panel form-stack"
        onSubmit={(e) => save(e)}
      >
        <h3>متطلب جديد</h3>
        <label>
          المعرف (أحرف إنجليزية صغيرة وأرقام وشرطة)
          <input name="id" required pattern="[a-z0-9-]{2,50}" dir="ltr" />
        </label>
        <label>
          الدور
          <select name="role" defaultValue="driver">
            <option value="driver">السائقون</option>
            <option value="seller">الأسر</option>
          </select>
        </label>
        <RequirementFields />
        <button className="button">إضافة المتطلب</button>
      </form>
    </>
  );
}
function RequirementFields({ value }: { value?: Requirement }) {
  return (
    <>
      <label>
        الاسم
        <input
          name="title"
          required
          minLength={2}
          maxLength={100}
          defaultValue={value?.title}
        />
      </label>
      <label>
        الوصف
        <input
          name="description"
          maxLength={500}
          defaultValue={value?.description}
        />
      </label>
      <label>
        الترتيب
        <input
          name="position"
          type="number"
          min="0"
          max="100"
          defaultValue={value?.position ?? 0}
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          name="required"
          defaultChecked={value?.required ?? true}
        />
        إلزامي
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          name="needs_expiry"
          defaultChecked={value?.needs_expiry ?? false}
        />
        له تاريخ انتهاء
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          name="active"
          defaultChecked={value?.active ?? true}
        />
        مفعّل
      </label>
    </>
  );
}
