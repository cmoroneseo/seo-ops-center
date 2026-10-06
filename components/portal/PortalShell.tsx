'use client';

import NextLink from 'next/link';
import { PortalLink as Link, PortalViewProvider } from './PortalViewContext';
import { portalViewHref } from '@/lib/portal/preview-policy';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChevronDown, LogOut, MessageSquare, Mountain, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { PortalClientScope, PortalContact } from '@/lib/portal/session';
import './portal.css';

const LINKS = [
    { href: '/portal', label: 'Overview' },
    { href: '/portal/plan', label: 'Our plan' },
    { href: '/portal/pending', label: 'Approvals' },
    { href: '/portal/reports', label: 'Reports' },
    { href: '/portal/messages', label: 'Messages' },
];

export function PortalShell({ contact, contacts, pendingCount, children, previewBasePath }: {
    contact: PortalClientScope | PortalContact; contacts: PortalContact[]; pendingCount: number | null; children: React.ReactNode;
    previewBasePath?: string;
}) {
    const readOnly = Boolean(previewBasePath);
    const basePath = previewBasePath ?? '/portal';
    const pathname = usePathname();
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    async function signOut() {
        if (readOnly) return;
        setBusy(true); setError(null);
        try {
            const supabase = createClient();
            if (!supabase) throw new Error('Sign out is unavailable. Try again.');
            const result = await supabase.auth.signOut({ scope: 'local' });
            if (result.error) throw result.error;
            window.location.assign('/portal/login');
        } catch { setError('Could not sign out. Please try again.'); setBusy(false); }
    }
    async function switchClient(clientId: string) {
        if (readOnly) return;
        setBusy(true); setError(null);
        try {
            const response = await fetch('/api/client-portal/switch', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId }),
            });
            if (!response.ok) throw new Error('switch failed');
            // Full navigation clears client state and drafts belonging to the previous account.
            router.push('/portal'); router.refresh();
        } catch { setError('Could not switch accounts. Please try again.'); }
        finally { setBusy(false); }
    }
    const initials = contact.clientName.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
    return (
        <PortalViewProvider value={{ basePath, readOnly }}>
        <div className="portal-theme">
            {readOnly && <aside className="border-b border-border bg-secondary px-4 py-3 text-secondary-foreground print:hidden" aria-label="Client preview"><div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold">Preview as client · {contact.clientName}</p><p className="mt-1 text-xs">Read-only · Shows currently shared content. Approvals, messages, and content review actions are disabled.</p></div><NextLink href={`/workspace/${contact.clientId}?tab=portal`} className="rounded-md border border-border px-3 py-2 text-sm font-semibold hover:bg-muted">Back to Portal management</NextLink></div></aside>}
            <a href="#portal-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-card focus:p-4">Skip to content</a>
            <header className="portal-header">
                <div className="portal-header-inner">
                    <Link href="/portal" className="portal-brand" aria-label={`${contact.organizationName} portal home`}>
                        <Mountain size={39} className="shrink-0 text-primary" aria-hidden="true" />
                        <span>{contact.organizationName}</span>
                    </Link>
                    <p className="portal-client-name">{contact.clientName}</p>
                    <nav className="portal-nav" aria-label="Client portal">
                        {LINKS.map(link => {
                            const href = portalViewHref(link.href, basePath);
                            const active = link.href === '/portal' ? pathname === basePath : pathname.startsWith(href);
                            return <Link key={link.href} href={link.href} aria-current={active ? 'page' : undefined}>
                                {link.label}{link.href === '/portal/pending' && pendingCount !== null && pendingCount > 0 && <span className="portal-badge" aria-label={`${pendingCount} waiting on you`}>{pendingCount}</span>}
                            </Link>;
                        })}
                    </nav>
                    <Link href="/portal/messages#message-compose" className="portal-button portal-header-message"><MessageSquare size={16} aria-hidden="true" />Message your team</Link>
                    {!readOnly && 'email' in contact && <details className="portal-account">
                        <summary aria-label="Your account"><span className="portal-avatar">{initials}</span><ChevronDown size={13} aria-hidden="true" /></summary>
                        <div className="portal-account-menu">
                            <p className="text-sm font-bold">{contact.displayName}</p>
                            <p className="mt-1 break-all text-xs text-muted-foreground">{contact.email}</p>
                            {contacts.length > 1 && <label className="mt-4 block text-xs font-medium">Client account
                                <select className="mt-2 w-full rounded-md border border-border bg-background p-2 text-sm" value={contact.clientId} disabled={busy} onChange={event => switchClient(event.target.value)}>
                                    {contacts.map(item => <option key={item.clientId} value={item.clientId}>{item.clientName}</option>)}
                                </select>
                            </label>}
                            <button type="button" disabled={busy} onClick={signOut} className="mt-4 flex min-h-10 w-full items-center gap-2 text-sm font-medium"><LogOut size={15} />{busy ? 'Please wait…' : 'Sign out'}</button>
                            {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
                        </div>
                    </details>}
                </div>
            </header>
            <main id="portal-content" className="portal-main" key={contact.clientId}>
                {pendingCount === null && <p role="status" className="mb-5 rounded-lg bg-card p-4 text-sm text-muted-foreground">Your approval count is temporarily unavailable. Open Approvals to try again.</p>}
                {children}
                <footer className="portal-footer mt-8"><span>{contact.organizationName} · {contact.clientName}</span><span className="flex items-center gap-1.5"><ShieldCheck size={13} aria-hidden="true" />Your private client workspace</span></footer>
            </main>
        </div>
        </PortalViewProvider>
    );
}
