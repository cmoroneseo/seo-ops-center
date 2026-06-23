'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Target, Plus, Sparkles, Send, Check, CheckCircle2, Upload,
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

// Section components
import { SeoOverviewSection } from './sections/SeoOverviewSection';
import { GoalsSection } from './sections/GoalsSection';
import { KpisSection } from './sections/KpisSection';
import { KeywordSnapshotSection } from './sections/KeywordSnapshotSection';
import { WebsiteAnalysisSection } from './sections/WebsiteAnalysisSection';
import { KeyActivitiesSection } from './sections/KeyActivitiesSection';
import { WorkstreamsSection } from './sections/WorkstreamsSection';
import { PreliminaryRoadmapSection } from './sections/PreliminaryRoadmapSection';
import { TimelineSection } from './sections/TimelineSection';
import { ExpectationsSection } from './sections/ExpectationsSection';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CampaignPlanTabProps {
    organizationId: string;
    clientId: string;
    clientName: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CampaignPlanTab({ organizationId, clientId, clientName }: CampaignPlanTabProps) {
    const [plan, setPlan] = useState<CampaignPlan | null>(null);
    const [loading, setLoading] = useState(true);
    const [showTemplateSelector, setShowTemplateSelector] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
        seoOverview: true, goals: true, kpis: true, keywordSnapshot: false,
        websiteAnalysis: false, keyActivities: false, workstreams: true,
        preliminaryRoadmap: false, timeline: true, expectations: true,
    });

    const toggleSection = (key: string) =>
        setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

    const loadPlan = useCallback(async () => {
        setLoading(true);
        const p = await getCampaignPlanFull(clientId);
        setPlan(p);
        setLoading(false);
    }, [clientId]);

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

        // Seed new sections from template defaults
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

    // Create blank
    const handleCreateBlank = async () => {
        setShowTemplateSelector(false);
        await createCampaignPlan({
            organizationId, clientId,
            title: `${clientName} — Campaign Plan`,
        });
        logActivity({ clientId, eventType: 'campaign.created', metadata: { template: 'blank' } });
        await loadPlan();
    };

    // Create from questionnaire import
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

    // Status transitions
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
    // No plan yet — show create options
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
                        Create a campaign plan to define goals, KPIs, workstreams, timeline, and expectations for {clientName}.
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
    // Plan exists — full editor
    // -----------------------------------------------------------------------

    const statusInfo = STATUS_LABELS[plan.status];

    // Compute section completeness
    const cf = plan.customFields as Record<string, any>;
    const seoOverview = (cf.seoOverview ?? {}) as Record<string, string>;
    const seoOverviewFilled = ['artExplanation', 'currentState', 'opportunities', 'challenges', 'campaignObjectives']
        .filter(k => seoOverview[k]?.trim()).length;
    const goalCount = plan.goals?.length ?? 0;
    const kpiCount = plan.kpis?.length ?? 0;
    const keywordCount = ((cf.keywordSnapshot as any)?.keywords ?? []).length;
    const analysisData = (cf.websiteAnalysis ?? {}) as Record<string, any>;
    const analysisFilled = ['observations', 'technicalFindings'].filter(k => analysisData[k]?.trim()).length
        + (analysisData.competitorExamples?.length ?? 0);
    const activityCount = ((cf.keyActivities as any)?.items ?? []).length;
    const workstreamCount = plan.workstreams?.length ?? 0;
    const roadmapCount = ((cf.preliminaryRoadmap as any)?.stages ?? []).length;
    const phaseCount = plan.phases?.length ?? 0;
    const expectationCount = plan.expectations?.length ?? 0;

    type StepStatus = 'empty' | 'partial' | 'complete';
    const steps: { key: string; label: string; status: StepStatus }[] = [
        { key: 'seoOverview', label: 'SEO Overview', status: seoOverviewFilled === 0 ? 'empty' : seoOverviewFilled >= 5 ? 'complete' : 'partial' },
        { key: 'goals', label: 'Goals', status: goalCount === 0 ? 'empty' : goalCount >= 2 ? 'complete' : 'partial' },
        { key: 'kpis', label: 'KPIs', status: kpiCount === 0 ? 'empty' : kpiCount >= 3 ? 'complete' : 'partial' },
        { key: 'keywordSnapshot', label: 'Keywords', status: keywordCount === 0 ? 'empty' : keywordCount >= 5 ? 'complete' : 'partial' },
        { key: 'websiteAnalysis', label: 'Analysis', status: analysisFilled === 0 ? 'empty' : analysisFilled >= 2 ? 'complete' : 'partial' },
        { key: 'keyActivities', label: 'Activities', status: activityCount === 0 ? 'empty' : activityCount >= 3 ? 'complete' : 'partial' },
        { key: 'workstreams', label: 'Workstreams', status: workstreamCount === 0 ? 'empty' : workstreamCount >= 3 ? 'complete' : 'partial' },
        { key: 'preliminaryRoadmap', label: 'Roadmap', status: roadmapCount === 0 ? 'empty' : roadmapCount >= 3 ? 'complete' : 'partial' },
        { key: 'timeline', label: 'Timeline', status: phaseCount === 0 ? 'empty' : phaseCount >= 3 ? 'complete' : 'partial' },
        { key: 'expectations', label: 'Expectations', status: expectationCount === 0 ? 'empty' : expectationCount >= 2 ? 'complete' : 'partial' },
    ];
    const completedCount = steps.filter(s => s.status === 'complete').length;
    const partialCount = steps.filter(s => s.status === 'partial').length;
    const progressPercent = Math.round(((completedCount + partialCount * 0.5) / steps.length) * 100);

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

            {/* Step progress bar */}
            <div className="rounded-xl border border-border/50 bg-card px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold">Campaign Setup Progress</span>
                    <span className="text-xs text-muted-foreground">
                        {completedCount} of {steps.length} complete · {progressPercent}%
                    </span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden mb-3">
                    <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
                <div className="flex gap-1 flex-wrap">
                    {steps.map((s, i) => (
                        <button
                            key={s.key}
                            onClick={() => {
                                setExpandedSections(prev => ({ ...prev, [s.key]: true }));
                                document.getElementById(`section-${s.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }}
                            className={cn(
                                'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors',
                                s.status === 'complete' ? 'bg-green-500/10 text-green-500' :
                                s.status === 'partial' ? 'bg-yellow-500/10 text-yellow-500' :
                                'bg-muted text-muted-foreground',
                            )}
                        >
                            <span className={cn(
                                'w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold',
                                s.status === 'complete' ? 'bg-green-500/20' :
                                s.status === 'partial' ? 'bg-yellow-500/20' :
                                'bg-muted-foreground/20',
                            )}>
                                {s.status === 'complete' ? '✓' : i + 1}
                            </span>
                            {s.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Sections */}
            <div id="section-seoOverview">
                <SeoOverviewSection
                    plan={plan} expanded={expandedSections.seoOverview}
                    onToggle={() => toggleSection('seoOverview')} onRefresh={loadPlan}
                />
            </div>
            <div id="section-goals">
                <GoalsSection
                    plan={plan} organizationId={organizationId} clientId={clientId}
                    expanded={expandedSections.goals} onToggle={() => toggleSection('goals')}
                    onRefresh={loadPlan}
                />
            </div>
            <div id="section-kpis">
                <KpisSection
                    plan={plan} organizationId={organizationId} clientId={clientId}
                    expanded={expandedSections.kpis} onToggle={() => toggleSection('kpis')}
                    onRefresh={loadPlan}
                />
            </div>
            <div id="section-keywordSnapshot">
                <KeywordSnapshotSection
                    plan={plan} expanded={expandedSections.keywordSnapshot}
                    onToggle={() => toggleSection('keywordSnapshot')} onRefresh={loadPlan}
                />
            </div>
            <div id="section-websiteAnalysis">
                <WebsiteAnalysisSection
                    plan={plan} expanded={expandedSections.websiteAnalysis}
                    onToggle={() => toggleSection('websiteAnalysis')} onRefresh={loadPlan}
                />
            </div>
            <div id="section-keyActivities">
                <KeyActivitiesSection
                    plan={plan} expanded={expandedSections.keyActivities}
                    onToggle={() => toggleSection('keyActivities')} onRefresh={loadPlan}
                />
            </div>
            <div id="section-workstreams">
                <WorkstreamsSection
                    plan={plan} organizationId={organizationId} clientId={clientId}
                    expanded={expandedSections.workstreams} onToggle={() => toggleSection('workstreams')}
                    onRefresh={loadPlan}
                />
            </div>
            <div id="section-preliminaryRoadmap">
                <PreliminaryRoadmapSection
                    plan={plan} expanded={expandedSections.preliminaryRoadmap}
                    onToggle={() => toggleSection('preliminaryRoadmap')} onRefresh={loadPlan}
                />
            </div>
            <div id="section-timeline">
                <TimelineSection
                    plan={plan} organizationId={organizationId} clientId={clientId}
                    expanded={expandedSections.timeline} onToggle={() => toggleSection('timeline')}
                    onRefresh={loadPlan}
                />
            </div>
            <div id="section-expectations">
                <ExpectationsSection
                    plan={plan} organizationId={organizationId} clientId={clientId}
                    expanded={expandedSections.expectations} onToggle={() => toggleSection('expectations')}
                    onRefresh={loadPlan}
                />
            </div>
        </div>
    );
}
