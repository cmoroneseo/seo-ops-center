import Link from "next/link";
import { Wordmark } from "@/components/landing/wordmark";

export function SiteFooter() {
    return (
        <footer className="border-t border-[#e4e4e7] bg-white">
            <div className="mx-auto flex w-full max-w-[1200px] items-start justify-between gap-6 px-5 py-8 lg:px-0">
                <div>
                    <Wordmark company={false} />
                    <p className="mt-3 text-sm text-[#71717a]">© 2026 Marketing Empire Group</p>
                </div>
                <nav className="flex items-center gap-5 pt-1" aria-label="Legal">
                    <Link href="/privacy" className="inline-flex min-h-11 items-center text-sm text-[#52525b] hover:text-[#18181b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ec4899]">
                        Privacy
                    </Link>
                    <Link href="/terms" className="inline-flex min-h-11 items-center text-sm text-[#52525b] hover:text-[#18181b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ec4899]">
                        Terms
                    </Link>
                </nav>
            </div>
        </footer>
    );
}
