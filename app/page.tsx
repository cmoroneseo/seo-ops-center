import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SiteHeader } from "@/components/landing/site-header";
import { Hero } from "@/components/landing/hero";
import { Story } from "@/components/landing/story";
import { Features } from "@/components/landing/features";
import { Pricing } from "@/components/landing/pricing";
import { CTA } from "@/components/landing/cta";
import { SiteFooter } from "@/components/landing/site-footer";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
    title: "SEO Ops Center | Search data and campaign delivery",
    description: "See how a client is performing, what the campaign is doing next, and what was actually delivered — without a second spreadsheet or a status-chase email.",
    keywords: [
        "SEO agency workspace",
        "search performance",
        "campaign delivery",
        "Google Search Console",
        "Google Analytics",
    ],
};

export default function LandingPage() {
    return (
        <div className={`${inter.className} min-h-screen bg-white text-[#18181b] selection:bg-[#fbcfe8]`} style={{ colorScheme: "light" }}>
            <SiteHeader />
            <main>
                <Hero />
                <Story />
                <Features />
                <Pricing />
                <CTA />
            </main>
            <SiteFooter />
        </div>
    );
}
