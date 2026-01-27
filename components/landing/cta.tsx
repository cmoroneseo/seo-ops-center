"use client";

import { Button } from "@/components/ui/button";
import { ArrowRight, Mail } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export function CTA() {
    const [email, setEmail] = useState("");

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // Handle form submission logic here
        console.log("Email submitted:", email);
        // You might want to integrate with an email service or API
    };

    return (
        <section className="py-32 relative overflow-hidden bg-background">
            {/* Background Glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/20 rounded-full blur-[128px] pointer-events-none" />

            <div className="container mx-auto px-4 relative z-10 text-center">
                <h2 className="text-4xl md:text-6xl font-bold text-foreground mb-6 fade-in">
                    Ready to Automate Your <br />
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
                        SEO Project Management?
                    </span>
                </h2>
                <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto fade-in">
                    Join 100+ agencies using SEO Ops Command Center to scale without the chaos.
                    Limited beta spots remaining.
                </p>

                <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-4 max-w-md mx-auto fade-in">
                    <div className="relative flex-1">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <input
                            type="email"
                            placeholder="Enter your work email"
                            className="w-full h-12 pl-10 pr-4 bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all font-medium"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <Button type="submit" size="lg" className="h-12 px-8 text-base bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:shadow-primary/50 transition-all duration-300 hover-lift">
                        Scale My Agency <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </form>

                <div className="mt-8 text-sm text-muted-foreground font-medium uppercase tracking-widest fade-in">
                    Built by SEO Veterans for SEO Professionals
                </div>
            </div>
        </section>
    );
}
