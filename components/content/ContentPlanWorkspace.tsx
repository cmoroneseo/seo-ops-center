'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
    AlertCircle, ArrowDown, ArrowLeft, ArrowUp, BookOpen, Check, CheckCircle2, ChevronDown, ChevronRight,
    CircleDot, ExternalLink, FilePlus2, FolderPlus, FolderTree, Link2,
    Pencil, Plus, Search, Sparkles, Trash2, X,
} from 'lucide-react';
import { useClients } from '@/lib/hooks/use-clients';
import {
    ContentOpportunity, ContentOpportunityStatus, ContentOpportunityType, ContentPlan,
    ContentPriority, SearchIntent, TopicCluster,
} from '@/lib/types';
import {
    bulkUpdateOpportunityStatus, createContentOpportunity, createTopicCluster,
    deleteContentOpportunity, deleteTopicCluster, getContentPlan, promoteOpportunity,
    updateContentOpportunity, updateContentPlan, updateTopicCluster,
} from '@/lib/supabase/content-plans';
import { clientIntelligenceReadiness, getClientIntelligence } from '@/lib/supabase/client-intelligence';
import { cn } from '@/lib/utils';

const opportunityTypeLabels: Record<ContentOpportunityType, string> = {
    landing_page: 'Landing / service page', supporting_article: 'Supporting article',
    location_page: 'Location page', existing_page_refresh: 'Existing-page refresh',
    faq_addition: 'FAQ addition', comparison_case_study: 'Comparison / case study',
    consolidate_redirect: 'Consolidate / redirect', no_action: 'No action',
};
const statuses: ContentOpportunityStatus[] = ['suggested', 'approved', 'rejected', 'promoted', 'published'];
const priorities: ContentPriority[] = ['high', 'medium', 'low'];

