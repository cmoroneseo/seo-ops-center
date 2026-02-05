import { SiteHeader } from "@/components/landing/site-header";
import Link from "next/link";

export default function MarketingLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-screen bg-black selection:bg-primary/30">
            <SiteHeader />
            <main>{children}</main>
            <footer className="py-8 border-t border-white/5 bg-black/50 backdrop-blur-xl">
                <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between text-sm text-white/40">
                    <div>© 2024 SEO Ops Center. All rights reserved.</div>
                    <div className="flex gap-6 mt-4 md:mt-0">
                        <Link href="/privacy" className="hover:text-white transition-colors text-xs">Privacy</Link>
                        <Link href="/terms" className="hover:text-white transition-colors text-xs">Terms</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}
