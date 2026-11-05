"use client";
import { useEffect, useRef } from "react";
import type { Map } from "leaflet";
import "leaflet/dist/leaflet.css";

export function PickupMap({
  latitude,
  longitude,
  householdName,
  address,
}: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  householdName: string;
  address?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);

  const lat = latitude ?? 17.7285;
  const lng = longitude ?? 42.2530;

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !container.current || map.current) return;
      const m = L.map(container.current).setView([lat, lng], 15);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(m);

      const marker = L.circleMarker([lat, lng], {
        radius: 11,
        color: "#663440",
        fillColor: "#b91c1c",
        fillOpacity: 0.9,
        weight: 3,
      }).addTo(m);

      marker.bindPopup(
        `<div style="text-align: right; direction: rtl; font-family: inherit; font-size: 14px; line-height: 1.5;">
          <strong style="color: #663440; font-size: 15px;">📍 ${householdName}</strong><br/>
          <span style="color: #444;">${address || "الدرب - مقر الأسرة"}</span>
        </div>`
      ).openPopup();

      map.current = m;
    });

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, [lat, lng, householdName, address]);

  return (
    <div
      ref={container}
      style={{
        height: "280px",
        width: "100%",
        borderRadius: "8px",
        overflow: "hidden",
        border: "1px solid #ddd",
        position: "relative",
        zIndex: 1,
      }}
    />
  );
}
