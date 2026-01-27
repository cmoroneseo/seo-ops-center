"use client";

import { Check, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

const tiers = [
    {
        name: "Starter",
        price: "49",
        description: "Perfect for freelancers and solo-agency owners.",
        features: [
            "Up to 3 Clients",
            "1 User Account",
            "Basic SEO Dashboard",
            "Kanban Task Board",
            "Manual Reports",
            "Community Support"
        ],
        cta: "Start Free Trial",
        highlighted: false
    },
    {
        name: "Pro",
        price: "199",
        description: "Ideal for growing boutique agencies.",
        features: [
            "Up to 15 Clients",
            "5 User Accounts",
            "AI Insights (20/mo)",
            "Time Tracking",
            "Client Portal",
            "Email Support"
        ],
        cta: "Scale Now",
        highlighted: true
    },
    {
        name: "Agency",
        price: "499",
        description: "For established agencies scaling fast.",
        features: [
            "Up to 50 Clients",
            "Unlimited Users",
            "Unlimited AI Reports",
            "White-labeling",
            "Custom Branding",
            "Priority Support"
        ],
        cta: "Go Unlimited",
        highlighted: false
    },
    {
        name: "Enterprise",
        price: "Custom",
        description: "Complex needs? We've got you covered.",
        features: [
            "50+ Clients",
            "Custom API Access",
            "SLA Guarantees",
            "Dedicated Account Manager",
            "Onboarding Training",
            "Security Review"
        ],
        cta: "Contact Sales",
        highlighted: false
    }
];

export function Pricing() {
    return (
        <section id="pricing" className="py-24 relative overflow-hidden bg-black">
            {/* Background elements */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full max-w-7xl pointer-events-none opacity-10">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary rounded-full blur-[128px]" />
                <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-accent rounded-full blur-[128px]" />
            </div>

            <div className="container mx-auto px-4 relative z-10">
                <div className="text-center max-w-3xl mx-auto mb-20">
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
                        Transparent Pricing for <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">Scalable Growth</span>
                    </h2>
                    <p className="text-lg text-white/60">
                        Choose the plan that fits your agency today and scale seamlessly as you grow.
                        No hidden fees, just value.
                    </p>
                </div>

                <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-8">
                    {tiers.map((tier, index) => (
                        <div
                            key={index}
                            className={`relative flex flex-col p-8 rounded-2xl border transition-all duration-300 ${tier.highlighted
                                ? "bg-white/5 border-primary shadow-[0_0_40px_-15px_rgba(var(--primary-rgb),0.3)] scale-105 z-20"
                                : "bg-zinc-900/50 border-white/5 hover:border-white/10"
                                }`}
                        >
                            {tier.highlighted && (
                                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-primary text-black text-[10px] uppercase font-bold tracking-widest py-1 px-3 rounded-full flex items-center gap-1">
                                    <Zap className="h-3 w-3 fill-current" />
                                    Most Popular
                                </div>
                            )}

                            <div className="mb-8">
                                <h3 className="text-xl font-bold text-white mb-2">{tier.name}</h3>
                                <div className="flex items-baseline gap-1 mb-4">
                                    <span className="text-4xl font-bold text-white">
                                        {tier.price === "Custom" ? "" : "$"}
                                        {tier.price}
                                    </span>
                                    {tier.price !== "Custom" && <span className="text-white/40">/month</span>}
                                </div>
                                <p className="text-sm text-white/60 leading-relaxed">
                                    {tier.description}
                                </p>
                            </div>

                            <div className="space-y-4 mb-10 flex-grow">
                                {tier.features.map((feature, fIndex) => (
                                    <div key={fIndex} className="flex gap-3 items-start">
                                        <div className={`mt-1 h-4 w-4 rounded-full flex items-center justify-center shrink-0 ${tier.highlighted ? "bg-primary/20" : "bg-white/5"}`}>
                                            <Check className={`h-3 w-3 ${tier.highlighted ? "text-primary" : "text-white/40"}`} />
                                        </div>
                                        <span className="text-sm text-white/80">{feature}</span>
                                    </div>
                                ))}
                            </div>

                            <Button
                                asChild
                                variant={tier.highlighted ? "default" : "outline"}
                                className={`w-full py-6 rounded-xl font-bold transition-all ${tier.highlighted
                                    ? "bg-primary text-black hover:bg-primary/90"
                                    : "border-white/10 bg-white/5 text-white hover:bg-white/10"
                                    }`}
                            >
                                <Link href="/signup">{tier.cta}</Link>
                            </Button>
                        </div>
                    ))}
                </div>

                <div className="mt-20 text-center">
                    <p className="text-white/40 text-sm">
                        All plans include a 14-day free trial. No credit card required to start.
                    </p>
                </div>
            </div>
        </section>
    );
}
