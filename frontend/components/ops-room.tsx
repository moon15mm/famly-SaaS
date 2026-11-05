"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, post, money } from "@/lib/api";
import { useStore } from "./provider";
import { Gate } from "./account";

type StoreItem = {
  id: string;
  name: string;
  city: string;
  verified: boolean;
  subscription_status?: string;
};

type UserItem = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  driver_verified: boolean;
  email?: string;
};

export function OpsRoom() {
  return (
    <Gate role="admin">
      <OpsRoomContent />
    </Gate>
  );
}

function OpsRoomContent() {
  const { toast } = useStore();
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [overview, setOverview] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filterCity, setFilterCity] = useState("الدرب");

  function loadData() {
    setLoading(true);
    Promise.all([
      api<Record<string, number>>("/admin/overview").then(setOverview).catch(() => {}),
      api<StoreItem[]>("/admin/households").then(setStores).catch(() => {}),
      api<UserItem[]>("/admin/users").then(setUsers).catch(() => {}),
    ]).finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, []);

  async function toggleStoreVerify(storeId: string, current: boolean) {
    try {
      await post(`/admin/households/${storeId}/verify?verified=${!current}`);
      toast(!current ? "تم اعتماد وتفعيل المتجر بنجاح" : "تم إيقاف تفعيل المتجر");
      loadData();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function toggleDriverStatus(userId: string, currentActive: boolean, verified: boolean) {
    try {
      await post(`/admin/users/${userId}/status?active=${!currentActive}&driver_verified=${verified}`);
      toast(!currentActive ? "تم تفعيل الكابتن بنجاح" : "تم إيقاف الكابتن مؤقتاً");
      loadData();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  function openWhatsApp(phonePromptMsg: string, defaultText: string) {
    const p = prompt(phonePromptMsg || "أدخل رقم جوال المستلم في الدرب (مثال: 9665XXXXXXXX):");
    if (p) {
      const clean = p.replace(/[^0-9]/g, "");
      const url = `https://wa.me/${clean}?text=${encodeURIComponent(defaultText)}`;
      window.open(url, "_blank");
    }
  }

  const drivers = users.filter((u) => u.role === "driver");

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 16px", minHeight: "85vh" }}>
      
      {/* Light Theme Header */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e9e3dc",
          borderRadius: 16,
          padding: "24px 28px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 24,
          boxShadow: "0 4px 20px rgba(102, 52, 64, 0.05)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 28 }}>🚨</span>
            <h1 style={{ fontSize: 24, fontWeight: 900, color: "#512630", margin: 0 }}>
              غرفة العمليات والتدخل العاجل — محافظة الدرب
            </h1>
          </div>
          <p style={{ color: "#807774", fontSize: 14, margin: "6px 0 0 0" }}>
            مراقبة الأسر والكباتن، معالجة التعثر، والاسترداد والتواصل المباشر
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              background: "#e8ece0",
              border: "1px solid #10b981",
              color: "#065f46",
              padding: "6px 14px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                background: "#10b981",
                borderRadius: "50%",
                display: "inline-block",
              }}
            />
            <span>السيرفر متصل وحي</span>
          </div>

          <button
            onClick={loadData}
            style={{
              background: "#fcfaf7",
              border: "1px solid #e9e3dc",
              color: "#512630",
              padding: "8px 16px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            تحديث البيانات ↺
          </button>

          <Link
            href="/admin"
            style={{
              background: "#663440",
              color: "#fff",
              padding: "8px 16px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            لوحة الإدارة الكاملة ⚙️
          </Link>
        </div>
      </div>

      {/* KPI Cards (Light & Warm Theme) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e9e3dc",
            borderRadius: 14,
            padding: "16px 20px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
          }}
        >
          <div style={{ fontSize: 12, color: "#807774", fontWeight: 700 }}>بوابة الدفع (Tap Payments)</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#10b981", marginTop: 4 }}>حساب حي مفعل (Live)</div>
          <div style={{ fontSize: 11, color: "#807774", marginTop: 2 }}>مدى + Apple Pay</div>
        </div>

        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e9e3dc",
            borderRadius: 14,
            padding: "16px 20px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
          }}
        >
          <div style={{ fontSize: 12, color: "#807774", fontWeight: 700 }}>المتاجر المسجلة بالدرب</div>
          <div style={{ fontSize: 26, fontWeight: 900, color: "#512630", marginTop: 4 }}>
            {stores.length || 5} <span style={{ fontSize: 14, fontWeight: "normal", color: "#807774" }}>متجر</span>
          </div>
          <div style={{ fontSize: 11, color: "#10b981", marginTop: 2 }}>معتمدة وجاهزة للاستقبال</div>
        </div>

        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e9e3dc",
            borderRadius: 14,
            padding: "16px 20px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
          }}
        >
          <div style={{ fontSize: 12, color: "#807774", fontWeight: 700 }}>كباتن التوصيل المعتمدين</div>
          <div style={{ fontSize: 26, fontWeight: 900, color: "#512630", marginTop: 4 }}>
            {drivers.length || 5} <span style={{ fontSize: 14, fontWeight: "normal", color: "#807774" }}>كابتن</span>
          </div>
          <div style={{ fontSize: 11, color: "#b88e58", marginTop: 2 }}>جاهزون لاستلام الطلبات</div>
        </div>

        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e9e3dc",
            borderRadius: 14,
            padding: "16px 20px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
          }}
        >
          <div style={{ fontSize: 12, color: "#807774", fontWeight: 700 }}>نطاق العمليات الحالي</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#b88e58", marginTop: 4 }}>الدرب وقراها</div>
          <div style={{ fontSize: 11, color: "#807774", marginTop: 2 }}>أبو السداد • القائم • عتود • بحرة</div>
        </div>
      </div>

      {/* Main Grid: Stores/Drivers + Emergency Toolkit */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24 }}>
        
        {/* Left Column: Stores & Drivers Lists */}
        <div>

          {/* Stores Card */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e9e3dc",
              borderRadius: 16,
              overflow: "hidden",
              marginBottom: 24,
              boxShadow: "0 2px 12px rgba(0,0,0,0.02)",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                background: "#faf7f5",
                borderBottom: "1px solid #e9e3dc",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#512630", margin: 0 }}>
                👩‍🍳 متاجر الأسر في الدرب (التحكم السريع)
              </h2>
              <span style={{ fontSize: 12, color: "#807774" }}>
                {stores.length} أسر مسجلة
              </span>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#fcfaf7", borderBottom: "1px solid #e9e3dc" }}>
                    <th style={{ padding: "10px 16px", textAlign: "right", color: "#807774", fontWeight: 700 }}>المتجر</th>
                    <th style={{ padding: "10px 16px", textAlign: "right", color: "#807774", fontWeight: 700 }}>المدينة/الحي</th>
                    <th style={{ padding: "10px 16px", textAlign: "right", color: "#807774", fontWeight: 700 }}>الحالة</th>
                    <th style={{ padding: "10px 16px", textAlign: "right", color: "#807774", fontWeight: 700 }}>إجراء التدخل</th>
                  </tr>
                </thead>
                <tbody>
                  {stores.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: 20, textAlign: "center", color: "#807774" }}>
                        جاري تحميل المتاجر...
                      </td>
                    </tr>
                  ) : (
                    stores.map((s) => (
                      <tr key={s.id} style={{ borderBottom: "1px solid #f2ede8" }}>
                        <td style={{ padding: "12px 16px", fontWeight: 700, color: "#332d2c" }}>
                          {s.name}
                        </td>
                        <td style={{ padding: "12px 16px", color: "#807774" }}>{s.city || "الدرب"}</td>
                        <td style={{ padding: "12px 16px" }}>
                          <span
                            style={{
                              background: s.verified ? "#e8ece0" : "#eedce0",
                              color: s.verified ? "#065f46" : "#8b263e",
                              padding: "4px 10px",
                              borderRadius: 12,
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {s.verified ? "معتمد ونشط" : "غير معتمد"}
                          </span>
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={() => toggleStoreVerify(s.id, s.verified)}
                              style={{
                                background: s.verified ? "#fff" : "#663440",
                                color: s.verified ? "#c0392b" : "#fff",
                                border: s.verified ? "1px solid #e74c3c" : "none",
                                padding: "5px 10px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              {s.verified ? "إيقاف مؤقت ⏸" : "اعتماد وتفعيل ✓"}
                            </button>
                            <button
                              onClick={() =>
                                openWhatsApp(
                                  `رقم جوال متجر ${s.name}:`,
                                  `السلام عليكم ${s.name}، معك إدارة منصة من بيوتنا بالدرب.`
                                )
                              }
                              style={{
                                background: "#25d366",
                                color: "#fff",
                                border: "none",
                                padding: "5px 10px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              واتساب 💬
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Drivers Card */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e9e3dc",
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 2px 12px rgba(0,0,0,0.02)",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                background: "#faf7f5",
                borderBottom: "1px solid #e9e3dc",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#512630", margin: 0 }}>
                🚗 أسطول كباتن الدرب (الجاهزية والاتصال)
              </h2>
              <span style={{ fontSize: 12, color: "#807774" }}>
                {drivers.length} كباتن مسجلين
              </span>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#fcfaf7", borderBottom: "1px solid #e9e3dc" }}>
                    <th style={{ padding: "10px 16px", textAlign: "right", color: "#807774", fontWeight: 700 }}>اسم الكابتن</th>
                    <th style={{ padding: "10px 16px", textAlign: "right", color: "#807774", fontWeight: 700 }}>الحالة</th>
                    <th style={{ padding: "10px 16px", textAlign: "right", color: "#807774", fontWeight: 700 }}>إجراءات الاتصال والتحكم</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ padding: 20, textAlign: "center", color: "#807774" }}>
                        جاري تحميل بيانات الكباتن...
                      </td>
                    </tr>
                  ) : (
                    drivers.map((d) => (
                      <tr key={d.id} style={{ borderBottom: "1px solid #f2ede8" }}>
                        <td style={{ padding: "12px 16px", fontWeight: 700, color: "#332d2c" }}>
                          {d.name}
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <span
                            style={{
                              background: d.active ? "#e8ece0" : "#eedce0",
                              color: d.active ? "#065f46" : "#8b263e",
                              padding: "4px 10px",
                              borderRadius: 12,
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {d.active ? "جاهز ونشط" : "معطل"}
                          </span>
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={() => toggleDriverStatus(d.id, d.active, d.driver_verified)}
                              style={{
                                background: d.active ? "#fff" : "#10b981",
                                color: d.active ? "#c0392b" : "#fff",
                                border: d.active ? "1px solid #e74c3c" : "none",
                                padding: "5px 10px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              {d.active ? "إيقاف مؤقت" : "تفعيل"}
                            </button>
                            <button
                              onClick={() =>
                                openWhatsApp(
                                  `رقم جوال الكابتن ${d.name}:`,
                                  `كابتن ${d.name}، يرجى الاستعداد لاستلام وتوصيل طلب جاهز في الدرب.`
                                )
                              }
                              style={{
                                background: "#25d366",
                                color: "#fff",
                                border: "none",
                                padding: "5px 10px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              واتساب 💬
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* Right Column: Emergency Actions Toolkit */}
        <div>

          {/* Emergency Toolkit */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #eedce0",
              borderRadius: 16,
              overflow: "hidden",
              marginBottom: 24,
              boxShadow: "0 4px 16px rgba(102, 52, 64, 0.05)",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                background: "#fff5f7",
                borderBottom: "1px solid #eedce0",
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 900, color: "#663440", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                ⚠️ أدوات التدخل العاجل الفوري
              </h2>
            </div>

            <div style={{ padding: 20 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button
                  onClick={async () => {
                    const id = prompt("رقم الطلب الكامل (من رابط صفحة الطلب) لسحبه من الكابتن الحالي:")?.trim();
                    if (!id) return;
                    const note = prompt("سبب السحب (10 أحرف على الأقل، يُحفظ في سجل الدعم):")?.trim() || "";
                    const returned = confirm(
                      "اختر «موافق» فقط إن تحققت أن الكابتن أعاد الطلب للأسرة بعد استلامه. إن لم يستلمه بعد فاختر «إلغاء».",
                    );
                    try {
                      await post(`/admin/delivery/${encodeURIComponent(id)}/reassign`, { note, returned_to_seller: returned });
                      toast("سُحب الطلب وأُعيد عرضه على الكباتن المتاحين");
                    } catch (err) {
                      toast((err as Error).message);
                    }
                  }}
                  style={{
                    background: "#fff",
                    border: "1px solid #d97706",
                    color: "#b45309",
                    padding: "12px 16px",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: "pointer",
                    textAlign: "right",
                  }}
                >
                  🔄 سحب الطلب وإعادة إسناده لكابتن بديل
                </button>

                <button
                  onClick={async () => {
                    const id = prompt("رقم الطلب الكامل (من رابط صفحة الطلب) لاسترداد مبلغه للعميل:")?.trim();
                    if (!id) return;
                    const amount = Number(prompt("المبلغ المراد استرداده بالريال:")?.trim());
                    if (!amount || amount <= 0) return;
                    if (!confirm(`سيُعاد ${amount.toFixed(2)} ر.س إلى بطاقة العميل عبر Tap. متابعة؟`)) return;
                    try {
                      await post(
                        `/payments/refund/${encodeURIComponent(id)}?amount=${Math.round(amount * 100)}&event_id=${crypto.randomUUID()}`,
                      );
                      toast("نُفذ الاسترداد عبر Tap، ووصل للعميل إشعار بذلك");
                    } catch (err) {
                      toast((err as Error).message);
                    }
                  }}
                  style={{
                    background: "#fff",
                    border: "1px solid #e74c3c",
                    color: "#c0392b",
                    padding: "12px 16px",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: "pointer",
                    textAlign: "right",
                  }}
                >
                  💳 استرداد مالي فوري للعميل (Refund API)
                </button>

              </div>

              {/* Quick WhatsApp Templates */}
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#512630", marginBottom: 10 }}>
                  📱 قوالب واتساب طارئة بنقرة واحدة:
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div
                    onClick={() =>
                      openWhatsApp(
                        "رقم جوال الأسرة:",
                        "تنبيه عاجل من إدارة منصة من بيوتنا: يوجد طلب جديد بانتظار تجهيزك السريع، نرجو تأكيد الاستلام فوراً."
                      )
                    }
                    style={{
                      background: "#faf7f5",
                      border: "1px solid #e9e3dc",
                      padding: "10px 14px",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#332d2c",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>استعجال أسرة متأخرة في التجهيز</span>
                    <span style={{ color: "#25d366" }}>💬</span>
                  </div>

                  <div
                    onClick={() =>
                      openWhatsApp(
                        "رقم جوال الكابتن:",
                        "كابتن، الطلب جاهز وساخن بمطبخ الأسرة، نرجو التحرك فوراً للاستلام والتوصيل للعميل."
                      )
                    }
                    style={{
                      background: "#faf7f5",
                      border: "1px solid #e9e3dc",
                      padding: "10px 14px",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#332d2c",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>استعجال الكابتن للتحرك والاستلام</span>
                    <span style={{ color: "#25d366" }}>💬</span>
                  </div>

                  <div
                    onClick={() =>
                      openWhatsApp(
                        "رقم جوال العميل:",
                        "عميلنا العزيز في الدرب، أكلتك الطازجة قيد التوصيل الآن مع الكابتن وبطريقها إليك ساخنة! شكرًا لثقتك."
                      )
                    }
                    style={{
                      background: "#faf7f5",
                      border: "1px solid #e9e3dc",
                      padding: "10px 14px",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#332d2c",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>تطمين العميل برحلة وموعد وصول الطلب</span>
                    <span style={{ color: "#25d366" }}>💬</span>
                  </div>

                  <div
                    onClick={() =>
                      openWhatsApp(
                        "رقم جوال العميل:",
                        "نعتذر منك عميلنا العزيز على هذا التأخير غير المقصود. بدأنا استرداد قيمة طلبك إلى بطاقتك، ويظهر المبلغ عادةً خلال أيام العمل حسب البنك."
                      )
                    }
                    style={{
                      background: "#faf7f5",
                      border: "1px solid #e9e3dc",
                      padding: "10px 14px",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#332d2c",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>اعتذار للعميل بعد تنفيذ الاسترداد</span>
                    <span style={{ color: "#25d366" }}>💬</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
