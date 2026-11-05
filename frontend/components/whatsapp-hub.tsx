"use client";

import { useEffect, useState, useRef } from "react";
import { api, post } from "@/lib/api";
import { useStore } from "./provider";
import {
  QrCode,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  LogOut,
  Send,
  Smartphone,
  ShieldCheck,
  Zap,
  MessageSquare,
} from "lucide-react";

type WhatsAppStatus = {
  instance: string;
  connected: boolean;
  state: string;
  owner?: string | null;
  profile_name?: string | null;
  profile_pic?: string | null;
  qrcode?: string | null;
};

export function WhatsAppHub() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useStore();
  const pollTimer = useRef<NodeJS.Timeout | null>(null);

  async function fetchStatus(showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      const data = await api<WhatsAppStatus>("/admin/whatsapp/status");
      setStatus(data);
    } catch (e) {
      console.error("WhatsApp status check failed:", e);
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus(true);

    // Auto-poll every 3 seconds to catch the QR scan instantly
    pollTimer.current = setInterval(() => {
      fetchStatus(false);
    }, 3000);

    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  async function handleRefreshQR() {
    setRefreshing(true);
    try {
      const res = await post<{ qrcode: string }>("/admin/whatsapp/refresh-qr");
      if (res && res.qrcode) {
        setStatus((prev) => (prev ? { ...prev, qrcode: res.qrcode } : null));
        toast("تم تحديث رمز الباركود بنجاح");
      }
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("هل أنت متأكد من رغبتك في تسجيل الخروج وفصل جلسة الواتساب؟")) {
      return;
    }
    try {
      await post("/admin/whatsapp/disconnect");
      toast("تم قطع الاتصال بنجاح");
      fetchStatus(true);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!testPhone.trim()) {
      toast("يرجى إدخال رقم الجوال");
      return;
    }
    if (!testMessage.trim()) {
      toast("يرجى كتابة نص الرسالة");
      return;
    }

    setSending(true);
    try {
      await post("/admin/whatsapp/send", {
        phone: testPhone,
        message: testMessage,
      });
      toast("تم إرسال الرسالة بنجاح عبر واتساب المنصة! ✓");
      setTestMessage("");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const QUICK_TEMPLATES = [
    {
      label: "🔔 استعجال مطبخ الأسرة",
      text: "تنبيه عاجل من إدارة منصة من بيوتنا: يوجد طلب جديد بانتظار بدء تجهيزك السريع، نرجو تأكيد الاستلام فوراً.",
    },
    {
      label: "🛵 استدعاء الكابتن للتحرك",
      text: "كابتن منصة من بيوتنا: الطلب جاهز وساخن بمطبخ الأسرة، نرجو التوجه فوراً للاستلام والتوصيل للعميل.",
    },
    {
      label: "🍲 تطمين العميل بالطلب",
      text: "عميلنا العزيز في الدرب، أكلتك الطازجة قيد التوصيل الآن مع الكابتن وبطريقها إليك ساخنة! شكرًا لثقتك.",
    },
    {
      label: "🎁 اعتذار وكوبون تعويض",
      text: "نعتذر منك عميلنا العزيز على هذا التأخير، تم استرداد المبلغ ونقدم لك كود خصم (DARB10) لطلبك القادم.",
    },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 0" }}>
      {/* Top Banner */}
      <div
        style={{
          background: "linear-gradient(135deg, #075e54 0%, #128c7e 100%)",
          borderRadius: 20,
          padding: "28px 32px",
          color: "#ffffff",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 20,
          marginBottom: 24,
          boxShadow: "0 8px 30px rgba(7, 94, 84, 0.2)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 32 }}>💬</span>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>
              بوابة واتساب المنصة الرسمية — محافظة الدرب
            </h2>
          </div>
          <p
            style={{
              margin: "8px 0 0 0",
              fontSize: 14,
              opacity: 0.9,
              maxWidth: 600,
              lineHeight: 1.6,
            }}
          >
            ربط مباشر وسريع عبر مسح الباركود، لإرسال إشعارات الطلبات، استعجال الكباتن،
            وتأكيد استلام وتجهيز الوجبات للأسر في الدرب وقراها لحظة بلحظة.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {status?.connected ? (
            <div
              style={{
                background: "rgba(255, 255, 255, 0.2)",
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(255, 255, 255, 0.4)",
                padding: "8px 18px",
                borderRadius: 30,
                fontSize: 13,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  background: "#25d366",
                  borderRadius: "50%",
                  boxShadow: "0 0 10px #25d366",
                }}
              />
              <span>متصل ونشط 100%</span>
            </div>
          ) : (
            <div
              style={{
                background: "rgba(255, 255, 255, 0.15)",
                border: "1px solid rgba(255, 255, 255, 0.3)",
                padding: "8px 18px",
                borderRadius: 30,
                fontSize: 13,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  background: "#fbbf24",
                  borderRadius: "50%",
                  animation: "pulse 1.5s infinite",
                }}
              />
              <span>بانتظار مسح الباركود</span>
            </div>
          )}

          <button
            onClick={() => fetchStatus(true)}
            disabled={loading}
            style={{
              background: "#ffffff",
              border: "none",
              color: "#075e54",
              padding: "10px 18px",
              borderRadius: 12,
              fontSize: 13,
              fontWeight: 800,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            }}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            <span>تحديث الحالة</span>
          </button>
        </div>
      </div>

      {/* Main Content Grid */}
      {loading && !status ? (
        <div
          style={{
            background: "#ffffff",
            padding: 60,
            borderRadius: 18,
            textAlign: "center",
            color: "#6b7280",
            border: "1px solid #e5e7eb",
          }}
        >
          <RefreshCw size={36} className="animate-spin" style={{ margin: "0 auto 16px auto", color: "#128c7e" }} />
          <p style={{ fontSize: 16, fontWeight: 700 }}>جارٍ فحص بوابة الواتساب السحابية...</p>
        </div>
      ) : status?.connected ? (
        /* CONNECTED STATE */
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {/* Status Details Card */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: 18,
              border: "1px solid #e5e7eb",
              padding: 28,
              boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div
                style={{
                  background: "#dcfce7",
                  color: "#166534",
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <CheckCircle2 size={28} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#111827" }}>
                  جلسة الواتساب نشطة وموثقة
                </h3>
                <span style={{ fontSize: 13, color: "#16a34a", fontWeight: 700 }}>
                  مربوط بنجاح كجهاز رسمي للمنصة
                </span>
              </div>
            </div>

            <div
              style={{
                background: "#f9fafb",
                borderRadius: 12,
                padding: "16px 20px",
                border: "1px solid #f3f4f6",
                marginBottom: 20,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 13 }}>
                <span style={{ color: "#6b7280" }}>رقم الواتساب المتصل:</span>
                <strong style={{ color: "#111827", direction: "ltr" }}>
                  +{status.owner || "9665XXXXXXX"}
                </strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 13 }}>
                <span style={{ color: "#6b7280" }}>اسم المعرّف / الحساب:</span>
                <strong style={{ color: "#111827" }}>
                  {status.profile_name || "منصة من بيوتنا"}
                </strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "#6b7280" }}>بروتوكول الربط:</span>
                <span style={{ color: "#075e54", fontWeight: 700 }}>
                  WhatsApp Baileys v2 (خادم الدرب)
                </span>
              </div>
            </div>

            <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 18 }}>
              <h4 style={{ margin: "0 0 10px 0", fontSize: 14, color: "#374151" }}>
                ميزات الربط التلقائي المفعلة الآن:
              </h4>
              <ul style={{ margin: 0, paddingRight: 20, fontSize: 13, color: "#4b5563", lineHeight: 1.8 }}>
                <li>إشعار فوري للأسر المنتجة عند وصول طلبات جديدة.</li>
                <li>إرسال كود الاستلام (Pickup OTP) وكود التسليم للعميل.</li>
                <li>تنبيه الكباتن عند اكتمال طهي وتجهيز الوجبات.</li>
                <li>التواصل المباشر والتدخل السريع من غرفة العمليات.</li>
              </ul>
            </div>

            <button
              onClick={handleDisconnect}
              style={{
                marginTop: 24,
                width: "100%",
                background: "#fff1f2",
                border: "1px solid #fecdd3",
                color: "#be123c",
                padding: "12px 18px",
                borderRadius: 12,
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <LogOut size={16} />
              <span>قطع الاتصال / تسجيل الخروج من هذا الرقم</span>
            </button>
          </div>

          {/* Test & Direct Sender Card */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: 18,
              border: "1px solid #e5e7eb",
              padding: 28,
              boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <Send size={20} color="#075e54" />
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#111827" }}>
                إرسال رسالة واتساب مباشرة (تجربة الإرسال)
              </h3>
            </div>
            <p style={{ margin: "0 0 18px 0", fontSize: 13, color: "#6b7280" }}>
              اختبر وصول الرسائل الفورية بإرسال رسالة تجريبية لأي رقم جوال سعودي:
            </p>

            <form onSubmit={handleSendMessage}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 6 }}>
                  رقم جوال المستلم (مثال: 055XXXXXXX أو 9665XXXXXXX):
                </label>
                <input
                  type="text"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="05XXXXXXXX"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #d1d5db",
                    fontSize: 14,
                    boxSizing: "border-box",
                    direction: "ltr",
                  }}
                  required
                />
              </div>

              {/* Quick Template Buttons */}
              <div style={{ marginBottom: 14 }}>
                <span style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 6, fontWeight: 700 }}>
                  قوالب رسائل سريعة بنقرة واحدة:
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {QUICK_TEMPLATES.map((tmpl, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setTestMessage(tmpl.text)}
                      style={{
                        background: "#f0fdf4",
                        border: "1px solid #bbf7d0",
                        color: "#166534",
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "4px 10px",
                        borderRadius: 8,
                        cursor: "pointer",
                      }}
                    >
                      {tmpl.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 6 }}>
                  نص الرسالة:
                </label>
                <textarea
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  placeholder="اكتب نص الرسالة هنا..."
                  rows={4}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #d1d5db",
                    fontSize: 13,
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={sending}
                style={{
                  width: "100%",
                  background: "#25d366",
                  color: "#ffffff",
                  border: "none",
                  padding: "12px 20px",
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 900,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  boxShadow: "0 4px 14px rgba(37, 211, 102, 0.3)",
                }}
              >
                {sending ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    <span>جارٍ الإرسال...</span>
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    <span>إرسال الرسالة عبر الواتساب الآن</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      ) : (
        /* DISCONNECTED / SCAN QR STATE */
        <div
          style={{
            background: "#ffffff",
            borderRadius: 20,
            border: "1px solid #e5e7eb",
            padding: "36px 32px",
            boxShadow: "0 4px 25px rgba(0,0,0,0.04)",
            display: "grid",
            gridTemplateColumns: "1.1fr 0.9fr",
            gap: 36,
            alignItems: "center",
          }}
        >
          {/* Instructions Column */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span
                style={{
                  background: "#e8f5e9",
                  color: "#2e7d32",
                  padding: "4px 12px",
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                خطوة الربط الأولى
              </span>
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                يستغرق الربط 5 ثوانٍ فقط
              </span>
            </div>

            <h3 style={{ margin: "0 0 12px 0", fontSize: 22, fontWeight: 900, color: "#111827" }}>
              امسح الباركود بهاتفك لتفعيل الواتساب
            </h3>
            <p style={{ margin: "0 0 24px 0", fontSize: 14, color: "#4b5563", lineHeight: 1.7 }}>
              اتبع الخطوات البسيطة التالية من خلال تطبيق الواتساب بجوالك لربط رقم المنصة الرسمي:
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div
                  style={{
                    background: "#075e54",
                    color: "#ffffff",
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 900,
                    flexShrink: 0,
                  }}
                >
                  1
                </div>
                <div>
                  <strong style={{ fontSize: 14, color: "#111827", display: "block" }}>
                    افتح تطبيق واتساب على هاتفك 📱
                  </strong>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>
                    تأكد من فتح تطبيق واتساب العادي أو الأعمال المسجل عليه رقم المنصة.
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div
                  style={{
                    background: "#075e54",
                    color: "#ffffff",
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 900,
                    flexShrink: 0,
                  }}
                >
                  2
                </div>
                <div>
                  <strong style={{ fontSize: 14, color: "#111827", display: "block" }}>
                    اضغط الإعدادات ⚙️ أو النقاط الثلاث (⋮)
                  </strong>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>
                    في أجهزة الآيفون: الإعدادات بالأسفل · في أجهزة الأندرويد: النقاط الثلاث بالأعلى.
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div
                  style={{
                    background: "#075e54",
                    color: "#ffffff",
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 900,
                    flexShrink: 0,
                  }}
                >
                  3
                </div>
                <div>
                  <strong style={{ fontSize: 14, color: "#111827", display: "block" }}>
                    اختر «الأجهزة المرتبطة» (Linked Devices)
                  </strong>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>
                    ثم اضغط على الزر الأخضر <strong>«ربط جهاز» (Link a Device)</strong>.
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div
                  style={{
                    background: "#25d366",
                    color: "#ffffff",
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 900,
                    flexShrink: 0,
                  }}
                >
                  4
                </div>
                <div>
                  <strong style={{ fontSize: 14, color: "#111827", display: "block" }}>
                    وجّه كاميرا الجوال نحو الباركود المقابل 📸
                  </strong>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>
                    بمجرد مسحه، ستتعرف الشاشة على الجهاز فوراً وسيتحول النظام تلقائياً لوضع الاتصال.
                  </span>
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 24,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <button
                onClick={handleRefreshQR}
                disabled={refreshing}
                style={{
                  background: "#f3f4f6",
                  border: "1px solid #d1d5db",
                  color: "#374151",
                  padding: "9px 16px",
                  borderRadius: 10,
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
                <span>توليد باركود جديد</span>
              </button>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>
                الباركود يتجدد تلقائياً كل 40 ثانية للأمان
              </span>
            </div>
          </div>

          {/* QR Code Column */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                background: "#ffffff",
                padding: 24,
                borderRadius: 24,
                border: "2px solid #25d366",
                boxShadow: "0 12px 40px rgba(37, 211, 102, 0.18)",
                position: "relative",
              }}
            >
              {status?.qrcode ? (
                <img
                  src={status.qrcode}
                  alt="WhatsApp QR Code"
                  style={{
                    width: 290,
                    height: 290,
                    display: "block",
                    borderRadius: 12,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 290,
                    height: 290,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#9ca3af",
                    gap: 12,
                  }}
                >
                  <RefreshCw size={32} className="animate-spin" color="#128c7e" />
                  <span style={{ fontSize: 13, fontWeight: 700 }}>
                    جارٍ إعداد وتوليد الباركود...
                  </span>
                </div>
              )}
            </div>

            <div
              style={{
                marginTop: 18,
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: "#059669",
                fontWeight: 800,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  background: "#10b981",
                  borderRadius: "50%",
                  display: "inline-block",
                  boxShadow: "0 0 8px #10b981",
                }}
              />
              <span>الرادار نشط: سيتصل النظام تلقائياً فور توجيه الكاميرا</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
