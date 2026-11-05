"use client";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { api, post, money, date } from "@/lib/api";
import { useStore } from "./provider";

type TapCharge = {
  id: string;
  kind: "order" | "invoice";
  target_id: string;
  amount: number;
  status: string;
  detail: string;
  refund_id: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS: Record<string, string> = {
  needs_refund: "مدفوعة ولم تُطبّق — تحتاج استردادًا",
  initiated: "بانتظار إتمام الدفع",
  applied: "مطبّقة",
  failed: "لم تكتمل",
  refunded: "مستردة",
  resolved: "عولجت يدويًا",
};

const OUTCOME: Record<string, string> = {
  paid: "طُبّقت الدفعة على ما دُفعت له",
  pending: "لم تكتمل الدفعة في Tap بعد",
  failed: "الدفعة لم تكتمل في Tap",
  review: "الدفعة مكتملة لكنها لا تنطبق؛ ظهرت في القائمة للاسترداد",
  ignored: "المعاملة لا تخص هذه المنصة",
};

/** Every Tap charge the platform opened; captured money that could not be applied waits here until refunded. */
export function TapChargesPanel() {
  const [rows, setRows] = useState<TapCharge[]>([]),
    [filter, setFilter] = useState("needs_refund"),
    [chargeId, setChargeId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const { toast } = useStore();
  function load() {
    api<TapCharge[]>(
      "/payments/admin/tap-charges" + (filter ? "?status=" + filter : ""),
    )
      .then(setRows)
      .catch((e) => setError(e.message));
  }
  useEffect(load, [filter]);
  async function run(task: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      await task();
      toast(done);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function check(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await post<{ outcome: string; tap_status: string }>(
        "/payments/admin/tap-charges/check",
        {
          charge_id: chargeId.trim(),
        },
      );
      toast(
        `${OUTCOME[result.outcome] || result.outcome} (Tap: ${result.tap_status})`,
      );
      setChargeId("");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel form-stack">
      <h2>معاملات Tap</h2>
      <p className="notice">
        كل دفعة تُفتح في Tap تُسجّل هنا. الدفعة المكتملة التي تعذر تطبيقها (طلب
        أُلغي، فاتورة مدفوعة مسبقًا، مبلغ مختلف) تبقى في «تحتاج استردادًا» حتى
        تُسترد أو تُعالج. الاسترداد هنا يعيد المال فعليًا إلى بطاقة الدافع.
      </p>
      <form className="form-stack" onSubmit={check}>
        <label>
          فحص معاملة برقمها (مثلًا دفعة اشتراك لم تتفعّل)
          <input
            dir="ltr"
            placeholder="chg_..."
            value={chargeId}
            onChange={(e) => setChargeId(e.target.value)}
            pattern="chg_[A-Za-z0-9_]{6,72}"
            required
          />
        </label>
        <button className="button" disabled={busy}>
          فحص وتطبيق من Tap
        </button>
      </form>
      <label>
        عرض
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          {Object.entries(STATUS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          <option value="">الكل</option>
        </select>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>المعاملة</th>
              <th>لـ</th>
              <th>المبلغ</th>
              <th>الحالة</th>
              <th>التفاصيل</th>
              <th>إجراء</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td dir="ltr">
                  {row.id}
                  <br />
                  <small>{date(row.created_at)}</small>
                </td>
                <td>
                  {row.kind === "order" ? (
                    <Link href={"/orders/" + row.target_id}>
                      طلب #{row.target_id.slice(0, 8)}
                    </Link>
                  ) : (
                    <Link href={"/invoices/" + row.target_id}>
                      فاتورة #{row.target_id.slice(0, 8)}
                    </Link>
                  )}
                </td>
                <td>{money(row.amount)} ر.س</td>
                <td>{STATUS[row.status] || row.status}</td>
                <td>{row.detail}</td>
                <td>
                  {row.status === "needs_refund" && (
                    <>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              `سيُعاد ${money(row.amount)} ر.س إلى بطاقة الدافع عبر Tap. متابعة؟`,
                            )
                          )
                            run(
                              () =>
                                post(
                                  "/payments/admin/tap-charges/" +
                                    row.id +
                                    "/refund",
                                ),
                              "تم إرسال الاسترداد إلى Tap",
                            );
                        }}
                      >
                        استرداد عبر Tap
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          const note = prompt(
                            "كيف عولجت الدفعة؟ (مثلًا: استُردت من لوحة Tap)",
                          );
                          if (note && note.trim().length >= 5)
                            run(
                              () =>
                                post(
                                  "/payments/admin/tap-charges/" +
                                    row.id +
                                    "/resolve",
                                  { note: note.trim() },
                                ),
                              "سُجلت المعالجة",
                            );
                        }}
                      >
                        عولجت خارج المنصة
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6}>لا توجد معاملات في هذا العرض.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
