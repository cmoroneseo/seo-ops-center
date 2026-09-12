'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SiteIdentityReview } from '@/components/workspace/SiteIdentityReview';
import type { SiteIdentityActiveClaimsPayload } from '@/lib/types';

export function SiteIdentityActiveClaims({ clientId }: { clientId: string }) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [payload, setPayload] = useState<SiteIdentityActiveClaimsPayload>();
    const [selectedPageId, setSelectedPageId] = useState<string>();
    const load = useCallback(async (cursor?: string) => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ clientId, view: 'active_claims', ...(cursor ? { cursor } : {}) });
            const response = await fetch(`/api/site-inventory/identity?${params}`, { cache: 'no-store' });
            if (!response.ok) throw new Error('Unable to load active identity claims.');
            setPayload(await response.json());
        } catch { setError('Unable to load active identity claims.'); }
        finally { setLoading(false); }
    }, [clientId]);

    return <section className="rounded-xl border border-border bg-card p-4" aria-label="Active identity claims">
        <Button type="button" variant="outline" aria-expanded={open} onClick={() => {
            setOpen(!open);
            if (!open) void load();
        }}>Active identity claims</Button>
        {open && <div className="mt-3 space-y-3 text-xs">
            <p className="text-muted-foreground">Review recorded claims, including sources omitted from the latest completed crawl. Each review discloses any retained historical evidence.</p>
            <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void load()}>Refresh claims / first page</Button>
            {loading && <p role="status">Loading active claims…</p>}
            {error && <p role="alert">{error}</p>}
            {!loading && !error && payload && <>
                <ul className="space-y-2">{payload.claims.map(claim => <li key={claim.sourcePageId}>
                    <button type="button" onClick={() => setSelectedPageId(claim.sourcePageId)} className="w-full rounded-lg border border-border p-3 text-left focus-visible:ring-2 focus-visible:ring-primary">
                        <span className="block break-all font-mono">{claim.sourcePrimaryUrl}</span>
                        <span className="mt-1 block break-all text-muted-foreground">Immediate target: {claim.targetPrimaryUrl}</span>
                        <span className="mt-1 block font-medium text-primary">Review active claim</span>
                    </button>
                </li>)}</ul>
                {!payload.claims.length && <p>No active claims on this page.</p>}
                {payload.nextCursor && <Button type="button" variant="outline" size="sm" onClick={() => void load(payload.nextCursor)}>Next 50 claims</Button>}
            </>}
        </div>}
        <Dialog open={Boolean(selectedPageId)} onOpenChange={value => { if (!value) setSelectedPageId(undefined); }}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader><DialogTitle>Review active page identity</DialogTitle><DialogDescription>Current claim state and stored evidence for the selected source.</DialogDescription></DialogHeader>
                {selectedPageId && <SiteIdentityReview key={selectedPageId} clientId={clientId} pageId={selectedPageId} onSaved={() => { void load(); }} />}
            </DialogContent>
        </Dialog>
    </section>;
}
