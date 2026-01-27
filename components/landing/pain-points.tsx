"use client";

import { XCircle, Zap, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";

const beforePoints = [
    "Manually pasting screenshots into Slides",
    "Clients asking 'What did you do this month?'",
    "Chasing team members for updates",
    "Data scattered across 5+ disconnected tools",
];

const afterPoints = [
    "Real-time dashboards clients actually understand",
    "Auto-generated deliverables & ROI tracking",
    "Team tasks linked directly to performance",
    "One central hub for your entire agency",
];

export function PainPoints() {
    return (
        <section className="py-24 bg-background overflow-hidden border-y border-border/5">
            <div className="container mx-auto px-4">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className="text-center max-w-3xl mx-auto mb-16"
                >
                    <h2 className="text-3xl md:text-5xl font-bold text-foreground mb-6 tracking-tight">
                        Stop Trading Hours <br />
                        <span className="text-muted-foreground/60">For Manual Reports</span>
                    </h2>
                    <p className="text-lg text-muted-foreground leading-relaxed">
                        SEO Managers waste up to 15 hours a week manually copy-pasting data.
                        That's time you could spend on strategy and growth.
                    </p>
                </motion.div>

                <div className="grid md:grid-cols-2 gap-8 items-stretch">
                    {/* Before Section */}
                    <motion.div
                        initial={{ opacity: 0, x: -40 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true, margin: "-100px" }}
                        transition={{ duration: 0.7, delay: 0.1 }}
                        className="rounded-2xl border border-red-500/20 bg-red-500/5 p-8 hover-lift"
                    >
                        <div className="flex items-center gap-3 mb-6">
                            <XCircle className="h-6 w-6 text-red-500" />
                            <h3 className="text-xl font-bold text-foreground">The Old Way</h3>
                        </div>
                        <ul className="space-y-4">
                            {beforePoints.map((point, i) => (
                                <li key={i} className="flex gap-3 text-muted-foreground text-sm">
                                    <span className="text-red-500/50 mt-1 flex-shrink-0">•</span>
                                    {point}
                                </li>
                            ))}
                        </ul>
                    </motion.div>

                    {/* After Section */}
                    <motion.div
                        initial={{ opacity: 0, x: 40 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true, margin: "-100px" }}
                        transition={{ duration: 0.7, delay: 0.2 }}
                        className="rounded-2xl border border-primary/20 bg-primary/5 p-8 relative overflow-hidden group hover-lift"
                    >
                        <div className="absolute top-0 right-0 p-4">
                            <Zap className="h-6 w-6 text-primary animate-pulse" />
                        </div>
                        <div className="flex items-center gap-3 mb-6">
                            <CheckCircle2 className="h-6 w-6 text-primary" />
                            <h3 className="text-xl font-bold text-foreground">With Command Center</h3>
                        </div>
                        <ul className="space-y-4">
                            {afterPoints.map((point, i) => (
                                <li key={i} className="flex gap-3 text-foreground text-sm font-medium">
                                    <span className="text-primary mt-1 flex-shrink-0">✓</span>
                                    {point}
                                </li>
                            ))}
                        </ul>
                        {/* Visual Accent */}
                        <div className="mt-8 pt-8 border-t border-primary/10">
                            <div className="text-sm text-primary font-bold uppercase tracking-widest mb-1">Result</div>
                            <div className="text-3xl font-bold text-foreground">Retain 95% more clients</div>
                        </div>
                    </motion.div>
                </div>

                <motion.div
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1, delay: 0.5 }}
                    className="mt-16 text-center italic text-muted-foreground max-w-2xl mx-auto"
                >
                    "I used to spend my entire Monday building dashboards. Now they update themselves."
                    <span className="block not-italic font-bold text-foreground mt-2">— Strategy Director, Elite SEO Agency</span>
                </motion.div>
            </div>
        </section>
    );
}
