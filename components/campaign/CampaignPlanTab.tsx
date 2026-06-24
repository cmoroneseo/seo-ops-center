'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Target, Plus, Sparkles, Send, Check, CheckCircle2, Upload,
    BarChart3, Search, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CampaignPlan, CampaignPlanStatus } from '@/lib/types';
import {
    getCampaignPlanFull, createCampaignPlan, updateCampaignPlan,
    upsertCampaignGoal, upsertCampaignKpi, upsertCampaignWorkstream,
    upsertCampaignPhase, upsertCampaignExpectation,
} from '@/lib/supabase/campaign-plans';
import { logActivity } from '@/lib/supabase/client-activity';
import { CAMPAIGN_TEMPLATES, CampaignTemplate } from '@/lib/campaign-templates';
import { QuestionnaireImportModal, ExtractedCampaignData } from './QuestionnaireImportModal';
import { STATUS_LABELS } from './sections/SectionCard';

import { SeoOverviewSection } from './sections/SeoOverviewSection';
import { GoalsSection } from './sections/GoalsSection';
import { KpisSection } from './sections/KpisSection';
import { KeywordSnapshotSection } from './sections/KeywordSnapshotSection';
import { WebsiteAnalysisSection } from './sections/WebsiteAnalysisSection';
import { KeyActivitiesSection } from './sections/KeyActivitiesSection';
// WorkstreamsSection removed — covered by Key Activities + Scope Meter
import { PreliminaryRoadmapSection } from './sections/PreliminaryRoadmapSection';
import { TimelineSection } from './sections/TimelineSection';
import { ExpectationsSection } from './sections/ExpectationsSection';
import { ScopeMeterSection } from './sections/ScopeMeterSection';

// ---------------------------------------------------------------------------

type CampaignTab = 'goals' | 'campaign' | 'timeline';

interface CampaignPlanTabProps {
    organizationId: string;
    clientId: string;
    clientName: string;
}

