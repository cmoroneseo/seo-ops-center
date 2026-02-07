'use client';

import { ClientProject } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Clock, Calendar, TrendingUp, PieChart, AlertCircle } from 'lucide-react';

interface EngagementOverviewProps {
    client: ClientProject;
}

export function EngagementOverview({ client }: EngagementOverviewProps) {
    const isCampaign = client.engagementModel === 'Campaign';
    const config = isCampaign ? client.campaignConfig : client.retainerConfig;

    if (!config) return null;

    // Calculate percentages
    const total = isCampaign ? (config as any).totalHours : (config as any).monthlyHours;
    const used = config.hoursUsed;
    const percentage = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

    // Determine color based on usage
    let progressColor = 'bg-primary';
    if (percentage > 90) progressColor = 'bg-red-500';
    else if (percentage > 75) progressColor = 'bg-yellow-500';

    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border bg-muted/30 flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2">
                    {isCampaign ? <TrendingUp className="h-4 w-4 text-primary" /> : <Clock className="h-4 w-4 text-primary" />}
                    {isCampaign ? 'Campaign Progress' : 'Monthly Retainer'}
                </h3>
                <span className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium border",
                    isCampaign ? "bg-blue-500/10 text-blue-500 border-blue-500/20" : "bg-green-500/10 text-green-500 border-green-500/20"
                )}>
                    {client.engagementModel}
                </span>
            </div>

            <div className="p-6">
                <div className="flex items-end justify-between mb-2">
                    <div>
                        <div className="text-3xl font-bold">{used} <span className="text-sm text-muted-foreground font-medium">/ {total} hrs</span></div>
                        <p className="text-xs text-muted-foreground mt-1">
                            {isCampaign
                                ? `${(config as any).monthlyBacklinkQuota} backlinks, ${(config as any).monthlyBlogQuota} blogs remaining`
                                : 'Resets on the 1st of next month'
                            }
                        </p>
                    </div>
                    <div className="text-right">
                        <span className={cn("text-2xl font-bold", percentage > 90 ? "text-red-500" : "text-foreground")}>
                            {percentage}%
                        </span>
                        <p className="text-xs text-muted-foreground">utilized</p>
                    </div>
                </div>

                {/* Progress Bar */}
                <div className="h-3 w-full bg-muted rounded-full overflow-hidden mb-6">
                    <div
                        className={cn("h-full transition-all duration-500", progressColor)}
                        style={{ width: `${percentage}%` }}
                    />
                </div>

                {/* Date or Category Info */}
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border/50">
                    {isCampaign ? (
                        <>
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-muted text-muted-foreground">
                                    <Calendar className="h-4 w-4" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Start Date</p>
                                    <p className="text-sm font-semibold">{new Date((config as any).startDate).toLocaleDateString()}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-muted text-muted-foreground">
                                    <Clock className="h-4 w-4" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">End Date</p>
                                    <p className="text-sm font-semibold">{new Date((config as any).endDate).toLocaleDateString()}</p>
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-muted text-muted-foreground">
                                    <PieChart className="h-4 w-4" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Allocation</p>
                                    <p className="text-sm font-semibold">Flexible</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-orange-500/10 text-orange-500">
                                    <AlertCircle className="h-4 w-4" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Rollover</p>
                                    <p className="text-sm font-semibold">0 hrs</p>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
