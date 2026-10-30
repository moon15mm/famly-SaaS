export interface Product {
  id: string;
  household_id: string;
  household_name?: string;
  city?: string;
  category_id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  prep_hours: number;
  images: string[];
  status: string;
  featured: boolean;
  options?: { id: string; name: string; price_delta: number }[];
  household?: Household;
  reviews?: { rating: number; comment: string }[];
}
export interface Household {
  id: string;
  name: string;
  description: string;
  city: string;
  verified: boolean;
  free_delivery: boolean;
  delivery_enabled: boolean;
  on_vacation: boolean;
  opening_hour: number;
  closing_hour: number;
  pickup_address?: string;
  subscription_status?: string;
  telegram_linked?: boolean;
  slot_capacity?: number;
}
export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  address: string;
  driver_verified: boolean;
  available: boolean;
  email_verified: boolean;
}
export interface Category {
  id: string;
  name: string;
  icon: string;
}
export interface Order {
  id: string;
  household_name: string;
  status: string;
  payment_status: string;
  delivery_method: string;
  total: number;
  subtotal: number;
  delivery_fee: number;
  refunded: number;
  scheduled_at: string;
  address?: string;
  pickup_address?: string;
  driver_id?: string;
  latitude?: number | null;
  longitude?: number | null;
  items: {
    product_id: string;
    name: string;
    quantity: number;
    unit_price: number;
    option_id?: string;
    option_label?: string;
  }[];
}
export async function api<T = Record<string, unknown>>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const readOnly = ["GET", "HEAD"].includes(
    (options.method || "GET").toUpperCase(),
  );
  const attempts = readOnly ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response;
    let raw: string;
    try {
      response = await fetch("/api" + path, {
        ...options,
        credentials: "same-origin",
        headers: {
          ...(options.body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
          ...options.headers,
        },
      });
      raw = await response.text();
    } catch {
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 80));
        continue;
      }
      throw new Error("تعذر الاتصال بالخادم؛ حدّث الحالة قبل إعادة المحاولة");
    }
    if (response.status >= 500 && attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      continue;
    }
    if (response.status === 204) return undefined as T;
    let data: unknown;
    let parsed = false;
    try {
      data = JSON.parse(raw);
      parsed = true;
    } catch {
      /* A proxy may return plain text rather than JSON. */
    }
    if (!response.ok) {
      const detail =
        data && typeof data === "object" && "detail" in data
          ? data.detail
          : undefined;
      throw new Error(
        typeof detail === "string"
          ? detail
          : response.status >= 500
            ? "تعذر إكمال الطلب لدى الخادم؛ حدّث الحالة وحاول لاحقًا"
            : "تحقق من البيانات المدخلة وحاول مجددًا",
      );
    }
    if (!parsed) throw new Error("استجابة الخادم غير صالحة؛ أعد تحميل الصفحة");
    return data as T;
  }
  throw new Error("تعذر الاتصال بالخادم");
}
export const post = <T = Record<string, unknown>>(
  path: string,
  data?: unknown,
) =>
  api<T>(path, {
    method: "POST",
    body: data === undefined ? undefined : JSON.stringify(data),
  });
export const money = (value: number) =>
  new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 2 }).format(
    value / 100,
  );
export const date = (value: string) =>
  new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Riyadh",
    calendar: "gregory",
  }).format(
    new Date(
      value.endsWith("Z") || /[+]\d\d:\d\d$/.test(value) ? value : value + "Z",
    ),
  );
export const status: Record<string, string> = {
  pending_payment: "بانتظار الدفع",
  pending_acceptance: "بانتظار موافقة الأسرة",
  confirmed: "مؤكد",
  preparing: "قيد التجهيز",
  ready: "جاهز للاستلام",
  assigned: "تم إسناد السائق",
  picked_up: "استلم السائق الطلب",
  in_transit: "في الطريق",
  delivered: "تم التسليم",
  completed: "مكتمل",
  cancelled: "ملغي",
  unpaid: "غير مدفوع",
  paid: "مدفوع تجريبيًا",
  failed: "فشل الدفع",
  refund_pending: "بانتظار الاسترداد",
  refunded: "مسترد",
  partial_refund: "استرداد جزئي",
  expired: "انتهت مهلة الدفع",
};
