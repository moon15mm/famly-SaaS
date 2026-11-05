"use client";

import { useState, useEffect, useRef, FormEvent, ChangeEvent } from "react";
import { api, post, date } from "@/lib/api";
import { useStore } from "./provider";
import {
  Send,
  Image as ImageIcon,
  Bot,
  User as UserIcon,
  ChefHat,
  Car,
  ShieldAlert,
  Star,
  CheckCircle2,
  Clock,
  Sparkles,
  Camera,
  RefreshCw,
  X,
  AlertTriangle,
} from "lucide-react";

interface ChatMessage {
  id: string;
  sender_id: string | null;
  sender_role: "ai" | "system" | "customer" | "seller" | "driver" | "admin";
  sender_name: string;
  message_type: "text" | "status_update" | "image" | "review_prompt" | "review_submitted";
  content: string;
  image_url: string | null;
  created_at: string;
}

interface ChatData {
  order_id: string;
  order_status: string;
  order_status_ar: string;
  scheduled_at: string | null;
  household_name: string;
  customer_name: string;
  driver_name: string | null;
  current_user_role: "customer" | "seller" | "driver" | "admin";
  current_user_name: string;
  delivery_method: string;
  address: string | null;
  has_review: boolean;
  review: {
    rating: number;
    comment: string;
    driver_rating: number | null;
    driver_comment: string | null;
    photo_url: string | null;
  } | null;
  messages: ChatMessage[];
}