export function ContentPlanWorkspace({ planId }: { planId: string }) {
    const { clients } = useClients({ statuses: ['Active', 'Paused', 'Cancelled', 'Onboarding'] });
    const [plan, setPlan] = useState<ContentPlan | null | undefined>(undefined);
    const [profileMeta, setProfileMeta] = useState<{ readiness: number; version?: number; updatedAt?: string }>({ readiness: 0 });
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | ContentOpportunityStatus>('all');
    const [priorityFilter, setPriorityFilter] = useState<'all' | ContentPriority>('all');
    const [typeFilter, setTypeFilter] = useState<'all' | ContentOpportunityType>('all');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [clusterDialog, setClusterDialog] = useState(false);
    const [opportunityDialog, setOpportunityDialog] = useState<string | null | undefined>(undefined);
    const [editingOpportunity, setEditingOpportunity] = useState<ContentOpportunity | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        getContentPlan(planId).then(async result => {
            if (cancelled) return;
            setPlan(result);
            if (result) {
                const profile = await getClientIntelligence(result.clientId);
                if (!cancelled) setProfileMeta({ readiness: clientIntelligenceReadiness(profile), version: profile?.version, updatedAt: profile?.updatedAt });
            }
        });
        return () => { cancelled = true; };
    }, [planId]);

    const client = clients.find(c => c.id === plan?.clientId);
    const visibleOpportunities = useMemo(() => (plan?.opportunities ?? []).filter(opportunity => {
        const haystack = `${opportunity.workingTitle} ${opportunity.keyword ?? ''} ${opportunity.targetUrl ?? ''}`.toLowerCase();
        return haystack.includes(query.toLowerCase())
            && (statusFilter === 'all' || opportunity.status === statusFilter)
            && (priorityFilter === 'all' || opportunity.priority === priorityFilter)
            && (typeFilter === 'all' || opportunity.opportunityType === typeFilter);
    }), [plan?.opportunities, query, statusFilter, priorityFilter, typeFilter]);

    const metrics = useMemo(() => {
        const all = plan?.opportunities ?? [];
        return {
            total: all.length,
            approved: all.filter(o => ['approved', 'promoted', 'published'].includes(o.status)).length,
            promoted: all.filter(o => ['promoted', 'published'].includes(o.status)).length,
            published: all.filter(o => o.status === 'published').length,
        };
    }, [plan?.opportunities]);

    function replaceOpportunity(updated: ContentOpportunity) {
        setPlan(current => current ? { ...current, opportunities: (current.opportunities ?? []).map(o => o.id === updated.id ? updated : o) } : current);
    }

    async function setOpportunityStatus(opportunity: ContentOpportunity, status: ContentOpportunityStatus) {
        const result = await updateContentOpportunity(opportunity.id, { status });
        if (result.success && result.data) replaceOpportunity(result.data); else setError(result.error ?? 'Unable to update opportunity');
    }

    async function bulkStatus(status: 'approved' | 'rejected') {
        const ids = [...selected];
        if (!ids.length) return;
        const result = await bulkUpdateOpportunityStatus(ids, status);
        if (!result.success) { setError(result.error ?? 'Unable to update opportunities'); return; }
        setPlan(current => current ? { ...current, opportunities: (current.opportunities ?? []).map(o => selected.has(o.id) ? { ...o, status } : o) } : current);
        setSelected(new Set());
    }

    async function promote(opportunity: ContentOpportunity, destination: 'task' | 'deliverable') {
        const result = await promoteOpportunity(opportunity, destination, plan!.clientId);
        if (!result.success) { setError(result.error ?? 'Unable to promote opportunity'); return; }
        replaceOpportunity({ ...opportunity, status: 'promoted', ...(destination === 'task' ? { taskId: result.recordId } : { deliverableId: result.recordId }) });
    }

    async function moveCluster(clusterId: string, direction: -1 | 1) {
        const clusters = [...(plan?.clusters ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
        const index = clusters.findIndex(cluster => cluster.id === clusterId);
        const swapIndex = index + direction;
        if (index < 0 || swapIndex < 0 || swapIndex >= clusters.length) return;
        const current = clusters[index];
        const swap = clusters[swapIndex];
        const currentOrder = current.sortOrder;
        current.sortOrder = swap.sortOrder;
        swap.sortOrder = currentOrder;
        setPlan(existing => existing ? { ...existing, clusters: [...clusters].sort((a, b) => a.sortOrder - b.sortOrder) } : existing);
        const [first, second] = await Promise.all([
            updateTopicCluster(current.id, { sortOrder: current.sortOrder }),
            updateTopicCluster(swap.id, { sortOrder: swap.sortOrder }),
        ]);
        if (!first.success || !second.success) { setError(first.error ?? second.error ?? 'Unable to reorder clusters'); void getContentPlan(planId).then(setPlan); }
    }

    if (plan === undefined) return <div className="py-20 text-center text-sm text-muted-foreground">Loading content plan…</div>;
    if (plan === null) return <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-8 text-center"><AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" /><h1 className="mt-3 text-xl font-semibold">Content plan not found</h1><Link href="/content" className="mt-4 inline-flex text-sm font-semibold text-primary">Return to Content Plans</Link></div>;

    const grouped = ([
        ...(plan.clusters ?? []).map(cluster => ({ cluster, opportunities: visibleOpportunities.filter(o => o.topicClusterId === cluster.id) })),
        { cluster: undefined, opportunities: visibleOpportunities.filter(o => !o.topicClusterId || !(plan.clusters ?? []).some(c => c.id === o.topicClusterId)) },
    ] as { cluster?: TopicCluster; opportunities: ContentOpportunity[] }[]).filter(group => group.cluster || group.opportunities.length);

    return (
        <div className="space-y-5">
            <Link href="/content" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Content Plans</Link>

            <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <input aria-label="Plan name" value={plan.name} onChange={e => setPlan({ ...plan, name: e.target.value })} onBlur={async () => { const result = await updateContentPlan(plan.id, { name: plan.name }); if (!result.success) setError(result.error ?? 'Unable to rename plan'); }} className="min-w-0 max-w-2xl border-0 bg-transparent p-0 text-2xl font-bold tracking-tight outline-none focus:ring-0 sm:text-3xl" />
                        <select aria-label="Plan status" value={plan.status} onChange={async e => { const status = e.target.value as ContentPlan['status']; const result = await updateContentPlan(plan.id, { status }); if (result.success) setPlan({ ...plan, status }); }} className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold capitalize">
                            <option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option>
                        </select>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{client?.clientName ?? 'Client'}{plan.periodStart ? ` · ${formatDate(plan.periodStart)}${plan.periodEnd ? ` – ${formatDate(plan.periodEnd)}` : ''}` : ' · Ongoing'}</p>
                </div>
                <Link href={`/workspace/${plan.clientId}?tab=intelligence`} className="group flex min-w-[280px] items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-sm hover:border-primary/40">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Sparkles className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2 text-sm font-semibold"><span>Client Intelligence</span><span className="text-primary">{profileMeta.readiness}% ready</span></div><p className="mt-0.5 truncate text-xs text-muted-foreground">{profileMeta.version ? `Version ${profileMeta.version}${profileMeta.updatedAt ? ` · updated ${relativeDate(profileMeta.updatedAt)}` : ''}` : 'No profile published · Review'}</p></div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
            </header>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Metric label="Opportunities" value={metrics.total} icon={FilePlus2} />
                <Metric label="Approved" value={metrics.approved} icon={CheckCircle2} />
                <Metric label="Promoted" value={metrics.promoted} icon={Link2} />
                <Metric label="Published" value={metrics.published} icon={ExternalLink} />
            </div>

            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 lg:flex-row lg:items-center">
                <label className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><span className="sr-only">Search opportunities</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search titles, keywords, or target pages" className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary" /></label>
                <FilterSelect label="Status" value={statusFilter} onChange={value => setStatusFilter(value as typeof statusFilter)} options={statuses} />
                <FilterSelect label="Priority" value={priorityFilter} onChange={value => setPriorityFilter(value as typeof priorityFilter)} options={priorities} />
                <FilterSelect label="Type" value={typeFilter} onChange={value => setTypeFilter(value as typeof typeFilter)} options={Object.keys(opportunityTypeLabels)} labels={opportunityTypeLabels} />
                <button onClick={() => setClusterDialog(true)} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"><FolderPlus className="h-4 w-4" /> Cluster</button>
                <button onClick={() => setOpportunityDialog(null)} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Plus className="h-4 w-4" /> Opportunity</button>
            </div>

            {error && <div role="alert" className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X className="h-4 w-4" /></button></div>}

            {selected.size > 0 && <div role="status" className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-card px-4 py-3 shadow-lg"><span className="mr-auto text-sm font-semibold">{selected.size} selected</span><button onClick={() => void bulkStatus('approved')} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><Check className="h-4 w-4" /> Approve</button><button onClick={() => void bulkStatus('rejected')} className="rounded-lg bg-destructive/10 px-3 py-1.5 text-sm font-semibold text-destructive">Reject</button><button onClick={() => setSelected(new Set())} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Clear selection"><X className="h-4 w-4" /></button></div>}

            {grouped.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center"><FolderTree className="mx-auto h-9 w-9 text-muted-foreground" /><h3 className="mt-3 font-semibold">No opportunities yet</h3><p className="mt-1 text-sm text-muted-foreground">Create a cluster, then add the pages and articles that support it.</p><button onClick={() => setClusterDialog(true)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><FolderPlus className="h-4 w-4" /> Create cluster</button></div>
            ) : grouped.map(group => (
                <ClusterSection key={group.cluster?.id ?? 'ungrouped'} cluster={group.cluster} opportunities={group.opportunities} collapsed={group.cluster ? collapsed.has(group.cluster.id) : false} onToggle={() => { if (!group.cluster) return; setCollapsed(current => { const next = new Set(current); if (next.has(group.cluster!.id)) next.delete(group.cluster!.id); else next.add(group.cluster!.id); return next; }); }} selected={selected} onSelect={setSelected} onAdd={() => setOpportunityDialog(group.cluster?.id ?? null)} onEdit={setEditingOpportunity} onStatus={setOpportunityStatus} onPromote={promote} onMove={direction => group.cluster && void moveCluster(group.cluster.id, direction)} onClusterUpdated={updated => setPlan(current => current ? { ...current, clusters: (current.clusters ?? []).map(c => c.id === updated.id ? updated : c) } : current)} onClusterDeleted={id => setPlan(current => current ? { ...current, clusters: (current.clusters ?? []).filter(c => c.id !== id), opportunities: (current.opportunities ?? []).map(o => o.topicClusterId === id ? { ...o, topicClusterId: undefined } : o) } : current)} onOpportunityDeleted={id => setPlan(current => current ? { ...current, opportunities: (current.opportunities ?? []).filter(o => o.id !== id) } : current)} />
            ))}

            {clusterDialog && <ClusterDialog organizationId={plan.organizationId} planId={plan.id} sortOrder={plan.clusters?.length ?? 0} onClose={() => setClusterDialog(false)} onCreated={cluster => { setPlan({ ...plan, clusters: [...(plan.clusters ?? []), cluster] }); setClusterDialog(false); }} />}
            {opportunityDialog !== undefined && <OpportunityDialog organizationId={plan.organizationId} planId={plan.id} clusters={plan.clusters ?? []} defaultClusterId={opportunityDialog ?? undefined} onClose={() => setOpportunityDialog(undefined)} onSaved={opportunity => { setPlan({ ...plan, opportunities: [...(plan.opportunities ?? []), opportunity] }); setOpportunityDialog(undefined); }} />}
            {editingOpportunity && <OpportunityDialog organizationId={plan.organizationId} planId={plan.id} clusters={plan.clusters ?? []} opportunity={editingOpportunity} onClose={() => setEditingOpportunity(null)} onSaved={opportunity => { replaceOpportunity(opportunity); setEditingOpportunity(null); }} />}
        </div>
    );
}

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof BookOpen }) {
    return <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"><div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></div><div><p className="text-2xl font-bold leading-none">{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></div></div>;
}

