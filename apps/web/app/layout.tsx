import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { getLocale, getDictionary } from "../lib/i18n/getLocale";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return {
    title: dict.chrome.appTitle,
    description: dict.chrome.appDescription,
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
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Fallback for a first-ever visit with no `fleet-theme` cookie yet (so nothing was
// readable server-side): guesses from the OS preference and writes the cookie so the
// *next* request — including the very next login-redirect navigation — is rendered
// server-side in the right theme instead of guessing again. Runs before paint (blocking
// inline script in <head>) purely to avoid a flash on this one first-visit case; once
// the cookie exists, RootLayout below renders `data-theme` directly from it and this
// script has nothing to do. Also migrates a pre-existing localStorage-only value (from
// before theme was cookie-backed) into the cookie, once.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var COOKIE_RE = /(?:^|; )fleet-theme=(light|dark)/;
    var match = document.cookie.match(COOKIE_RE);
    var theme = match
      ? match[1]
      : (localStorage.getItem("fleet-theme") === "light" || localStorage.getItem("fleet-theme") === "dark")
        ? localStorage.getItem("fleet-theme")
        : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    if (!match) {
      document.cookie = "fleet-theme=" + theme + "; path=/; max-age=31536000; samesite=lax";
    }
    document.documentElement.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#000000" : "#ffffff");
  } catch (e) {}
})();
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("fleet-theme")?.value;
  const theme = themeCookie === "light" || themeCookie === "dark" ? themeCookie : undefined;
  return (
    <html lang={locale} data-theme={theme} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
