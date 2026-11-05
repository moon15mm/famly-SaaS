"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

let known: string | null = null;

/** "tap" when cards are charged for real, "test" for the local simulation, null while loading. */
export function usePaymentProvider() {
  const [provider, setProvider] = useState<string | null>(known);
  useEffect(() => {
    if (known) return;
    api<{ payments?: string }>("/health")
      .then((health) => {
        known = health.payments || "disabled";
        setProvider(known);
      })
      .catch(() => setProvider("disabled"));
  }, []);
  return provider;
}

const RESULTS: Record<
  string,
  { tone: string; order: string; subscription: string }
> = {
  paid: {
    tone: "#ecfdf5",
    order: "✅ تم الدفع بنجاح وتأكد طلبك.",
    subscription: "✅ تم الدفع وتفعيل الاشتراك.",
  },
  pending: {
    tone: "#fef9c3",
    order:
      "⏳ لم تؤكد بوابة الدفع العملية بعد. ستتحدث الحالة تلقائيًا خلال دقائق؛ لا تكرر الدفع.",
    subscription:
      "⏳ لم تؤكد بوابة الدفع العملية بعد. سيتفعل الاشتراك تلقائيًا خلال دقائق؛ لا تكرر الدفع.",
  },
  failed: {
    tone: "#fef2f2",
    order: "❌ لم تكتمل عملية الدفع ولم يُخصم المبلغ. يمكنك المحاولة مرة أخرى.",
    subscription:
      "❌ لم تكتمل عملية الدفع ولم يُخصم المبلغ. يمكنك المحاولة مرة أخرى.",
  },
  review: {
    tone: "#fff7ed",
    order:
      "⚠️ وصلتنا دفعتك لكن تعذر ربطها بالطلب (مثلًا أُلغي أو انتهت مهلته). أُبلغت الإدارة، وسيُسترد المبلغ كاملًا.",
    subscription:
      "⚠️ وصلتنا دفعتك لكن تعذر ربطها بالفاتورة. أُبلغت الإدارة، وسيُسترد المبلغ أو يُطبّق يدويًا.",
  },
  error: {
    tone: "#fef2f2",
    order:
      "تعذر التحقق من عملية الدفع. إن خُصم المبلغ فسيظهر تلقائيًا خلال دقائق، أو تواصل مع الدعم.",
    subscription:
      "تعذر التحقق من عملية الدفع. إن خُصم المبلغ فسيظهر تلقائيًا خلال دقائق، أو تواصل مع الدعم.",
  },
};

/** Shows what happened when Tap sent the payer back (the `payment` query parameter). */
export function PaymentResult({
  subject,
}: {
  subject: "order" | "subscription";
}) {
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    setResult(new URLSearchParams(window.location.search).get("payment"));
  }, []);
  const message = result ? RESULTS[result] : undefined;
  if (!message) return null;
  return (
    <p
      className="notice"
      role="status"
      style={{
        background: message.tone,
        padding: "14px",
        borderRadius: "8px",
        margin: "1rem 0",
      }}
    >
      {message[subject]}
    </p>
  );
}
