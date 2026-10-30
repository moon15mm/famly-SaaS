export default function Loading() {
  return (
    <div className="container section" aria-label="جارٍ التحميل">
      <div className="skeleton skeleton-title" />
      <div className="product-grid">
        {[1, 2, 3, 4].map((n) => (
          <div className="skeleton skeleton-card" key={n} />
        ))}
      </div>
    </div>
  );
}
