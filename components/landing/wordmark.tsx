import Link from "next/link";

export function Wordmark({ href = "/", company = true }: { href?: string; company?: boolean }) {
    return (
        <Link href={href} className="flex items-center gap-2.5 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ec4899]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#ec4899] text-sm font-bold text-white" aria-hidden="true">
                A
            </span>
            <span className="leading-tight">
                <span className="block text-[15px] font-bold tracking-tight text-[#18181b]">SEO Ops Center</span>
                {company && <span className="block text-[11px] font-medium text-[#71717a]">Marketing Empire Group</span>}
            </span>
        </Link>
    );
}
