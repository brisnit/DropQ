import type { Metadata } from "next";
import { Arvo, Google_Sans_Flex } from "next/font/google";
import "./globals.css";

// Primary / display font
const arvo = Arvo({
  variable: "--font-arvo",
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
});

// Secondary / body font
const googleSans = Google_Sans_Flex({
  variable: "--font-google-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "DropQ — The operating system for modern food businesses",
  description:
    "Sell food online, run drops, manage orders, and grow recurring revenue. One platform built for bakers, cottage food makers, meal preppers, and food creators.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${arvo.variable} ${googleSans.variable} h-full`}>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
