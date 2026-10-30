"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Truck, MapPin, ArrowLeft } from "lucide-react";
import { api, post, money, date } from "@/lib/api";
import { useStore } from "./provider";
import { CompliancePanel } from "./compliance";
import { Gate, OrderList } from "./account";
type Offer = {
  id: string;
  city: string;
  scheduled_at: string;
  fee: number;
  expires_at: string;
};
export function Driver() {
  return (
    <Gate role="driver">
      <DriverContent />
    </Gate>
  );
}
function DriverContent() {
  const { user, refresh, toast } = useStore(),
    [offers, setOffers] = useState<Offer[]>([]),
    [tab, setTab] = useState("offers"),
    [busy, setBusy] = useState(false);
  function load() {
    api<Offer[]>("/driver/offers")
      .then(setOffers)
      .catch((e) => toast(e.message));
  }
  useEffect(() => {
    if (user?.driver_verified) load();
  }, [user?.available, user?.driver_verified]);
  async function availability() {
    setBusy(true);
    try {
      await post("/driver/availability?available=" + !user?.available);
      await refresh();
      load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container page">
      <Link className="text-link" href="/verification">
        مستندات اعتماد السائق الخاصة
      </Link>
      <p className="hint">
        لمشاركة موقعك أثناء الرحلات وتلقي تنبيهات العروض فورًا، استخدم تطبيق
        أندرويد.
      </p>
      <div className="toolbar">
        <div>
          <span className="overline">من بيتهم، لباب البيت</span>
          <h1>مساحة السائق</h1>
        </div>
        <button
          className="button"
          disabled={busy || !user?.driver_verified}
          onClick={availability}
        >
          {user?.available ? "متاح للرحلات — إيقاف التوفر" : "تفعيل التوفر"}
        </button>
      </div>
      <CompliancePanel />
      {!user?.driver_verified ? (
        <div className="notice">
          حسابك ينتظر مراجعة الإدارة وأهليتك للتوصيل. لا تتوفر عروض أو عناوين
          قبل الاعتماد.
        </div>
      ) : (
        <>
          <p className="notice">
            جميع عروض التوصيل تجريبية. المسافات والأسعار ليست عروضًا من شركة
            توصيل فعلية.
          </p>
          <div className="tabs">
            <button
              className={tab === "offers" ? "selected" : ""}
              onClick={() => setTab("offers")}
            >
              عروض المشاوير
            </button>
            <button
              className={tab === "trips" ? "selected" : ""}
              onClick={() => setTab("trips")}
            >
              رحلاتي وسجل الطلبات
            </button>
          </div>
          {tab === "offers" ? (
            <>
              <button className="text-button" onClick={load}>
                تحديث العروض
              </button>
              <div className="household-grid">
                {offers.map((o) => (
                  <div className="panel" key={o.id}>
                    <span className="overline">مشوار #{o.id.slice(0, 8)}</span>
                    <h2>
                      <MapPin size={22} />
                      {o.city}
                    </h2>
                    <p>الموعد: {date(o.scheduled_at)}</p>
                    <p>العرض متاح إلى {date(o.expires_at)}</p>
                    <strong>{money(o.fee)} ر.س أجرة معلنة تجريبية</strong>
                    <p className="hint">
                      التفاصيل الدقيقة تظهر بعد قبول المشوار.
                    </p>
                    <button
                      className="button"
                      onClick={async () => {
                        try {
                          await post("/driver/offers/" + o.id + "/accept");
                          toast("تم قبول المشوار");
                          load();
                          setTab("trips");
                        } catch (e) {
                          toast((e as Error).message);
                          load();
                        }
                      }}
                    >
                      قبول المشوار <ArrowLeft size={17} />
                    </button>
                    <button
                      className="text-button"
                      onClick={async () => {
                        try {
                          await post("/driver/offers/" + o.id + "/reject");
                          load();
                          toast(
                            "تم رفض العرض دون التأثير على السائقين الآخرين",
                          );
                        } catch (e) {
                          toast((e as Error).message);
                        }
                      }}
                    >
                      رفض العرض
                    </button>
                  </div>
                ))}
              </div>
              {!offers.length && (
                <div className="empty">
                  <Truck size={45} />
                  <h2>
                    {user.available
                      ? "بانتظار رحلة مناسبة"
                      : "فعّل توفرك لاستقبال العروض"}
                  </h2>
                  <p>ستظهر الطلبات الجاهزة التي لم تُسند بعد.</p>
                </div>
              )}
            </>
          ) : (
            <OrderList embedded />
          )}
        </>
      )}
    </div>
  );
}