export function OrderChat({ orderId, orderStatus }: { orderId: string; orderStatus?: string }) {
  const [data, setData] = useState<ChatData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inputText, setInputText] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // In-chat review form state
  const [foodRating, setFoodRating] = useState(5);
  const [foodComment, setFoodComment] = useState("");
  const [driverRating, setDriverRating] = useState(5);
  const [driverComment, setDriverComment] = useState("");
  const [reviewPhoto, setReviewPhoto] = useState<string | null>(null);
  const [submittingReview, setSubmittingReview] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reviewFileRef = useRef<HTMLInputElement>(null);
  const { toast } = useStore();

  const loadChat = async (isPolling = false) => {
    try {
      const res = await api<ChatData>(`/orders/${orderId}/chat`);
      setData(res);
      if (!isPolling) setLoading(false);
    } catch (e) {
      if (!isPolling) {
        setError((e as Error).message);
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadChat(false);
    const interval = setInterval(() => loadChat(true), 3500);
    return () => clearInterval(interval);
  }, [orderId]);

  useEffect(() => {
    if (data?.messages.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [data?.messages.length]);

  const handleSendMessage = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text && !selectedImage) return;

    setBusy(true);
    try {
      await post(`/orders/${orderId}/chat/messages`, {
        content: text,
        image_url: selectedImage,
      });
      setInputText("");
      setSelectedImage(null);
      await loadChat(true);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>, isReview = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await api<{ url: string }>(`/orders/${orderId}/chat/upload`, {
        method: "POST",
        body: formData,
      });
      if (isReview) {
        setReviewPhoto(res.url);
        toast("تم إرفاق صورة التقييم بنجاح");
      } else {
        setSelectedImage(res.url);
        toast("تم تجهيز الصورة للإرسال");
      }
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
  };

  const handleQuickChip = (text: string) => {
    setInputText(text);
  };

  const handleSubmitReview = async (e: FormEvent) => {
    e.preventDefault();
    if (!foodComment.trim()) {
      toast("يرجى كتابة ملاحظتك حول جودة الوجبة");
      return;
    }
    setSubmittingReview(true);
    try {
      await post(`/orders/${orderId}/chat/review`, {
        rating: foodRating,
        comment: foodComment.trim(),
        driver_rating: data?.driver_name ? driverRating : null,
        driver_comment: data?.driver_name && driverComment.trim() ? driverComment.trim() : null,
        photo_url: reviewPhoto,
      });
      toast("تم إرسال التقييم بنجاح! شكرًا لمشاركتك ❤️");
      await loadChat(true);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSubmittingReview(false);
    }
  };

  if (loading) {
    return (
      <div style={panelCardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px", gap: 12, color: "#663440" }}>
          <RefreshCw className="animate-spin" size={24} />
          <span>جارٍ فتح غرفة المحادثة الذكية للطلب…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={panelCardStyle}>
        <p style={{ color: "#b91c1c", margin: 0 }}>{error || "تعذر تحميل محادثة الطلب"}</p>
      </div>
    );
  }

  const isDeliveredOrCompleted = ["delivered", "completed"].includes(data.order_status);
  const showReviewForm = isDeliveredOrCompleted && data.current_user_role === "customer" && !data.has_review;

  return (
    <div style={panelCardStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 18 }}>🤖</span>
            <h2 style={{ margin: 0, fontSize: 18, color: "#512630" }}>غرفة المحادثة الذكية للطلب</h2>
            <span style={livePulseBadge}>
              <span style={pulseDot} />
              مباشر
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "#666", lineHeight: 1.5 }}>
            تنسيق فوري بين العميل ومطبخ الأسرة والكابتن والإدارة · مدارة بذكاء اصطناعي تفاعلي
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => loadChat(true)}
            title="تحديث المحادثة"
            style={{
              background: "#f7f2ea",
              border: "1px solid #ebdccb",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              color: "#663440",
            }}
          >
            <RefreshCw size={13} />
            <span>تحديث</span>
          </button>
        </div>
      </div>

      {/* Participants Banner */}
      <div style={participantsBarStyle}>
        <span style={participantPill("customer")}>
          <UserIcon size={12} /> العميل: {data.customer_name}
        </span>
        <span style={participantPill("seller")}>
          <ChefHat size={12} /> مطبخ: {data.household_name}
        </span>
        <span style={participantPill("driver")}>
          <Car size={12} /> {data.driver_name ? `الكابتن: ${data.driver_name}` : "الكابتن: بانتظار الإسناد"}
        </span>
        <span style={participantPill("admin")}>
          <ShieldAlert size={12} /> إدارة العمليات
        </span>
        <span style={participantPill("ai")}>
          <Bot size={12} /> مساعد بيوتنا الذكي
        </span>
      </div>

      {/* Messages Stream */}
      <div style={streamContainerStyle}>
        {data.messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            currentUserRole={data.current_user_role}
            onOpenImage={(url) => setLightboxUrl(url)}
          />
        ))}

        {/* Embedded Interactive Review Card inside Chat Stream */}
        {showReviewForm && (
          <div style={reviewCardPromptStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div style={{ background: "#fef3c7", padding: 8, borderRadius: "50%", color: "#b45309" }}>
                <Star size={20} fill="#b45309" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, color: "#92400e" }}>شاركونا تقييمكم للطلب</h3>
                <span style={{ fontSize: 12, color: "#b45309" }}>
                  رأيكم يساهم في دعم وتمكين أسر الدرب المنتجة وكباتن التوصيل
                </span>
              </div>
            </div>

            <form onSubmit={handleSubmitReview} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Food Rating */}
              <div style={ratingSectionStyle}>
                <label style={{ fontSize: 13, fontWeight: "bold", color: "#374151" }}>
                  🍽️ تقييم طعام ومطبخ ({data.household_name}):
                </label>
                <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "6px 0" }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      type="button"
                      key={star}
                      onClick={() => setFoodRating(star)}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}
                    >
                      <Star
                        size={26}
                        fill={star <= foodRating ? "#f59e0b" : "none"}
                        color={star <= foodRating ? "#f59e0b" : "#d1d5db"}
                      />
                    </button>
                  ))}
                  <span style={{ fontSize: 12, color: "#6b7280", marginRight: 6 }}>
                    ({foodRating === 5 ? "ممتاز جدًا" : foodRating === 4 ? "جيد جدًا" : foodRating === 3 ? "جيد" : foodRating === 2 ? "متوسط" : "يحتاج تحسين"})
                  </span>
                </div>
                <textarea
                  value={foodComment}
                  onChange={(e) => setFoodComment(e.target.value)}
                  placeholder="ما رأيك في المذاق، الحرارة، والتغليف ونظافة الوجبة؟"
                  required
                  rows={2}
                  style={inputAreaStyle}
                />
              </div>

              {/* Driver Rating */}
              {data.driver_name && (
                <div style={ratingSectionStyle}>
                  <label style={{ fontSize: 13, fontWeight: "bold", color: "#374151" }}>
                    🚗 تقييم كابتن التوصيل ({data.driver_name}):
                  </label>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "6px 0" }}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        type="button"
                        key={star}
                        onClick={() => setDriverRating(star)}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}
                      >
                        <Star
                          size={26}
                          fill={star <= driverRating ? "#10b981" : "none"}
                          color={star <= driverRating ? "#10b981" : "#d1d5db"}
                        />
                      </button>
                    ))}
                    <span style={{ fontSize: 12, color: "#6b7280", marginRight: 6 }}>
                      ({driverRating === 5 ? "سريع ومحترم" : driverRating >= 4 ? "جيد جدًا" : "مقبول"})
                    </span>
                  </div>
                  <input
                    value={driverComment}
                    onChange={(e) => setDriverComment(e.target.value)}
                    placeholder="ملاحظتك حول سرعة التوصيل واللباقة (اختياري)…"
                    style={{ ...inputAreaStyle, height: 38 }}
                  />
                </div>
              )}

              {/* Photo Upload for Review */}
              <div>
                <input
                  type="file"
                  accept="image/*"
                  ref={reviewFileRef}
                  style={{ display: "none" }}
                  onChange={(e) => handleImageUpload(e, true)}
                />
                <button
                  type="button"
                  onClick={() => reviewFileRef.current?.click()}
                  disabled={uploading}
                  style={uploadPhotoBtnStyle}
                >
                  <Camera size={15} />
                  <span>{reviewPhoto ? "تغيير صورة الطبق المرفقة" : "إرفاق صورة للطبق (اختياري)"}</span>
                </button>
                {reviewPhoto && (
                  <div style={{ marginTop: 8, position: "relative", display: "inline-block" }}>
                    <img
                      src={reviewPhoto}
                      alt="صورة التقييم"
                      style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid #ddd" }}
                    />
                    <button
                      type="button"
                      onClick={() => setReviewPhoto(null)}
                      style={removePhotoBtnStyle}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={submittingReview}
                style={submitReviewBtnStyle}
              >
                {submittingReview ? "جارٍ إرسال التقييم…" : "إرسال التقييم وتأكيده ⭐"}
              </button>
            </form>
          </div>
        )}

        {/* Confirmed Review Summary if already reviewed */}
        {data.has_review && data.review && (
          <div style={reviewSummaryCardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <CheckCircle2 size={16} color="#059669" />
              <strong style={{ fontSize: 14, color: "#065f46" }}>تم تسجيل تقييم هذا الطلب</strong>
            </div>
            <div style={{ fontSize: 13, color: "#374151" }}>
              <div>🍽️ تقييم الأسرة: {"⭐".repeat(data.review.rating)} · &quot;{data.review.comment}&quot;</div>
              {data.review.driver_rating && (
                <div style={{ marginTop: 4 }}>
                  🚗 تقييم الكابتن: {"⭐".repeat(data.review.driver_rating)}
                  {data.review.driver_comment ? ` · "${data.review.driver_comment}"` : ""}
                </div>
              )}
            </div>
            {data.review.photo_url && (
              <div style={{ marginTop: 8 }}>
                <img
                  src={data.review.photo_url}
                  alt="صورة تجربة الطلب"
                  onClick={() => setLightboxUrl(data.review!.photo_url)}
                  style={{ width: 70, height: 70, objectFit: "cover", borderRadius: 6, cursor: "pointer" }}
                />
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Suggestion Chips */}
      <div style={quickChipsContainerStyle}>
        <span style={{ fontSize: 11, color: "#888", display: "flex", alignItems: "center", gap: 3 }}>
          <Sparkles size={11} color="#b88e58" /> اقتراحات سريعة:
        </span>
        <button type="button" onClick={() => handleQuickChip("متى يوصل الطلب تقريباً؟")} style={chipBtnStyle}>
          ⏱️ متى يوصل الطلب؟
        </button>
        <button type="button" onClick={() => handleQuickChip("الرجاء إضافة ملاعق وشطة زيادة")} style={chipBtnStyle}>
          🥄 ملاعق وشطة زيادة
        </button>
        <button type="button" onClick={() => handleQuickChip("تأكيد موقع الباب بالدرب")} style={chipBtnStyle}>
          📍 تأكيد موقع الباب
        </button>
        {data.current_user_role === "seller" && (
          <button type="button" onClick={() => handleQuickChip("الطبق تم طهيه وتغليفه وهو ساخن الآن")} style={chipBtnStyle}>
            🍳 تم الطهي وهو ساخن
          </button>
        )}
        {data.current_user_role === "driver" && (
          <button type="button" onClick={() => handleQuickChip("أنا عند الباب بانتظاركم")} style={chipBtnStyle}>
            🚗 وصلت عند الباب
          </button>
        )}
        <button type="button" onClick={() => handleQuickChip("أحتاج مساعدة الإدارة بخصوص الطلب")} style={chipBtnStyle}>
          🚨 مساعدة الإدارة
        </button>
      </div>

      {/* Selected Image Preview before sending */}
      {selectedImage && (
        <div style={{ padding: "8px 16px", background: "#fdf8f0", borderTop: "1px dashed #e2d2b8", display: "flex", alignItems: "center", gap: 10 }}>
          <img
            src={selectedImage}
            alt="صورة للإرسال"
            style={{ width: 50, height: 50, objectFit: "cover", borderRadius: 6, border: "1px solid #ccc" }}
          />
          <span style={{ fontSize: 12, color: "#663440" }}>تم إرفاق الصورة وجاهزة للإرسال مع الرسالة</span>
          <button
            type="button"
            onClick={() => setSelectedImage(null)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#b91c1c", marginRight: "auto" }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Chat Input Bar */}
      <form onSubmit={handleSendMessage} style={inputFormStyle}>
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={(e) => handleImageUpload(e, false)}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || busy}
          title="إرفاق صورة (تجهيز/تغليف/تسليم)"
          style={attachPhotoBtnStyle}
        >
          <ImageIcon size={18} />
        </button>

        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="اكتب استفسارك أو رسالتك لجميع الأطراف ومساعد بيوتنا الذكي…"
          style={textInputStyle}
          disabled={busy}
        />

        <button
          type="submit"
          disabled={busy || (!inputText.trim() && !selectedImage)}
          style={{
            ...sendBtnStyle,
            opacity: busy || (!inputText.trim() && !selectedImage) ? 0.6 : 1,
            cursor: busy || (!inputText.trim() && !selectedImage) ? "not-allowed" : "pointer",
          }}
        >
          <Send size={16} />
          <span>إرسال</span>
        </button>
      </form>

      {/* Lightbox Modal */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={lightboxOverlayStyle}
        >
          <div style={{ position: "relative", maxWidth: "90%", maxHeight: "90%" }}>
            <img
              src={lightboxUrl}
              alt="صورة مكبرة"
              style={{ maxWidth: "100%", maxHeight: "85vh", borderRadius: 12, boxShadow: "0 10px 40px rgba(0,0,0,0.5)" }}
            />
            <button
              onClick={() => setLightboxUrl(null)}
              style={lightboxCloseBtnStyle}
            >
              <X size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  msg,
  currentUserRole,
  onOpenImage,
}: {
  msg: ChatMessage;
  currentUserRole: string;
  onOpenImage: (url: string) => void;
}) {
  const isAi = msg.sender_role === "ai";
  const isMe = msg.sender_role === currentUserRole;
  const isStatus = msg.message_type === "status_update" || msg.message_type === "review_prompt";
  const isReviewDone = msg.message_type === "review_submitted";

  if (isStatus || isReviewDone) {
    return (
      <div style={statusBannerStyle(isReviewDone)}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          {isReviewDone ? (
            <Star size={15} fill="#d97706" color="#d97706" />
          ) : (
            <Bot size={15} color="#663440" />
          )}
          <strong style={{ fontSize: 13, color: isReviewDone ? "#92400e" : "#512630" }}>
            {msg.sender_name}
          </strong>
          <span style={{ fontSize: 11, color: "#8a7e78", marginRight: "auto" }}>
            {date(msg.created_at)}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: isReviewDone ? "#78350f" : "#444", lineHeight: 1.6 }}>
          {msg.content}
        </p>
        {msg.image_url && (
          <div style={{ marginTop: 8 }}>
            <img
              src={msg.image_url}
              alt="صورة مرفقة"
              onClick={() => onOpenImage(msg.image_url!)}
              style={{ maxHeight: 180, maxWidth: "100%", borderRadius: 8, cursor: "pointer", border: "1px solid #ebdccb" }}
            />
          </div>
        )}
      </div>
    );
  }

  const roleMetaMap: Record<string, { icon: typeof UserIcon; bg: string; border: string; color: string; label: string }> = {
    ai: { icon: Bot, bg: "#fdf8f0", border: "#e8d8be", color: "#663440", label: "مساعد الذكاء الاصطناعي 🤖" },
    system: { icon: Bot, bg: "#fdf8f0", border: "#e8d8be", color: "#663440", label: "نظام بيوتنا ⚙️" },
    customer: { icon: UserIcon, bg: isMe ? "#f0f7ff" : "#ffffff", border: isMe ? "#bfdbfe" : "#e5e7eb", color: "#1e40af", label: "العميل 👤" },
    seller: { icon: ChefHat, bg: "#fef8f4", border: "#fed7aa", color: "#c2410c", label: "مطبخ الأسرة 👩‍🍳" },
    driver: { icon: Car, bg: "#f0fdf4", border: "#bbf7d0", color: "#15803d", label: "كابتن التوصيل 🚗" },
    admin: { icon: ShieldAlert, bg: "#fdf2f4", border: "#fbcfe8", color: "#9f1239", label: "إدارة المنصة 🛡️" },
  };

  const roleMeta = roleMetaMap[msg.sender_role] || { icon: UserIcon, bg: "#ffffff", border: "#e5e7eb", color: "#333", label: msg.sender_name };

  const IconComp = roleMeta.icon;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isMe ? "flex-start" : "flex-start", marginBottom: 12 }}>
      <div
        style={{
          maxWidth: "85%",
          background: roleMeta.bg,
          border: `1px solid ${roleMeta.border}`,
          borderRadius: 14,
          padding: "10px 14px",
          boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ color: roleMeta.color, display: "flex", alignItems: "center" }}>
            <IconComp size={14} />
          </span>
          <strong style={{ fontSize: 12, color: roleMeta.color }}>
            {msg.sender_name}
          </strong>
          <span style={{ fontSize: 10, color: "#9ca3af", marginRight: "auto" }}>
            {date(msg.created_at)}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "#1f2937", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {msg.content}
        </p>
        {msg.image_url && (
          <div style={{ marginTop: 8 }}>
            <img
              src={msg.image_url}
              alt="صورة مرفقة"
              onClick={() => onOpenImage(msg.image_url!)}
              style={{ maxHeight: 200, maxWidth: "100%", borderRadius: 8, cursor: "pointer", border: "1px solid #ddd" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Styles
const panelCardStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #ebdccb",
  borderRadius: 16,
  boxShadow: "0 4px 20px rgba(102, 52, 64, 0.05)",
  overflow: "hidden",
  marginTop: 24,
  marginBottom: 24,
};

const headerStyle: React.CSSProperties = {
  padding: "16px 20px",
  background: "#fcfaf7",
  borderBottom: "1px solid #f0e6d9",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 10,
};

const livePulseBadge: React.CSSProperties = {
  background: "#ecfdf5",
  color: "#065f46",
  border: "1px solid #a7f3d0",
  fontSize: 11,
  fontWeight: "bold",
  padding: "2px 8px",
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

const participantsBarStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "#f8f6f2",
  borderBottom: "1px solid #eee7de",
  display: "flex",
  gap: 8,
  overflowX: "auto",
  whiteSpace: "nowrap",
};

const participantPill = (role: string): React.CSSProperties => {
  const colors: Record<string, { bg: string; color: string; border: string }> = {
    customer: { bg: "#eff6ff", color: "#1e40af", border: "#bfdbfe" },
    seller: { bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
    driver: { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" },
    admin: { bg: "#fdf2f4", color: "#9f1239", border: "#fbcfe8" },
    ai: { bg: "#fdf8f0", color: "#854d0e", border: "#fef08a" },
  };
  const c = colors[role] || { bg: "#f3f4f6", color: "#374151", border: "#e5e7eb" };
  return {
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 8,
    background: c.bg,
    color: c.color,
    border: `1px solid ${c.border}`,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontWeight: "500",
  };
};

const streamContainerStyle: React.CSSProperties = {
  height: 380,
  overflowY: "auto",
  padding: "16px 20px",
  background: "#faf8f5",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const statusBannerStyle = (isReviewDone: boolean): React.CSSProperties => ({
  background: isReviewDone ? "#fffbeb" : "#fef8f0",
  border: `1px solid ${isReviewDone ? "#fde68a" : "#ebdccb"}`,
  borderRadius: 12,
  padding: "12px 14px",
  margin: "8px 0",
});

const reviewCardPromptStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "2px solid #fde68a",
  borderRadius: 14,
  padding: "16px",
  margin: "12px 0",
  boxShadow: "0 6px 16px rgba(217, 119, 6, 0.08)",
};

const ratingSectionStyle: React.CSSProperties = {
  background: "#f9fafb",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
};

const reviewSummaryCardStyle: React.CSSProperties = {
  background: "#ecfdf5",
  border: "1px solid #a7f3d0",
  borderRadius: 12,
  padding: "12px 14px",
  margin: "8px 0",
};

const inputAreaStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
};

const uploadPhotoBtnStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px dashed #d1d5db",
  padding: "8px 14px",
  borderRadius: 8,
  fontSize: 12,
  color: "#4b5563",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const removePhotoBtnStyle: React.CSSProperties = {
  position: "absolute",
  top: -6,
  right: -6,
  background: "#b91c1c",
  color: "#fff",
  borderRadius: "50%",
  width: 20,
  height: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  cursor: "pointer",
};

const submitReviewBtnStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, #d97706, #b45309)",
  color: "#ffffff",
  padding: "10px 18px",
  borderRadius: 8,
  border: "none",
  fontWeight: "bold",
  fontSize: 14,
  cursor: "pointer",
  boxShadow: "0 2px 8px rgba(217, 119, 6, 0.3)",
};

const quickChipsContainerStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "#ffffff",
  borderTop: "1px solid #f0e6d9",
  display: "flex",
  alignItems: "center",
  gap: 8,
  overflowX: "auto",
  whiteSpace: "nowrap",
};

const chipBtnStyle: React.CSSProperties = {
  background: "#f7f2ea",
  border: "1px solid #e5d8c6",
  borderRadius: 20,
  padding: "4px 10px",
  fontSize: 11,
  color: "#663440",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const inputFormStyle: React.CSSProperties = {
  padding: "12px 16px",
  background: "#ffffff",
  borderTop: "1px solid #ebdccb",
  display: "flex",
  gap: 10,
  alignItems: "center",
};

const attachPhotoBtnStyle: React.CSSProperties = {
  background: "#f7f2ea",
  border: "1px solid #ebdccb",
  color: "#663440",
  borderRadius: 10,
  width: 40,
  height: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const textInputStyle: React.CSSProperties = {
  flex: 1,
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
};

const sendBtnStyle: React.CSSProperties = {
  background: "#663440",
  color: "#ffffff",
  border: "none",
  borderRadius: 10,
  padding: "10px 18px",
  fontSize: 13,
  fontWeight: "bold",
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexShrink: 0,
};

const lightboxOverlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0,0,0,0.75)",
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
};

const lightboxCloseBtnStyle: React.CSSProperties = {
  position: "absolute",
  top: -12,
  right: -12,
  background: "#ffffff",
  border: "none",
  borderRadius: "50%",
  width: 32,
  height: 32,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  color: "#000",
  boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
};
