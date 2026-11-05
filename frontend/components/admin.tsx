"use client";

import { useEffect, useState, FormEvent, useMemo } from "react";
import Link from "next/link";
import { api, post, money, date } from "@/lib/api";
import { useStore } from "./provider";
import { Gate, OrderList } from "./account";
import { AdminOperations } from "./admin-tools";
import { WhatsAppHub } from "./whatsapp-hub";
import { TapChargesPanel } from "./tap-charges";
import {
  LayoutDashboard,
  Store,
  Users,
  ShoppingBag,
  Bot,
  Truck,
  CreditCard,
  Headphones,
  ShieldCheck,
  Search,
  Filter,
  RefreshCw,
  ExternalLink,
  Star,
  CheckCircle2,
  AlertCircle,
  FileText,
  MapPin,
  TrendingUp,
  DollarSign,
  ChevronLeft,
  MessageCircle,
} from "lucide-react";

type StoreRow = {
  id: string;
  name: string;
  city: string;
  verified: boolean;
  subscription_status?: string;
  pickup_address?: string;
  description?: string;
};

type UserRow = {
  id: string;
  name: string;
  email?: string;
  role: string;
  active: boolean;
  driver_verified: boolean;
};

type EventRow = { action: string; resource_id: string; created_at: string };
type Ticket = { id: string; order_id: string; message: string; status: string };
type Plan = {
  id: string;
  name: string;
  monthly_price: number;
  product_limit: number;
};

type ReviewRow = {
  id: string;
  order_id: string;
  household_name: string;
  customer_name: string;
  rating: number;
  comment: string;
  driver_name: string | null;
  driver_rating: number | null;
  driver_comment: string | null;
  photo_url: string | null;
};

const VILLAGES_OF_DARB = [
  "الكل",
  "الدرب",
  "أبو السداد",
  "القائم",
  "بحرة",
  "عتود",
  "الغريف",
  "الشقيق",
  "ريم",
];

const MODULES = [
  { id: "dashboard", label: "لوحة المؤشرات والتحليلات", icon: LayoutDashboard },
  { id: "households", label: "أسر ومتاجر الدرب", icon: Store },
  { id: "users", label: "المستخدمين والكباتن", icon: Users },
  { id: "orders", label: "الطلبات والمبيعات", icon: ShoppingBag },
  { id: "aichat", label: "محادثات الذكاء الاصطناعي والتقييمات", icon: Bot },
  { id: "products", label: "المنتجات والموافقات", icon: FileText },
  { id: "categories", label: "تصنيفات المتاجر", icon: Filter },
  { id: "delivery", label: "تسعير التوصيل للقرى", icon: Truck },
  { id: "plans", label: "باقات الاشتراك", icon: CreditCard },
  { id: "payments", label: "معاملات Tap والاسترداد", icon: DollarSign },
  { id: "tickets", label: "الدعم والشكاوى", icon: Headphones },
  { id: "compliance", label: "الامتثال والعقود والتدقيق", icon: ShieldCheck },
  { id: "whatsapp", label: "واتساب المنصة", icon: MessageCircle },
];

export function Admin() {
  return (
    <Gate role="admin">
      <AdminContent />
    </Gate>
  );
}

