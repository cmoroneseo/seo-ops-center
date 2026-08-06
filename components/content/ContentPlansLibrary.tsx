'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Archive, ArrowRight, CalendarRange, CheckCircle2, FileText, FolderTree, Plus, Search, Sparkles, X } from 'lucide-react';
import { useOrganization } from '@/components/providers/organization-provider';
import { useClients } from '@/lib/hooks/use-clients';
import { ContentPlan, ContentPlanStatus } from '@/lib/types';
import { createContentPlan, getContentPlans, updateContentPlan } from '@/lib/supabase/content-plans';
import { getClientIntelligence } from '@/lib/supabase/client-intelligence';
import { cn } from '@/lib/utils';

const statusStyle: Record<ContentPlanStatus, string> = {
    draft: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
    active: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    archived: 'bg-muted text-muted-foreground border-border',
};

export function ContentPlansLibrary({ fixedClientId, fixedClientName }: { fixedClientId?: string; fixedClientName?: string }) {
    const { organization } = useOrganization();
    const { clients, isLoading: clientsLoading } = useClients({ statuses: ['Active', 'Paused', 'Cancelled', 'Onboarding'] });
    const [plans, setPlans] = useState<ContentPlan[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<'all' | ContentPlanStatus>('all');
    const [clientFilter, setClientFilter] = useState(fixedClientId ?? 'all');
    const [createOpen, setCreateOpen] = useState(false);
    const [error, setError] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');

    useEffect(() => {
        if (!organization) return;
        let cancelled = false;
        setLoading(true);
        getContentPlans(organization.id, fixedClientId).then(items => {
            if (!cancelled) { setPlans(items); setLoading(false); }
        });
        return () => { cancelled = true; };
    }, [organization, fixedClientId]);

    const clientNames = useMemo(() => new Map(clients.map(c => [c.id, c.clientName])), [clients]);
    const filtered = plans.filter(plan => {
        const matchesQuery = `${plan.name} ${clientNames.get(plan.clientId) ?? ''}`.toLowerCase().includes(query.toLowerCase());
        return matchesQuery && (status === 'all' || plan.status === status) && (clientFilter === 'all' || plan.clientId === clientFilter);
    });

    async function changeStatus(plan: ContentPlan, next: ContentPlanStatus) {
        const result = await updateContentPlan(plan.id, { status: next });
        if (!result.success || !result.data) { setError(result.error ?? 'Unable to update plan'); return; }
        setPlans(current => current.map(item => item.id === plan.id ? { ...item, ...result.data } : item));
    }

    async function saveRename(plan: ContentPlan) {
        if (!editingName.trim()) return;
        const result = await updateContentPlan(plan.id, { name: editingName });
        if (result.success && result.data) {
            setPlans(current => current.map(item => item.id === plan.id ? { ...item, ...result.data } : item));
            setEditingId(null);
        } else setError(result.error ?? 'Unable to rename plan');
    }

    return (
        <section className="space-y-5">
            {!fixedClientId && (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground">Content Plans</h1>
                        <p className="mt-1 text-sm text-muted-foreground">Turn client context and SEO opportunities into approved, executable roadmaps.</p>
                    </div>
                    <button onClick={() => setCreateOpen(true)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90">
                        <Plus className="h-4 w-4" /> New content plan
                    </button>
                </div>
            )}

            {fixedClientId && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="text-xl font-semibold">Content Plan</h2>
                        <p className="text-sm text-muted-foreground">Plan topic clusters and promote approved opportunities into delivery.</p>
                    </div>
                    <button onClick={() => setCreateOpen(true)} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                        <Plus className="h-4 w-4" /> New plan
                    </button>
                </div>
            )}

            <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-3 md:flex-row">
                <label className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <span className="sr-only">Search content plans</span>
                    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search plans or clients" className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
                </label>
                {!fixedClientId && (
                    <select aria-label="Filter by client" value={clientFilter} onChange={e => setClientFilter(e.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary">
                        <option value="all">All clients</option>
                        {clients.map(client => <option key={client.id} value={client.id}>{client.clientName}</option>)}
                    </select>
                )}
                <select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value as typeof status)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary">
                    <option value="all">All statuses</option><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option>
                </select>
            </div>

            {error && <div role="alert" className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X className="h-4 w-4" /></button></div>}

            {loading || clientsLoading ? (
                <div className="rounded-xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">Loading content plans…</div>
            ) : filtered.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><FolderTree className="h-6 w-6" /></div>
                    <h3 className="font-semibold">{plans.length ? 'No plans match these filters' : 'Create the first content plan'}</h3>
                    <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Group opportunities by topic, review them with your team, and connect approved work to execution.</p>
                    {!plans.length && <button onClick={() => setCreateOpen(true)} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /> New content plan</button>}
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                    <div className="hidden grid-cols-[minmax(220px,1.5fr)_minmax(140px,.8fr)_110px_120px_150px] gap-4 border-b border-border bg-muted/35 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground md:grid">
                        <span>Plan</span><span>Client</span><span>Status</span><span>Coverage</span><span className="text-right">Actions</span>
                    </div>
                    {filtered.map(plan => {
                        const opportunities = plan.opportunities ?? [];
                        const approved = opportunities.filter(o => o.status === 'approved' || o.status === 'promoted' || o.status === 'published').length;
                        return (
                            <article key={plan.id} className="grid gap-3 border-b border-border/70 px-4 py-4 last:border-0 md:grid-cols-[minmax(220px,1.5fr)_minmax(140px,.8fr)_110px_120px_150px] md:items-center md:gap-4">
                                <div className="min-w-0">
                                    {editingId === plan.id ? (
                                        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void saveRename(plan); }}>
                                            <input autoFocus value={editingName} onChange={e => setEditingName(e.target.value)} aria-label="Plan name" className="h-8 min-w-0 flex-1 rounded-md border border-primary bg-background px-2 text-sm" />
                                            <button className="text-xs font-semibold text-primary">Save</button>
                                        </form>
                                    ) : (
                                        <button className="block max-w-full truncate text-left font-semibold hover:text-primary" onClick={() => { setEditingId(plan.id); setEditingName(plan.name); }}>{plan.name}</button>
                                    )}
                                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <CalendarRange className="h-3.5 w-3.5" />
                                        {plan.periodStart ? `${formatDate(plan.periodStart)}${plan.periodEnd ? ` – ${formatDate(plan.periodEnd)}` : ''}` : 'Ongoing plan'}
                                    </div>
                                </div>
                                <div className="text-sm text-muted-foreground"><span className="md:hidden">Client · </span>{fixedClientName ?? clientNames.get(plan.clientId) ?? 'Unknown client'}</div>
                                <div><span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold capitalize', statusStyle[plan.status])}>{plan.status}</span></div>
                                <div className="text-sm"><span className="font-semibold">{plan.clusters?.length ?? 0}</span> <span className="text-muted-foreground">clusters</span><br /><span className="text-xs text-muted-foreground">{approved}/{opportunities.length} approved</span></div>
                                <div className="flex items-center justify-end gap-1">
                                    {plan.status === 'draft' && <button title="Activate plan" aria-label={`Activate ${plan.name}`} onClick={() => void changeStatus(plan, 'active')} className="rounded-md p-2 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600"><CheckCircle2 className="h-4 w-4" /></button>}
                                    {plan.status !== 'archived' && <button title="Archive plan" aria-label={`Archive ${plan.name}`} onClick={() => { if (confirm(`Archive “${plan.name}”?`)) void changeStatus(plan, 'archived'); }} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><Archive className="h-4 w-4" /></button>}
                                    <Link href={`/content/${plan.id}`} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary/10 px-2.5 text-xs font-semibold text-primary hover:bg-primary/15">Open <ArrowRight className="h-3.5 w-3.5" /></Link>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}

            {createOpen && organization && (
                <CreatePlanDialog organizationId={organization.id} clients={clients} fixedClientId={fixedClientId} fixedClientName={fixedClientName} onClose={() => setCreateOpen(false)} onCreated={plan => { setPlans(current => [plan, ...current]); setCreateOpen(false); }} />
            )}
        </section>
    );
}

function CreatePlanDialog({ organizationId, clients, fixedClientId, fixedClientName, onClose, onCreated }: {
    organizationId: string; clients: { id: string; clientName: string }[]; fixedClientId?: string; fixedClientName?: string; onClose: () => void; onCreated: (plan: ContentPlan) => void;
}) {
    const [clientId, setClientId] = useState(fixedClientId ?? clients[0]?.id ?? '');
    const [name, setName] = useState('');
    const [periodStart, setPeriodStart] = useState('');
    const [periodEnd, setPeriodEnd] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    async function submit(e: FormEvent) {
        e.preventDefault();
        if (!clientId || !name.trim()) return;
        setSaving(true); setError('');
        const profile = await getClientIntelligence(clientId);
        const result = await createContentPlan({ organizationId, clientId, name, periodStart, periodEnd, intelligenceVersion: profile?.version });
        setSaving(false);
        if (!result.success || !result.data) { setError(result.error ?? 'Unable to create plan'); return; }
        onCreated({ ...result.data, clusters: [], opportunities: [] });
    }

    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="create-plan-title" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
            <form onSubmit={submit} className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl">
                <div className="flex items-start justify-between border-b border-border p-5"><div><h2 id="create-plan-title" className="text-lg font-semibold">Create content plan</h2><p className="mt-1 text-sm text-muted-foreground">Start with client context, then add clusters and opportunities.</p></div><button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-5 w-5" /></button></div>
                <div className="space-y-4 p-5">
                    <label className="block text-sm font-medium">Client<select disabled={!!fixedClientId} value={clientId} onChange={e => setClientId(e.target.value)} required className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"><option value="">Select a client</option>{fixedClientId ? <option value={fixedClientId}>{fixedClientName}</option> : clients.map(c => <option key={c.id} value={c.id}>{c.clientName}</option>)}</select></label>
                    <label className="block text-sm font-medium">Plan name<input autoFocus value={name} onChange={e => setName(e.target.value)} required placeholder="Q4 organic growth roadmap" className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" /></label>
                    <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium">Start date <span className="font-normal text-muted-foreground">optional</span><input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" /></label><label className="block text-sm font-medium">End date <span className="font-normal text-muted-foreground">optional</span><input type="date" min={periodStart} value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" /></label></div>
                    <div className="flex gap-3 rounded-lg bg-primary/8 p-3 text-sm"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p className="text-muted-foreground">The current Client Intelligence version will be recorded with this plan when available.</p></div>
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                </div>
                <div className="flex justify-end gap-2 border-t border-border p-4"><button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted">Cancel</button><button disabled={saving || !clientId || !name.trim()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"><FileText className="h-4 w-4" />{saving ? 'Creating…' : 'Create plan'}</button></div>
            </form>
        </div>
    );
}

function formatDate(value: string) {
    return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
