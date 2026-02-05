"use client";

import { Check, X, ShieldCheck, TrendingUp, Zap, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import Link from "next/link";

const competitors = ["HubSpot", "Monday.com", "ClickUp", "Basecamp"];

const features = [
    {
        name: "General Project Tracking",
        others: true,
        seoOps: true,
        detail: "Standard task lists and kanban boards."
    },
    {
        name: "GA4 & GSC Native Integration",
        others: false,
        seoOps: true,
        detail: "Connect search data directly to projects without external plugins."
    },
    {
        name: "Predictive Churn AI",
        others: false,
        seoOps: true,
        detail: "Flags at-risk clients based on ranking drops and low engagement."
    },
    {
        name: "ROI-Focused Dashboards",
        others: false,
        seoOps: true,
        detail: "Translates abstract traffic into actual dollar value gained."
    },
    {
        name: "SEO Workflow Templates",
        others: false,
        seoOps: true,
        detail: "Pre-built audits, content briefs, and backlink trackers."
    }
];

export default function ComparisonPage() {
    return (
        <div className="bg-black text-white">
            {/* Hero Section */}
            <section className="pt-32 pb-20 px-4">
                <div className="container mx-auto max-w-5xl text-center">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-sm font-medium text-primary mb-8"
                    >
                        SEO Ops Center vs. General PM Tools
                    </motion.div>
                    <h1 className="text-4xl md:text-7xl font-bold mb-8 leading-tight">
                        Stop forcing HubSpot to be an <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">SEO Tool.</span>
                    </h1>
                    <p className="text-xl text-muted-foreground max-w-3xl mx-auto mb-10">
                        Generic project management tools track "to-dos." SEO Ops Center tracks **ROI**.
                        Built specifically for agency owners who need to prove value and keep clients from churning.
                    </p>
                    <div className="flex flex-col sm:flex-row justify-center gap-4">
                        <Button asChild size="lg" className="h-12 px-8 bg-primary hover:bg-primary/90">
                            <Link href="/signup">Start Free Trial</Link>
                        </Button>
                        <Button asChild size="lg" variant="outline" className="h-12 px-8 border-white/10 hover:bg-white/5">
                            <Link href="/tools/roi-calculator">Try the ROI Calculator</Link>
                        </Button>
                    </div>
                </div>
            </section>

            {/* Comparison Table */}
            <section className="py-20 px-4 bg-white/5 backdrop-blur-3xl">
                <div className="container mx-auto max-w-6xl">
                    <div className="overflow-x-auto rounded-3xl border border-white/10 bg-black/40 shadow-2xl">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-white/10">
                                    <th className="p-8 text-lg font-bold">Strategic Feature</th>
                                    <th className="p-8 text-lg font-bold text-muted-foreground">General PM Tools*</th>
                                    <th className="p-8 text-lg font-bold text-primary bg-primary/5">SEO Ops Center</th>
                                </tr>
                            </thead>
                            <tbody>
                                {features.map((feature, i) => (
                                    <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                                        <td className="p-8">
                                            <div className="font-bold mb-1">{feature.name}</div>
                                            <div className="text-sm text-muted-foreground opacity-60 group-hover:opacity-100 transition-opacity">
                                                {feature.detail}
                                            </div>
                                        </td>
                                        <td className="p-8">
                                            {feature.others ? (
                                                <Check className="h-6 w-6 text-green-500/50" />
                                            ) : (
                                                <X className="h-6 w-6 text-red-500/50" />
                                            )}
                                        </td>
                                        <td className="p-8 bg-primary/5">
                                            <div className="flex items-center gap-2">
                                                <ShieldCheck className="h-6 w-6 text-primary" />
                                                <span className="font-bold text-primary">Native</span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="p-4 text-center text-xs text-muted-foreground border-t border-white/10">
                            *Comparison represents standard configurations of HubSpot, Monday.com, ClickUp, and Basecamp without heavy custom development.
                        </div>
                    </div>
                </div>
            </section>

            {/* Deep Dive Section */}
            <section className="py-24 px-4">
                <div className="container mx-auto max-w-6xl">
                    <div className="grid md:grid-cols-3 gap-12">
                        <div className="space-y-4">
                            <div className="h-12 w-12 rounded-2xl bg-blue-500/20 flex items-center justify-center text-blue-500">
                                <TrendingUp className="h-6 w-6" />
                            </div>
                            <h3 className="text-2xl font-bold">Proof, Not Progress</h3>
                            <p className="text-muted-foreground leading-relaxed">
                                Generic tools show you "Tasks Completed." We show you **Revenue Generated**.
                                Link your work directly to traffic and lead value increases.
                            </p>
                        </div>
                        <div className="space-y-4">
                            <div className="h-12 w-12 rounded-2xl bg-primary/20 flex items-center justify-center text-primary">
                                <Zap className="h-6 w-6" />
                            </div>
                            <h3 className="text-2xl font-bold">SEO-Specific Automations</h3>
                            <p className="text-muted-foreground leading-relaxed">
                                Automate content briefing and backlink audits. No more hacking together
                                custom fields and templates in a tool built for general project managers.
                            </p>
                        </div>
                        <div className="space-y-4">
                            <div className="h-12 w-12 rounded-2xl bg-accent/20 flex items-center justify-center text-accent">
                                <Users className="h-6 w-6" />
                            </div>
                            <h3 className="text-2xl font-bold">The Retention Edge</h3>
                            <p className="text-muted-foreground leading-relaxed">
                                Our AI analyzes client sentiment and performance data to flag at-risk accounts
                                30 days before they send a cancellation request.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="py-24 px-4 bg-gradient-to-t from-primary/20 to-transparent">
                <div className="container mx-auto max-w-4xl text-center border border-primary/20 rounded-3xl p-12 bg-black/40 backdrop-blur-xl">
                    <h2 className="text-3xl md:text-5xl font-bold mb-6">Build a Better Agency.</h2>
                    <p className="text-xl text-muted-foreground mb-10">
                        Join the waitlist to get early access to the project management software that understands SEO.
                    </p>
                    <Button asChild size="lg" className="h-14 px-12 text-lg bg-primary hover:bg-primary/90 shadow-2xl shadow-primary/40">
                        <Link href="/signup">Join Founding Members Waitlist</Link>
                    </Button>
                </div>
            </section>
        </div>
    );
}
