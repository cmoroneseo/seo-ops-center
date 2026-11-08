import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SEO Ops Center | Search data and campaign delivery",
  description: "See how a client is performing, what the campaign is doing next, and what was actually delivered — without a second spreadsheet or a status-chase email.",
  keywords: ["SEO agency workspace", "search performance", "campaign delivery", "Google Search Console", "Google Analytics"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

import { BrandThemeSync } from "@/components/providers/brand-theme";
import { OrganizationProvider } from "@/components/providers/organization-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { SchemaMarkup } from "@/components/seo/schema-markup";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${plusJakartaSans.variable} font-sans antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <OrganizationProvider>
            <BrandThemeSync />
            {children}
            <SchemaMarkup />
          </OrganizationProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