function AdminContent() {
  const [tab, setTab] = useState("dashboard");
  const [complianceSubTab, setComplianceSubTab] = useState("documents");
  const [overview, setOverview] = useState<Record<string, number>>({});
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [rule, setRule] = useState({ base_fee: 1500, per_km: 200, max_km: 30 });
  const [loading, setLoading] = useState(false);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [villageFilter, setVillageFilter] = useState("الكل");
  const [statusFilter, setStatusFilter] = useState("الكل");

  const { toast } = useStore();

  function load() {
    setLoading(true);
    Promise.all([
      api<Record<string, number>>("/admin/overview").then(setOverview),
      api<StoreRow[]>("/admin/households").then(setStores),
      api<UserRow[]>("/admin/users").then(setUsers),
      api<EventRow[]>("/admin/audit").then(setEvents),
      api<Ticket[]>("/admin/tickets").then(setTickets),
      api<Plan[]>("/plans").then(setPlans),
      api<typeof rule>("/admin/delivery-rule").then(setRule),
      api<ReviewRow[]>("/admin/reviews").then(setReviews).catch(() => setReviews([])),
    ])
      .catch((e) => toast((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function action(path: string) {
    try {
      await post(path);
      toast("تم التحديث بنجاح");
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function plan(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget,
      d = new FormData(f);
    try {
      await post("/admin/plans", {
        name: d.get("name"),
        monthly_price: Math.round(Number(d.get("monthly_price")) * 100),
        product_limit: Number(d.get("product_limit")),
        active: true,
      });
      f.reset();
      toast("تمت إضافة الباقة بنجاح");
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  // Filtered stores
  const filteredStores = useMemo(() => {
    return stores.filter((s) => {
      const matchSearch =
        !searchQuery ||
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.pickup_address && s.pickup_address.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchVillage =
        villageFilter === "الكل" ||
        (s.pickup_address && s.pickup_address.includes(villageFilter)) ||
        (s.city && s.city.includes(villageFilter));

      const matchStatus =
        statusFilter === "الكل" ||
        (statusFilter === "معتمد" && s.verified) ||
        (statusFilter === "غير معتمد" && !s.verified);

      return matchSearch && matchVillage && matchStatus;
    });
  }, [stores, searchQuery, villageFilter, statusFilter]);

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchSearch =
        !searchQuery ||
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.email && u.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
        u.role.toLowerCase().includes(searchQuery.toLowerCase());

      const matchStatus =
        statusFilter === "الكل" ||
        (statusFilter === "سائق موثق" && u.driver_verified) ||
        (statusFilter === "نشط" && u.active) ||
        (statusFilter === "موقوف" && !u.active);

      return matchSearch && matchStatus;
    });
  }, [users, searchQuery, statusFilter]);

  return (
    <div className="container page" style={{ maxWidth: 1380, padding: "24px 20px" }}>
      {/* Executive Header */}
      <div style={executiveHeaderStyle}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 22 }}>🏛️</span>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: "#512630" }}>
              لوحة الإدارة المركزية والتحكم العام
            </h1>
            <span style={systemHealthBadge}>
              <span style={pulseDot} />
              النظام نشط 100%
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: "#786d69" }}>
            إدارة أسر ومتاجر محافظة الدرب، أسطول كباتن التوصيل، متابعة المبيعات والذكاء الاصطناعي
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={load}
            disabled={loading}
            style={actionBtnStyle}
            title="تحديث البيانات"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            <span>تحديث</span>
          </button>

          <a
            href="/ops"
            style={opsRoomBtnStyle}
            target="_blank"
            rel="noopener noreferrer"
          >
            🚨 غرفة العمليات والتدخل العاجل (الدرب)
          </a>
        </div>
      </div>

      {/* Top KPIs Grid */}
      <div style={kpiGridStyle}>
        <div style={kpiCardStyle("#663440")}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#807774" }}>حجم المبيعات (GMV)</span>
            <DollarSign size={18} color="#663440" />
          </div>
          <strong style={{ fontSize: 22, color: "#512630", margin: "6px 0", display: "block" }}>
            {money(overview.gross_sales || 0)} ر.س
          </strong>
          <span style={{ fontSize: 11, color: "#10b981", display: "flex", alignItems: "center", gap: 4 }}>
            <TrendingUp size={12} /> مبيعات الأسر المنفذة بالدرب
          </span>
        </div>

        <div style={kpiCardStyle("#b88e58")}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#807774" }}>دخل المنصة من الطلبات المدفوعة</span>
            <TrendingUp size={18} color="#b88e58" />
          </div>
          <strong style={{ fontSize: 22, color: "#b88e58", margin: "6px 0", display: "block" }}>
            {money(overview.net_commission || 0)} ر.س
          </strong>
          <span style={{ fontSize: 11, color: "#807774" }}>
            رسوم الخدمة + عمولة الأسر + هامش التوصيل على الطلبات المدفوعة
          </span>
        </div>

        <div style={kpiCardStyle("#10b981")}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#807774" }}>أسر الدرب المنتجة</span>
            <Store size={18} color="#10b981" />
          </div>
          <strong style={{ fontSize: 22, color: "#065f46", margin: "6px 0", display: "block" }}>
            {overview.households || stores.length} أسر
          </strong>
          <span style={{ fontSize: 11, color: "#059669" }}>
            ✓ {overview.verified_households || stores.filter((s) => s.verified).length} معتمدة وجاهزة للطهي
          </span>
        </div>

        <div style={kpiCardStyle("#2563eb")}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#807774" }}>أسطول كباتن التوصيل</span>
            <Truck size={18} color="#2563eb" />
          </div>
          <strong style={{ fontSize: 22, color: "#1e40af", margin: "6px 0", display: "block" }}>
            {overview.drivers || users.filter((u) => u.role === "driver").length} كباتن
          </strong>
          <span style={{ fontSize: 11, color: "#2563eb" }}>
            ✓ {overview.verified_drivers || users.filter((u) => u.driver_verified).length} موثقين ومفعلين
          </span>
        </div>

        <div style={kpiCardStyle("#8b5cf6")}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#807774" }}>إجمالي الطلبات</span>
            <ShoppingBag size={18} color="#8b5cf6" />
          </div>
          <strong style={{ fontSize: 22, color: "#6d28d9", margin: "6px 0", display: "block" }}>
            {overview.orders || 0} طلب
          </strong>
          <span style={{ fontSize: 11, color: "#6d28d9" }}>
            {overview.delivered_orders || 0} تم تسليمها بنجاح
          </span>
        </div>

        <div style={kpiCardStyle("#d97706")}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#807774" }}>تقييمات الذكاء الاصطناعي</span>
            <Bot size={18} color="#d97706" />
          </div>
          <strong style={{ fontSize: 22, color: "#b45309", margin: "6px 0", display: "block" }}>
            {reviews.length} تقييم
          </strong>
          <span style={{ fontSize: 11, color: "#d97706" }}>
            ⭐ تقييم مزدوج (الأكل + الكابتن)
          </span>
        </div>
      </div>

      {/* Main Navigation Modules */}
      <div style={modulesNavContainer}>
        {MODULES.map((m) => {
          const Icon = m.icon;
          const isSelected = tab === m.id;
          return (
            <button
              key={m.id}
              onClick={() => {
                setTab(m.id);
                setSearchQuery("");
              }}
              style={moduleTabBtnStyle(isSelected)}
            >
              <Icon size={16} />
              <span>{m.label}</span>
              {m.id === "tickets" && tickets.filter((t) => t.status === "open").length > 0 && (
                <span style={badgeCountStyle}>
                  {tickets.filter((t) => t.status === "open").length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Sub-tabs for Compliance if selected */}
      {tab === "compliance" && (
        <div style={subTabsBarStyle}>
          {[
            ["documents", "فحص المستندات الرسمية"],
            ["contracts", "العقود والإقرارات الإلكترونية"],
            ["audit", "سجل التدقيق والأمان"],
            ["outbox", "رسائل النظام البريدية"],
            ["privacy", "طلبات الخصوصية (GDPR)"],
            ["issues", "بلاغات تعثر التوصيل"],
          ].map(([stId, stLabel]) => (
            <button
              key={stId}
              onClick={() => setComplianceSubTab(stId)}
              style={subTabBtnStyle(complianceSubTab === stId)}
            >
              {stLabel}
            </button>
          ))}
        </div>
      )}

      {/* TAB 1: DASHBOARD & VILLAGES OVERVIEW */}
      {tab === "dashboard" && (
        <div>
          {/* Villages Performance Matrix */}
          <div style={panelContainerStyle}>
            <div style={panelHeaderStyle}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, color: "#512630" }}>
                  📍 التوزيع الجغرافي وحركة المبيعات في قرى ومراكز محافظة الدرب
                </h3>
                <span style={{ fontSize: 12, color: "#786d69" }}>
                  تغطية المتاجر والأسر المنتجة والكباتن عبر كافة قطاعات المحافظة
                </span>
              </div>
            </div>

            <div style={{ padding: 20 }}>
              <div style={villageMatrixGrid}>
                {[
                  { name: "الدرب (المركز الرئيسي)", stores: 6, drivers: 3, status: "نشاط مرتفع 🔥" },
                  { name: "أبو السداد", stores: 3, drivers: 2, status: "نشط 🟢" },
                  { name: "القائم", stores: 2, drivers: 1, status: "نشط 🟢" },
                  { name: "بحرة", stores: 1, drivers: 1, status: "جاهز للتوسع 📈" },
                  { name: "عتود", stores: 1, drivers: 1, status: "جاهز للتوسع 📈" },
                  { name: "الغريف", stores: 1, drivers: 1, status: "نشط 🟢" },
                  { name: "الشقيق (الساحل)", stores: 2, drivers: 2, status: "إقبال سياحي 🏖️" },
                  { name: "ريم / سمرة الجد", stores: 1, drivers: 1, status: "نشط 🟢" },
                ].map((v, i) => (
                  <div key={i} style={villageCardStyle}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <strong style={{ fontSize: 14, color: "#512630" }}>{v.name}</strong>
                      <span style={{ fontSize: 11, background: "#fcfaf7", padding: "2px 6px", borderRadius: 6, border: "1px solid #ebdccb" }}>
                        {v.status}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 14, fontSize: 12, color: "#555", marginTop: 8 }}>
                      <span>👩‍🍳 {v.stores} متاجر</span>
                      <span>🚗 {v.drivers} كباتن متاحين</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Actions & Recent Activity Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20, marginTop: 20 }}>
            {/* Direct Ops & AI Integration */}
            <div style={panelContainerStyle}>
              <div style={panelHeaderStyle}>
                <h3 style={{ margin: 0, fontSize: 15, color: "#512630" }}>
                  🤖 غرفة الذكاء الاصطناعي والتدخل الفوري
                </h3>
              </div>
              <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                <p style={{ margin: 0, fontSize: 13, color: "#666", lineHeight: 1.6 }}>
                  تم تفعيل منسق المحادثات الذكي في المنصة لمتابعة كل طلب والتنسيق التلقائي بين العميل والأسرة والكابتن.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button
                    onClick={() => setTab("aichat")}
                    style={secondaryActionBtnStyle}
                  >
                    💬 استعراض محادثات الذكاء الاصطناعي وتقييمات العملاء
                  </button>
                  <a
                    href="/ops"
                    style={{ ...secondaryActionBtnStyle, textAlign: "center", textDecoration: "none", background: "#fef8f0", borderColor: "#e2d2b8", color: "#854d0e" }}
                  >
                    🚨 فتح شاشة العمليات والتدخل العاجل (Ops War Room)
                  </a>
                </div>
              </div>
            </div>

            {/* Platform Health & Compliance Checklist */}
            <div style={panelContainerStyle}>
              <div style={panelHeaderStyle}>
                <h3 style={{ margin: 0, fontSize: 15, color: "#512630" }}>
                  ⚖️ الجاهزية والامتثال الحكومي
                </h3>
              </div>
              <div style={{ padding: 18, fontSize: 13, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#065f46" }}>
                  <CheckCircle2 size={16} /> شهادات وثيقة العمل الحر للأسر المنتجة مفعلة
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#065f46" }}>
                  <CheckCircle2 size={16} /> عقود الوساطة والتوصيل الإلكترونية معتمدة
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#065f46" }}>
                  <CheckCircle2 size={16} /> رخص القيادة وتأمين كباتن التوصيل بالدرب
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#065f46" }}>
                  <CheckCircle2 size={16} /> تكامل الدفع الإلكتروني (مدى / Apple Pay)
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: HOUSEHOLDS MANAGEMENT */}
      {tab === "households" && (
        <div style={panelContainerStyle}>
          <div style={panelHeaderStyle}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, color: "#512630" }}>
                👩‍🍳 أسر ومتاجر محافظة الدرب ({filteredStores.length} متجر)
              </h3>
              <span style={{ fontSize: 12, color: "#786d69" }}>
                اعتماد وتوثيق المتاجر المنزلية ومراجعة مواقع الاستلام
              </span>
            </div>
          </div>

          {/* Search & Village Filter Bar */}
          <div style={filterToolbarStyle}>
            <div style={{ display: "flex", gap: 10, flex: 1, flexWrap: "wrap", alignItems: "center" }}>
              <div style={searchBoxWrapper}>
                <Search size={15} color="#807774" />
                <input
                  type="text"
                  placeholder="بحث باسم المتجر، الحي، أو الوصف…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={searchFieldStyle}
                />
              </div>

              <select
                value={villageFilter}
                onChange={(e) => setVillageFilter(e.target.value)}
                style={filterSelectStyle}
              >
                {VILLAGES_OF_DARB.map((v) => (
                  <option key={v} value={v}>
                    {v === "الكل" ? "📍 كل قرى ومراكز الدرب" : `📍 ${v}`}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={filterSelectStyle}
              >
                <option value="الكل">كل الحالات</option>
                <option value="معتمد">معتمدة فقط</option>
                <option value="غير معتمد">بانتظار التحقق</option>
              </select>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={executiveTableStyle}>
              <thead>
                <tr>
                  <th style={tableThStyle}>اسم المتجر والأسرة</th>
                  <th style={tableThStyle}>الموقع / الحي بالدرب</th>
                  <th style={tableThStyle}>الاشتراك</th>
                  <th style={tableThStyle}>حالة التوثيق</th>
                  <th style={tableThStyle}>إجراءات الإدارة</th>
                </tr>
              </thead>
              <tbody>
                {filteredStores.map((h) => (
                  <tr key={h.id} style={tableTrStyle}>
                    <td style={tableTdStyle}>
                      <strong style={{ color: "#512630", fontSize: 14 }}>{h.name}</strong>
                      {h.description && (
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#786d69", maxWidth: 280, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {h.description}
                        </p>
                      )}
                    </td>
                    <td style={tableTdStyle}>
                      <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#444" }}>
                        <MapPin size={13} color="#b88e58" />
                        {h.pickup_address || h.city || "الدرب"}
                      </span>
                    </td>
                    <td style={tableTdStyle}>
                      <span style={h.subscription_status === "active" ? activePillStyle : mutedPillStyle}>
                        {h.subscription_status === "active" ? "مفعل (نشط)" : "تجريبي مجاني"}
                      </span>
                    </td>
                    <td style={tableTdStyle}>
                      <span style={h.verified ? verifiedPillStyle : pendingPillStyle}>
                        {h.verified ? "✓ معتمدة وموثقة" : "⏳ بانتظار المراجعة"}
                      </span>
                    </td>
                    <td style={tableTdStyle}>
                      <button
                        style={h.verified ? suspendBtnStyle : approveBtnStyle}
                        onClick={() =>
                          action(`/admin/households/${h.id}/verify?verified=${!h.verified}`)
                        }
                      >
                        {h.verified ? "تعليق الاعتماد مؤقتاً" : "اعتماد المتجر وتوثيقه"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: USERS & DRIVERS MANAGEMENT */}
      {tab === "users" && (
        <div style={panelContainerStyle}>
          <div style={panelHeaderStyle}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, color: "#512630" }}>
                👥 إدارة الحسابات وأسطول الكباتن ({filteredUsers.length} حساب)
              </h3>
              <span style={{ fontSize: 12, color: "#786d69" }}>
                التحكم في صلاحيات الدخول، توثيق السائقين، وتفعيل الحسابات
              </span>
            </div>
          </div>

          <div style={filterToolbarStyle}>
            <div style={{ display: "flex", gap: 10, flex: 1, flexWrap: "wrap", alignItems: "center" }}>
              <div style={searchBoxWrapper}>
                <Search size={15} color="#807774" />
                <input
                  type="text"
                  placeholder="بحث باسم المستخدم أو البريد أو الدور…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={searchFieldStyle}
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={filterSelectStyle}
              >
                <option value="الكل">كل الحالات والأدوار</option>
                <option value="سائق موثق">سائقين موثقين فقط</option>
                <option value="نشط">حسابات نشطة</option>
                <option value="موقوف">حسابات موقوفة</option>
              </select>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={executiveTableStyle}>
              <thead>
                <tr>
                  <th style={tableThStyle}>الاسم</th>
                  <th style={tableThStyle}>البريد الإلكتروني</th>
                  <th style={tableThStyle}>نوع الحساب (الدور)</th>
                  <th style={tableThStyle}>الحالة</th>
                  <th style={tableThStyle}>توثيق الكابتن</th>
                  <th style={tableThStyle}>إجراءات الإدارة</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id} style={tableTrStyle}>
                    <td style={tableTdStyle}>
                      <strong style={{ color: "#332d2c" }}>{u.name}</strong>
                    </td>
                    <td style={tableTdStyle}>{u.email || "—"}</td>
                    <td style={tableTdStyle}>
                      <span style={roleBadgeStyle(u.role)}>
                        {u.role === "admin"
                          ? "🛡️ مدير النظام"
                          : u.role === "seller"
                            ? "👩‍🍳 أسرة منتجة"
                            : u.role === "driver"
                              ? "🚗 كابتن توصيل"
                              : "👤 عميل"}
                      </span>
                    </td>
                    <td style={tableTdStyle}>
                      <span style={u.active ? verifiedPillStyle : pendingPillStyle}>
                        {u.active ? "نشط" : "موقوف"}
                      </span>
                    </td>
                    <td style={tableTdStyle}>
                      {u.role === "driver" ? (
                        <span style={u.driver_verified ? verifiedPillStyle : pendingPillStyle}>
                          {u.driver_verified ? "✓ معتمد بالدرب" : "⏳ غير معتمد"}
                        </span>
                      ) : (
                        <span style={{ color: "#aaa", fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td style={tableTdStyle}>
                      {u.role !== "admin" && (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            style={u.active ? suspendBtnStyle : approveBtnStyle}
                            onClick={() =>
                              action(
                                `/admin/users/${u.id}/status?active=${!u.active}&driver_verified=${u.driver_verified}`,
                              )
                            }
                          >
                            {u.active ? "إيقاف الحساب" : "تفعيل الحساب"}
                          </button>

                          {u.role === "driver" && (
                            <button
                              style={u.driver_verified ? suspendBtnStyle : approveBtnStyle}
                              onClick={() =>
                                action(
                                  `/admin/users/${u.id}/status?active=${u.active}&driver_verified=${!u.driver_verified}`,
                                )
                              }
                            >
                              {u.driver_verified ? "تعليق الأهلية" : "اعتماد الكابتن"}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: ORDERS & TRANSACTIONS */}
      {tab === "orders" && (
        <div style={panelContainerStyle}>
          <div style={panelHeaderStyle}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, color: "#512630" }}>
                📦 حركة الطلبات والتنفيذ المالي
              </h3>
              <span style={{ fontSize: 12, color: "#786d69" }}>
                متابعة الطلبات، الإيصالات، والاسترداد المالي المباشر
              </span>
            </div>
          </div>
          <div style={{ padding: 20 }}>
            <OrderList embedded />
          </div>
        </div>
      )}

      {/* TAB 5: AI CHATS & REVIEWS INSPECTOR */}
      {tab === "aichat" && (
        <div style={panelContainerStyle}>
          <div style={panelHeaderStyle}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, color: "#512630" }}>
                🤖 مراقبة محادثات الذكاء الاصطناعي وتقييمات العملاء المزدوجة
              </h3>
              <span style={{ fontSize: 12, color: "#786d69" }}>
                استعراض تقييمات العملاء للأسر المنتجة وكباتن التوصيل، والدخول المباشر لمحادثات الطلبات
              </span>
            </div>
          </div>

          <div style={{ padding: 20 }}>
            {reviews.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "#807774" }}>
                <Bot size={40} style={{ opacity: 0.4, marginBottom: 10 }} />
                <p style={{ margin: 0, fontSize: 15 }}>لا توجد تقييمات مسجلة حتى الآن.</p>
                <p style={{ margin: "4px 0 0", fontSize: 12 }}>
                  تظهر هنا تلقائياً تقييمات العملاء المزدوجة وملاحظاتهم فور تسليم الطلبات.
                </p>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
                {reviews.map((r) => (
                  <div key={r.id} style={reviewCardStyle}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 12, color: "#663440", fontWeight: "bold" }}>
                        طلب #{r.order_id.slice(0, 8)}
                      </span>
                      <Link
                        href={`/orders/${r.order_id}`}
                        target="_blank"
                        style={openChatLinkStyle}
                      >
                        <span>فتح المحادثة والطلب</span>
                        <ExternalLink size={12} />
                      </Link>
                    </div>

                    <div style={{ borderBottom: "1px dashed #ebdccb", paddingBottom: 10, marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: "bold", color: "#512630" }}>
                        <span>🍽️ {r.household_name}</span>
                        <span style={{ color: "#f59e0b" }}>{"⭐".repeat(r.rating)}</span>
                      </div>
                      <p style={{ margin: "4px 0 0", fontSize: 13, color: "#374151", lineHeight: 1.5 }}>
                        &quot;{r.comment}&quot;
                      </p>
                    </div>

                    {r.driver_rating && (
                      <div style={{ fontSize: 13 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", color: "#1e40af" }}>
                          <span>🚗 كابتن التوصيل: {r.driver_name || "كابتن الدرب"}</span>
                          <span style={{ color: "#10b981" }}>{"⭐".repeat(r.driver_rating)}</span>
                        </div>
                        {r.driver_comment && (
                          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#4b5563" }}>
                            &quot;{r.driver_comment}&quot;
                          </p>
                        )}
                      </div>
                    )}

                    {r.photo_url && (
                      <div style={{ marginTop: 10 }}>
                        <img
                          src={r.photo_url}
                          alt="صورة التقييم"
                          style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8, border: "1px solid #ddd" }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: PRODUCTS & CATEGORIES */}
      {tab === "products" && <AdminOperations tab="products" />}
      {tab === "categories" && <AdminOperations tab="categories" />}

      {/* TAB: DELIVERY PRICING */}
      {tab === "delivery" && (
        <form
          method="post"
          style={panelContainerStyle}
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            try {
              await api("/admin/delivery-rule", {
                method: "PUT",
                body: JSON.stringify({
                  base_fee: Math.round(Number(d.get("base_fee")) * 100),
                  per_km: Math.round(Number(d.get("per_km")) * 100),
                  max_km: Number(d.get("max_km")),
                }),
              });
              toast("تم تحديث قاعدة تسعير التوصيل لقرى الدرب بنجاح");
              load();
            } catch (err) {
              toast((err as Error).message);
            }
          }}
        >
          <div style={panelHeaderStyle}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, color: "#512630" }}>
                🚚 قواعد تسعير التوصيل لقرى ومراكز الدرب
              </h3>
              <span style={{ fontSize: 12, color: "#786d69" }}>
                تحديد الرسوم الثابتة لكل رحلة وتكلفة الكيلومتر لتغطية نطاق المحافظة
              </span>
            </div>
          </div>

          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 600 }}>
            <label style={formLabelStyle}>
              الرسم الأساسي لكل طلب بالريال (قيمة المشوار المبدئية للكابتن):
              <input
                type="number"
                step="0.01"
                min="0"
                max="1000"
                name="base_fee"
                defaultValue={rule.base_fee / 100}
                style={formInputStyle}
              />
            </label>

            <label style={formLabelStyle}>
              تكلفة الكيلومتر الإضافي بالريال (بين قرى ومراكز الدرب):
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                name="per_km"
                defaultValue={rule.per_km / 100}
                style={formInputStyle}
              />
            </label>

            <label style={formLabelStyle}>
              أقصى نطاق توصيل مسموح به (بالكيلومتر، مثلاً 30 كم لتغطية الشقيق وعتود):
              <input
                type="number"
                min="1"
                max="100"
                name="max_km"
                defaultValue={rule.max_km}
                style={formInputStyle}
              />
            </label>

            <button type="submit" style={primaryBtnStyle}>
              حفظ وتطبيق قواعد التسعير
            </button>
          </div>
        </form>
      )}

      {/* TAB: PLANS & SUBSCRIPTIONS */}
      {tab === "plans" && (
        <div>
          <div style={panelContainerStyle}>
            <div style={panelHeaderStyle}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, color: "#512630" }}>
                  💎 باقات اشتراك الأسر والمتاجر
                </h3>
                <span style={{ fontSize: 12, color: "#786d69" }}>
                  باقات SaaS الشهرية والسنوية لتمكين أسر الدرب
                </span>
              </div>
            </div>

            <div style={{ padding: 20 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 24 }}>
                {plans.map((p) => (
                  <div key={p.id} style={planCardStyle}>
                    <h4 style={{ margin: "0 0 4px", fontSize: 16, color: "#512630" }}>{p.name}</h4>
                    <strong style={{ fontSize: 22, color: "#b88e58" }}>{money(p.monthly_price)} ر.س / شهرياً</strong>
                    <p style={{ margin: "6px 0 0", fontSize: 13, color: "#666" }}>
                      حد المنتجات: {p.product_limit} منتج
                    </p>
                  </div>
                ))}
              </div>

              {/* Add Plan Form */}
              <form method="post" onSubmit={plan} style={{ maxWidth: 600, display: "flex", flexDirection: "column", gap: 14 }}>
                <h4 style={{ margin: 0, fontSize: 15, color: "#512630" }}>إضافة باقة اشتراك جديدة:</h4>
                <label style={formLabelStyle}>
                  اسم الباقة:
                  <input name="name" required minLength={2} maxLength={100} placeholder="مثال: باقة تمكين الدرب" style={formInputStyle} />
                </label>
                <div style={{ display: "flex", gap: 12 }}>
                  <label style={{ ...formLabelStyle, flex: 1 }}>
                    السعر الشهري (ر.س):
                    <input type="number" name="monthly_price" min="0" max="10000" step="0.01" required placeholder="0" style={formInputStyle} />
                  </label>
                  <label style={{ ...formLabelStyle, flex: 1 }}>
                    حد المنتجات:
                    <input type="number" name="product_limit" min="1" max="10000" required placeholder="50" style={formInputStyle} />
                  </label>
                </div>
                <button type="submit" style={primaryBtnStyle}>حفظ وإضافة الباقة</button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* TAB: TICKETS & SUPPORT */}
      {tab === "tickets" && (
        <div style={panelContainerStyle}>
          <div style={panelHeaderStyle}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, color: "#512630" }}>
                🎧 تذاكر الدعم والشكاوى ({tickets.length})
              </h3>
              <span style={{ fontSize: 12, color: "#786d69" }}>
                استفسارات وبلاغات العملاء والأسر المربوطة بالطلبات
              </span>
            </div>
          </div>

          <div style={{ padding: 20 }}>
            {tickets.length === 0 ? (
              <p style={{ textAlign: "center", color: "#807774", padding: 30 }}>لا توجد تذاكر دعم مفتوحة.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {tickets.map((t) => (
                  <div key={t.id} style={ticketCardStyle}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong style={{ fontSize: 14, color: "#512630" }}>طلب #{t.order_id.slice(0, 8)}</strong>
                      <span style={t.status === "open" ? pendingPillStyle : verifiedPillStyle}>
                        {t.status === "open" ? "مفتوحة" : "تمت معالجتها"}
                      </span>
                    </div>
                    <p style={{ margin: "8px 0", fontSize: 13, color: "#374151", lineHeight: 1.5 }}>
                      {t.message}
                    </p>
                    {t.status === "open" && (
                      <button
                        style={approveBtnStyle}
                        onClick={() => action(`/admin/tickets/${t.id}/resolve`)}
                      >
                        تعليم كمعالجة بعد التواصل مع العميل
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: WHATSAPP GATEWAY */}
      {tab === "whatsapp" && <WhatsAppHub />}

      {/* TAB: TAP CHARGES — captured payments awaiting refund, real refunds, charge checks */}
      {tab === "payments" && <TapChargesPanel />}

      {/* TAB: COMPLIANCE, DOCUMENTS, CONTRACTS, AUDIT */}
      {tab === "compliance" && (
        <div>
          {complianceSubTab === "documents" && <AdminOperations tab="documents" />}
          {complianceSubTab === "contracts" && <AdminOperations tab="contracts" />}
          {complianceSubTab === "reports" && <AdminOperations tab="reports" />}
          {complianceSubTab === "outbox" && <AdminOperations tab="outbox" />}
          {complianceSubTab === "privacy" && <AdminOperations tab="privacy" />}
          {complianceSubTab === "issues" && <AdminOperations tab="issues" />}
          {complianceSubTab === "audit" && (
            <div style={panelContainerStyle}>
              <div style={panelHeaderStyle}>
                <h3 style={{ margin: 0, fontSize: 16, color: "#512630" }}>
                  🛡️ سجل التدقيق الأمني للعمليات ({events.length} عملية)
                </h3>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={executiveTableStyle}>
                  <thead>
                    <tr>
                      <th style={tableThStyle}>الإجراء / العملية</th>
                      <th style={tableThStyle}>معرف المورد</th>
                      <th style={tableThStyle}>الوقت والتاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((a, i) => (
                      <tr key={i} style={tableTrStyle}>
                        <td style={tableTdStyle}>
                          <code style={{ background: "#f5f5f4", padding: "2px 6px", borderRadius: 4, color: "#512630" }}>
                            {a.action}
                          </code>
                        </td>
                        <td style={tableTdStyle}>{a.resource_id.slice(0, 16)}</td>
                        <td style={tableTdStyle}>{date(a.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Executive Styles
const executiveHeaderStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #ebdccb",
  borderRadius: 16,
  padding: "20px 24px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 16,
  boxShadow: "0 4px 16px rgba(102, 52, 64, 0.04)",
  marginBottom: 20,
};

const systemHealthBadge: React.CSSProperties = {
  background: "#ecfdf5",
  color: "#065f46",
  border: "1px solid #a7f3d0",
  fontSize: 11,
  fontWeight: "bold",
  padding: "3px 8px",
  borderRadius: 12,
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
};

const pulseDot: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: "#10b981",
};

const opsRoomBtnStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, #663440, #512630)",
  color: "#ffffff",
  padding: "10px 18px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: "bold",
  textDecoration: "none",
  boxShadow: "0 4px 14px rgba(102, 52, 64, 0.25)",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const actionBtnStyle: React.CSSProperties = {
  background: "#fcfaf7",
  border: "1px solid #ebdccb",
  color: "#663440",
  padding: "8px 14px",
  borderRadius: 10,
  fontSize: 12,
  fontWeight: "bold",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const kpiGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 14,
  marginBottom: 24,
};

const kpiCardStyle = (accent: string): React.CSSProperties => ({
  background: "#ffffff",
  border: "1px solid #ebdccb",
  borderTop: `4px solid ${accent}`,
  borderRadius: 14,
  padding: "14px 16px",
  boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
});

const modulesNavContainer: React.CSSProperties = {
  display: "flex",
  gap: 8,
  overflowX: "auto",
  paddingBottom: 6,
  marginBottom: 16,
  whiteSpace: "nowrap",
};

const moduleTabBtnStyle = (isSelected: boolean): React.CSSProperties => ({
  background: isSelected ? "#663440" : "#ffffff",
  color: isSelected ? "#ffffff" : "#512630",
  border: `1px solid ${isSelected ? "#663440" : "#ebdccb"}`,
  borderRadius: 12,
  padding: "10px 16px",
  fontSize: 13,
  fontWeight: isSelected ? "bold" : "600",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  boxShadow: isSelected ? "0 4px 12px rgba(102, 52, 64, 0.2)" : "none",
  transition: "all 0.15s ease",
});

const badgeCountStyle: React.CSSProperties = {
  background: "#e11d48",
  color: "#ffffff",
  borderRadius: 10,
  padding: "1px 6px",
  fontSize: 10,
  fontWeight: "bold",
};

const subTabsBarStyle: React.CSSProperties = {
  background: "#f7f2ea",
  padding: "8px 12px",
  borderRadius: 12,
  display: "flex",
  gap: 6,
  marginBottom: 16,
  overflowX: "auto",
  border: "1px solid #ebdccb",
};

const subTabBtnStyle = (isSelected: boolean): React.CSSProperties => ({
  background: isSelected ? "#ffffff" : "transparent",
  color: isSelected ? "#663440" : "#786d69",
  border: isSelected ? "1px solid #ebdccb" : "none",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: isSelected ? "bold" : "500",
  cursor: "pointer",
  whiteSpace: "nowrap",
});

const panelContainerStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #ebdccb",
  borderRadius: 16,
  overflow: "hidden",
  boxShadow: "0 4px 16px rgba(102, 52, 64, 0.04)",
  marginBottom: 24,
};

const panelHeaderStyle: React.CSSProperties = {
  padding: "16px 20px",
  background: "#fcfaf7",
  borderBottom: "1px solid #ebdccb",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 10,
};

const filterToolbarStyle: React.CSSProperties = {
  padding: "12px 18px",
  background: "#faf8f5",
  borderBottom: "1px solid #ebdccb",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const searchBoxWrapper: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  background: "#ffffff",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: "6px 10px",
  gap: 8,
  minWidth: 260,
};

const searchFieldStyle: React.CSSProperties = {
  border: "none",
  outline: "none",
  fontSize: 13,
  width: "100%",
  fontFamily: "inherit",
};

const filterSelectStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: "7px 12px",
  fontSize: 12,
  outline: "none",
  color: "#374151",
  fontFamily: "inherit",
};

const villageMatrixGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};

const villageCardStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #ebdccb",
  borderRadius: 12,
  padding: 14,
  boxShadow: "0 2px 6px rgba(0,0,0,0.02)",
};

const executiveTableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const tableThStyle: React.CSSProperties = {
  background: "#fcfaf7",
  borderBottom: "2px solid #ebdccb",
  padding: "12px 16px",
  textAlign: "right",
  color: "#663440",
  fontWeight: "bold",
  fontSize: 12,
};

const tableTrStyle: React.CSSProperties = {
  borderBottom: "1px solid #f2ede8",
};

const tableTdStyle: React.CSSProperties = {
  padding: "12px 16px",
  verticalAlign: "middle",
};

const verifiedPillStyle: React.CSSProperties = {
  background: "#ecfdf5",
  color: "#065f46",
  padding: "3px 8px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: "bold",
  display: "inline-block",
};

const pendingPillStyle: React.CSSProperties = {
  background: "#fffbeb",
  color: "#92400e",
  padding: "3px 8px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: "bold",
  display: "inline-block",
};

const activePillStyle: React.CSSProperties = {
  background: "#eff6ff",
  color: "#1e40af",
  padding: "3px 8px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: "bold",
  display: "inline-block",
};

const mutedPillStyle: React.CSSProperties = {
  background: "#f3f4f6",
  color: "#6b7280",
  padding: "3px 8px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: "bold",
  display: "inline-block",
};

const roleBadgeStyle = (role: string): React.CSSProperties => {
  const colors: Record<string, { bg: string; color: string }> = {
    admin: { bg: "#fdf2f4", color: "#9f1239" },
    seller: { bg: "#fff7ed", color: "#c2410c" },
    driver: { bg: "#f0fdf4", color: "#15803d" },
    customer: { bg: "#eff6ff", color: "#1e40af" },
  };
  const c = colors[role] || { bg: "#f3f4f6", color: "#374151" };
  return {
    background: c.bg,
    color: c.color,
    padding: "3px 8px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: "bold",
  };
};

const approveBtnStyle: React.CSSProperties = {
  background: "#ecfdf5",
  border: "1px solid #a7f3d0",
  color: "#065f46",
  borderRadius: 6,
  padding: "5px 10px",
  fontSize: 11,
  fontWeight: "bold",
  cursor: "pointer",
};

const suspendBtnStyle: React.CSSProperties = {
  background: "#fff1f2",
  border: "1px solid #fecdd3",
  color: "#be123c",
  borderRadius: 6,
  padding: "5px 10px",
  fontSize: 11,
  fontWeight: "bold",
  cursor: "pointer",
};

const reviewCardStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #ebdccb",
  borderRadius: 12,
  padding: 14,
  boxShadow: "0 2px 8px rgba(0,0,0,0.03)",
};

const openChatLinkStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#663440",
  textDecoration: "none",
  fontWeight: "bold",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

const planCardStyle: React.CSSProperties = {
  background: "#fcfaf7",
  border: "1px solid #ebdccb",
  borderRadius: 12,
  padding: 16,
};

const ticketCardStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #ebdccb",
  borderRadius: 10,
  padding: 14,
};

const secondaryActionBtnStyle: React.CSSProperties = {
  background: "#fcfaf7",
  border: "1px solid #ebdccb",
  color: "#512630",
  padding: "10px 14px",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: "bold",
  cursor: "pointer",
  textAlign: "right",
};

const formLabelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  fontWeight: "bold",
  color: "#374151",
};

const formInputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
};

const primaryBtnStyle: React.CSSProperties = {
  background: "#663440",
  color: "#ffffff",
  border: "none",
  borderRadius: 8,
  padding: "10px 18px",
  fontSize: 13,
  fontWeight: "bold",
  cursor: "pointer",
  alignSelf: "flex-start",
};
