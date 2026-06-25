'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, ClipboardList, Clock, FileText, HeartPulse, Target } from 'lucide-react';
import type { ClientProject } from '@/lib/types';
import { cn } from '@/lib/utils';
import { getClientOverview } from '@/lib/supabase/client-overview';
import type { ClientOverview, NextBestAction } from '@/lib/supabase/client-overview';
import { severityBadgeClass } from '@/components/deliverables/deliverable-ui';

interface ClientOverviewWidgetProps {
    client: ClientProject;
    organizationId: string;
}

function formatHours(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function actionBadgeClass(priority: NextBestAction['priority']): string {
    switch (priority) {
        case 'critical': return 'text-red-500 bg-red-500/10 border-red-500/20';
        case 'high': return 'text-orange-500 bg-orange-500/10 border-orange-500/20';
        case 'medium': return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
        default: return 'text-green-500 bg-green-500/10 border-green-500/20';
    }
}

function OverviewCard({
    icon,
    label,
    value,
    detail,
    badge,
    className,
}: {
    icon: ReactNode;
    label: string;
    value: ReactNode;
    detail?: ReactNode;
    badge?: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('rounded-xl border border-border bg-card p-4', className)}>
            <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        {icon}
                        <span>{label}</span>
                    </div>
                    <div className="text-2xl font-bold">{value}</div>
                </div>
                {badge}
            </div>
            {detail && <div className="mt-3 text-xs text-muted-foreground">{detail}</div>}
        </div>
    );
}

export function ClientOverviewWidget({ client, organizationId }: ClientOverviewWidgetProps) {
    const enabled = process.env.NEXT_PUBLIC_WORKSPACE_OVERVIEW === 'true';
    const [overview, setOverview] = useState<ClientOverview | null>(null);
    const [loading, setLoading] = useState(enabled);

    useEffect(() => {
        if (!enabled || !organizationId) return;
        let active = true;
        setLoading(true);
        getClientOverview(client, organizationId)
            .then((data) => {
                if (active) setOverview(data);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [client, enabled, organizationId]);

    if (!enabled) return null;

    if (loading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="h-32 rounded-xl border border-border bg-card animate-pulse" />
                ))}
            </div>
        );
    }

    if (!overview) return null;

    const primaryAction = overview.nextBestActions[0];
    const healthSeverity = overview.healthScore >= 85 ? 'ok' : overview.healthScore >= 70 ? 'warn' : 'critical';

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <OverviewCard
                icon={<HeartPulse className="h-4 w-4 text-primary" />}
                label="Health Score"
                value={`${overview.healthScore}`}
                badge={(
                    <span className={cn('px-2 py-0.5 rounded text-xs font-medium border', severityBadgeClass(healthSeverity))}>
                        {healthSeverity === 'ok' ? 'Healthy' : healthSeverity === 'warn' ? 'Watch' : 'Critical'}
                    </span>
                )}
                detail="Based on deliverables, hours, blocked tasks, and plan readiness."
            />
            <OverviewCard
                icon={<Clock className="h-4 w-4 text-primary" />}
                label="Hours This Month"
                value={<>{formatHours(overview.hours.logged)} <span className="text-sm font-medium text-muted-foreground">/ {formatHours(overview.hours.budget)} hrs</span></>}
                badge={(
                    <span className={cn('px-2 py-0.5 rounded text-xs font-medium border', severityBadgeClass(overview.hours.status.severity))}>
                        {overview.hours.status.status}
                    </span>
                )}
                detail={overview.hours.status.reason}
            />
            <OverviewCard
                icon={<ClipboardList className="h-4 w-4 text-primary" />}
                label="Open Tasks"
                value={overview.tasks.open}
                badge={overview.tasks.blocked > 0 && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium border text-red-500 bg-red-500/10 border-red-500/20">
                        {overview.tasks.blocked} blocked
                    </span>
                )}
                detail={overview.tasks.blocked > 0 ? 'Blocked work needs manager attention.' : 'No blocked tasks.'}
            />
            <OverviewCard
                icon={<FileText className="h-4 w-4 text-primary" />}
                label="Deliverables"
                value={<>{overview.deliverables.delivered}<span className="text-sm font-medium text-muted-foreground"> / {overview.deliverables.promised}</span></>}
                badge={overview.deliverables.overdue > 0 ? (
                    <span className="px-2 py-0.5 rounded text-xs font-medium border text-red-500 bg-red-500/10 border-red-500/20">
                        {overview.deliverables.overdue} overdue
                    </span>
                ) : (
                    <span className="px-2 py-0.5 rounded text-xs font-medium border text-green-500 bg-green-500/10 border-green-500/20">
                        On pace
                    </span>
                )}
                detail={`${overview.deliverables.inProgress} in production, ${overview.deliverables.atRisk} at risk groups.`}
            />
            <OverviewCard
                icon={<Target className="h-4 w-4 text-primary" />}
                label="Campaign Plan"
                value={overview.campaignPlan.exists ? 'Ready' : 'Missing'}
                badge={overview.campaignPlan.exists ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : (
                    <AlertCircle className="h-5 w-5 text-yellow-500" />
                )}
                detail={overview.campaignPlan.title ?? 'No active plan found.'}
            />
            <OverviewCard
                icon={<AlertCircle className="h-4 w-4 text-primary" />}
                label="Next Best Action"
                value={<span className="text-lg">{primaryAction.label}</span>}
                badge={(
                    <span className={cn('px-2 py-0.5 rounded text-xs font-medium border capitalize', actionBadgeClass(primaryAction.priority))}>
                        {primaryAction.priority}
                    </span>
                )}
                detail={primaryAction.detail}
            />
        </div>
    );
}
