'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';

interface LinkSummary {
    id: string;
    scope: 'request' | 'client';
    expiresAt: string;
}

export function InternalLinkControls({ requestId, canCreate }: { requestId: string; canCreate: boolean }) {
    const endpoint = `/api/approval-requests/${requestId}/internal-links`;
    const [links, setLinks] = useState<LinkSummary[] | null>(null);
    const [created, setCreated] = useState<{ id: string; url: string } | null>(null);
    const [confirm, setConfirm] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const load = useCallback(async () => {
        const response = await fetch(endpoint, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setLinks(data.links);
    }, [endpoint]);
    useEffect(() => {
        void load().catch(() => setError('Internal links could not be loaded.'));
    }, [load]);

    async function update(method: 'POST' | 'DELETE', body: object) {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const response = await fetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            if (method === 'POST') setCreated({ id: data.id, url: data.url });
            else {
                if (created?.id === confirm) setCreated(null);
                setConfirm(null);
                setNotice('Internal link revoked.');
            }
            await load();
        } catch (error) {
            setError(error instanceof Error ? error.message : 'The internal link could not be updated.');
        } finally {
            setBusy(false);
        }
    }

    function create(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        void update('POST', { scope: fields.get('scope'), expiresInDays: Number(fields.get('expiry')) });
    }

    async function copy() {
        if (!created) return;
        try {
            await navigator.clipboard.writeText(created.url);
            setCreated(null);
            setNotice('Internal link copied.');
        } catch {
            setError('Select the URL and copy it manually.');
        }
    }

    return (
        <section className="space-y-4 rounded-xl border border-border bg-card p-4">
            <h2 className="font-semibold">Internal review link</h2>
            {canCreate && <>
                <p className="text-sm text-muted-foreground">Anyone with this link can read the selected drafts and leave internal feedback.</p>
                <form className="space-y-3 text-sm" onSubmit={create}>
                    <label className="grid gap-1">
                        Scope
                        <select name="scope" className="w-full rounded-md border border-input bg-background p-2">
                            <option value="request">This batch</option>
                            <option value="client">All drafts for this client</option>
                        </select>
                    </label>
                    <label className="grid gap-1">
                        Expires in (days)
                        <input className="w-full rounded-md border border-input bg-background p-2" name="expiry" type="number" min={1} max={30} defaultValue={7} required />
                    </label>
                    <Button disabled={busy || created !== null} variant="outline" type="submit">Create internal link</Button>
                </form>
            </>}
            {created && (
                <div className="space-y-2 rounded-md border border-border p-3 text-sm">
                    <label className="grid gap-1">
                        Copy this URL now. It is shown once.
                        <input readOnly value={created.url} onFocus={event => event.currentTarget.select()} className="w-full rounded-md border border-input bg-background p-2" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => void copy()}>Copy URL</Button>
                        <Button size="sm" variant="outline" onClick={() => setCreated(null)}>Done</Button>
                    </div>
                </div>
            )}
            {links?.length ? (
                <div className="space-y-2 border-t border-border pt-3">
                    <h3 className="text-sm font-semibold">Active internal links</h3>
                    <ul className="divide-y divide-border">
                        {links.map(link => (
                            <li key={link.id} className="space-y-2 py-2 text-sm">
                                <div className="flex items-center justify-between gap-2">
                                    <div>
                                        <p>{link.scope === 'request' ? 'This batch' : 'All client drafts'}</p>
                                        <p className="text-xs text-muted-foreground">Expires <time dateTime={link.expiresAt}>{new Date(link.expiresAt).toLocaleDateString()}</time></p>
                                    </div>
                                    {confirm !== link.id && <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirm(link.id)}>Revoke</Button>}
                                </div>
                                {confirm === link.id && <div className="flex flex-wrap gap-2">
                                    <Button variant="destructive" size="sm" disabled={busy} onClick={() => void update('DELETE', { linkId: link.id })}>Confirm revoke</Button>
                                    <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button>
                                </div>}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : links && <p className="text-sm text-muted-foreground">No active internal links.</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {notice && <p role="status" className="text-sm">{notice}</p>}
        </section>
    );
}
