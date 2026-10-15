'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface BotTokenRow {
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    clientIds: string[];
    expiresAt: string | null;
    revokedAt: string | null;
    lastUsedAt: string | null;
    rateLimitPerMinute: number;
    createdAt: string;
}

interface ClientOption {
    id: string;
    name: string;
}

export function BotTokensTab({ organizationId }: { organizationId: string }) {
    const [tokens, setTokens] = useState<BotTokenRow[]>([]);
    const [clients, setClients] = useState<ClientOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [expiry, setExpiry] = useState<'30' | '90' | '365' | 'never'>('90');
    const [rate, setRate] = useState(60);
    const [selectedClients, setSelectedClients] = useState<string[]>([]);
    const [scopes, setScopes] = useState({ ga4: true, gsc: true });
    const [issuing, setIssuing] = useState(false);
    const [issuedToken, setIssuedToken] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [revoking, setRevoking] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            setError(null);
            const response = await fetch(`/api/settings/bot-tokens?organizationId=${encodeURIComponent(organizationId)}`);
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (!cancelled) {
                    setError(body.error || 'Unable to load bot tokens');
                    setLoading(false);
                }
                return;
            }
            const supabase = createClient();
            const clientResult = supabase
                ? await supabase.from('clients').select('id, name').eq('organization_id', organizationId).order('name')
                : { data: [] };
            if (cancelled) return;
            setTokens(body.tokens ?? []);
            setClients((clientResult.data ?? []) as ClientOption[]);
            setLoading(false);
        }
        load();
        return () => { cancelled = true; };
    }, [organizationId]);

    async function reload() {
        const response = await fetch(`/api/settings/bot-tokens?organizationId=${encodeURIComponent(organizationId)}`);
        const body = await response.json().catch(() => ({}));
        if (response.ok) setTokens(body.tokens ?? []);
    }

    async function issue(event: React.FormEvent) {
        event.preventDefault();
        setIssuing(true);
        setError(null);
        setCopied(false);
        const selectedScopes = [
            ...(scopes.ga4 ? ['ga4.read'] : []),
            ...(scopes.gsc ? ['gsc.read'] : []),
        ];
        const expiresAt = expiry === 'never' ? null : new Date(Date.now() + Number(expiry) * 24 * 60 * 60 * 1000).toISOString();
        const response = await fetch('/api/settings/bot-tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                organizationId,
                name,
                scopes: selectedScopes,
                clientIds: selectedClients,
                expiresAt,
                rateLimitPerMinute: rate,
            }),
        });
        const body = await response.json().catch(() => ({}));
        setIssuing(false);
        if (!response.ok) {
            setError(body.error || 'Unable to issue a token');
            return;
        }
        setIssuedToken(body.token);
        setName('');
        setSelectedClients([]);
        await reload();
    }

    async function revoke(tokenId: string) {
        setRevoking(tokenId);
        setError(null);
        const response = await fetch('/api/settings/bot-tokens/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ organizationId, tokenId }),
        });
        const body = await response.json().catch(() => ({}));
        setRevoking(null);
        if (!response.ok) {
            setError(body.error || 'Unable to revoke the token');
            return;
        }
        await reload();
    }

    async function copyToken() {
        if (!issuedToken) return;
        await navigator.clipboard.writeText(issuedToken);
        setCopied(true);
    }

    function toggleClient(id: string) {
        setSelectedClients(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    }

    return (
        <div className="grid gap-6">
            <div className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-center gap-4 mb-4">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <KeyRound className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                        <h3 className="text-lg font-medium">Bot tokens</h3>
                        <p className="text-sm text-muted-foreground">Read-only access to stored GA4 and Search Console totals. The secret is shown once.</p>
                    </div>
                </div>

                {issuedToken && (
                    <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4" role="status">
                        <p className="text-sm font-medium">Copy this token now. It will not be shown again.</p>
                        <code className="mt-2 block break-all rounded-md bg-background px-3 py-2 text-xs">{issuedToken}</code>
                        <div className="mt-3 flex gap-2">
                            <button type="button" onClick={copyToken} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
                                {copied ? 'Copied' : 'Copy'}
                            </button>
                            <button type="button" onClick={() => setIssuedToken(null)} className="rounded-md border border-border px-3 py-1.5 text-sm">
                                I have saved it
                            </button>
                        </div>
                    </div>
                )}

                <form onSubmit={issue} className="grid gap-4">
                    <label className="grid gap-1 text-sm">
                        Name
                        <input value={name} onChange={event => setName(event.target.value)} required maxLength={80} className="rounded-md border border-input bg-background px-3 py-2" />
                    </label>
                    <div className="grid gap-3 md:grid-cols-2">
                        <label className="grid gap-1 text-sm">
                            Expires
                            <select value={expiry} onChange={event => setExpiry(event.target.value as typeof expiry)} className="rounded-md border border-input bg-background px-3 py-2">
                                <option value="30">30 days</option>
                                <option value="90">90 days</option>
                                <option value="365">365 days</option>
                                <option value="never">No expiry</option>
                            </select>
                        </label>
                        <label className="grid gap-1 text-sm">
                            Requests per minute
                            <input type="number" min={1} max={600} value={rate} onChange={event => setRate(Number(event.target.value))} className="rounded-md border border-input bg-background px-3 py-2" />
                        </label>
                    </div>
                    <fieldset className="grid gap-2 text-sm">
                        <legend>Scopes</legend>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={scopes.ga4} onChange={event => setScopes(current => ({ ...current, ga4: event.target.checked }))} /> GA4 read</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={scopes.gsc} onChange={event => setScopes(current => ({ ...current, gsc: event.target.checked }))} /> Search Console read</label>
                    </fieldset>
                    <fieldset className="grid gap-2 text-sm">
                        <legend>Clients</legend>
                        <p className="text-muted-foreground">Leave empty to allow every client in this organization.</p>
                        <div className="max-h-48 overflow-auto rounded-md border border-border p-2">
                            {clients.length === 0 && <p className="text-muted-foreground">No clients yet.</p>}
                            {clients.map(client => (
                                <label key={client.id} className="flex items-center gap-2 py-1">
                                    <input type="checkbox" checked={selectedClients.includes(client.id)} onChange={() => toggleClient(client.id)} />
                                    {client.name}
                                </label>
                            ))}
                        </div>
                    </fieldset>
                    {error && <p className="text-sm text-red-500">{error}</p>}
                    <button type="submit" disabled={issuing || (!scopes.ga4 && !scopes.gsc)} className="w-fit rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60">
                        {issuing ? 'Issuing…' : 'Issue token'}
                    </button>
                </form>
            </div>

            <div className="rounded-xl border border-border bg-card p-6">
                <h3 className="text-lg font-medium mb-4">Issued tokens</h3>
                {loading ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading tokens</p>
                ) : tokens.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No bot tokens yet.</p>
                ) : (
                    <ul className="divide-y divide-border">
                        {tokens.map(token => (
                            <li key={token.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                                <div>
                                    <p className="font-medium">{token.name} {token.revokedAt && <span className="text-muted-foreground">(revoked)</span>}</p>
                                    <p className="text-muted-foreground">
                                        {token.prefix} · {token.scopes.join(', ') || 'no scopes'} · {token.rateLimitPerMinute}/min
                                        {token.expiresAt ? ` · expires ${token.expiresAt.slice(0, 10)}` : ' · no expiry'}
                                        {token.lastUsedAt ? ` · used ${token.lastUsedAt.slice(0, 16).replace('T', ' ')}` : ''}
                                    </p>
                                </div>
                                {!token.revokedAt && (
                                    <button type="button" onClick={() => revoke(token.id)} disabled={revoking === token.id} className="rounded-md border border-border px-3 py-1.5">
                                        {revoking === token.id ? 'Revoking…' : 'Revoke'}
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
