'use client';

import { useEffect, useState, Suspense } from 'react';
import { useParams } from 'next/navigation';
import { notFound } from 'next/navigation';
import { ArrowLeft, Calendar, Clock, MoreVertical, Shield, UserCheck, Plug } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ClientNotesPanel } from '@/components/workspace/ClientNotesPanel';
import { ActivityFeed } from '@/components/workspace/ActivityFeed';
import { ReassignModal } from '@/components/workspace/ReassignModal';
import { isClientAtRisk } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';
import { EngagementOverview } from '@/components/workspace/EngagementOverview';
import { DeliverablesTracker } from '@/components/workspace/DeliverablesTracker';
import { MonthlyPlannerCard } from '@/components/workspace/MonthlyPlannerCard';
import { IntegrationsTab } from '@/components/workspace/IntegrationsTab';
import { EditClientPanel, ClientAvatar } from '@/components/workspace/EditClientPanel';
import { getClients } from '@/lib/supabase/clients';
import { useOrganization } from '@/components/providers/organization-provider';
import { useTimer } from '@/components/providers/timer-provider';
import { ClientProject } from '@/lib/types';
import { Pencil, Play, Pause } from 'lucide-react';

type Tab = 'overview' | 'integrations';

export default function ClientDetailPage() {
    const params = useParams();
    const id = params.id as string;
    const { organization } = useOrganization();
    const [client, setClient] = useState<ClientProject | null | undefined>(undefined); // undefined = loading
    const [showReassign, setShowReassign] = useState(false);
    const [showEditPanel, setShowEditPanel] = useState(false);
    const [activityRefreshKey, setActivityRefreshKey] = useState(0);
    const [activeTab, setActiveTab] = useState<Tab>('overview');
    const { timer, start, pause } = useTimer();

    const isThisClientRunning = timer?.status === 'running' && timer.clientId === id;

    const handleTimerClick = async () => {
        if (!client) return;
        if (isThisClientRunning) {
            await pause();
        } else {
            await start({ clientId: client.id, clientName: client.clientName });
        }
    };

    useEffect(() => {
        if (!organization) return;
        getClients(organization.id).then((all) => {
            const found = all.find(c => c.id === id);
            setClient(found ?? null);
        });
    }, [organization?.id, id]);

    if (client === undefined) {
        return <div className="p-8 text-muted-foreground">Loading client...</div>;
    }

    if (client === null) {
        notFound();
    }

    const atRisk = isClientAtRisk(client);

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col space-y-4">
                <Link
                    href="/workspace"
                    className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Workspace
                </Link>

                {atRisk && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center gap-3 text-red-500">
                        <AlertTriangle className="h-5 w-5" />
                        <div>
                            <div className="font-semibold">At Risk: Falling Behind Schedule</div>
                            <div className="text-sm text-red-500/80">This client is significantly behind on monthly deliverables.</div>
                        </div>
                    </div>
                )}

                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                        <ClientAvatar name={client.clientName} logoUrl={client.logoUrl} size="lg" />
                        <div className="space-y-1">
                        <div className="flex items-center gap-2">
                        <h1 className="text-3xl font-bold tracking-tight neon-gradient-text">{client.clientName}</h1>
                        <button
                            onClick={() => setShowEditPanel(true)}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Edit client"
                        >
                            <Pencil className="h-4 w-4" />
                        </button>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            {client.launchDate && (
                                <div className="flex items-center gap-1.5">
                                    <Calendar className="h-4 w-4" />
                                    <span>Launched {new Date(client.launchDate.includes('T') ? client.launchDate : client.launchDate + 'T00:00:00').toLocaleDateString()}</span>
                                </div>
                            )}
                            <div className="flex items-center gap-1.5">
                                <Shield className="h-4 w-4" />
                                <span>Tier {client.tier}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <Clock className="h-4 w-4" />
                                <span>{client.seoHours}h/mo</span>
                            </div>
                        </div>
                        </div>{/* end inner space-y-1 */}
                    </div>{/* end flex items-center gap-4 (logo + text) */}

                    <div className="flex items-center gap-3 pr-2">
                        <div className={cn(
                            "px-3 py-1 rounded-full text-sm font-medium border",
                            client.status === 'Active' ? "bg-green-500/10 text-green-500 border-green-500/20" :
                                client.status === 'Cancelled' ? "bg-red-500/10 text-red-500 border-red-500/20" :
                                    "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
                        )}>
                            {client.status}
                        </div>
                        <button
                            onClick={handleTimerClick}
                            title={isThisClientRunning ? 'Pause timer' : 'Start timer for this client'}
                            className={cn(
                                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150',
                                isThisClientRunning
                                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25'
                                    : 'bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20 border border-green-500/20'
                            )}
                        >
                            {isThisClientRunning
                                ? <><Pause className="h-3.5 w-3.5 fill-current" /> Pause</>
                                : <><Play className="h-3.5 w-3.5 fill-current" /> Start Timer</>
                            }
                        </button>
                        <button className="p-2 hover:bg-muted rounded-md transition-colors">
                            <MoreVertical className="h-5 w-5 text-muted-foreground" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Edit client slide-over */}
            {showEditPanel && (
                <EditClientPanel
                    client={client}
                    onClose={() => setShowEditPanel(false)}
                    onSaved={(updated) => {
                        setClient(updated);
                        setShowEditPanel(false);
                    }}
                />
            )}

            {/* Tab bar */}
            <div className="flex items-center gap-1 border-b border-border/50">
                <button
                    onClick={() => setActiveTab('overview')}
                    className={cn(
                        'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                        activeTab === 'overview'
                            ? 'border-primary text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                >
                    Overview
                </button>
                <button
                    onClick={() => setActiveTab('integrations')}
                    className={cn(
                        'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                        activeTab === 'integrations'
                            ? 'border-primary text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                >
                    <Plug className="h-3.5 w-3.5" />
                    Integrations
                </button>
            </div>

            {/* Integrations tab */}
            {activeTab === 'integrations' && (
                <Suspense fallback={null}>
                    <IntegrationsTab clientId={client.id} />
                </Suspense>
            )}

            {/* Overview tab content */}
            {activeTab === 'overview' && <>

            {/* Engagement & Stats */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <EngagementOverview client={client} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl border border-border/50 bg-card flex flex-col justify-center">
                        <div className="text-sm text-muted-foreground mb-1">Blogs/mo</div>
                        <div className="text-2xl font-bold">
                            {client.blogsDuePerMonth || '—'}
                            {client.blogsDuePerMonth > 0 && <span className="text-sm font-normal text-muted-foreground"> /mo</span>}
                        </div>
                    </div>
                    <div className="p-4 rounded-xl border border-border/50 bg-card flex flex-col justify-center">
                        <div className="text-sm text-muted-foreground mb-1">Tier</div>
                        <div className="text-2xl font-bold">T{client.tier}</div>
                    </div>
                    <div className="col-span-2 p-4 rounded-xl border border-border/50 bg-card flex items-center justify-between">
                        <div>
                            <div className="text-sm text-muted-foreground mb-1">Account Manager</div>
                            <div className="font-medium">{client.accountManager}</div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setShowReassign(true)}
                                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border hover:border-primary/40 rounded-md px-2.5 py-1.5 transition-all"
                                title="Reassign account manager"
                            >
                                <UserCheck className="h-3.5 w-3.5" />
                                Reassign
                            </button>
                            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                                {(client.accountManager || '?').charAt(0)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <MonthlyPlannerCard client={client} />
                    <DeliverablesTracker client={client} />
                    <ClientNotesPanel client={client} />
                </div>

                <div className="space-y-6">
                    <div className="rounded-xl border border-border/50 bg-card p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold">Pending Approvals</h3>
                            {client.approvals.pendingCount > 0 && (
                                <span className="bg-orange-500/10 text-orange-500 text-xs font-medium px-2 py-0.5 rounded-full">
                                    {client.approvals.pendingCount}
                                </span>
                            )}
                        </div>
                        <div className="space-y-3">
                            {client.approvals.items.length > 0 ? (
                                client.approvals.items.map((item) => (
                                    <div key={item.id} className="p-3 rounded-lg bg-muted/30 border border-border/50 text-sm">
                                        <div className="flex items-center justify-between">
                                            <div className="font-medium">{item.title}</div>
                                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground border border-border px-1.5 rounded">
                                                {item.type}
                                            </span>
                                        </div>
                                        <div className="text-muted-foreground text-xs mt-1 flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            Sent {new Date(item.sentDate.includes('T') ? item.sentDate : item.sentDate + 'T00:00:00').toLocaleDateString()}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-sm text-muted-foreground italic text-center py-4">
                                    No pending approvals
                                </div>
                            )}
                        </div>
                    </div>
                    <ActivityFeed client={client} refreshKey={activityRefreshKey} />
                </div>
            </div>

            </> /* end overview tab */}

            {/* Reassign Modal */}
            {showReassign && (
                <ReassignModal
                    client={client}
                    currentManager={client.accountManager}
                    onClose={() => setShowReassign(false)}
                    onSuccess={(newManager) => {
                        setClient({ ...client, accountManager: newManager });
                        setShowReassign(false);
                        setActivityRefreshKey(k => k + 1);
                    }}
                />
            )}
        </div>
    );
}
