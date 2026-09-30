'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { PortalContact } from '@/lib/portal/session';

const LINKS = [
    { href: '/portal', label: 'Progress' },
    { href: '/portal/plan', label: 'SEO Plan' },
    { href: '/portal/pending', label: 'Pending' },
    { href: '/portal/reports', label: 'Reports' },
];

export function PortalShell({
    contact,
    contacts,
    pendingCount,
    children,
}: {
    contact: PortalContact;
    contacts: PortalContact[];
    pendingCount: number;
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const [switching, setSwitching] = useState(false);

    async function signOut() {
        const supabase = createClient();
        await supabase?.auth.signOut();
        window.location.assign('/portal/login');
    }

    async function switchClient(clientId: string) {
        setSwitching(true);
        await fetch('/api/client-portal/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId }),
        });
        router.refresh();
        setSwitching(false);
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="border-b border-border bg-card">
                <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-4">
                    <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{contact.organizationName}</p>
                        <h1 className="truncate text-lg font-semibold">{contact.clientName}</h1>
                    </div>
                    {contacts.length > 1 && (
                        <label className="text-sm text-muted-foreground">
                            <span className="sr-only">Client</span>
                            <select
                                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                                value={contact.clientId}
                                disabled={switching}
                                onChange={event => switchClient(event.target.value)}
                            >
                                {contacts.map(item => (
                                    <option key={item.clientId} value={item.clientId}>{item.clientName}</option>
                                ))}
                            </select>
                        </label>
                    )}
                    <div className="text-right">
                        <p className="text-sm">{contact.displayName}</p>
                        <button type="button" onClick={signOut} className="text-xs text-muted-foreground hover:text-foreground">
                            Sign out
                        </button>
                    </div>
                </div>
                <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-3">
                    {LINKS.map(link => {
                        const active = link.href === '/portal'
                            ? pathname === '/portal'
                            : pathname === link.href || pathname.startsWith(`${link.href}/`);
                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                className={cn(
                                    'rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap',
                                    active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                                )}
                            >
                                {link.label}
                                {link.href === '/portal/pending' && pendingCount > 0 && (
                                    <span className={cn('ml-1.5 rounded-full px-1.5 text-xs', active ? 'bg-primary-foreground/20' : 'bg-primary/15 text-primary')}>
                                        {pendingCount}
                                    </span>
                                )}
                            </Link>
                        );
                    })}
                </nav>
            </header>
            <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        </div>
    );
}
