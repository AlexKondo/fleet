import type { Metadata, Viewport } from "next";
import "./globals.css";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
