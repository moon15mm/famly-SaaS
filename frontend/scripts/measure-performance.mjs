import { chromium } from "@playwright/test";
import fs from "node:fs";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
for (const mode of [
  "desktop-local",
  "desktop-local",
  "desktop-local",
  "mobile-simulated",
  "mobile-simulated",
  "mobile-simulated",
]) {
  const context = await browser.newContext({
    viewport:
      mode === "desktop-local"
        ? { width: 1440, height: 1000 }
        : { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__metrics = {
      lcp: 0,
      cls: 0,
      interaction: 0,
      shifts: [],
      windowValue: 0,
      firstShift: 0,
      lastShift: 0,
    };
    new PerformanceObserver((list) => {
      for (const item of list.getEntries())
        window.__metrics.lcp = item.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const item of list.getEntries())
        if (!item.hadRecentInput) {
          const m = window.__metrics;
          if (
            item.startTime - m.lastShift < 1000 &&
            item.startTime - m.firstShift < 5000
          )
            m.windowValue += item.value;
          else {
            m.windowValue = item.value;
            m.firstShift = item.startTime;
          }
          m.lastShift = item.startTime;
          m.cls = Math.max(m.cls, m.windowValue);
          window.__metrics.shifts.push({
            value: item.value,
            sources: item.sources?.map((x) => ({
              element: x.node?.tagName,
              className: String(x.node?.className || ""),
              before: { y: x.previousRect.y, height: x.previousRect.height },
              after: { y: x.currentRect.y, height: x.currentRect.height },
            })),
          });
        }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const item of list.getEntries())
        if (item.interactionId)
          window.__metrics.interaction = Math.max(
            window.__metrics.interaction,
            item.duration,
          );
    }).observe({ type: "event", buffered: true, durationThreshold: 16 });
  });
  if (mode === "mobile-simulated") {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: 200000,
      uploadThroughput: 93750,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".add-button").first().click();
  await page.waitForTimeout(500);
  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      ...window.__metrics,
      ttfb: nav.responseStart - nav.requestStart,
      domContentLoaded: nav.domContentLoadedEventEnd,
      transferBytes: performance
        .getEntriesByType("resource")
        .reduce((sum, x) => sum + x.transferSize, 0),
    };
  });
  results.push({
    mode,
    conditions:
      mode === "desktop-local"
        ? "Local loopback; unthrottled; fresh browser context; server image cache not flushed"
        : "Local loopback; 390x844; CPU 4x slowdown; 150ms latency; 1.6Mbps download; server image cache not flushed",
    lcp_ms: Math.round(metrics.lcp),
    cls: Number(metrics.cls.toFixed(4)),
    observed_interaction_ms: metrics.interaction,
    ttfb_ms: Math.round(metrics.ttfb),
    dom_content_loaded_ms: Math.round(metrics.domContentLoaded),
    transfer_bytes: metrics.transferBytes,
    layout_shifts: metrics.shifts,
  });
  await context.close();
}
await browser.close();
const report = {
  node_version: process.version,
  generated_at: new Date().toISOString(),
  browser: "Microsoft Edge / Playwright",
  samples_per_mode: 3,
  results,
  limits:
    "Lab samples only. observed_interaction_ms is one observed interaction, not field INP. No Lighthouse or real-user data. Not a guarantee of Core Web Vitals targets on production.",
};
fs.writeFileSync(
  "../reports/performance.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
