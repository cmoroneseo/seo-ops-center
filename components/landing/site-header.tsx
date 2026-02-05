"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, Menu, X } from "lucide-react";
import { useState } from "react";

import { ModeToggle } from "@/components/ui/mode-toggle";

export function SiteHeader() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    return (
        <header className="fixed top-0 z-50 w-full border-b border-border bg-background/50 backdrop-blur-xl">
            <div className="container mx-auto flex h-16 items-center justify-between px-4">
                <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-accent" />
                    <span className="text-xl font-bold tracking-tight text-foreground">
                        SEO Ops Center
                    </span>
                </div>

                {/* Desktop Nav */}
                <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
                    <Link href="/#features" className="hover:text-foreground transition-colors">
                        Features
                    </Link>
                    <Link href="/tools/roi-calculator" className="hover:text-foreground transition-colors">
                        ROI Calculator
                    </Link>
                    <Link href="/vs/general-pm-comparison" className="hover:text-foreground transition-colors">
                        Vs. Competitors
                    </Link>
                    <Link href="/#pricing" className="hover:text-foreground transition-colors">
                        Pricing
                    </Link>
                </nav>

                <div className="flex items-center gap-2 sm:gap-4">
                    <div className="hidden sm:block">
                        <ModeToggle />
                    </div>
                    <Link href="/login" className="hidden sm:block text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                        Sign In
                    </Link>
                    <Button asChild className="hidden sm:inline-flex bg-primary hover:bg-primary/90 text-primary-foreground border-0 shadow-lg shadow-primary/20">
                        <Link href="/signup">
                            Get Started <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                    </Button>

                    <div className="sm:hidden">
                        <ModeToggle />
                    </div>

                    {/* Mobile Menu Toggle */}
                    <button
                        className="md:hidden text-foreground p-2"
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                    >
                        {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
                    </button>
                </div>
            </div>

            {/* Mobile Menu Overlay */}
            {isMenuOpen && (
                <div className="md:hidden absolute top-16 left-0 w-full bg-background border-b border-border p-4 space-y-4 flex flex-col items-center animate-in slide-in-from-top duration-200 z-50">
                    <Link
                        href="/#features"
                        className="text-lg font-medium text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setIsMenuOpen(false)}
                    >
                        Features
                    </Link>
                    <Link
                        href="/tools/roi-calculator"
                        className="text-lg font-medium text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setIsMenuOpen(false)}
                    >
                        ROI Calculator
                    </Link>
                    <Link
                        href="/vs/general-pm-comparison"
                        className="text-lg font-medium text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setIsMenuOpen(false)}
                    >
                        Vs. Competitors
                    </Link>
                    <Link
                        href="/#pricing"
                        className="text-lg font-medium text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setIsMenuOpen(false)}
                    >
                        Pricing
                    </Link>
                    <hr className="w-full border-border" />
                    <Link
                        href="/login"
                        className="text-lg font-medium text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setIsMenuOpen(false)}
                    >
                        Sign In
                    </Link>
                    <Button asChild className="w-full bg-primary hover:bg-primary/90 text-primary-foreground border-0">
                        <Link href="/signup" onClick={() => setIsMenuOpen(false)}>
                            Get Started <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                    </Button>
                </div>
            )}
        </header>
    );
}
