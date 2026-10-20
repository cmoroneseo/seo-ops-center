'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { MissingClient } from '@/components/workspace/MissingClient';
import { ArrowLeft, Calendar, Clock, Shield, UserCheck, Plug, Target, ScanSearch, Map, FileCheck2, Globe, Archive } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ClientNotesPanel } from '@/components/workspace/ClientNotesPanel';
import { ActivityFeed } from '@/components/workspace/ActivityFeed';
import { ReassignModal } from '@/components/workspace/ReassignModal';
import { isClientAtRisk } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';
import { EngagementOverview } from '@/components/workspace/EngagementOverview';
import { ClientDeliverablesTab } from '@/components/deliverables/ClientDeliverablesTab';
import { MonthlyPlannerCard } from '@/components/workspace/MonthlyPlannerCard';
import { SearchInsightsTab } from '@/components/workspace/SearchInsightsTab';
import { SiteInventoryTab } from '@/components/workspace/SiteInventoryTab';
import { TopicalMapTab } from '@/components/workspace/TopicalMapTab';
import { IntegrationsTab } from '@/components/workspace/IntegrationsTab';
import { ClientSetupScopeCard } from '@/components/workspace/ClientSetupScopeCard';
import { ClientOverviewWidget } from '@/components/workspace/ClientOverviewWidget';
import { ClientWorkspaceCanvas } from '@/components/workspace/canvas/ClientWorkspaceCanvas';
import { workspaceCanvasEnabled } from '@/lib/workspace-canvas/flag';
import { EditClientPanel, ClientAvatar } from '@/components/workspace/EditClientPanel';
import { getClients } from '@/lib/supabase/clients';
import { ClientActionsMenu } from '@/components/workspace/ClientActionsMenu';
import { archivedClientPath, canDeleteClient, notifyClientsChanged } from '@/lib/clients/delete-client';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { useTimer } from '@/components/providers/timer-provider';
import { ClientProject } from '@/lib/types';
import { clientScopeLabel } from '@/lib/hour-format';
import { Pencil, Play, Pause } from 'lucide-react';
import { TaskListView } from '@/components/tasks/TaskListView';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal';
import { getTask, getTasksByClient } from '@/lib/supabase/tasks';
import { getLoggedHoursByClient } from '@/lib/supabase/time-logs';
import { Task } from '@/lib/types';
import { SEO_PLAN_LABEL } from '@/lib/marketing-plan-template';
import { MarketingPlanTab } from '@/components/marketing-plan/MarketingPlanTab';
import { ResultsView } from '@/components/marketing-plan/ResultsView';
import { searchReportingEnabled } from '@/lib/search-reporting/flag';
import { parsePlanView, type PlanView } from '@/lib/search-reporting/ledger';
import { BasecampImportModal } from '@/components/workspace/BasecampImportModal';
import { AddOnboardingToPlanButton } from '@/components/marketing-plan/AddOnboardingToPlanButton';
import { NestLinkedTasksControl } from '@/components/marketing-plan/NestLinkedTasksControl';
import { ONBOARDING_IMPORT_HINT } from '@/lib/seo-plan/onboarding-import';
import { ClientApprovalsTab } from '@/components/approvals/ClientApprovalsTab';
import { ClientPortalStaffPanel } from '@/components/portal/ClientPortalStaffPanel';
import { VaultHeaderPill } from '@/components/vault/VaultHeaderPill';
import { VaultPage } from '@/components/vault/VaultPage';
import { useVaultEnabled } from '@/components/vault/use-vault-enabled';
import { StagePlanList } from '@/components/seo-plan/StagePlanList';
import { useSeoPlanStageList } from '@/components/seo-plan/use-seo-plan-stage-list';
import { useSeoPlanV2 } from '@/components/seo-plan/use-seo-plan-v2';
import { seoPlanReadOnly } from '@/lib/seo-plan/read-only';
import { WorkspaceNav } from '@/components/seo-plan/WorkspaceNav';
import { PanelSkeleton } from '@/components/seo-plan/PanelSkeleton';
import { PlanOverviewPanel } from '@/components/seo-plan/PlanOverviewPanel';
import { prefetchClientWorkspace } from '@/lib/seo-plan/prefetch';
import { TaskToolbar } from '@/components/seo-plan/TaskToolbar';
import { SearchReporting } from '@/components/seo-plan/SearchReporting';
import { monthKey } from '@/lib/marketing-plan-execution';
import { managerIsAssigned, planHourLabel, planHoursNarrative } from '@/lib/seo-plan/overview';
import { planChooseTaskClass } from '@/lib/seo-plan/row-timer';

