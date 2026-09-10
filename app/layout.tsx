import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { site } from "@/lib/site";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Chatbot from "@/components/Chatbot";
import MobileBar from "@/components/MobileBar";
import PageTransition from "@/components/PageTransition";
import { CartProvider } from "@/lib/cart";
import CartFab from "@/components/CartFab";

// Soft old-style serif for headings and dish names — reads hand-set,
// like a recipe handed down. Paired with a plain, warm grotesque for
// menus, hours and forms.
const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-heading",
  display: "swap",
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — home-style South & North Indian food`,
    template: `%s — ${site.name}`,
  },
  description: site.blurb,
  openGraph: {
    title: site.name,
    description: site.blurb,
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${fraunces.variable} ${hanken.variable}`}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <CartProvider>
          <Header />
          <main id="main">
            <PageTransition>{children}</PageTransition>
          </main>
          <Footer />
          <MobileBar />
          <CartFab />
          <Chatbot />
        </CartProvider>
      </body>
    </html>
  );
}
