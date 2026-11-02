"use client";
import { useEffect, useRef, useState } from "react";
import type { Map, CircleMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
export type Point = { latitude: number | null; longitude: number | null };
export function MapPicker({
  value,
  onChange,
}: {
  value: Point;
  onChange: (point: Point) => void;
}) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState("");
  const container = useRef<HTMLDivElement>(null),
    map = useRef<Map | null>(null),
    marker = useRef<CircleMarker | null>(null),
    callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !container.current) return;
      const m = L.map(container.current).setView(
        [value.latitude ?? 17.7336, value.longitude ?? 42.2658],
        13,
      );
      map.current = m;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(m);
      if (value.latitude !== null && value.longitude !== null)
        marker.current = L.circleMarker([value.latitude, value.longitude], {
          radius: 9,
          color: "#663440",
        }).addTo(m);
      m.on("click", (e) => {
        if (marker.current) marker.current.setLatLng(e.latlng);
        else
          marker.current = L.circleMarker(e.latlng, {
            radius: 9,
            color: "#663440",
          }).addTo(m);
        callback.current({
          latitude: Number(e.latlng.lat.toFixed(6)),
          longitude: Number(e.latlng.lng.toFixed(6)),
        });
      });
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, [open]);
  async function locate() {
    setError("");
    if (!navigator.geolocation) {
      setError("تحديد الموقع غير متاح في هذا المتصفح");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const p = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        onChange(p);
        map.current?.setView([p.latitude, p.longitude], 16);
        if (marker.current) marker.current.setLatLng([p.latitude, p.longitude]);
      },
      () => setError("تعذر تحديد الموقع؛ اختره على الخريطة أو أدخل الإحداثيات"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }
  return (
    <div className="form-stack">
      <div className="order-actions">
        <button
          type="button"
          className="text-button"
          onClick={() => setOpen(!open)}
        >
          {open ? "إخفاء الخريطة" : "اختيار الموقع على الخريطة"}
        </button>
        <button type="button" className="text-button" onClick={locate}>
          استخدام موقعي الحالي
        </button>
      </div>
      <p className="hint">
        تحميل خريطة OpenStreetMap اختياري. العنوان النصي مطلوب، والإحداثيات
        تساعد السائق. مركز الخريطة لا يحفظ عنوانًا قبل اختياره.
      </p>
      {open && (
        <div
          ref={container}
          className="address-map"
          aria-label="خريطة تحديد موقع العنوان"
        />
      )}
      <div className="form-row">
        <label>
          خط العرض
          <input
            aria-label="خط العرض"
            type="number"
            step="any"
            min="-90"
            max="90"
            value={value.latitude ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                latitude: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
        </label>
        <label>
          خط الطول
          <input
            aria-label="خط الطول"
            type="number"
            step="any"
            min="-180"
            max="180"
            value={value.longitude ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                longitude:
                  e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
