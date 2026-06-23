'use client';

import { useState, useEffect } from 'react';
import { Gauge, Check, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { updateCampaignPlan } from '@/lib/supabase/campaign-plans';
import { SectionCard, CustomFieldSectionProps } from './SectionCard';
import { SEO_ACTIVITIES, ScopeActivity, getActivityAvgHours } from '@/lib/scope-estimates';

interface ScopeItem {
    key: string;
    inScope: boolean;
    upsellOpportunity: boolean;
    customHours?: number;
}

interface ScopePlanningData {
    monthlyHours: number;
    items: ScopeItem[];
}

export function ScopeMeterSection({ plan, expanded, onToggle, onRefresh }: CustomFieldSectionProps) {
    const saved = (plan.customFields.scopePlanning ?? {}) as Partial<ScopePlanningData>;
    const [monthlyHours, setMonthlyHours] = useState(saved.monthlyHours ?? 0);
    const [items, setItems] = useState<ScopeItem[]>(() => {
        const savedItems = saved.items ?? [];
        return SEO_ACTIVITIES.map(act => {
            const existing = savedItems.find(i => i.key === act.key);
            return existing ?? { key: act.key, inScope: false, upsellOpportunity: false };
        });
    });

    useEffect(() => {
        const s = (plan.customFields.scopePlanning ?? {}) as Partial<ScopePlanningData>;
        setMonthlyHours(s.monthlyHours ?? 0);
        if (s.items?.length) {
            setItems(SEO_ACTIVITIES.map(act => {
                const existing = s.items!.find(i => i.key === act.key);
                return existing ?? { key: act.key, inScope: false, upsellOpportunity: false };
            }));
        }
    }, [plan.customFields.scopePlanning]);

    const save = async (hours: number, updatedItems: ScopeItem[]) => {
        const data: ScopePlanningData = { monthlyHours: hours, items: updatedItems.filter(i => i.inScope || i.upsellOpportunity) };
        await updateCampaignPlan(plan.id, {
            customFields: { ...plan.customFields, scopePlanning: data },
        });
        onRefresh();
    };

    const toggleInScope = (key: string) => {
        const updated = items.map(i => i.key === key ? { ...i, inScope: !i.inScope, upsellOpportunity: false } : i);
        setItems(updated);
        save(monthlyHours, updated);
    };

    const toggleUpsell = (key: string) => {
        const updated = items.map(i => i.key === key ? { ...i, upsellOpportunity: !i.upsellOpportunity, inScope: false } : i);
        setItems(updated);
        save(monthlyHours, updated);
    };

    const handleHoursChange = (hours: number) => {
        setMonthlyHours(hours);
        save(hours, items);
    };

    // Calculations
    const inScopeItems = items.filter(i => i.inScope);
    const upsellItems = items.filter(i => i.upsellOpportunity);
    const monthlyInScope = inScopeItems.reduce((sum, item) => {
        const act = SEO_ACTIVITIES.find(a => a.key === item.key);
        if (!act) return sum;
        const hours = item.customHours ?? getActivityAvgHours(act);
        if (act.frequency === 'monthly') return sum + hours;
        if (act.frequency === 'quarterly') return sum + hours / 3;
        return sum;
    }, 0);
    const oneTimeTotal = inScopeItems.reduce((sum, item) => {
        const act = SEO_ACTIVITIES.find(a => a.key === item.key);
        if (!act || act.frequency !== 'one_time') return sum;
        return sum + (item.customHours ?? getActivityAvgHours(act));
    }, 0);

    const utilizationPercent = monthlyHours > 0 ? Math.round((monthlyInScope / monthlyHours) * 100) : 0;
    const overScope = monthlyInScope > monthlyHours;
    const barColor = overScope ? 'bg-red-500' : utilizationPercent >= 80 ? 'bg-yellow-500' : 'bg-green-500';

    const categories = [...new Set(SEO_ACTIVITIES.map(a => a.category))];

    return (
        <SectionCard
            icon={Gauge} title="Scope Meter" count={inScopeItems.length}
            expanded={expanded} onToggle={onToggle}
        >
            <div className="space-y-5">
                {/* Hours input + meter */}
                <div className="flex items-end gap-4">
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Monthly SEO Hours</label>
                        <input
                            type="number"
                            value={monthlyHours || ''}
                            onChange={e => handleHoursChange(Number(e.target.value) || 0)}
                            placeholder="e.g. 20"
                            className="bg-transparent border border-border/50 rounded-md text-sm py-1.5 px-3 w-24 outline-none focus:border-primary"
                        />
                    </div>
                    <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                                {monthlyInScope.toFixed(1)}h recurring / {monthlyHours}h available
                                {oneTimeTotal > 0 && <span className="ml-2 text-muted-foreground/60">+ {oneTimeTotal.toFixed(1)}h one-time setup</span>}
                            </span>
                            <span className={cn(
                                'font-medium',
                                overScope ? 'text-red-500' : utilizationPercent >= 80 ? 'text-yellow-500' : 'text-green-500',
                            )}>
                                {utilizationPercent}%
                            </span>
                        </div>
                        <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                            <div
                                className={cn('h-full rounded-full transition-all duration-500', barColor)}
                                style={{ width: `${Math.min(utilizationPercent, 100)}%` }}
                            />
                        </div>
                        {overScope && (
                            <p className="text-[10px] text-red-500 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                Over scope by {(monthlyInScope - monthlyHours).toFixed(1)}h — reduce activities or increase hours
                            </p>
                        )}
                    </div>
                </div>

                {/* Activity checklist by category */}
                <div className="space-y-4">
                    {categories.map(cat => {
                        const catActivities = SEO_ACTIVITIES.filter(a => a.category === cat);
                        return (
                            <div key={cat}>
                                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{cat}</h4>
                                <div className="space-y-1">
                                    {catActivities.map(act => {
                                        const item = items.find(i => i.key === act.key)!;
                                        const avgHours = getActivityAvgHours(act);
                                        return (
                                            <div key={act.key} className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/30 transition-colors">
                                                <button
                                                    onClick={() => toggleInScope(act.key)}
                                                    className={cn(
                                                        'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                                                        item.inScope ? 'bg-green-500 border-green-500' : 'border-border',
                                                    )}
                                                >
                                                    {item.inScope && <Check className="h-2.5 w-2.5 text-white" />}
                                                </button>
                                                <span className={cn('text-sm flex-1', item.inScope ? 'text-foreground' : item.upsellOpportunity ? 'text-muted-foreground' : 'text-muted-foreground/70')}>
                                                    {act.label}
                                                </span>
                                                <span className="text-[10px] text-muted-foreground/60 shrink-0">
                                                    {act.minHours}–{act.maxHours}h
                                                    {act.frequency !== 'monthly' && ` (${act.frequency.replace('_', '-')})`}
                                                </span>
                                                <button
                                                    onClick={() => toggleUpsell(act.key)}
                                                    title={item.upsellOpportunity ? 'Flagged as upsell' : 'Flag as upsell opportunity'}
                                                    className={cn(
                                                        'p-0.5 rounded transition-colors shrink-0',
                                                        item.upsellOpportunity ? 'text-amber-500' : 'text-muted-foreground/30 hover:text-amber-500/50',
                                                    )}
                                                >
                                                    <ArrowUpRight className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Upsell summary */}
                {upsellItems.length > 0 && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-1">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-amber-500">
                            <ArrowUpRight className="h-3.5 w-3.5" />
                            Upsell Opportunities ({upsellItems.length})
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                            {upsellItems.map(item => {
                                const act = SEO_ACTIVITIES.find(a => a.key === item.key);
                                return act ? (
                                    <div key={item.key} className="flex items-center justify-between">
                                        <span>{act.label}</span>
                                        <span className="text-muted-foreground/60">{act.minHours}–{act.maxHours}h</span>
                                    </div>
                                ) : null;
                            })}
                        </div>
                    </div>
                )}
            </div>
        </SectionCard>
    );
}
