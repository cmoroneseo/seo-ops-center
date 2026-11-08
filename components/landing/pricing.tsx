import Link from "next/link";
import { Check } from "lucide-react";
import { pricingTiers, pricingTrialLine } from "@/lib/landing/pricing";

export function Pricing() {
    return (
        <section id="pricing" className="scroll-mt-20 border-t border-[#f4f4f5] py-20 md:py-28">
            <div className="mx-auto w-full max-w-[1200px] px-5 lg:px-0">
                <div className="mx-auto mb-12 max-w-2xl text-center md:mb-14">
                    <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#ec4899]">Pricing</p>
                    <h2 className="mt-3 text-[36px] font-bold tracking-[-0.025em] text-[#18181b] md:text-[40px]">
                        Pricing
                    </h2>
                    <p className="mt-3 text-[16px] text-[#52525b]">{pricingTrialLine}</p>
                </div>

                <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {pricingTiers.map((tier) => (
                        <article
                            key={tier.name}
                            className={`flex flex-col rounded-2xl bg-white p-6 ${tier.highlighted ? "border-2 border-[#ec4899]" : "border border-[#e4e4e7]"}`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <h3 className="text-lg font-bold text-[#18181b]">{tier.name}</h3>
                                {tier.highlighted && (
                                    <span className="shrink-0 rounded-full bg-[#fdf2f8] px-2.5 py-1 text-[11px] font-semibold text-[#ec4899]">
                                        Most popular
                                    </span>
                                )}
                            </div>
                            <p className="mt-2 min-h-10 text-sm leading-snug text-[#71717a]">{tier.description}</p>
                            <p className="mt-4 flex items-baseline gap-1">
                                <span className="text-[40px] font-bold leading-none tracking-[-0.03em] text-[#18181b]">
                                    {tier.price === "Custom" ? tier.price : `$${tier.price}`}
                                </span>
                                {tier.period && <span className="text-sm text-[#71717a]">{tier.period}</span>}
                            </p>
                            <Link
                                href={tier.href}
                                className={`mt-5 inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ec4899] ${tier.highlighted ? "bg-[#ec4899] text-white hover:bg-[#db2777]" : "border border-[#e4e4e7] bg-white text-[#18181b] hover:bg-[#fafafa]"}`}
                            >
                                {tier.cta}
                            </Link>
                            <ul className="mt-5 space-y-3 border-t border-[#f4f4f5] pt-5">
                                {tier.features.map((feature) => (
                                    <li key={feature} className="flex items-start gap-2 text-sm text-[#3f3f46]">
                                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#ec4899]" aria-hidden="true" />
                                        <span>{feature}</span>
                                    </li>
                                ))}
                            </ul>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
}
