import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SEO Project Management Software | SEO Ops Command Center",
  description: "The ultimate SEO project management software for agencies. Prove ROI, track deliverables, and manage clients in one real-time command center.",
  keywords: ["SEO project management software", "agency SEO tool", "SEO ROI tracking", "SEO agency management", "real-time SEO dashboard"],
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
            {children}
            <SchemaMarkup />
          </OrganizationProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
