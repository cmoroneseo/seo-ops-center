import Image from "next/image";
import { ProductShot } from "@/components/landing/product-shot";

const demoCaption = "Demo workspace · fictional client data";
const campaignCaption = "Roadmap and Results tabs · demo workspace · fictional client data";

function Eyebrow({ children }: { children: string }) {
    return (
        <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#ec4899]">
            {children}
        </p>
    );
}

export function Features() {
    return (
        <div>
            <section id="performance" className="scroll-mt-20 py-20 md:py-28">
                <div className="mx-auto grid w-full max-w-[1200px] items-center gap-10 px-5 md:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] md:gap-12 lg:px-0">
                    <div>
                        <Eyebrow>Performance</Eyebrow>
                        <h2 className="mt-3 text-[32px] font-bold leading-[1.1] tracking-[-0.025em] text-[#18181b] md:text-[40px]">
                            A live view of search performance
                        </h2>
                        <p className="mt-4 max-w-[420px] text-[16px] leading-relaxed text-[#52525b] md:text-[17px]">
                            Overview brings Google Search Console and Google Analytics into the client workspace, with the date window and source in view.
                        </p>
                    </div>
                    <ProductShot
                        desktopSrc="/marketing/summit-overview.png"
                        desktopWidth={824}
                        desktopHeight={589}
                        mobileSrc="/marketing/summit-overview-mobile.png"
                        mobileWidth={378}
                        mobileHeight={394}
                        alt="Demo workspace, fictional client data. Summit Dental search performance overview."
                        caption={demoCaption}
                    />
                </div>
            </section>

            <section className="pb-20 md:pb-28">
                <div className="mx-auto w-full max-w-[1200px] px-5 lg:px-0">
                    <div className="grid items-end gap-6 md:grid-cols-2 md:gap-16">
                        <div>
                            <Eyebrow>Campaign</Eyebrow>
                            <h2 className="mt-3 text-[32px] font-bold leading-[1.1] tracking-[-0.025em] text-[#18181b] md:text-[40px]">
                                A campaign view your team can actually share
                            </h2>
                        </div>
                        <div className="md:pb-1">
                            <p className="text-[16px] leading-relaxed text-[#52525b] md:text-[17px]">
                                Scope, next milestone, blockers that need a client, and results with a visible baseline. Missing data stays "Not yet measurable" — never a fake zero.
                            </p>
                            <p className="mt-4 text-[14px] font-semibold text-[#18181b]">
                                Overview · Roadmap · Results
                            </p>
                        </div>
                    </div>

                    <div className="mt-10 md:mt-12">
                        <figure>
                            <Image
                                src="/marketing/summit-roadmap-results.png"
                                alt="Demo workspace, fictional client data. Summit Dental campaign roadmap with the results card. Roadmap and Results tabs."
                                width={1236}
                                height={886}
                                sizes="(min-width: 768px) 1200px, 100vw"
                                className="hidden h-auto w-full md:block"
                            />
                            <figcaption className="sr-only max-md:hidden">{campaignCaption}</figcaption>
                        </figure>
                        <div className="md:hidden">
                            <Image
                                src="/marketing/summit-roadmap-mobile.png"
                                alt="Demo workspace, fictional client data. Summit Dental campaign roadmap."
                                width={378}
                                height={258}
                                sizes="100vw"
                                className="h-auto w-full"
                            />
                            <p className="my-3 text-center text-[13px] text-[#71717a]">{campaignCaption}</p>
                            <Image
                                src="/marketing/summit-results-mobile.png"
                                alt="Demo workspace, fictional client data. Summit Dental results, including the baseline, Measuring, and Not yet measurable."
                                width={374}
                                height={314}
                                sizes="100vw"
                                className="h-auto w-full"
                            />
                        </div>
                    </div>
                </div>
            </section>

            <section className="pb-20 md:pb-28">
                <div className="mx-auto grid w-full max-w-[1200px] items-center gap-10 px-5 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:gap-12 lg:px-0">
                    <div className="order-1 md:order-2">
                        <Eyebrow>Delivery</Eyebrow>
                        <h2 className="mt-3 text-[32px] font-bold leading-[1.1] tracking-[-0.025em] text-[#18181b] md:text-[40px]">
                            Delivery stays on the same account
                        </h2>
                        <p className="mt-4 text-[16px] leading-relaxed text-[#52525b] md:text-[17px]">
                            SEO Plan and Tasks live beside performance — this month's work, onboarding checklists, and owners — so status isn't trapped in a side spreadsheet.
                        </p>
                    </div>
                    <div className="order-2 md:order-1">
                        <ProductShot
                            desktopSrc="/marketing/summit-tasks.png"
                            desktopWidth={826}
                            desktopHeight={568}
                            mobileSrc="/marketing/summit-tasks-mobile.png"
                            mobileWidth={378}
                            mobileHeight={350}
                            alt="Demo workspace, fictional client data. Summit Dental tasks."
                            caption={demoCaption}
                        />
                    </div>
                </div>
            </section>
        </div>
    );
}
