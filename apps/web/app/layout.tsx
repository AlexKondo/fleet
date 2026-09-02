import type { Metadata } from "next";
import { Big_Shoulders, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const bigShoulders = Big_Shoulders({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-big-shoulders",
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-sans",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
});

export const metadata: Metadata = {
  title: "Fleet — Painel de Frota",
  description: "Right Vehicle. Right Trip. Right Time. Ready to Go.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${bigShoulders.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
