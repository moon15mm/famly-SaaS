"use client";
import { useEffect, useRef, useState } from "react";
import type { Map, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";
import { api, date } from "@/lib/api";
type Point = { latitude: number; longitude: number };
type Tracking = {
  status: string;
  driver:
    | (Point & { accuracy: number | null; updated_at: string; stale: boolean })
    | null;
  pickup: Point | null;
  dropoff: Point | null;
};
export function DriverMap({ orderId }: { orderId: string }) {
  const [tracking, setTracking] = useState<Tracking | null>(null),
    [error, setError] = useState("");
  const container = useRef<HTMLDivElement>(null),
    map = useRef<Map | null>(null),
    layer = useRef<LayerGroup | null>(null),
    leaflet = useRef<typeof import("leaflet") | null>(null),
    latest = useRef<Tracking | null>(null),
    fitted = useRef(false);
  function draw() {
    const L = leaflet.current,
      m = map.current,
      group = layer.current,
      t = latest.current;
    if (!L || !m || !group || !t) return;
    group.clearLayers();
    const points: [number, number][] = [];
    const mark = (p: Point | null, color: string, label: string) => {
      if (!p) return;
      L.circleMarker([p.latitude, p.longitude], {
        radius: label === "السائق" ? 11 : 8,
        color,
        fillColor: color,
        fillOpacity: 0.85,
      })
        .bindTooltip(label)
        .addTo(group);
      points.push([p.latitude, p.longitude]);
    };
    mark(t.pickup, "#663440", "موقع الاستلام");
    mark(t.dropoff, "#2e6b4f", "موقع التسليم");
    mark(t.driver, "#1d5fa8", "السائق");
    if (points.length && !fitted.current) {
      fitted.current = true;
      if (points.length === 1) m.setView(points[0], 15);
      else m.fitBounds(points, { padding: [30, 30] });
    } else if (
      t.driver &&
      !m.getBounds().contains([t.driver.latitude, t.driver.longitude])
    )
      m.panTo([t.driver.latitude, t.driver.longitude]);
  }
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const next = await api<Tracking>(
          "/orders/" + orderId + "/driver-location",
        );
        if (!active) return;
        latest.current = next;
        setTracking(next);
        setError("");
        draw();
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    }
    load();
    const timer = setInterval(load, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [orderId]);
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !container.current || map.current) return;
      leaflet.current = L;
      const m = L.map(container.current).setView([17.7336, 42.2658], 13);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(m);
      map.current = m;
      layer.current = L.layerGroup().addTo(m);
      draw();
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      layer.current = null;
      fitted.current = false;
    };
  }, []);
  const driver = tracking?.driver;
  return (
    <section className="panel form-stack section" aria-label="موقع السائق">
      <h2>موقع السائق الآن</h2>
      <div ref={container} className="address-map" />
      <p className="hint" role="status">
        {error
          ? error
          : !driver
            ? "بانتظار أول تحديث لموقع السائق من التطبيق."
            : driver.stale
              ? "آخر موقع وصل " +
                date(driver.updated_at) +
                "؛ قد يكون اتصال السائق ضعيفًا."
              : "آخر تحديث " +
                date(driver.updated_at) +
                "، ويتحدث تلقائيًا كل 10 ثوانٍ."}
      </p>
      <p className="hint">
        يظهر الموقع من قبول السائق للمشوار حتى التسليم فقط. الخريطة من
        OpenStreetMap.
      </p>
    </section>
  );
}
