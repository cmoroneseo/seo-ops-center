"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

export function Hero() {
    const containerRef = useRef<HTMLDivElement>(null);
    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ["start start", "end start"]
    });

    const y1 = useTransform(scrollYProgress, [0, 1], [0, 200]);
    const y2 = useTransform(scrollYProgress, [0, 1], [0, -150]);
    const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
    const scale = useTransform(scrollYProgress, [0, 0.5], [1, 0.9]);
    const imgScale = useTransform(scrollYProgress, [0, 1], [1, 1.1]);
    const imgOpacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0, 1, 1, 0]);

    return (
        <section ref={containerRef} className="relative min-h-[120vh] overflow-hidden pt-32 pb-20 md:pt-40 md:pb-32 bg-background">
            {/* Background gradients */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full max-w-7xl pointer-events-none opacity-20">
                <motion.div style={{ y: y1 }} className="absolute top-20 left-10 w-96 h-96 bg-primary rounded-full blur-[128px]" />
                <motion.div style={{ y: y2 }} className="absolute top-40 right-10 w-96 h-96 bg-accent rounded-full blur-[128px]" />
            </div>

            <div className="container mx-auto px-4 relative z-10">
                <motion.div
                    style={{ opacity, scale }}
                    className="flex flex-col items-center text-center max-w-4xl mx-auto"
                >
                    <div className="inline-flex items-center rounded-full border border-border bg-background/5 px-3 py-1 text-sm font-medium text-primary backdrop-blur-xl mb-8">
                        <span className="flex h-2 w-2 rounded-full bg-primary mr-2 animate-pulse" />
                        Waitlist is open for early access
                    </div>

                    <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-foreground mb-8 leading-[1.1] md:leading-tight">
                        The Ultimate <br className="hidden sm:block" />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
                            SEO Project Management Software
                        </span>
                    </h1>

                    <p className="text-xl text-muted-foreground mb-10 max-w-2xl leading-relaxed">
                        The all-in-one agency SEO tool to prove ROI, track deliverables,
                        and keep clients happy with real-time, crystal-clear dashboards.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
                        <Button asChild size="lg" className="w-full sm:w-auto h-12 px-8 text-base bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20 hover-lift">
                            <Link href="/signup">Join the Waitlist</Link>
                        </Button>
                        <Button asChild size="lg" variant="outline" className="w-full sm:w-auto h-12 px-8 text-base border-border bg-background/5 hover:bg-accent text-foreground hover-lift">
                            <Link href="/dashboard">View Live Demo</Link>
                        </Button>
                    </div>
                </motion.div>

                <motion.div
                    style={{ scale: imgScale, opacity: imgOpacity }}
                    className="mt-20 w-full relative max-w-5xl mx-auto"
                >
                    <div className="absolute -inset-1 bg-gradient-to-r from-primary to-accent rounded-xl blur opacity-20" />
                    <div className="relative rounded-xl border border-border bg-card/50 backdrop-blur-xl p-2 md:p-4 aspect-video shadow-2xl overflow-hidden">
                        {/* Abstract UI representation */}
                        <div className="w-full h-full bg-muted/30 rounded-lg flex items-center justify-center border border-border/5 relative overflow-hidden">
                            <div className="grid grid-cols-12 gap-4 w-full h-full p-6 opacity-80">
                                <div className="col-span-3 h-full bg-muted/20 rounded-lg border border-border/10" />
                                <div className="col-span-9 h-full flex flex-col gap-4">
                                    <div className="h-32 w-full bg-muted/20 rounded-lg border border-border/10" />
                                    <div className="flex-1 grid grid-cols-2 gap-4">
                                        <div className="bg-muted/20 rounded-lg border border-border/10" />
                                        <div className="bg-muted/20 rounded-lg border border-border/10" />
                                    </div>
                                </div>
                            </div>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-muted-foreground/30 font-mono text-sm">Interactive Dashboard Preview</span>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </section>
    );
}
