'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ArrowLeft, Calendar, CheckCircle2, Clock, ExternalLink, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';
import { useOrganization } from '@/components/providers/organization-provider';
import { getClients } from '@/lib/supabase/clients';
import { getTimeLogs } from '@/lib/supabase/time-logs';
import { ClientProject, TimeLog } from '@/lib/types';

export default function ClientPortalPage() {
    const params = useParams();
    const id = params.id as string;
    const { organization } = useOrganization();
    const [client, setClient] = useState<ClientProject | null | undefined>(undefined);
    const [logs, setLogs] = useState<TimeLog[]>([]);
    const thisMonth = new Date().toISOString().slice(0, 7);

    useEffect(() => {
        if (!organization) return;
        Promise.all([
            getClients(organization.id),
            getTimeLogs(organization.id, { clientId: id, month: thisMonth }),
        ]).then(([all, timeLogs]) => {
            setClient(all.find(c => c.id === id) ?? null);
            setLogs(timeLogs);
        });
    }, [organization?.id, id]);

    if (client === undefined) {
        return <div className="p-8 text-muted-foreground">Loading...</div>;
    }

    if (client === null) {
        return <div className="p-8">Client not found.</div>;
    }

    const totalLogged = logs.reduce((s, l) => s + l.hours, 0);
    const totalPlanned = client.seoHours || 0;
    const percentUsed = totalPlanned > 0 ? Math.min((totalLogged / totalPlanned) * 100, 100) : 0;

    return (
        <div className="min-h-screen bg-background flex flex-col">
            <header className="border-b border-border bg-card">
                <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/workspace" className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground">
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
                                {client.clientName.charAt(0)}
                            </div>
                            <div>
                                <h1 className="font-bold text-lg leading-tight">{client.clientName}</h1>
                                <p className="text-xs text-muted-foreground">Client Portal</p>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 text-xs font-medium text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}
                        </div>
                        <button className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground">
                            <ExternalLink className="h-5 w-5" />
                        </button>
                    </div>
                </div>
            </header>

            <main className="flex-1 container mx-auto px-4 py-8 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Budget Card */}
                    <div className="col-span-1 md:col-span-2 bg-card border border-border rounded-xl p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="font-semibold flex items-center gap-2">
                                <Clock className="h-5 w-5 text-primary" />
                                Monthly Budget
                            </h2>
                            <span className="text-2xl font-bold">
                                {totalLogged.toFixed(1)}
                                <span className="text-muted-foreground text-sm font-normal"> / {totalPlanned}h</span>
                            </span>
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-medium">Utilization</span>
                                <span className="text-muted-foreground">{percentUsed.toFixed(0)}%</span>
                            </div>
                            <div className="h-4 w-full bg-muted rounded-full overflow-hidden">
                                <div
                                    className={cn("h-full rounded-full transition-all duration-1000", percentUsed > 100 ? "bg-red-500" : "bg-primary")}
                                    style={{ width: `${percentUsed}%` }}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground pt-2">
                                {totalPlanned - totalLogged > 0
                                    ? `${(totalPlanned - totalLogged).toFixed(1)} hours remaining`
                                    : `${(totalLogged - totalPlanned).toFixed(1)} hours over budget`}
                            </p>
                        </div>
                    </div>

                    {/* Status Card */}
                    <div className="bg-card border border-border rounded-xl p-6 shadow-sm flex flex-col justify-center items-center text-center space-y-4">
                        <div className={cn(
                            "w-16 h-16 rounded-full flex items-center justify-center",
                            client.status === 'Active' ? "bg-green-500/10 text-green-500" : "bg-yellow-500/10 text-yellow-500"
                        )}>
                            <CheckCircle2 className="h-8 w-8" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-lg">Project Status</h3>
                            <p className={cn(
                                "text-sm font-medium uppercase tracking-wider mt-1",
                                client.status === 'Active' ? "text-green-500" : "text-yellow-500"
                            )}>
                                {client.status}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Work Log */}
                <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                    <div className="p-6 border-b border-border/50">
                        <h2 className="font-semibold flex items-center gap-2">
                            <LayoutDashboard className="h-5 w-5 text-primary" />
                            Work Log — {new Date().toLocaleString('default', { month: 'long' })}
                        </h2>
                    </div>
                    <div className="divide-y divide-border/50">
                        {logs.length > 0 ? logs.slice(0, 10).map((log) => (
                            <div key={log.id} className="p-4 hover:bg-muted/20 transition-colors flex items-start gap-4">
                                <div className="mt-1 w-2 h-2 rounded-full bg-primary shrink-0" />
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <h4 className="font-medium text-sm">{log.description || 'SEO Work'}</h4>
                                        <span className="text-xs text-muted-foreground">{new Date(log.date).toLocaleDateString()}</span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-2">
                                        <span className="text-xs font-medium text-foreground">{log.hours}h</span>
                                    </div>
                                </div>
                            </div>
                        )) : (
                            <div className="p-8 text-center text-sm text-muted-foreground italic">
                                No hours logged this month yet.
                            </div>
                        )}
                    </div>
                    {logs.length > 10 && (
                        <div className="p-4 bg-muted/20 text-center">
                            <span className="text-sm text-muted-foreground">{logs.length - 10} more entries</span>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
