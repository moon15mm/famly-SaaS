import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "msedge", headless: true });
for (const [mode, width, height] of [
  ["desktop", 1440, 1000],
  ["mobile", 390, 844],
]) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `../reports/home-${mode}.png`,
    fullPage: true,
  });
  await page.close();
}
await browser.close();
console.log("Final storefront screenshots captured.");