export function CampaignPlanTab({ organizationId, clientId, clientName }: CampaignPlanTabProps) {
    const [plan, setPlan] = useState<CampaignPlan | null>(null);
    const [loading, setLoading] = useState(true);
    const [showTemplateSelector, setShowTemplateSelector] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [activeTab, setActiveTab] = useState<CampaignTab>('goals');
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
        seoOverview: true, goals: true, kpis: true, keywordSnapshot: true,
        websiteAnalysis: true, keyActivities: true, workstreams: true,
        preliminaryRoadmap: true, timeline: true, expectations: true,
    });

    const toggleSection = (key: string) =>
        setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

    const loadPlan = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        const p = await getCampaignPlanFull(clientId);
        setPlan(p);
        setLoading(false);
    }, [clientId]);

    const refreshPlan = useCallback(() => loadPlan(true), [loadPlan]);

    useEffect(() => { loadPlan(); }, [loadPlan]);

    // Create from template
    const handleCreateFromTemplate = async (template: CampaignTemplate) => {
        setShowTemplateSelector(false);
        const res = await createCampaignPlan({
            organizationId, clientId,
            title: `${clientName} — ${template.name}`,
            strategyModel: template.strategyModel,
        });
        if (!res.success || !res.data) return;
        const planId = res.data.id;

        await Promise.all([
            ...template.workstreams.map((ws, i) =>
                upsertCampaignWorkstream({
                    campaignPlanId: planId, organizationId, clientId,
                    name: ws.name, category: ws.category, sortOrder: i,
                }),
            ),
            ...template.phases.map(ph =>
                upsertCampaignPhase({
                    campaignPlanId: planId, organizationId, clientId,
                    name: ph.name, phaseOrder: ph.phaseOrder, objective: ph.objective,
                }),
            ),
            ...template.suggestedKpis.map((kpi, i) =>
                upsertCampaignKpi({
                    campaignPlanId: planId, organizationId, clientId,
                    metricName: kpi.metricName, kpiGroup: kpi.kpiGroup,
                    source: kpi.source, sortOrder: i,
                }),
            ),
            ...template.suggestedExpectations.map((exp, i) =>
                upsertCampaignExpectation({
                    campaignPlanId: planId, organizationId, clientId,
                    type: exp.type, statement: exp.statement,
                    targetWindowDays: exp.targetWindowDays, sortOrder: i,
                }),
            ),
        ]);

        const customFields: Record<string, unknown> = {};
        if (template.defaultSeoOverview) customFields.seoOverview = template.defaultSeoOverview;
        if (template.defaultPreliminaryRoadmap) customFields.preliminaryRoadmap = { stages: template.defaultPreliminaryRoadmap };
        if (template.defaultKeyActivities) customFields.keyActivities = { items: template.defaultKeyActivities };
        if (Object.keys(customFields).length > 0) {
            await updateCampaignPlan(planId, { customFields });
        }

        logActivity({ clientId, eventType: 'campaign.created', metadata: { template: template.key } });
        await loadPlan();
    };

    const handleCreateBlank = async () => {
        setShowTemplateSelector(false);
        await createCampaignPlan({
            organizationId, clientId,
            title: `${clientName} — Campaign Plan`,
        });
        logActivity({ clientId, eventType: 'campaign.created', metadata: { template: 'blank' } });
        await loadPlan();
    };

    const handleImportConfirm = async (data: ExtractedCampaignData) => {
        setShowImportModal(false);
        const planTitle = data.intake.businessName
            ? `${data.intake.businessName} — Campaign Plan`
            : `${clientName} — Campaign Plan`;

        const intakeContext: Record<string, unknown> = {};
        if (data.intake.businessDescription) intakeContext.businessDescription = data.intake.businessDescription;
        if (data.intake.targetServices?.length) intakeContext.targetServices = data.intake.targetServices;
        if (data.intake.targetLocations?.length) intakeContext.targetLocations = data.intake.targetLocations;
        if (data.intake.primaryConversionEvents?.length) intakeContext.primaryConversionEvents = data.intake.primaryConversionEvents;
        if (data.intake.analyticsConfidence) intakeContext.analyticsConfidence = data.intake.analyticsConfidence;
        if (data.intake.knownCompetitors?.length) intakeContext.knownCompetitors = data.intake.knownCompetitors;
        if (data.intake.constraints?.length) intakeContext.constraints = data.intake.constraints;
        if (data.intake.riskNotes?.length) intakeContext.riskNotes = data.intake.riskNotes;

        const res = await createCampaignPlan({
            organizationId, clientId,
            title: planTitle,
            strategyModel: data.strategyModel,
        });
        if (!res.success || !res.data) return;
        const planId = res.data.id;

        if (Object.keys(intakeContext).length > 0) {
            await updateCampaignPlan(planId, { customFields: intakeContext });
        }

        await Promise.all([
            ...data.goals.filter(g => g._selected).map((g, i) =>
                upsertCampaignGoal({
                    campaignPlanId: planId, organizationId, clientId,
                    title: g.title, category: g.category, description: g.description,
                    sortOrder: i,
                }),
            ),
            ...data.kpis.filter(k => k._selected).map((k, i) =>
                upsertCampaignKpi({
                    campaignPlanId: planId, organizationId, clientId,
                    metricName: k.metricName, kpiGroup: k.kpiGroup, source: k.source,
                    baselineValue: k.baselineValue ?? undefined,
                    targetValue: k.targetValue ?? undefined,
                    confidence: k.confidence, sortOrder: i,
                }),
            ),
            ...data.workstreams.filter(w => w._selected).map((w, i) =>
                upsertCampaignWorkstream({
                    campaignPlanId: planId, organizationId, clientId,
                    name: w.name, category: w.category, sortOrder: i,
                }),
            ),
            ...data.phases.filter(p => p._selected).map(p =>
                upsertCampaignPhase({
                    campaignPlanId: planId, organizationId, clientId,
                    name: p.name, phaseOrder: p.phaseOrder, objective: p.objective,
                }),
            ),
            ...data.expectations.filter(e => e._selected).map((e, i) =>
                upsertCampaignExpectation({
                    campaignPlanId: planId, organizationId, clientId,
                    type: e.type, statement: e.statement,
                    targetWindowDays: e.targetWindowDays, confidence: e.confidence,
                    sortOrder: i,
                }),
            ),
        ]);

        logActivity({ clientId, eventType: 'campaign.created', metadata: { source: 'questionnaire_import' } });
        await loadPlan();
    };

    const handleStatusChange = async (newStatus: CampaignPlanStatus) => {
        if (!plan) return;
        const patch: Record<string, unknown> = { status: newStatus };
        if (newStatus === 'approved') {
            patch.approvedAt = new Date().toISOString();
        }
        const res = await updateCampaignPlan(plan.id, patch);
        if (res.success && res.data) {
            setPlan(prev => prev ? { ...prev, ...res.data } : prev);
            if (newStatus === 'internal_review') {
                logActivity({ clientId, eventType: 'campaign.submitted_for_review' });
            } else if (newStatus === 'approved') {
                logActivity({ clientId, eventType: 'campaign.approved' });
            }
        }
    };

    // -----------------------------------------------------------------------
    // No plan yet
    // -----------------------------------------------------------------------

    if (loading) {
        return <div className="text-center py-12 text-muted-foreground text-sm italic">Loading campaign plan…</div>;
    }

    if (!plan) {
        return (
            <div className="space-y-6">
                <div className="text-center py-16 space-y-4">
                    <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                        <Target className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold">No Campaign Plan Yet</h3>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                        Create a campaign plan to define goals, strategy, and timeline for {clientName}.
                    </p>
                    <div className="flex items-center justify-center gap-3 pt-2">
                        <button
                            onClick={() => setShowImportModal(true)}
                            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 transition-colors"
                        >
                            <Upload className="h-4 w-4" />
                            Import from Questionnaire
                        </button>
                        <button
                            onClick={() => setShowTemplateSelector(true)}
                            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                        >
                            <Sparkles className="h-4 w-4" />
                            Create from Template
                        </button>
                        <button
                            onClick={handleCreateBlank}
                            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                        >
                            <Plus className="h-4 w-4" />
                            Blank Plan
                        </button>
                    </div>
                </div>

                {showTemplateSelector && (
                    <div className="max-w-2xl mx-auto space-y-3">
                        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Choose a Template</h4>
                        {CAMPAIGN_TEMPLATES.map(t => (
                            <button
                                key={t.key}
                                onClick={() => handleCreateFromTemplate(t)}
                                className="w-full text-left p-4 rounded-xl border border-border/50 bg-card hover:border-primary/40 transition-colors space-y-1"
                            >
                                <div className="font-semibold">{t.name}</div>
                                <div className="text-sm text-muted-foreground">{t.description}</div>
                                <div className="flex gap-2 pt-1 flex-wrap">
                                    {t.workstreams.slice(0, 4).map(ws => (
                                        <span key={ws.name} className="text-[10px] bg-muted px-2 py-0.5 rounded-full">
                                            {ws.name}
                                        </span>
                                    ))}
                                    {t.workstreams.length > 4 && (
                                        <span className="text-[10px] text-muted-foreground">+{t.workstreams.length - 4} more</span>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                )}

                {showImportModal && (
                    <QuestionnaireImportModal
                        onClose={() => setShowImportModal(false)}
                        onConfirm={handleImportConfirm}
                    />
                )}
            </div>
        );
    }

    // -----------------------------------------------------------------------
    // Plan exists — 3-tab editor
    // -----------------------------------------------------------------------

    const statusInfo = STATUS_LABELS[plan.status];
    const cf = plan.customFields as Record<string, any>;

    // Completeness
    const goalCount = plan.goals?.length ?? 0;
    const kpiCount = plan.kpis?.length ?? 0;
    const expectationCount = plan.expectations?.length ?? 0;
    const seoOverview = (cf.seoOverview ?? {}) as Record<string, string>;
    const seoFilled = ['artExplanation', 'currentState', 'opportunities', 'challenges', 'campaignObjectives']
        .filter(k => seoOverview[k]?.trim()).length;
    const activityCount = ((cf.keyActivities as any)?.items ?? []).length;
    const roadmapCount = ((cf.preliminaryRoadmap as any)?.stages ?? []).length;
    const phaseCount = plan.phases?.length ?? 0;

    type StepStatus = 'empty' | 'partial' | 'complete';
    const tabStatuses: Record<CampaignTab, StepStatus> = {
        goals: goalCount === 0 && kpiCount === 0 ? 'empty' : (goalCount >= 2 && kpiCount >= 3 && expectationCount >= 1) ? 'complete' : 'partial',
        campaign: seoFilled === 0 && activityCount === 0 ? 'empty' : (seoFilled >= 3 && activityCount >= 1) ? 'complete' : 'partial',
        timeline: roadmapCount === 0 && phaseCount === 0 ? 'empty' : (roadmapCount >= 1 && phaseCount >= 1) ? 'complete' : 'partial',
    };
    const completedTabs = Object.values(tabStatuses).filter(s => s === 'complete').length;
    const partialTabs = Object.values(tabStatuses).filter(s => s === 'partial').length;
    const progressPercent = Math.round(((completedTabs + partialTabs * 0.5) / 3) * 100);

    const TABS: { key: CampaignTab; label: string; icon: typeof Target }[] = [
        { key: 'goals', label: 'Goals & KPIs', icon: Target },
        { key: 'campaign', label: 'SEO Campaign', icon: Search },
        { key: 'timeline', label: 'Timeline', icon: Clock },
    ];

    return (
        <div className="space-y-6">
            {/* Plan header */}
            <div className="flex items-start justify-between">
                <div className="space-y-1">
                    <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold">{plan.title}</h3>
                        <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-medium border', statusInfo.color)}>
                            {statusInfo.label}
                        </span>
                    </div>
                    {plan.summary && <p className="text-sm text-muted-foreground">{plan.summary}</p>}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
                        {plan.startDate && <span>Start: {new Date(plan.startDate + 'T00:00:00').toLocaleDateString()}</span>}
                        {plan.targetReviewDate && <span>Review: {new Date(plan.targetReviewDate + 'T00:00:00').toLocaleDateString()}</span>}
                        {plan.approvedAt && <span>Approved: {new Date(plan.approvedAt).toLocaleDateString()}</span>}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {plan.status === 'draft' && (
                        <button
                            onClick={() => handleStatusChange('internal_review')}
                            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                        >
                            <Send className="h-3.5 w-3.5" /> Submit for Review
                        </button>
                    )}
                    {plan.status === 'internal_review' && (
                        <button
                            onClick={() => handleStatusChange('approved')}
                            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
                        >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                        </button>
                    )}
                    {plan.status === 'approved' && (
                        <button
                            onClick={() => handleStatusChange('active')}
                            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
                        >
                            <Check className="h-3.5 w-3.5" /> Activate
                        </button>
                    )}
                </div>
            </div>

            {/* Progress bar */}
            <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">{completedTabs}/3 complete</span>
            </div>

            {/* 3-tab navigation */}
            <div className="flex items-center gap-1 border-b border-border/50">
                {TABS.map(tab => {
                    const status = tabStatuses[tab.key];
                    return (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={cn(
                                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                                activeTab === tab.key
                                    ? 'border-primary text-foreground'
                                    : 'border-transparent text-muted-foreground hover:text-foreground',
                            )}
                        >
                            <tab.icon className="h-4 w-4" />
                            {tab.label}
                            <div className={cn(
                                'w-2 h-2 rounded-full',
                                status === 'complete' ? 'bg-green-500' :
                                status === 'partial' ? 'bg-yellow-500' :
                                'bg-gray-400/40',
                            )} />
                        </button>
                    );
                })}
            </div>

            {/* Tab content */}
            {activeTab === 'goals' && (
                <div className="space-y-6">
                    <GoalsSection
                        plan={plan} organizationId={organizationId} clientId={clientId}
                        expanded={expandedSections.goals} onToggle={() => toggleSection('goals')}
                        onRefresh={refreshPlan}
                    />
                    <KpisSection
                        plan={plan} organizationId={organizationId} clientId={clientId}
                        expanded={expandedSections.kpis} onToggle={() => toggleSection('kpis')}
                        onRefresh={refreshPlan}
                    />
                    <ExpectationsSection
                        plan={plan} organizationId={organizationId} clientId={clientId}
                        expanded={expandedSections.expectations} onToggle={() => toggleSection('expectations')}
                        onRefresh={refreshPlan}
                    />
                </div>
            )}

            {activeTab === 'campaign' && (
                <div className="space-y-6">
                    <SeoOverviewSection
                        plan={plan} expanded={expandedSections.seoOverview}
                        onToggle={() => toggleSection('seoOverview')} onRefresh={refreshPlan}
                    />
                    <WebsiteAnalysisSection
                        plan={plan} expanded={expandedSections.websiteAnalysis}
                        onToggle={() => toggleSection('websiteAnalysis')} onRefresh={refreshPlan}
                    />
                    <KeywordSnapshotSection
                        plan={plan} expanded={expandedSections.keywordSnapshot}
                        onToggle={() => toggleSection('keywordSnapshot')} onRefresh={refreshPlan}
                        clientId={clientId}
                    />
                    <KeyActivitiesSection
                        plan={plan} expanded={expandedSections.keyActivities}
                        onToggle={() => toggleSection('keyActivities')} onRefresh={refreshPlan}
                    />
                    <ScopeMeterSection
                        plan={plan} expanded={expandedSections.scopeMeter ?? false}
                        onToggle={() => toggleSection('scopeMeter')} onRefresh={refreshPlan}
                    />
                </div>
            )}

            {activeTab === 'timeline' && (
                <div className="space-y-6">
                    <PreliminaryRoadmapSection
                        plan={plan} expanded={expandedSections.preliminaryRoadmap}
                        onToggle={() => toggleSection('preliminaryRoadmap')} onRefresh={refreshPlan}
                    />
                    <TimelineSection
                        plan={plan} organizationId={organizationId} clientId={clientId}
                        expanded={expandedSections.timeline} onToggle={() => toggleSection('timeline')}
                        onRefresh={refreshPlan}
                    />
                </div>
            )}
        </div>
    );
}
