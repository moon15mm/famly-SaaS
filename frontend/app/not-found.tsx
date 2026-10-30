import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty page">
      <span className="overline">404</span>
      <h1>يبدو أننا سلكنا طريقًا آخر</h1>
      <p>الصفحة التي تبحث عنها غير موجودة.</p>
      <Link className="button" href="/">
        العودة إلى بيوتنا
      </Link>
    </div>
  );
}
