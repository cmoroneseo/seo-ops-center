"use client";

import { LayoutDashboard, LineChart, ShieldCheck, ArrowRight } from "lucide-react";
import { motion, useScroll, useTransform, useInView } from "framer-motion";
import { useRef } from "react";

const features = [
    {
        icon: LayoutDashboard,
        title: "Agency-Grade Workspace",
        description: "Manage 50+ clients without keeping 50 tabs open. Switch contexts instantly and never miss a deadline.",
        color: "from-blue-500 to-cyan-500"
    },
    {
        icon: LineChart,
        title: "Live ROI Tracking",
        description: "Connect GA4, GSC, and ranking data into a single view that shows clients exactly how much money you made them.",
        color: "from-primary to-accent"
    },
    {
        icon: ShieldCheck,
        title: "Client Retention Radar",
        description: "AI that flags at-risk accounts based on engagement and performance drops, before they send the cancellation email.",
        color: "from-green-500 to-emerald-500"
    }
];

export function Features() {
    const containerRef = useRef<HTMLDivElement>(null);
    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ["start end", "end start"]
    });

    return (
        <section ref={containerRef} id="features" className="relative py-24 bg-background">
            <div className="container mx-auto px-4">
                <div className="flex flex-col lg:flex-row gap-16 lg:items-start">
                    {/* Left: Scrolling Content */}
                    <div className="lg:w-1/2 space-y-32 py-20">
                        <div className="max-w-xl">
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                className="inline-block text-primary font-bold mb-4 tracking-wider text-sm uppercase"
                            >
                                Optimized for Agencies
                            </motion.div>
                            <motion.h2
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: 0.1 }}
                                className="text-4xl md:text-6xl font-bold text-foreground mb-6"
                            >
                                Scale Your SEO Agency <br />
                                <span className="text-muted-foreground/40">Without the Chaos</span>
                            </motion.h2>
                        </div>

                        {features.map((feature, index) => (
                            <FeatureCard key={index} feature={feature} index={index} />
                        ))}
                    </div>

                    {/* Right: Sticky Visuals */}
                    <div className="hidden lg:block lg:w-1/2 sticky top-32 h-[600px] rounded-3xl overflow-hidden border border-border bg-card shadow-2xl">
                        <div className="absolute inset-0 bg-gradient-to-br from-background via-card/50 to-background" />

                        {/* Dynamic Dashboard Representation */}
                        <div className="relative h-full w-full p-8 flex flex-col gap-6">
                            <div className="flex items-center justify-between border-b border-border pb-6">
                                <div className="space-y-2">
                                    <div className="h-2 w-32 bg-muted rounded-full" />
                                    <div className="h-4 w-48 bg-muted-foreground/10 rounded-full" />
                                </div>
                                <div className="h-10 w-10 rounded-full bg-muted" />
                            </div>

                            <div className="grid grid-cols-3 gap-6">
                                {[0, 1, 2].map((i) => (
                                    <VisualCard key={i} index={i} scrollYProgress={scrollYProgress} />
                                ))}
                            </div>

                            <motion.div
                                className="flex-1 rounded-2xl bg-muted/20 border border-border/50 p-6 flex flex-col justify-end gap-4 overflow-hidden relative"
                            >
                                <motion.div
                                    style={{
                                        height: useTransform(scrollYProgress, [0, 0.4, 0.7, 1], ["20%", "60%", "80%", "40%"]),
                                        background: useTransform(scrollYProgress,
                                            [0, 0.5, 1],
                                            ["rgba(59, 130, 246, 0.2)", "rgba(255, 0, 128, 0.2)", "rgba(16, 185, 129, 0.2)"]
                                        )
                                    }}
                                    className="w-full rounded-t-xl"
                                />
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <span className="text-muted-foreground/20 font-mono text-xs uppercase tracking-widest">Real-time Data Stream</span>
                                </div>
                            </motion.div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

function FeatureCard({ feature, index }: { feature: any, index: number }) {
    const ref = useRef(null);
    const isInView = useInView(ref, { margin: "-20%" });

    return (
        <motion.div
            ref={ref}
            animate={{ opacity: isInView ? 1 : 0.3, x: isInView ? 0 : -20 }}
            transition={{ duration: 0.5 }}
            className="flex gap-6 items-start group"
        >
            <div className={`h-14 w-14 rounded-2xl bg-gradient-to-br ${feature.color} flex items-center justify-center shrink-0 shadow-lg shadow-black/20`}>
                <feature.icon className="h-7 w-7 text-white" />
            </div>
            <div>
                <h4 className="text-2xl font-bold text-foreground mb-3">{feature.title}</h4>
                <p className="text-lg text-muted-foreground leading-relaxed mb-6">
                    {feature.description}
                </p>
                <div className="flex items-center gap-2 text-primary font-bold cursor-pointer hover:underline">
                    Learn how it works <ArrowRight className="h-4 w-4" />
                </div>
            </div>
        </motion.div>
    );
}

function VisualCard({ index, scrollYProgress }: { index: number, scrollYProgress: any }) {
    const opacity = useTransform(
        scrollYProgress,
        [index * 0.3, (index + 1) * 0.3],
        [0.2, 1]
    );
    const scale = useTransform(
        scrollYProgress,
        [index * 0.3, (index + 1) * 0.3],
        [0.95, 1]
    );

    return (
        <motion.div
            style={{ opacity, scale }}
            className="h-32 rounded-xl bg-muted/40 border border-border p-5 flex flex-col justify-between"
        >
            <div className="h-2 w-12 bg-primary/20 rounded-full" />
            <div className="space-y-2">
                <div className="h-6 w-full bg-muted rounded-lg" />
                <div className="h-2 w-2/3 bg-muted-foreground/10 rounded-full" />
            </div>
        </motion.div>
    );
}