function FilterSelect({ label, value, onChange, options, labels }: { label: string; value: string; onChange: (value: string) => void; options: string[]; labels?: Record<string, string> }) {
    return <label><span className="sr-only">{label}</span><select value={value} onChange={e => onChange(e.target.value)} className="h-9 max-w-[180px] rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"><option value="all">All {label.toLowerCase()}</option>{options.map(option => <option key={option} value={option}>{labels?.[option] ?? titleCase(option)}</option>)}</select></label>;
}

function ClusterSection({ cluster, opportunities, collapsed, onToggle, selected, onSelect, onAdd, onEdit, onStatus, onPromote, onMove, onClusterUpdated, onClusterDeleted, onOpportunityDeleted }: {
    cluster?: TopicCluster; opportunities: ContentOpportunity[]; collapsed: boolean; onToggle: () => void; selected: Set<string>; onSelect: (next: Set<string>) => void; onAdd: () => void; onEdit: (opportunity: ContentOpportunity) => void; onStatus: (opportunity: ContentOpportunity, status: ContentOpportunityStatus) => void; onPromote: (opportunity: ContentOpportunity, destination: 'task' | 'deliverable') => void; onMove: (direction: -1 | 1) => void; onClusterUpdated: (cluster: TopicCluster) => void; onClusterDeleted: (id: string) => void; onOpportunityDeleted: (id: string) => void;
}) {
    const [editingTarget, setEditingTarget] = useState(false);
    const [editingName, setEditingName] = useState(false);
    const [name, setName] = useState(cluster?.name ?? '');
    const [targetUrl, setTargetUrl] = useState(cluster?.primaryTargetUrl ?? '');
    async function saveTarget() { if (!cluster) return; const result = await updateTopicCluster(cluster.id, { primaryTargetUrl: targetUrl }); if (result.success && result.data) { onClusterUpdated(result.data); setEditingTarget(false); } }
    async function saveName() { if (!cluster || !name.trim()) return; const result = await updateTopicCluster(cluster.id, { name }); if (result.success && result.data) { onClusterUpdated(result.data); setEditingName(false); } }
    async function removeCluster() { if (!cluster || !confirm(`Remove “${cluster.name}”? Its opportunities will move to Ungrouped.`)) return; const result = await deleteTopicCluster(cluster.id); if (result.success) onClusterDeleted(cluster.id); }
    return <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-3 bg-muted/25 px-4 py-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 items-center gap-2">{cluster ? <button onClick={onToggle} aria-expanded={!collapsed} className="shrink-0">{collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}</button> : <CircleDot className="h-4 w-4 shrink-0 text-muted-foreground" />}{editingName && cluster ? <form onSubmit={e => { e.preventDefault(); void saveName(); }} className="flex items-center gap-1"><input autoFocus value={name} onChange={e => setName(e.target.value)} className="h-8 rounded-md border border-primary bg-background px-2 text-sm font-semibold" /><button className="text-xs font-semibold text-primary">Save</button></form> : <button onClick={() => cluster && setEditingName(true)} disabled={!cluster} className="truncate text-left font-semibold hover:text-primary">{cluster?.name ?? 'Ungrouped opportunities'}</button>}<span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">{opportunities.length}</span></div>
            {cluster && <div className="ml-auto flex min-w-0 items-center gap-1 text-xs text-muted-foreground"><button onClick={() => onMove(-1)} aria-label={`Move ${cluster.name} up`} title="Move up" className="rounded-md p-1.5 hover:bg-background hover:text-foreground"><ArrowUp className="h-3.5 w-3.5" /></button><button onClick={() => onMove(1)} aria-label={`Move ${cluster.name} down`} title="Move down" className="rounded-md p-1.5 hover:bg-background hover:text-foreground"><ArrowDown className="h-3.5 w-3.5" /></button>{editingTarget ? <form onSubmit={e => { e.preventDefault(); void saveTarget(); }} className="flex min-w-0 items-center gap-1"><label className="sr-only">Primary target page</label><input autoFocus value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder="https://…" className="h-8 min-w-0 rounded-md border border-border bg-background px-2 text-xs sm:w-64" /><button className="rounded-md bg-primary px-2 py-1.5 font-semibold text-primary-foreground">Save</button></form> : <button onClick={() => setEditingTarget(true)} className="flex max-w-[260px] items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-background"><Link2 className="h-3.5 w-3.5" /><span className="truncate">{cluster.primaryTargetUrl || 'Set primary target page'}</span></button>}<button onClick={onAdd} aria-label={`Add opportunity to ${cluster.name}`} title="Add opportunity" className="rounded-md p-1.5 hover:bg-background hover:text-foreground"><Plus className="h-4 w-4" /></button><button onClick={() => void removeCluster()} aria-label={`Remove ${cluster.name}`} title="Remove cluster" className="rounded-md p-1.5 hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button></div>}
        </div>
        {!collapsed && <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-left text-sm"><thead><tr className="border-y border-border/70 bg-muted/10 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><th className="w-10 px-3 py-2"><span className="sr-only">Select</span></th><th className="px-3 py-2">Opportunity</th><th className="w-36 px-3 py-2">Type</th><th className="w-28 px-3 py-2">Intent</th><th className="w-24 px-3 py-2">Priority</th><th className="w-28 px-3 py-2">Status</th><th className="w-32 px-3 py-2 text-right">Actions</th></tr></thead><tbody>{opportunities.length ? opportunities.map(opportunity => <OpportunityRow key={opportunity.id} opportunity={opportunity} checked={selected.has(opportunity.id)} onCheck={checked => { const next = new Set(selected); if (checked) next.add(opportunity.id); else next.delete(opportunity.id); onSelect(next); }} onEdit={() => onEdit(opportunity)} onStatus={status => onStatus(opportunity, status)} onPromote={destination => onPromote(opportunity, destination)} onDelete={async () => { if (!confirm(`Delete “${opportunity.workingTitle}”?`)) return; const result = await deleteContentOpportunity(opportunity.id); if (result.success) onOpportunityDeleted(opportunity.id); }} />) : <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">No opportunities match these filters. <button onClick={onAdd} className="font-semibold text-primary">Add one</button></td></tr>}</tbody></table></div>}
    </section>;
}

function OpportunityRow({ opportunity, checked, onCheck, onEdit, onStatus, onPromote, onDelete }: { opportunity: ContentOpportunity; checked: boolean; onCheck: (checked: boolean) => void; onEdit: () => void; onStatus: (status: ContentOpportunityStatus) => void; onPromote: (destination: 'task' | 'deliverable') => void; onDelete: () => void }) {
    const [menu, setMenu] = useState(false);
    return <tr className={cn('border-b border-border/60 last:border-0 hover:bg-muted/15', checked && 'bg-primary/5')}><td className="px-3 py-3"><input type="checkbox" checked={checked} onChange={e => onCheck(e.target.checked)} aria-label={`Select ${opportunity.workingTitle}`} className="h-4 w-4 rounded border-border accent-primary" /></td><td className="max-w-[380px] px-3 py-3"><button onClick={onEdit} className="block max-w-full truncate text-left font-medium hover:text-primary">{opportunity.workingTitle}</button><p className="mt-0.5 truncate text-xs text-muted-foreground">{opportunity.keyword || opportunity.targetUrl || 'No target keyword yet'}</p></td><td className="px-3 py-3 text-xs text-muted-foreground">{opportunityTypeLabels[opportunity.opportunityType]}</td><td className="px-3 py-3 text-xs capitalize text-muted-foreground">{opportunity.searchIntent ?? '—'}</td><td className="px-3 py-3"><span className={cn('inline-flex items-center gap-1 text-xs font-semibold capitalize', opportunity.priority === 'high' ? 'text-rose-600 dark:text-rose-400' : opportunity.priority === 'medium' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}><CircleDot className="h-3 w-3" />{opportunity.priority}</span></td><td className="px-3 py-3"><select aria-label={`Status for ${opportunity.workingTitle}`} value={opportunity.status} onChange={e => onStatus(e.target.value as ContentOpportunityStatus)} className="max-w-[110px] rounded-full border border-border bg-background px-2 py-1 text-xs font-semibold capitalize"><option value="suggested">Suggested</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="promoted">Promoted</option><option value="published">Published</option></select></td><td className="px-3 py-3"><div className="relative flex justify-end gap-1">{opportunity.taskId ? <Link href="/tasks" title="Open linked task" className="rounded-md p-1.5 text-primary hover:bg-primary/10"><Link2 className="h-4 w-4" /></Link> : opportunity.deliverableId ? <Link href="/deliverables" title="Open linked deliverable" className="rounded-md p-1.5 text-primary hover:bg-primary/10"><Link2 className="h-4 w-4" /></Link> : opportunity.status === 'approved' ? <button onClick={() => setMenu(!menu)} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1.5 text-xs font-semibold text-primary">Promote <ChevronDown className="h-3 w-3" /></button> : null}<button onClick={onEdit} title="Edit" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-4 w-4" /></button><button onClick={onDelete} title="Delete" className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>{menu && <div className="absolute right-12 top-8 z-20 w-44 rounded-lg border border-border bg-popover p-1 shadow-xl"><button onClick={() => { onPromote('task'); setMenu(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium hover:bg-muted"><CheckCircle2 className="h-4 w-4" /> Create task</button><button onClick={() => { onPromote('deliverable'); setMenu(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium hover:bg-muted"><FilePlus2 className="h-4 w-4" /> Create deliverable</button></div>}</div></td></tr>;
}

function ClusterDialog({ organizationId, planId, sortOrder, onClose, onCreated }: { organizationId: string; planId: string; sortOrder: number; onClose: () => void; onCreated: (cluster: TopicCluster) => void }) {
    const [name, setName] = useState(''); const [seed, setSeed] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
    async function submit(e: FormEvent) { e.preventDefault(); setSaving(true); const result = await createTopicCluster({ organizationId, contentPlanId: planId, name, seedKeyword: seed, sortOrder }); setSaving(false); if (result.success && result.data) onCreated(result.data); else setError(result.error ?? 'Unable to create cluster'); }
    return <Modal title="Create topic cluster" description="Use a service, location, product, or theme — a pillar page is optional." onClose={onClose}><form onSubmit={submit} className="space-y-4"><Field label="Cluster name" value={name} onChange={setName} placeholder="Emergency plumbing services" autoFocus /><Field label="Seed keyword" value={seed} onChange={setSeed} placeholder="emergency plumber" optional />{error && <p className="text-sm text-destructive">{error}</p>}<ModalActions onClose={onClose} saving={saving} submitLabel="Create cluster" disabled={!name.trim()} /></form></Modal>;
}

function OpportunityDialog({ organizationId, planId, clusters, defaultClusterId, opportunity, onClose, onSaved }: { organizationId: string; planId: string; clusters: TopicCluster[]; defaultClusterId?: string; opportunity?: ContentOpportunity; onClose: () => void; onSaved: (opportunity: ContentOpportunity) => void }) {
    const [title, setTitle] = useState(opportunity?.workingTitle ?? ''); const [keyword, setKeyword] = useState(opportunity?.keyword ?? ''); const [clusterId, setClusterId] = useState(opportunity?.topicClusterId ?? defaultClusterId ?? ''); const [type, setType] = useState<ContentOpportunityType>(opportunity?.opportunityType ?? 'supporting_article'); const [intent, setIntent] = useState<SearchIntent | ''>(opportunity?.searchIntent ?? ''); const [priority, setPriority] = useState<ContentPriority>(opportunity?.priority ?? 'medium'); const [targetUrl, setTargetUrl] = useState(opportunity?.targetUrl ?? ''); const [existingUrl, setExistingUrl] = useState(opportunity?.existingUrl ?? ''); const [dueDate, setDueDate] = useState(opportunity?.dueDate ?? ''); const [notes, setNotes] = useState(opportunity?.notes ?? ''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
    async function submit(e: FormEvent) { e.preventDefault(); setSaving(true); const payload = { topicClusterId: clusterId || undefined, opportunityType: type, workingTitle: title, keyword, searchIntent: intent || undefined, priority, targetUrl, existingUrl, dueDate, notes }; const result = opportunity ? await updateContentOpportunity(opportunity.id, payload) : await createContentOpportunity({ organizationId, contentPlanId: planId, ...payload }); setSaving(false); if (result.success && result.data) onSaved(result.data); else setError(result.error ?? 'Unable to save opportunity'); }
    return <Modal title={opportunity ? 'Edit opportunity' : 'Add content opportunity'} description="Capture the recommendation now; refine assignment and execution after approval." onClose={onClose} wide><form onSubmit={submit} className="space-y-4"><Field label="Working title" value={title} onChange={setTitle} placeholder="How to choose an emergency plumber" autoFocus /><div className="grid gap-4 sm:grid-cols-2"><Field label="Target keyword" value={keyword} onChange={setKeyword} placeholder="emergency plumber" optional /><label className="block text-sm font-medium">Topic cluster<select value={clusterId} onChange={e => setClusterId(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"><option value="">Ungrouped</option>{clusters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="block text-sm font-medium">Opportunity type<select value={type} onChange={e => setType(e.target.value as ContentOpportunityType)} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm">{Object.entries(opportunityTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="block text-sm font-medium">Search intent<select value={intent} onChange={e => setIntent(e.target.value as SearchIntent | '')} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"><option value="">Not set</option><option value="informational">Informational</option><option value="commercial">Commercial</option><option value="transactional">Transactional</option><option value="navigational">Navigational</option></select></label><label className="block text-sm font-medium">Priority<select value={priority} onChange={e => setPriority(e.target.value as ContentPriority)} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label className="block text-sm font-medium">Due date <span className="font-normal text-muted-foreground">optional</span><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" /></label></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Existing page" value={existingUrl} onChange={setExistingUrl} placeholder="https://example.com/current" optional /><Field label="Target page" value={targetUrl} onChange={setTargetUrl} placeholder="https://example.com/service" optional /></div><label className="block text-sm font-medium">Notes <span className="font-normal text-muted-foreground">optional</span><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></label>{error && <p className="text-sm text-destructive">{error}</p>}<ModalActions onClose={onClose} saving={saving} submitLabel={opportunity ? 'Save changes' : 'Add opportunity'} disabled={!title.trim()} /></form></Modal>;
}

function Modal({ title, description, onClose, wide, children }: { title: string; description: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) { return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className={cn('my-auto w-full rounded-2xl border border-border bg-card shadow-2xl', wide ? 'max-w-2xl' : 'max-w-lg')}><div className="flex items-start justify-between border-b border-border p-5"><div><h2 id="modal-title" className="text-lg font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div><button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-5 w-5" /></button></div><div className="p-5">{children}</div></div></div>; }
function Field({ label, value, onChange, placeholder, optional, autoFocus }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; optional?: boolean; autoFocus?: boolean }) { return <label className="block text-sm font-medium">{label} {optional && <span className="font-normal text-muted-foreground">optional</span>}<input autoFocus={autoFocus} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" /></label>; }
function ModalActions({ onClose, saving, submitLabel, disabled }: { onClose: () => void; saving: boolean; submitLabel: string; disabled?: boolean }) { return <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted">Cancel</button><button disabled={saving || disabled} className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{saving ? 'Saving…' : submitLabel}</button></div>; }
function titleCase(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase()); }
function formatDate(value: string) { return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
function relativeDate(value: string) { const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000); return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`; }
