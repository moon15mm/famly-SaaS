"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty page">
      <h1>تعذّر إكمال الخطوة</h1>
      <p>حاول مرة أخرى بعد قليل. لن نعرض تفاصيل حسابك في رسالة الخطأ.</p>
      <button className="button" onClick={reset}>
        إعادة المحاولة
      </button>
    </div>
  );
}
