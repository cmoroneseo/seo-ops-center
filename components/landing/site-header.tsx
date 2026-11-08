"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Wordmark } from "@/components/landing/wordmark";

const nav = [
    { href: "/#performance", label: "Product" },
    { href: "/#pricing", label: "Pricing" },
];

const linkClass = "rounded-md text-sm font-medium text-[#18181b] hover:text-[#ec4899] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ec4899]";

export function SiteHeader() {
    const [open, setOpen] = useState(false);

    return (
        <header className="sticky top-0 z-40 border-b border-[#e4e4e7] bg-white">
            <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-5 lg:px-0">
                <Wordmark />

                <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
                    {nav.map((item) => (
                        <Link key={item.href} href={item.href} className={linkClass}>
                            {item.label}
                        </Link>
                    ))}
                </nav>

                <div className="hidden items-center gap-5 md:flex">
                    <Link href="/login" className={`${linkClass} inline-flex min-h-11 items-center`}>
                        Log in
                    </Link>
                    <Link
                        href="/signup"
                        className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#ec4899] px-4 text-sm font-semibold text-white hover:bg-[#db2777] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ec4899]"
                    >
                        Start free trial
                    </Link>
                </div>

                <div className="flex items-center gap-2 md:hidden">
                    <Link href="/login" className={`${linkClass} inline-flex min-h-11 items-center px-2`}>
                        Log in
                    </Link>
                    <button
                        type="button"
                        className="inline-flex h-11 w-11 items-center justify-center rounded-md text-[#18181b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ec4899]"
                        aria-expanded={open}
                        aria-controls="landing-menu"
                        onClick={() => setOpen((value) => !value)}
                    >
                        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
                        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                    </button>
                </div>
            </div>

            {open && (
                <div id="landing-menu" className="border-t border-[#e4e4e7] bg-white px-5 py-4 md:hidden">
                    <nav className="flex flex-col gap-1" aria-label="Mobile">
                        {nav.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                className="inline-flex min-h-11 items-center rounded-md text-base font-medium text-[#18181b]"
                                onClick={() => setOpen(false)}
                            >
                                {item.label}
                            </Link>
                        ))}
                        <Link
                            href="/signup"
                            className="mt-2 inline-flex min-h-11 items-center justify-center rounded-full bg-[#ec4899] px-4 text-sm font-semibold text-white"
                            onClick={() => setOpen(false)}
                        >
                            Start free trial
                        </Link>
                    </nav>
                </div>
            )}
        </header>
    );
}
