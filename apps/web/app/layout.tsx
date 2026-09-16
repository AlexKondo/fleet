import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getLocale } from "../lib/i18n/getLocale";

export const metadata: Metadata = {
  title: "Fleet — Painel de Frota",
  description: "Right Vehicle. Right Trip. Right Time. Ready to Go.",
  // A PWA in the sense this product needs: the same responsive web app, installable to
  // a phone's home screen via the browser (no native Android/iOS app, no app store) —
  // camera capture in the checklist forms already goes through the browser's own
  // `<input type="file" capture>`, not a native API.
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Fleet",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Runs before paint (blocking inline script in <head>) so the correct theme is applied
// on first render — avoids a flash of the wrong theme. Reads the persisted choice from
// localStorage, falling back to the OS preference (prefers-color-scheme) when unset.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("fleet-theme");
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#000000" : "#ffffff");
  } catch (e) {}
})();
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
