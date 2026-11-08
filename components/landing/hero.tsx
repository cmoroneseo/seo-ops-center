import Link from "next/link";
import { ProductShot } from "@/components/landing/product-shot";

const demoCaption = "Demo workspace · fictional client data";

export function Hero() {
    return (
        <section className="relative overflow-hidden pb-16 pt-14 md:pb-24 md:pt-20">
            <div
                className="pointer-events-none absolute inset-x-0 top-0 h-[780px] bg-[radial-gradient(ellipse_at_center,_#fdf2f8_0%,_rgba(255,255,255,0)_68%)]"
                aria-hidden="true"
            />
            <div className="relative mx-auto w-full max-w-[1200px] px-5 lg:px-0">
                <div className="mx-auto max-w-[760px] text-left md:text-center">
                    <p className="mb-6 inline-flex items-center rounded-full bg-[#fdf2f8] px-3 py-1 text-[12px] font-bold uppercase tracking-[0.14em] text-[#ec4899]">
                        For SEO agencies
                    </p>
                    <h1 className="text-[36px] font-bold leading-[1.08] tracking-[-0.025em] text-[#18181b] md:text-[56px] md:leading-[1.05]">
                        Search data and campaign delivery, together.
                    </h1>
                    <p className="mt-5 text-[16px] leading-relaxed text-[#52525b] md:text-[18px]">
                        See how a client is performing, what the campaign is doing next, and what was actually delivered — without a second spreadsheet or a status-chase email.
                    </p>
                    <div className="mt-8 flex flex-col items-stretch justify-center gap-4 sm:flex-row sm:items-center">
                        <Link
                            href="/signup"
                            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#ec4899] px-6 text-[15px] font-semibold text-white hover:bg-[#db2777] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ec4899] sm:w-auto"
                        >
                            Start 14-day free trial
                        </Link>
                        <Link
                            href="/login"
                            className="inline-flex min-h-11 items-center justify-center self-center rounded-md px-2 text-[15px] font-semibold text-[#18181b] hover:text-[#ec4899] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ec4899] sm:self-auto"
                        >
                            Sign in →
                        </Link>
                    </div>
                </div>

                <div className="mt-12 md:mt-16">
                    <ProductShot
                        desktopSrc="/marketing/summit-campaign-overview.png"
                        desktopWidth={1202}
                        desktopHeight={797}
                        mobileSrc="/marketing/summit-campaign-overview-mobile.png"
                        mobileWidth={378}
                        mobileHeight={324}
                        alt="Demo workspace, fictional client data. Summit Dental campaign overview."
                        caption={demoCaption}
                        priority
                    />
                </div>
            </div>
        </section>
    );
}
