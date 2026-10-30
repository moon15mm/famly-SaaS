import type { Metadata } from "next";
import localFont from "next/font/local";
import { Provider } from "@/components/provider";
import { Header, Footer } from "@/components/shell";
import "./globals.css";
const tajawal = localFont({
  src: [
    {
      path: "../public/fonts/tajawal-regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/tajawal-bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-tajawal",
  display: "optional",
  fallback: ["Arial"],
  adjustFontFallback: "Arial",
  preload: true,
});
export const metadata: Metadata = {
  title: {
    default: "من بيوتنا | أشياء جميلة، صُنعت بحب",
    template: "%s | من بيوتنا",
  },
  description:
    "اكتشف منتجات الأسر السعودية من المأكولات المنزلية والحلويات إلى الحرف والعطور والهدايا.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" className={tajawal.variable}>
      <body>
        <Provider>
          <a className="skip" href="#main">
            انتقل إلى المحتوى
          </a>
          <Header />
          <main id="main">{children}</main>
          <Footer />
        </Provider>
      </body>
    </html>
  );
}
