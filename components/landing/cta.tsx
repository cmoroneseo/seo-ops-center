import Link from "next/link";

export function CTA() {
    return (
        <section className="px-5 pb-8 md:pb-12">
            <div className="mx-auto w-full max-w-[1200px] rounded-[28px] border border-[#fbcfe8] bg-[#fdf2f8] px-6 py-16 text-center md:py-20">
                <h2 className="text-[32px] font-bold tracking-[-0.025em] text-[#18181b] md:text-[40px]">
                    Start with one client workspace.
                </h2>
                <p className="mt-3 text-[16px] text-[#52525b]">14-day free trial. No waitlist.</p>
                <Link
                    href="/signup"
                    className="mt-8 inline-flex min-h-11 items-center justify-center rounded-full bg-[#ec4899] px-6 text-[15px] font-semibold text-white hover:bg-[#db2777] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ec4899]"
                >
                    Start free trial
                </Link>
            </div>
        </section>
    );
}
