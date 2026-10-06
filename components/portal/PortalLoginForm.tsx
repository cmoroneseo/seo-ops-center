'use client';

import { FormEvent, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Mail, Mountain, ShieldCheck } from 'lucide-react';
import { safePortalNext } from '@/lib/portal/access-policy';
import './portal.css';

export function PortalLoginForm() {
    const params = useSearchParams();
    const next = safePortalNext(params.get('next'));
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState<string | null>(params.get('error'));
    const [isError, setIsError] = useState(Boolean(params.get('error')));
    const [pending, setPending] = useState(false);
    async function submit(event: FormEvent) {
        event.preventDefault(); setPending(true); setMessage(null); setIsError(false);
        try {
            const response = await fetch('/api/client-portal/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, next, clientId: params.get('client') }) });
            const body = await response.json().catch(() => null);
            if (!response.ok) throw new Error('Could not send the link. Try again in a moment.');
            setMessage(body?.message ?? 'If this email is invited to a client portal, a sign-in link is on its way. Check your inbox and spam folder.');
        } catch { setIsError(true); setMessage('Could not send the link. Try again in a moment.'); }
        finally { setPending(false); }
    }
    return <div className="portal-theme relative flex min-h-screen items-center justify-center px-5 py-12"><div className="relative w-full max-w-[440px]"><div className="mb-7 flex items-center justify-center gap-3 text-foreground"><Mountain size={34} className="text-primary" aria-hidden="true" /><p className="text-sm font-bold">Your client portal</p></div><section className="portal-panel p-8"><h1 className="text-2xl font-extrabold tracking-tight">Your progress, one link away.</h1><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Sign in to see what’s shipped, review your plan, and connect with your account team.</p><form onSubmit={submit} className="mt-7 space-y-5"><label className="block text-sm font-semibold">Email address<div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-card px-3"><Mail size={17} className="text-muted-foreground" aria-hidden="true" /><input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="min-w-0 flex-1 bg-transparent py-3 text-sm font-normal outline-offset-2" placeholder="you@company.com" /></div></label><button type="submit" disabled={pending} className="portal-button min-h-11 w-full">{pending ? 'Sending your link…' : 'Email me a sign-in link'}{!pending && <ArrowRight size={16} />}</button></form>{message && <p className={`mt-5 text-sm leading-relaxed ${isError ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400'}`} role={isError ? 'alert' : 'status'}>{message}</p>}<p className="mt-5 text-xs leading-relaxed text-muted-foreground">For invited contacts only. We’ll email a one-time sign-in link. No password needed.</p></section><p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground"><ShieldCheck size={14} aria-hidden="true" />Private access to your client workspace</p></div></div>;
}
