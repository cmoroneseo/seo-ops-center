'use client';

import { useEffect, useState, useCallback } from 'react';
import { ClipboardList, Plus, Search, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarketingPlan, MarketingPlanItem } from '@/lib/types';
import {
    getMarketingPlan, createMarketingPlanFromTemplate, addCustomItem,
} from '@/lib/supabase/marketing-plans';
import { createClient } from '@/lib/supabase/client';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { logActivity } from '@/lib/supabase/client-activity';
import {
    computePlanSummary, groupItems, filterItems, GroupMode,
} from '@/lib/marketing-plan-logic';
import { SummaryStrip } from './SummaryStrip';
import { StepRail } from './StepRail';
import { ItemRow, MemberOption } from './ItemRow';
import { AddItemForm } from './AddItemForm';

interface MarketingPlanTabProps {
    organizationId: string;
    clientId: string;
    clientName: string;
}

export function MarketingPlanTab({ organizationId, clientId, clientName }: MarketingPlanTabProps) {
    const [plan, setPlan] = useState<MarketingPlan | null>(null);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [groupMode, setGroupMode] = useState<GroupMode>('step');
    const [query, setQuery] = useState('');
    const [activeStepKey, setActiveStepKey] = useState<string | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [members, setMembers] = useState<MemberOption[]>([]);
    const [currentUser, setCurrentUser] = useState<{ id?: string; name: string }>({ name: 'Team' });

    const loadPlan = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        const p = await getMarketingPlan(clientId);
        setPlan(p);
        setLoading(false);
    }, [clientId]);

    const refresh = useCallback(() => loadPlan(true), [loadPlan]);

    useEffect(() => { loadPlan(); }, [loadPlan]);

    useEffect(() => {
        if (!organizationId) return;
        getOrganizationMembers(organizationId).then(ms => {
            const opts = ms.map(m => ({
                userId: m.userId,
                displayName: m.user?.fullName ?? m.user?.email ?? 'Member',
            }));
            setMembers(opts);
            const supabase = createClient();
            if (!supabase) return;
            supabase.auth.getUser().then((res: Awaited<ReturnType<typeof supabase.auth.getUser>>) => {
                const uid = res.data.user?.id;
                if (!uid) return;
                const me = opts.find(o => o.userId === uid);
                setCurrentUser({ id: uid, name: me?.displayName ?? res.data.user?.email ?? 'Team' });
            });
        });
    }, [organizationId]);

    const handleCreate = async () => {
        setCreating(true);
        const res = await createMarketingPlanFromTemplate({ organizationId, clientId, clientName });
        if (res.success) {
            logActivity({ clientId, eventType: 'campaign.created', metadata: { source: 'marketing_plan_template' } });
        }
        setCreating(false);
        await loadPlan();
    };

    const handleAddItem = async (fields: {
        stepKey: string; title: string; description?: string;
        priority: 'high' | 'medium' | 'low';
    }) => {
        if (!plan) return;
        const maxSort = Math.max(0, ...(plan.items ?? []).map(i => i.sortOrder));
        await addCustomItem({
            marketingPlanId: plan.id, organizationId, clientId,
            ...fields, sortOrder: maxSort + 1,
        });
        setShowAddForm(false);
        refresh();
    };

    if (loading) {
        return <div className="text-center py-12 text-muted-foreground text-sm italic">Loading marketing plan…</div>;
    }

    // Empty state
    if (!plan) {
        return (
            <div className="text-center py-16 space-y-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <ClipboardList className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">No SEO Marketing Plan Yet</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Create a plan for {clientName} — a 7-step SEO checklist covering setup,
                    technical, research, content, on-page, links, and local.
                </p>
                <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                    <Plus className="h-4 w-4" />
                    {creating ? 'Creating…' : 'Create SEO Marketing Plan'}
                </button>
            </div>
        );
    }

    const items = plan.items ?? [];
    const summary = computePlanSummary(items);
    const visibleItems = filterItems(items, query);
    const groups = groupItems(visibleItems, plan.steps, groupMode)
        .filter(g => groupMode !== 'step' || !activeStepKey || g.key === activeStepKey);

    const GROUP_MODES: { key: GroupMode; label: string }[] = [
        { key: 'step', label: 'By Step' },
        { key: 'priority', label: 'By Priority' },
        { key: 'status', label: 'By Status' },
    ];

    return (
        <div className="space-y-6" id="marketing-plan-root">
            {/* Print rules: hide app chrome when exporting */}
            <style>{`@media print { nav, aside, header, .print\\:hidden { display: none !important; } }`}</style>

            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{plan.title}</h3>
                <button
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors print:hidden"
                >
                    <Upload className="h-3.5 w-3.5" /> Export
                </button>
            </div>

            <SummaryStrip summary={summary} />

            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 items-start">
                <StepRail
                    steps={plan.steps}
                    items={items}
                    activeStepKey={activeStepKey}
                    onSelect={key => {
                        setGroupMode('step');
                        setActiveStepKey(prev => prev === key ? null : key);
                    }}
                />

                <div className="space-y-4 min-w-0">
                    {/* Toolbar */}
                    <div className="flex items-center gap-3 flex-wrap print:hidden">
                        <div className="flex items-center gap-1 border-b border-border/50">
                            {GROUP_MODES.map(m => (
                                <button
                                    key={m.key}
                                    onClick={() => { setGroupMode(m.key); setActiveStepKey(null); }}
                                    className={cn(
                                        'px-3 py-2 text-xs font-semibold uppercase tracking-wide border-b-2 -mb-px transition-colors',
                                        groupMode === m.key
                                            ? 'border-primary text-foreground'
                                            : 'border-transparent text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    {m.label}
                                </button>
                            ))}
                        </div>
                        <div className="flex-1" />
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <input
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                placeholder="Search by keyword..."
                                className="text-sm border border-border rounded-lg pl-8 pr-3 py-1.5 bg-card w-52"
                            />
                        </div>
                        <button
                            onClick={() => setShowAddForm(f => !f)}
                            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-green-700 transition-colors"
                        >
                            <Plus className="h-4 w-4" /> Add Item
                        </button>
                    </div>

                    {showAddForm && (
                        <AddItemForm
                            steps={plan.steps}
                            defaultStepKey={activeStepKey ?? undefined}
                            onSubmit={handleAddItem}
                            onCancel={() => setShowAddForm(false)}
                        />
                    )}

                    {/* Groups */}
                    {groups.map(group => {
                        const done = group.items.filter(i => i.status === 'done').length;
                        const countable = group.items.filter(i => i.status !== 'ignored').length;
                        return (
                            <section key={group.key} className="rounded-xl border border-border/50 bg-card px-5 py-2">
                                <div className="flex items-center justify-between py-3">
                                    <h4 className="font-bold text-base">{group.label}</h4>
                                    <span className="text-sm text-muted-foreground">
                                        <span className="text-primary font-semibold">{done}</span>/{countable}
                                    </span>
                                </div>
                                {group.items.length === 0 ? (
                                    <p className="text-sm text-muted-foreground italic pb-4">No items.</p>
                                ) : (
                                    group.items.map(item => (
                                        <ItemRow
                                            key={item.id}
                                            item={item}
                                            members={members}
                                            currentUser={currentUser}
                                            onChanged={refresh}
                                        />
                                    ))
                                )}
                            </section>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
