'use client';

import { FormEvent, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { safePortalNext } from '@/lib/portal/access-policy';

export function PortalLoginForm() {
    const params = useSearchParams();
    const next = safePortalNext(params.get('next'));
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState<string | null>(params.get('error'));
    const [pending, setPending] = useState(false);

    async function submit(event: FormEvent) {
        event.preventDefault();
        setPending(true);
        setMessage(null);
        try {
            const response = await fetch('/api/client-portal/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, next }),
            });
            const body = await response.json().catch(() => null);
            setMessage(body?.message ?? 'If this email is on a client portal, a sign-in link is on its way.');
        } catch {
            setMessage('Could not send the link. Try again in a moment.');
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Client portal</p>
                <h1 className="mt-2 text-2xl font-semibold">Sign in with your email</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    We will send a one-time link. No password.
                </p>
                <form onSubmit={submit} className="mt-6 space-y-3">
                    <label className="block text-sm font-medium">
                        Email
                        <input
                            type="email"
                            required
                            autoComplete="email"
                            value={email}
                            onChange={event => setEmail(event.target.value)}
                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        />
                    </label>
                    <button
                        type="submit"
                        disabled={pending}
                        className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                    >
                        {pending ? 'Sending…' : 'Email me a sign-in link'}
                    </button>
                </form>
                {message && (
                    <p className="mt-4 text-sm text-muted-foreground" role="status">{message}</p>
                )}
            </div>
        </div>
    );
}