type Tab = 'overview' | 'campaign' | 'tasks' | 'integrations' | 'insights' | 'inventory' | 'topical-map' | 'approvals' | 'portal' | 'vault';

export default function ClientDetailPage() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;
    const { organization, memberships } = useOrganization();
    const { isOwner, displayName, isLoading: memberLoading, userId } = useCurrentMember();
    const membership = memberships.find((member) => member.userId === userId);
    const vaultEnabled = useVaultEnabled(organization?.id);
    const seoPlanV2 = useSeoPlanV2(organization?.id);
    const v2On = seoPlanV2 === true;
    const stageListOn = useSeoPlanStageList(organization?.id);
    const v2Ref = useRef(v2On);
    v2Ref.current = v2On;
    const [client, setClient] = useState<ClientProject | null | undefined>(undefined); // undefined = loading
    const [showReassign, setShowReassign] = useState(false);
    const [showEditPanel, setShowEditPanel] = useState(false);
    const [activityRefreshKey, setActivityRefreshKey] = useState(0);
    const [activeTab, setActiveTabState] = useState<Tab>('overview');
    const [planView, setPlanView] = useState<PlanView>('plan');
    const [importOpen, setImportOpen] = useState(false);
    const setActiveTab = (tab: Tab, extras?: Record<string, string | null>) => {
        const v2 = v2Ref.current;
        const next: Tab = !v2 && tab === 'tasks' ? 'campaign' : tab;
        setActiveTabState(next);
        if (!v2 && tab === 'tasks') setPlanView('tasks');
        else if (tab === 'campaign' || tab === 'tasks') setPlanView('plan');
        const url = new URL(window.location.href);
        url.searchParams.set('tab', next);
        if (!v2 && tab === 'tasks') url.searchParams.set('planView', 'tasks');
        else url.searchParams.delete('planView');
        for (const [key, value] of Object.entries(extras ?? {})) {
            if (value == null) url.searchParams.delete(key);
            else url.searchParams.set(key, value);
        }
        window.history.replaceState(null, '', url);
    };

    useEffect(() => {
        const query = new URLSearchParams(window.location.search);
        const tab = query.get('tab');
        if (tab && ['overview', 'campaign', 'tasks', 'integrations', 'insights', 'inventory', 'topical-map', 'approvals', 'portal'].includes(tab)) setActiveTabState(tab as Tab);
        if (tab === 'tasks') { setActiveTabState('campaign'); setPlanView('tasks'); }
        else setPlanView(parsePlanView(query.get('planView'), searchReportingEnabled()));
        if (!tab && (query.has('range') || query.has('section'))) setActiveTabState('insights');
        if (query.has('integrationSuccess') || query.has('integrationError')) setActiveTabState('integrations');
    }, [id]);

    // The vault tab exists only after the allowlist resolves true. A shared
    // ?tab=vault link stays on Overview while the flag is off.
    useEffect(() => {
        if (vaultEnabled === false) {
            setActiveTabState(current => (current === 'vault' ? 'overview' : current));
            return;
        }
        if (vaultEnabled !== true) return;
        if (new URLSearchParams(window.location.search).get('tab') === 'vault') setActiveTabState('vault');
    }, [vaultEnabled, id]);

    useEffect(() => {
        const openVault = () => {
            if (vaultEnabled !== true) return;
            setActiveTabState('vault');
        };
        window.addEventListener('vault:navigate', openVault);
        return () => window.removeEventListener('vault:navigate', openVault);
    }, [vaultEnabled]);

    useEffect(() => {
        if (seoPlanV2 !== true) return;
        const query = new URLSearchParams(window.location.search);
        const tab = query.get('tab');
        const view = query.get('planView');
        if (tab === 'tasks' || view === 'tasks') setActiveTabState('tasks');
        else if (tab === 'plan') setActiveTabState('campaign');
        else if ((tab === 'campaign' || tab === 'plan') && view === 'results') setActiveTabState('insights');
    }, [seoPlanV2, id]);
    const [clientTasks, setClientTasks] = useState<Task[]>([]);
    const [loggedHours, setLoggedHours] = useState<number | undefined>(undefined);
    const [calendarDueDate, setCalendarDueDate] = useState<string | undefined>();
    const [hoursMonth, setHoursMonth] = useState<string | null>(null);
    const canvasEnabled = workspaceCanvasEnabled();
    const [tasksLoading, setTasksLoading] = useState(false);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false);
    const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
    const [timerTaskRequired, setTimerTaskRequired] = useState(false);
    const { runningTimer, pause } = useTimer();

    const isThisClientRunning = runningTimer?.clientId === id;

    const handleTimerClick = async () => {
        if (!client) return;
        if (isThisClientRunning && runningTimer) {
            await pause(runningTimer);
        } else {
            setActiveTab('tasks');
            setTimerTaskRequired(true);
        }
    };

    useEffect(() => {
        prefetchClientWorkspace(id);
    }, [id]);

    useEffect(() => {
        const organizationId = organization?.id;
        if (!organizationId) return;
        let cancelled = false;
        setClient(undefined);
        getClients(organizationId).then((all) => {
            if (cancelled) return;
            const found = all.find(c => c.id === id);
            setClient(found ?? null);
        });
        return () => { cancelled = true; };
    }, [organization?.id, id]);

    const showClientTasks = v2On ? activeTab === 'tasks' : activeTab === 'campaign' && planView === 'tasks';
    useEffect(() => {
        if (!showClientTasks || !id) return;
        let cancelled = false;
        setTasksLoading(true);
        getTasksByClient(id).then(tasks => {
            if (cancelled) return;
            setClientTasks(tasks);
            setTasksLoading(false);
        });
        return () => { cancelled = true; };
    }, [showClientTasks, id]);

    // Budget-consuming hours for this month — excludes internal work and client
    // meetings flagged as not counting toward budget. Re-read whenever confirmed
    // time lands so SEO hours and the feed refresh together.
    useEffect(() => {
        if (!organization?.id || !id) return;
        let cancelled = false;
        if (canvasEnabled) return;
        const month = new Date().toISOString().slice(0, 7);
        getLoggedHoursByClient(organization.id, month).then(byClient => {
            if (!cancelled) setLoggedHours(byClient[id] ?? 0);
        });
        return () => { cancelled = true; };
    }, [organization?.id, id, activityRefreshKey, canvasEnabled]);

    useEffect(() => {
        const refresh = () => setActivityRefreshKey(key => key + 1);
        window.addEventListener('client-activity:data-changed', refresh);
        return () => window.removeEventListener('client-activity:data-changed', refresh);
    }, []);

    if (client === undefined) {
        return (
            <div className="space-y-6" aria-busy="true">
                <div className="flex flex-col space-y-4" aria-hidden="true">
                    <div className="h-5 w-40 animate-pulse rounded bg-muted" />
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-muted" />
                            <div className="space-y-2">
                                <div className="h-9 w-64 max-w-full animate-pulse rounded bg-muted" />
                                <div className="h-4 w-80 max-w-full animate-pulse rounded bg-muted" />
                            </div>
                        </div>
                        <div className="flex items-center gap-3 pr-2">
                            <div className="h-8 w-24 animate-pulse rounded-full bg-muted" />
                            <div className="h-8 w-28 animate-pulse rounded-lg bg-muted" />
                        </div>
                    </div>
                </div>
                {seoPlanV2 === true ? (
                    <WorkspaceNav active="overview" vault={false} onSelect={() => {}} />
                ) : (
                    <div className="flex h-10 items-center gap-3 border-b border-border/50" aria-hidden="true">
                        {Array.from({ length: 6 }, (_, index) => (
                            <span key={index} className="h-4 w-16 animate-pulse rounded bg-muted" />
                        ))}
                    </div>
                )}
                <PanelSkeleton label="Loading client" />
            </div>
        );
    }

    if (client === null) {
        return <MissingClient organizationName={organization?.name} />;
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

                <div className="flex flex-wrap items-start justify-between gap-4">
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
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
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
                                <span>{seoPlanV2 == null ? (
                                    <span className="inline-block h-4 w-28 animate-pulse rounded bg-muted" aria-label="Loading hours" />
                                ) : v2On ? planHourLabel({
                                    seoHours: client.seoHours,
                                    scopeMode: client.setupScope?.mode,
                                    status: client.status,
                                    launchDate: client.launchDateOverride ?? client.launchDate,
                                    month: monthKey(),
                                }) : clientScopeLabel(client)}</span>
                            </div>
                            {(v2On || canvasEnabled) && <div className="flex flex-wrap items-center gap-2">
                                <UserCheck className="h-4 w-4" />
                                {v2On && !managerIsAssigned(client.accountManager) ? (
                                    <button type="button" onClick={() => setShowReassign(true)} className="rounded px-1 text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring">Assign manager</button>
                                ) : (
                                    <>
                                        <span>Manager: {client.accountManager || 'Unassigned'}</span>
                                        {isOwner && <button type="button" onClick={() => setShowReassign(true)} className="rounded px-1 text-xs font-medium text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">Reassign</button>}
                                    </>
                                )}
                            </div>}
                            {(v2On || canvasEnabled) && client.domain && <a href={/^https?:\/\//i.test(client.domain) ? client.domain : `https://${client.domain}`} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">{client.domain}</a>}
                        </div>
                        </div>{/* end inner space-y-1 */}
                    </div>{/* end flex items-center gap-4 (logo + text) */}

                    <div className="flex items-center gap-3 pr-2">
                        <VaultHeaderPill clientId={client.id} organizationId={organization?.id} onOpen={() => setActiveTab('vault')} />
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
                            title={isThisClientRunning ? 'Pause timer' : 'Choose a task to start timer'}
                            data-choose-task={activeTab === 'campaign' && stageListOn && !isThisClientRunning ? 'secondary' : undefined}
                            className={cn(
                                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150',
                                planChooseTaskClass(activeTab === 'campaign' && stageListOn, isThisClientRunning),
                            )}
                        >
                            {isThisClientRunning
                                ? <><Pause className="h-3.5 w-3.5 fill-current" /> Pause</>
                                : <><Play className="h-3.5 w-3.5 fill-current" /> Choose Task</>
                            }
                        </button>
                        <ClientActionsMenu
                            clientId={client.id}
                            clientName={client.clientName}
                            canDelete={!memberLoading && canDeleteClient(membership?.role)}
                            onDeleted={(name) => {
                                notifyClientsChanged();
                                router.push(archivedClientPath(name));
                            }}
                        />
                    </div>
                </div>
            </div>

            {timerTaskRequired && (
                <p className="-mt-3 text-sm text-muted-foreground">
                    Choose a task below to start time tracking for this client.
                </p>
            )}

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
            {seoPlanV2 === null ? (
                <div className="flex h-10 items-center gap-3 border-b border-border/50" aria-hidden="true">
                    {Array.from({ length: 6 }, (_, index) => (
                        <span key={index} className="h-4 w-16 animate-pulse rounded bg-muted" />
                    ))}
                </div>
            ) : v2On ? (
                <WorkspaceNav
                    active={activeTab}
                    vault={vaultEnabled === true}
                    onSelect={tab => setActiveTab(tab as Tab, tab === 'campaign' ? { phase: null } : undefined)}
                />
            ) : (
            <div className="flex items-center gap-1 overflow-x-auto border-b border-border/50">
                <button
                    onClick={() => setActiveTab('overview')}
                    className={cn(
                        'flex shrink-0 whitespace-nowrap items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                        activeTab === 'overview'
                            ? 'border-primary text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                >
                    Overview
                </button>
                {vaultEnabled === true && (
                    <button
                        onClick={() => setActiveTab('vault')}
                        className={cn(
                            'flex shrink-0 whitespace-nowrap items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                            activeTab === 'vault'
                                ? 'border-primary text-foreground'
                                : 'border-transparent text-muted-foreground hover:text-foreground',
                        )}
                    >
                        <Archive className="h-3.5 w-3.5" />
                        Vault
                    </button>
                )}
                <button
                    onClick={() => setActiveTab('campaign', { phase: null })}
                    className={cn(
                        'flex shrink-0 whitespace-nowrap items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                        activeTab === 'campaign'
                            ? 'border-primary text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                >
                    <Target className="h-3.5 w-3.5" />
                    {SEO_PLAN_LABEL}
                </button>
                <button
                    onClick={() => setActiveTab('insights')}
                    className={cn('shrink-0 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors', activeTab === 'insights' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
                >Search Insights</button>
                <button
                    onClick={() => setActiveTab('inventory')}
                    className={cn('flex shrink-0 items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors', activeTab === 'inventory' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
                ><ScanSearch className="h-3.5 w-3.5" />Site Inventory</button>
                <button
                    onClick={() => setActiveTab('topical-map')}
                    className={cn('flex shrink-0 items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors', activeTab === 'topical-map' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
                ><Map className="h-3.5 w-3.5" />Topical Map</button>
                <button
                    onClick={() => setActiveTab('approvals')}
                    className={cn('flex shrink-0 items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors', activeTab === 'approvals' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
                ><FileCheck2 className="h-3.5 w-3.5" />Approvals</button>
                <button
                    onClick={() => setActiveTab('portal')}
                    className={cn('flex shrink-0 items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors', activeTab === 'portal' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
                ><Globe className="h-3.5 w-3.5" />Portal management</button>
                <button
                    onClick={() => setActiveTab('integrations')}
                    className={cn(
                        'flex shrink-0 whitespace-nowrap items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                        activeTab === 'integrations'
                            ? 'border-primary text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                >
                    <Plug className="h-3.5 w-3.5" />
                    Integrations
                </button>
            </div>
            )}

            {/* SEO Marketing Plan tab */}
            {activeTab === 'campaign' && seoPlanV2 === false && !stageListOn && <nav aria-label="SEO Plan sections" className="mb-5 flex flex-wrap items-center gap-2 border-b border-border pb-3">
                {([
                    ['plan', 'Monthly plan'],
                    ['tasks', 'All client tasks'],
                    ...(searchReportingEnabled() ? [['results', 'Results'] as const] : []),
                ] as const).map(([view, label]) => <button key={view} aria-pressed={planView === view} onClick={() => {
                    setPlanView(view);
                    const url = new URL(window.location.href);
                    url.searchParams.set('tab', 'campaign');
                    if (view === 'plan') url.searchParams.delete('planView');
                    else url.searchParams.set('planView', view);
                    window.history.replaceState(null, '', url);
                }} className={cn('rounded-lg px-4 py-2 text-sm font-medium', planView === view ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted')}>{label}</button>)}
            </nav>}
            {activeTab === 'campaign' && stageListOn && (
                <StagePlanList
                    clientId={client.id}
                    clientName={client.clientName}
                    onOpenResults={() => setActiveTab('insights')}
                />
            )}
            {(v2On ? activeTab === 'campaign' : activeTab === 'campaign' && planView === 'plan') && !stageListOn && (
                <MarketingPlanTab
                    key={v2On ? 'plan-v2' : 'plan-classic'}
                    organizationId={organization?.id ?? ''}
                    clientId={client.id}
                    clientName={client.clientName}
                    monthlyBudget={client.setupScope?.mode === 'custom' ? null : client.seoHours || client.retainerConfig?.monthlyHours || 0}
                    scopeMode={client.setupScope?.mode === 'custom' ? 'custom' : 'monthly'}
                    presentation={v2On ? 'v2' : 'classic'}
                    checklistScope={{ gbp: client.setupScope?.gbp === true, listings: client.setupScope?.listings === true }}
                    readOnly={v2On && seoPlanReadOnly(client.status)}
                    hoursNarrative={planHoursNarrative({
                        seoHours: client.seoHours,
                        scopeMode: client.setupScope?.mode,
                        status: client.status,
                        launchDate: client.launchDateOverride ?? client.launchDate,
                        month: monthKey(),
                    })}
                />
            )}

            {!v2On && !stageListOn && activeTab === 'campaign' && planView === 'results' && (
                <ResultsView
                    organizationId={organization?.id ?? ''}
                    clientId={client.id}
                    clientName={client.clientName}
                    clientDomain={client.domain ?? null}
                />
            )}

            {/* Tasks tab */}
            {(v2On ? activeTab === 'tasks' : activeTab === 'campaign' && planView === 'tasks' && !stageListOn) && (
                <div className="space-y-4">
                    <TaskToolbar
                        clientName={client.clientName}
                        activeCount={clientTasks.filter(t => t.status !== 'done').length}
                        completedCount={clientTasks.filter(t => t.status === 'done').length}
                        overflowImport={v2On}
                        onImport={() => setImportOpen(true)}
                        onCreate={() => setIsCreateTaskOpen(true)}
                    />

                    <p className="text-sm text-muted-foreground">{ONBOARDING_IMPORT_HINT} All client work stays here, including ad hoc requests. The SEO Plan shows the work you add to it.</p>
                    {organization && (
                        <AddOnboardingToPlanButton
                            clientId={client.id}
                            organizationId={organization.id}
                            onDone={() => { void getTasksByClient(id).then(setClientTasks); }}
                        />
                    )}
                    <NestLinkedTasksControl
                        clientId={client.id}
                        actorName={displayName}
                        onDone={() => { void getTasksByClient(id).then(setClientTasks); }}
                    />
                    {importOpen && organization && <BasecampImportModal isOpen onClose={() => setImportOpen(false)} onSuccess={() => {
                        void getTasksByClient(id).then(setClientTasks);
                    }} clientId={client.id} organizationId={organization.id} />}
                    {tasksLoading ? (
                        <div className="text-center py-12 text-muted-foreground text-sm italic">Loading tasks…</div>
                    ) : (
                        <TaskListView
                            tasks={clientTasks}
                            onTaskClick={(task) => {
                                setSelectedTask(task);
                                setIsTaskDetailOpen(true);
                            }}
                            onTaskUpdated={updated => {
                                setClientTasks(prev => prev.map(task => task.id === updated.id ? updated : task));
                                setSelectedTask(current => current?.id === updated.id ? updated : current);
                            }}
                        />
                    )}

                </div>
            )}

            {vaultEnabled === true && activeTab === 'vault' && (
                <VaultPage clientId={client.id} clientName={client.clientName} />
            )}

            {activeTab === 'insights' && client.organizationId === organization?.id && (
                <>
                <SearchInsightsTab key={`${organization.id}:${client.id}`} organizationId={organization.id} clientId={client.id} clientName={client.clientName} onConnections={() => setActiveTab('integrations')} onSiteInventory={() => setActiveTab('inventory')} />
                {v2On && (
                    <SearchReporting
                        organizationId={organization.id}
                        clientId={client.id}
                        clientName={client.clientName}
                        clientDomain={client.domain ?? null}
                        sharePageFreshness
                    />
                )}
                </>
            )}

            {activeTab === 'inventory' && client.organizationId === organization?.id && (
                <SiteInventoryTab key={`${organization.id}:${client.id}`} clientId={client.id} clientName={client.clientName} />
            )}

            {activeTab === 'topical-map' && client.organizationId === organization?.id && (
                <TopicalMapTab
                    organizationId={organization?.id ?? ''}
                    clientId={client.id}
                    clientName={client.clientName}
                />
            )}

            {activeTab === 'approvals' && client.organizationId === organization?.id && (
                <ClientApprovalsTab
                    clientId={client.id}
                    organizationId={organization?.id ?? ''}
                />
            )}

            {activeTab === 'portal' && client.organizationId === organization?.id && (
                <ClientPortalStaffPanel clientId={client.id} clientName={client.clientName} />
            )}

            {/* Integrations tab */}
            {activeTab === 'integrations' && client.organizationId === organization?.id && (
                <Suspense fallback={null}>
                    <IntegrationsTab
                        key={`${organization.id}:${client.id}`}
                        clientId={client.id}
                        clientName={client.clientName}
                        website={client.domain}
                    />
                </Suspense>
            )}

            {/* Overview tab content */}
            {activeTab === 'overview' && v2On && (
                <>
                <PlanOverviewPanel
                    clientId={client.id}
                    domain={client.domain}
                    hoursLabel={planHourLabel({
                        seoHours: client.seoHours,
                        scopeMode: client.setupScope?.mode,
                        status: client.status,
                        launchDate: client.launchDateOverride ?? client.launchDate,
                        month: monthKey(),
                    })}
                    onOpenPlan={() => setActiveTab('campaign', { phase: null })}
                    onOpenTasks={() => setActiveTab('tasks')}
                />
                <div className="mt-8">
                    <ActivityFeed client={client} refreshKey={activityRefreshKey} />
                </div>
                </>
            )}

            {activeTab === 'overview' && seoPlanV2 === false && canvasEnabled && <>
            <ClientWorkspaceCanvas
                client={client}
                organizationId={organization?.id ?? ''}
                refreshKey={activityRefreshKey}
                onAddWork={(date) => { setCalendarDueDate(date); setIsCreateTaskOpen(true); }}
                onOpenTask={(taskId) => {
                    void getTask(taskId).then(result => {
                        if (!result.task) return;
                        setSelectedTask(result.task);
                        setIsTaskDetailOpen(true);
                    });
                }}
                onOpenPlan={() => setActiveTab('campaign', { phase: null })}
                onOpenPhase={(phase) => setActiveTab('campaign', { phase })}
                onViewAllTasks={() => setActiveTab('tasks', { phase: null })}
                onReview={(batchId) => setActiveTab('approvals', { approvalBatch: batchId })}
                onConnections={() => setActiveTab('integrations')}

                onOpenDeliverables={(id) => router.push(id ? `/deliverables?deliverable=${encodeURIComponent(id)}` : '/deliverables')}
                onMonthChange={setHoursMonth}
                selectedMonth={hoursMonth}
            />
            <ClientSetupScopeCard client={client} />
            <ActivityFeed client={client} refreshKey={activityRefreshKey} />
            </>}

            {activeTab === 'overview' && seoPlanV2 === false && !canvasEnabled && <>

            <ClientSetupScopeCard client={client} />
            <ClientOverviewWidget client={client} organizationId={organization?.id ?? ''} />

            {/* Engagement & Stats */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <EngagementOverview client={client} loggedHours={loggedHours} />
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
                            {isOwner && (
                                <button
                                    onClick={() => setShowReassign(true)}
                                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border hover:border-primary/40 rounded-md px-2.5 py-1.5 transition-all"
                                    title="Reassign account manager"
                                >
                                    <UserCheck className="h-3.5 w-3.5" />
                                    Reassign
                                </button>
                            )}
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
                    <ClientDeliverablesTab
                        organizationId={organization?.id ?? ''}
                        clientId={client.id}
                        clientName={client.clientName}
                        clientDomain={client.domain ?? null}
                    />
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

            <TaskDetailModal
                task={selectedTask}
                isOpen={isTaskDetailOpen}
                onClose={() => setIsTaskDetailOpen(false)}
                onUpdate={(updated) => {
                    setClientTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
                    setSelectedTask(updated);
                    setActivityRefreshKey(key => key + 1);
                }}
            />
            <CreateTaskModal
                isOpen={isCreateTaskOpen}
                onClose={() => { setIsCreateTaskOpen(false); setCalendarDueDate(undefined); }}
                onCreated={(created) => {
                    setClientTasks(prev => [created, ...prev]);
                    setActivityRefreshKey(key => key + 1);
                }}
                organizationId={organization?.id ?? ''}
                defaultDueDate={calendarDueDate}
                defaultClientId={client.id}
                defaultClientName={client.clientName}
            />

            {/* Reassign Modal */}
            {showReassign && (
                <ReassignModal
                    client={client}
                    currentManager={client.accountManager}
                    onClose={() => setShowReassign(false)}
                    onSuccess={(newManager, newManagerId) => {
                        setClient({ ...client, accountManager: newManager, accountManagerId: newManagerId });
                        setShowReassign(false);
                        setActivityRefreshKey(k => k + 1);
                    }}
                />
            )}
        </div>
    );
}
