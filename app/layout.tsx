import type { Metadata } from "next";
import { Varela_Round, Google_Sans_Flex, Allerta_Stencil } from "next/font/google";
import "./globals.css";
import { PageView } from "@/components/analytics/page-view";
import { analyticsMode } from "@/lib/analytics-identity";

// Primary / display font (single weight 400 — bold is synthesized)
const varela = Varela_Round({
  variable: "--font-varela",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

// Secondary / body font
const googleSans = Google_Sans_Flex({
  variable: "--font-google-sans",
  subsets: ["latin"],
  display: "swap",
});

// Stencil face for countdown digits (the drop "closes in" callout)
const allertaStencil = Allerta_Stencil({
  variable: "--font-allerta-stencil",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const TAGLINE = "The operating system for modern product drops.";
const SHARE_DESCRIPTION =
  "Sell online, run timed drops, manage orders, and grow recurring revenue. One platform for food makers, collectors, designers, artists — every kind of seller.";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.drop-q.com"),
  title: `DropQ — ${TAGLINE}`,
  description: SHARE_DESCRIPTION,
  openGraph: {
    title: TAGLINE,
    description: SHARE_DESCRIPTION,
    url: "https://www.drop-q.com",
    siteName: "DropQ",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TAGLINE,
    description: SHARE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${varela.variable} ${googleSans.variable} ${allertaStencil.variable} h-full`}>
      <body className="min-h-full antialiased">
        {children}
        {/* Reports page_viewed on public pages. `enabled` is decided here, on
            the server, from ANALYTICS_MODE — off everywhere today, so this
            currently renders a component that does nothing at all. */}
        <PageView enabled={analyticsMode() !== "off"} />
      </body>
    </html>
  );
}
