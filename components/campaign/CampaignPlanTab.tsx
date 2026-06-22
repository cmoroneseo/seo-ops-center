'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Target, BarChart3, Layers, Clock, ShieldCheck,
    Plus, ChevronDown, ChevronRight, Trash2, Check, X,
    FileText, Send, CheckCircle2, AlertTriangle, Sparkles, Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    CampaignPlan, CampaignGoal, CampaignKpi,
    CampaignWorkstream, CampaignPhase, CampaignExpectation,
    CampaignPlanStatus, CampaignGoalCategory, KpiGroup, KpiSource,
    KpiConfidence, WorkstreamCategory, WorkstreamStatus,
    PhaseStatus, ExpectationType,
} from '@/lib/types';
import {
    getCampaignPlanFull, createCampaignPlan, updateCampaignPlan,
    upsertCampaignGoal, deleteCampaignGoal,
    upsertCampaignKpi, deleteCampaignKpi,
    upsertCampaignWorkstream, deleteCampaignWorkstream,
    upsertCampaignPhase, deleteCampaignPhase,
    upsertCampaignExpectation, deleteCampaignExpectation,
} from '@/lib/supabase/campaign-plans';
import { logActivity } from '@/lib/supabase/client-activity';
import { CAMPAIGN_TEMPLATES, CampaignTemplate } from '@/lib/campaign-templates';
import { QuestionnaireImportModal, ExtractedCampaignData } from './QuestionnaireImportModal';
import { Upload } from 'lucide-react';

// ---------------------------------------------------------------------------
// Shared label maps
// ---------------------------------------------------------------------------

const GOAL_CATEGORIES: { value: CampaignGoalCategory; label: string }[] = [
    { value: 'leads', label: 'Leads' },
    { value: 'sales', label: 'Sales' },
    { value: 'local_visibility', label: 'Local Visibility' },
    { value: 'authority', label: 'Authority' },
    { value: 'traffic', label: 'Traffic' },
    { value: 'content_moat', label: 'Content Moat' },
    { value: 'launch_support', label: 'Launch Support' },
    { value: 'reputation', label: 'Reputation' },
    { value: 'other', label: 'Other' },
];

const KPI_GROUPS: { value: KpiGroup; label: string }[] = [
    { value: 'visibility', label: 'Visibility' },
    { value: 'traffic', label: 'Traffic' },
    { value: 'conversion', label: 'Conversion' },
    { value: 'authority', label: 'Authority' },
    { value: 'content', label: 'Content' },
    { value: 'technical', label: 'Technical' },
];

const KPI_SOURCES: { value: KpiSource; label: string }[] = [
    { value: 'gsc', label: 'GSC' },
    { value: 'ga4', label: 'GA4' },
    { value: 'gbp', label: 'GBP' },
    { value: 'ahrefs', label: 'Ahrefs' },
    { value: 'manual', label: 'Manual' },
    { value: 'internal', label: 'Internal' },
];

const WORKSTREAM_CATEGORIES: { value: WorkstreamCategory; label: string }[] = [
    { value: 'research_strategy', label: 'Research & Strategy' },
    { value: 'technical_seo', label: 'Technical SEO' },
    { value: 'on_page', label: 'On-Page' },
    { value: 'content', label: 'Content' },
    { value: 'authority', label: 'Authority / Links' },
    { value: 'local_seo', label: 'Local SEO' },
    { value: 'analytics', label: 'Analytics' },
    { value: 'cro', label: 'CRO' },
];

const CONFIDENCE_OPTIONS: { value: KpiConfidence; label: string; color: string }[] = [
    { value: 'low', label: 'Low', color: 'text-red-500' },
    { value: 'medium', label: 'Medium', color: 'text-yellow-500' },
    { value: 'high', label: 'High', color: 'text-green-500' },
];

const EXPECTATION_TYPES: { value: ExpectationType; label: string }[] = [
    { value: 'ranking', label: 'Ranking' },
    { value: 'traffic', label: 'Traffic' },
    { value: 'conversion', label: 'Conversion' },
    { value: 'content', label: 'Content' },
    { value: 'technical', label: 'Technical' },
    { value: 'authority', label: 'Authority' },
    { value: 'local', label: 'Local' },
];

const STATUS_LABELS: Record<CampaignPlanStatus, { label: string; color: string }> = {
    draft: { label: 'Draft', color: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
    internal_review: { label: 'In Review', color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' },
    approved: { label: 'Approved', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
    active: { label: 'Active', color: 'bg-green-500/10 text-green-500 border-green-500/20' },
    archived: { label: 'Archived', color: 'bg-gray-500/10 text-gray-400 border-gray-500/20' },
};

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
        overview: true, goals: true, kpis: true, workstreams: true, timeline: true, expectations: true,
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
            organizationId,
            clientId,
            title: `${clientName} — ${template.name}`,
            strategyModel: template.strategyModel,
        });
        if (!res.success || !res.data) return;
        const planId = res.data.id;

        // Seed workstreams, phases, KPIs, expectations in parallel
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

        // Store intake context in custom_fields
        if (Object.keys(intakeContext).length > 0) {
            await updateCampaignPlan(planId, { customFields: intakeContext });
        }

        // Seed selected items in parallel
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

                {/* Template selector */}
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

                {/* Questionnaire import modal */}
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

            {/* Sections */}
            <GoalsSection
                plan={plan} organizationId={organizationId} clientId={clientId}
                expanded={expandedSections.goals} onToggle={() => toggleSection('goals')}
                onRefresh={loadPlan}
            />
            <KpisSection
                plan={plan} organizationId={organizationId} clientId={clientId}
                expanded={expandedSections.kpis} onToggle={() => toggleSection('kpis')}
                onRefresh={loadPlan}
            />
            <WorkstreamsSection
                plan={plan} organizationId={organizationId} clientId={clientId}
                expanded={expandedSections.workstreams} onToggle={() => toggleSection('workstreams')}
                onRefresh={loadPlan}
            />
            <TimelineSection
                plan={plan} organizationId={organizationId} clientId={clientId}
                expanded={expandedSections.timeline} onToggle={() => toggleSection('timeline')}
                onRefresh={loadPlan}
            />
            <ExpectationsSection
                plan={plan} organizationId={organizationId} clientId={clientId}
                expanded={expandedSections.expectations} onToggle={() => toggleSection('expectations')}
                onRefresh={loadPlan}
            />
        </div>
    );
}

// ===========================================================================
// Section wrapper
// ===========================================================================

function SectionCard({ icon: Icon, title, count, expanded, onToggle, onAdd, children }: {
    icon: any; title: string; count: number;
    expanded: boolean; onToggle: () => void; onAdd?: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="rounded-xl border border-border/50 bg-card">
            <div
                className="flex items-center justify-between px-5 py-3 cursor-pointer select-none"
                onClick={onToggle}
            >
                <div className="flex items-center gap-2">
                    {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    <Icon className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-sm">{title}</span>
                    <span className="text-xs text-muted-foreground">({count})</span>
                </div>
                {onAdd && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onAdd(); }}
                        className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                    >
                        <Plus className="h-3.5 w-3.5" /> Add
                    </button>
                )}
            </div>
            {expanded && <div className="px-5 pb-5 space-y-3">{children}</div>}
        </div>
    );
}

// ===========================================================================
// Inline editor helpers
// ===========================================================================

function InlineInput({ value, onChange, placeholder, className }: {
    value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
    return (
        <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={cn(
                'bg-transparent border-b border-border/50 focus:border-primary outline-none text-sm py-1 transition-colors w-full',
                className,
            )}
        />
    );
}

function InlineSelect({ value, onChange, options }: {
    value: string; onChange: (v: string) => void;
    options: { value: string; label: string }[];
}) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="bg-transparent border border-border/50 rounded-md text-xs py-1 px-2 outline-none focus:border-primary"
        >
            <option value="">—</option>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    );
}

// ===========================================================================
// Goals Section
// ===========================================================================

const GOAL_STATUSES: { value: string; label: string }[] = [
    { value: 'active', label: 'Active' },
    { value: 'achieved', label: 'Achieved' },
    { value: 'at_risk', label: 'At Risk' },
    { value: 'dropped', label: 'Dropped' },
];

function GoalsSection({ plan, organizationId, clientId, expanded, onToggle, onRefresh }: {
    plan: CampaignPlan; organizationId: string; clientId: string;
    expanded: boolean; onToggle: () => void; onRefresh: () => void;
}) {
    const goals = plan.goals ?? [];
    const [adding, setAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState({ title: '', category: '', description: '', status: 'active' });

    const startEdit = (g: CampaignGoal) => {
        setEditingId(g.id);
        setForm({ title: g.title, category: g.category ?? '', description: g.description ?? '', status: g.status });
    };

    const handleSave = async (g: CampaignGoal) => {
        if (!form.title.trim()) return;
        await upsertCampaignGoal({
            id: g.id, campaignPlanId: plan.id, organizationId, clientId,
            title: form.title.trim(), category: form.category || undefined,
            description: form.description.trim() || undefined,
            status: form.status || 'active', sortOrder: g.sortOrder,
        });
        setEditingId(null);
        onRefresh();
    };

    const handleAdd = async () => {
        if (!form.title.trim()) return;
        await upsertCampaignGoal({
            campaignPlanId: plan.id, organizationId, clientId,
            title: form.title.trim(), category: form.category || undefined,
            description: form.description.trim() || undefined,
            sortOrder: goals.length,
        });
        setForm({ title: '', category: '', description: '', status: 'active' });
        setAdding(false);
        onRefresh();
    };

    const startAdd = () => {
        setForm({ title: '', category: '', description: '', status: 'active' });
        setAdding(true);
    };

    const handleDelete = async (id: string) => {
        await deleteCampaignGoal(id);
        onRefresh();
    };

    return (
        <SectionCard
            icon={Target} title="Goals" count={goals.length}
            expanded={expanded} onToggle={onToggle} onAdd={startAdd}
        >
            {goals.length === 0 && !adding && (
                <p className="text-sm text-muted-foreground italic">No goals defined yet.</p>
            )}
            {goals.map(g => editingId === g.id ? (
                <div key={g.id} className="space-y-2 p-3 rounded-lg bg-muted/20 border border-primary/30">
                    <div className="flex items-center gap-2">
                        <InlineInput value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} placeholder="Goal title…" className="flex-1" />
                        <InlineSelect value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} options={GOAL_CATEGORIES} />
                        <InlineSelect value={form.status} onChange={v => setForm(f => ({ ...f, status: v }))} options={GOAL_STATUSES} />
                    </div>
                    <InlineInput value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Description (optional)…" />
                    <div className="flex justify-end gap-2">
                        <button onClick={() => handleSave(g)} className="text-green-500 hover:text-green-400 p-1"><Check className="h-4 w-4" /></button>
                        <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
                    </div>
                </div>
            ) : (
                <div key={g.id} className="flex items-start justify-between p-3 rounded-lg bg-muted/30 border border-border/30 group cursor-pointer hover:border-border/60" onClick={() => startEdit(g)}>
                    <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{g.title}</span>
                            {g.category && (
                                <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                    {GOAL_CATEGORIES.find(c => c.value === g.category)?.label ?? g.category}
                                </span>
                            )}
                            <span className={cn(
                                'text-[10px] px-1.5 py-0.5 rounded-full border',
                                g.status === 'active' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                g.status === 'achieved' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' :
                                g.status === 'at_risk' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                                'bg-gray-500/10 text-gray-400 border-gray-500/20'
                            )}>
                                {g.status}
                            </span>
                        </div>
                        {g.description && <p className="text-xs text-muted-foreground">{g.description}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 text-muted-foreground transition-all" />
                        <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(g.id); }}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
            ))}
            {adding && (
                <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-dashed border-border">
                    <div className="flex items-center gap-2">
                        <InlineInput value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} placeholder="Goal title…" className="flex-1" />
                        <InlineSelect value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} options={GOAL_CATEGORIES} />
                    </div>
                    <InlineInput value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Description (optional)…" />
                    <div className="flex justify-end gap-2">
                        <button onClick={handleAdd} className="text-green-500 hover:text-green-400 p-1"><Check className="h-4 w-4" /></button>
                        <button onClick={() => { setAdding(false); }} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
                    </div>
                </div>
            )}
        </SectionCard>
    );
}

// ===========================================================================
// KPIs Section
// ===========================================================================

function KpiEditForm({ form, setForm, onSave, onCancel }: {
    form: { metricName: string; kpiGroup: string; source: string; baselineValue: string; targetValue: string; confidence: string };
    setForm: (fn: (f: typeof form) => typeof form) => void;
    onSave: () => void; onCancel: () => void;
}) {
    return (
        <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-primary/30">
            <div className="flex items-center gap-2">
                <InlineInput value={form.metricName} onChange={v => setForm(f => ({ ...f, metricName: v }))} placeholder="Metric name…" className="flex-1" />
                <InlineSelect value={form.kpiGroup} onChange={v => setForm(f => ({ ...f, kpiGroup: v }))} options={KPI_GROUPS} />
                <InlineSelect value={form.source} onChange={v => setForm(f => ({ ...f, source: v }))} options={KPI_SOURCES} />
            </div>
            <div className="flex items-center gap-2">
                <input type="number" value={form.baselineValue} onChange={e => setForm(f => ({ ...f, baselineValue: e.target.value }))} placeholder="Baseline" className="bg-transparent border border-border/50 rounded-md text-xs py-1 px-2 w-24 outline-none focus:border-primary" />
                <input type="number" value={form.targetValue} onChange={e => setForm(f => ({ ...f, targetValue: e.target.value }))} placeholder="Target" className="bg-transparent border border-border/50 rounded-md text-xs py-1 px-2 w-24 outline-none focus:border-primary" />
                <InlineSelect value={form.confidence} onChange={v => setForm(f => ({ ...f, confidence: v }))} options={CONFIDENCE_OPTIONS} />
                <div className="flex-1" />
                <button onClick={onSave} className="text-green-500 hover:text-green-400 p-1"><Check className="h-4 w-4" /></button>
                <button onClick={onCancel} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
            </div>
        </div>
    );
}

function KpisSection({ plan, organizationId, clientId, expanded, onToggle, onRefresh }: {
    plan: CampaignPlan; organizationId: string; clientId: string;
    expanded: boolean; onToggle: () => void; onRefresh: () => void;
}) {
    const kpis = plan.kpis ?? [];
    const [adding, setAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState({ metricName: '', kpiGroup: '', source: '', baselineValue: '', targetValue: '', confidence: 'medium' });

    const startEdit = (k: CampaignKpi) => {
        setEditingId(k.id);
        setForm({
            metricName: k.metricName, kpiGroup: k.kpiGroup ?? '', source: k.source ?? '',
            baselineValue: k.baselineValue != null ? String(k.baselineValue) : '',
            targetValue: k.targetValue != null ? String(k.targetValue) : '',
            confidence: k.confidence ?? 'medium',
        });
    };

    const handleSave = async (k: CampaignKpi) => {
        if (!form.metricName.trim()) return;
        await upsertCampaignKpi({
            id: k.id, campaignPlanId: plan.id, organizationId, clientId,
            metricName: form.metricName.trim(),
            kpiGroup: form.kpiGroup || undefined, source: form.source || undefined,
            baselineValue: form.baselineValue ? Number(form.baselineValue) : undefined,
            targetValue: form.targetValue ? Number(form.targetValue) : undefined,
            confidence: form.confidence || undefined, sortOrder: k.sortOrder,
        });
        setEditingId(null);
        onRefresh();
    };

    const handleAdd = async () => {
        if (!form.metricName.trim()) return;
        await upsertCampaignKpi({
            campaignPlanId: plan.id, organizationId, clientId,
            metricName: form.metricName.trim(),
            kpiGroup: form.kpiGroup || undefined, source: form.source || undefined,
            baselineValue: form.baselineValue ? Number(form.baselineValue) : undefined,
            targetValue: form.targetValue ? Number(form.targetValue) : undefined,
            confidence: form.confidence || undefined, sortOrder: kpis.length,
        });
        setForm({ metricName: '', kpiGroup: '', source: '', baselineValue: '', targetValue: '', confidence: 'medium' });
        setAdding(false);
        onRefresh();
    };

    const startAdd = () => {
        setForm({ metricName: '', kpiGroup: '', source: '', baselineValue: '', targetValue: '', confidence: 'medium' });
        setAdding(true);
    };

    const handleDelete = async (id: string) => {
        await deleteCampaignKpi(id);
        onRefresh();
    };

    return (
        <SectionCard
            icon={BarChart3} title="KPIs" count={kpis.length}
            expanded={expanded} onToggle={onToggle} onAdd={startAdd}
        >
            {kpis.length === 0 && !adding && (
                <p className="text-sm text-muted-foreground italic">No KPIs defined yet.</p>
            )}
            <div className="space-y-2">
                {kpis.map(k => editingId === k.id ? (
                    <KpiEditForm key={k.id} form={form} setForm={setForm} onSave={() => handleSave(k)} onCancel={() => setEditingId(null)} />
                ) : (
                    <div key={k.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30 group cursor-pointer hover:border-border/60" onClick={() => startEdit(k)}>
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm truncate">{k.metricName}</span>
                                    {k.kpiGroup && (
                                        <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full shrink-0">
                                            {KPI_GROUPS.find(g => g.value === k.kpiGroup)?.label}
                                        </span>
                                    )}
                                    {k.source && (
                                        <span className="text-[10px] text-muted-foreground shrink-0">
                                            {KPI_SOURCES.find(s => s.value === k.source)?.label}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                                {k.baselineValue != null && <span>Baseline: <strong className="text-foreground">{k.baselineValue}</strong></span>}
                                {k.targetValue != null && <span>Target: <strong className="text-foreground">{k.targetValue}</strong></span>}
                                {k.confidence && (
                                    <span className={CONFIDENCE_OPTIONS.find(c => c.value === k.confidence)?.color}>
                                        {k.confidence}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 text-muted-foreground transition-all" />
                            <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(k.id); }}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1 ml-1"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            {adding && (
                <KpiEditForm form={form} setForm={setForm} onSave={handleAdd} onCancel={() => setAdding(false)} />
            )}
        </SectionCard>
    );
}

// ===========================================================================
// Workstreams Section
// ===========================================================================

const WS_STATUS_COLORS: Record<WorkstreamStatus, string> = {
    planned: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    active: 'bg-green-500/10 text-green-500 border-green-500/20',
    paused: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    completed: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
};

function WsEditForm({ form, setForm, onSave, onCancel }: {
    form: { name: string; category: string; currentState: string; targetState: string; risks: string };
    setForm: (fn: (f: typeof form) => typeof form) => void;
    onSave: () => void; onCancel: () => void;
}) {
    return (
        <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-primary/30">
            <div className="flex items-center gap-2">
                <InlineInput value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Workstream name…" className="flex-1" />
                <InlineSelect value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} options={WORKSTREAM_CATEGORIES} />
            </div>
            <div className="grid grid-cols-2 gap-2">
                <InlineInput value={form.currentState} onChange={v => setForm(f => ({ ...f, currentState: v }))} placeholder="Current state…" />
                <InlineInput value={form.targetState} onChange={v => setForm(f => ({ ...f, targetState: v }))} placeholder="Target state…" />
            </div>
            <InlineInput value={form.risks} onChange={v => setForm(f => ({ ...f, risks: v }))} placeholder="Risks (optional)…" />
            <div className="flex justify-end gap-2">
                <button onClick={onSave} className="text-green-500 hover:text-green-400 p-1"><Check className="h-4 w-4" /></button>
                <button onClick={onCancel} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
            </div>
        </div>
    );
}

function WorkstreamsSection({ plan, organizationId, clientId, expanded, onToggle, onRefresh }: {
    plan: CampaignPlan; organizationId: string; clientId: string;
    expanded: boolean; onToggle: () => void; onRefresh: () => void;
}) {
    const workstreams = plan.workstreams ?? [];
    const [adding, setAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState({ name: '', category: '', currentState: '', targetState: '', risks: '' });

    const startEdit = (ws: CampaignWorkstream) => {
        setEditingId(ws.id);
        setForm({ name: ws.name, category: ws.category ?? '', currentState: ws.currentState ?? '', targetState: ws.targetState ?? '', risks: ws.risks ?? '' });
    };

    const handleSave = async (ws: CampaignWorkstream) => {
        if (!form.name.trim()) return;
        await upsertCampaignWorkstream({
            id: ws.id, campaignPlanId: plan.id, organizationId, clientId,
            name: form.name.trim(), category: form.category || undefined,
            currentState: form.currentState.trim() || undefined,
            targetState: form.targetState.trim() || undefined,
            risks: form.risks.trim() || undefined,
            status: ws.status, sortOrder: ws.sortOrder,
        });
        setEditingId(null);
        onRefresh();
    };

    const handleAdd = async () => {
        if (!form.name.trim()) return;
        await upsertCampaignWorkstream({
            campaignPlanId: plan.id, organizationId, clientId,
            name: form.name.trim(), category: form.category || undefined,
            currentState: form.currentState.trim() || undefined,
            targetState: form.targetState.trim() || undefined,
            risks: form.risks.trim() || undefined,
            sortOrder: workstreams.length,
        });
        setForm({ name: '', category: '', currentState: '', targetState: '', risks: '' });
        setAdding(false);
        onRefresh();
    };

    const startAdd = () => {
        setForm({ name: '', category: '', currentState: '', targetState: '', risks: '' });
        setAdding(true);
    };

    const handleStatusChange = async (ws: CampaignWorkstream, status: string) => {
        await upsertCampaignWorkstream({
            id: ws.id, campaignPlanId: ws.campaignPlanId,
            organizationId: ws.organizationId, clientId: ws.clientId,
            name: ws.name, category: ws.category, status,
            sortOrder: ws.sortOrder,
        });
        onRefresh();
    };

    const handleDelete = async (id: string) => {
        await deleteCampaignWorkstream(id);
        onRefresh();
    };

    return (
        <SectionCard
            icon={Layers} title="Workstreams" count={workstreams.length}
            expanded={expanded} onToggle={onToggle} onAdd={startAdd}
        >
            {workstreams.length === 0 && !adding && (
                <p className="text-sm text-muted-foreground italic">No workstreams defined yet.</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {workstreams.map(ws => editingId === ws.id ? (
                    <WsEditForm key={ws.id} form={form} setForm={setForm} onSave={() => handleSave(ws)} onCancel={() => setEditingId(null)} />
                ) : (
                    <div key={ws.id} className="p-3 rounded-lg bg-muted/30 border border-border/30 group space-y-2 cursor-pointer hover:border-border/60" onClick={() => startEdit(ws)}>
                        <div className="flex items-start justify-between">
                            <div>
                                <div className="font-medium text-sm">{ws.name}</div>
                                {ws.category && (
                                    <span className="text-[10px] text-muted-foreground">
                                        {WORKSTREAM_CATEGORIES.find(c => c.value === ws.category)?.label}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-1">
                                <select
                                    value={ws.status}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => { e.stopPropagation(); handleStatusChange(ws, e.target.value); }}
                                    className={cn(
                                        'text-[10px] font-medium rounded-full px-2 py-0.5 border outline-none cursor-pointer appearance-none',
                                        WS_STATUS_COLORS[ws.status],
                                    )}
                                >
                                    <option value="planned">Planned</option>
                                    <option value="active">Active</option>
                                    <option value="paused">Paused</option>
                                    <option value="completed">Completed</option>
                                </select>
                                <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 text-muted-foreground transition-all" />
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleDelete(ws.id); }}
                                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            </div>
                        </div>
                        {(ws.currentState || ws.targetState) && (
                            <div className="text-xs space-y-1">
                                {ws.currentState && <div><span className="text-muted-foreground">Current:</span> {ws.currentState}</div>}
                                {ws.targetState && <div><span className="text-muted-foreground">Target:</span> {ws.targetState}</div>}
                            </div>
                        )}
                        {ws.risks && (
                            <div className="flex items-start gap-1 text-xs text-yellow-500">
                                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                                {ws.risks}
                            </div>
                        )}
                    </div>
                ))}
            </div>
            {adding && (
                <WsEditForm form={form} setForm={setForm} onSave={handleAdd} onCancel={() => setAdding(false)} />
            )}
        </SectionCard>
    );
}

// ===========================================================================
// Timeline (Phases) Section
// ===========================================================================

const PHASE_STATUS_COLORS: Record<PhaseStatus, string> = {
    upcoming: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    active: 'bg-green-500/10 text-green-500 border-green-500/20',
    completed: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    skipped: 'bg-gray-500/10 text-gray-300 border-gray-500/20',
};

function PhaseEditForm({ form, setForm, onSave, onCancel }: {
    form: { name: string; objective: string; exitCriteria: string; startDate: string; endDate: string };
    setForm: (fn: (f: typeof form) => typeof form) => void;
    onSave: () => void; onCancel: () => void;
}) {
    return (
        <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-primary/30">
            <InlineInput value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Phase name…" />
            <InlineInput value={form.objective} onChange={v => setForm(f => ({ ...f, objective: v }))} placeholder="Objective…" />
            <InlineInput value={form.exitCriteria} onChange={v => setForm(f => ({ ...f, exitCriteria: v }))} placeholder="Exit criteria (optional)…" />
            <div className="flex items-center gap-2">
                <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} className="bg-transparent border border-border/50 rounded-md text-xs py-1 px-2 outline-none focus:border-primary" />
                <span className="text-xs text-muted-foreground">to</span>
                <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} className="bg-transparent border border-border/50 rounded-md text-xs py-1 px-2 outline-none focus:border-primary" />
                <div className="flex-1" />
                <button onClick={onSave} className="text-green-500 hover:text-green-400 p-1"><Check className="h-4 w-4" /></button>
                <button onClick={onCancel} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
            </div>
        </div>
    );
}

function TimelineSection({ plan, organizationId, clientId, expanded, onToggle, onRefresh }: {
    plan: CampaignPlan; organizationId: string; clientId: string;
    expanded: boolean; onToggle: () => void; onRefresh: () => void;
}) {
    const phases = plan.phases ?? [];
    const [adding, setAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState({ name: '', objective: '', exitCriteria: '', startDate: '', endDate: '' });

    const startEdit = (ph: CampaignPhase) => {
        setEditingId(ph.id);
        setForm({ name: ph.name, objective: ph.objective ?? '', exitCriteria: ph.exitCriteria ?? '', startDate: ph.startDate ?? '', endDate: ph.endDate ?? '' });
    };

    const handleSave = async (ph: CampaignPhase) => {
        if (!form.name.trim()) return;
        await upsertCampaignPhase({
            id: ph.id, campaignPlanId: plan.id, organizationId, clientId,
            name: form.name.trim(), phaseOrder: ph.phaseOrder, status: ph.status,
            objective: form.objective.trim() || undefined,
            exitCriteria: form.exitCriteria.trim() || undefined,
            startDate: form.startDate || undefined,
            endDate: form.endDate || undefined,
        });
        setEditingId(null);
        onRefresh();
    };

    const handleAdd = async () => {
        if (!form.name.trim()) return;
        await upsertCampaignPhase({
            campaignPlanId: plan.id, organizationId, clientId,
            name: form.name.trim(), phaseOrder: phases.length,
            objective: form.objective.trim() || undefined,
            exitCriteria: form.exitCriteria.trim() || undefined,
            startDate: form.startDate || undefined,
            endDate: form.endDate || undefined,
        });
        setForm({ name: '', objective: '', exitCriteria: '', startDate: '', endDate: '' });
        setAdding(false);
        onRefresh();
    };

    const startAdd = () => {
        setForm({ name: '', objective: '', exitCriteria: '', startDate: '', endDate: '' });
        setAdding(true);
    };

    const handleStatusChange = async (ph: CampaignPhase, status: string) => {
        await upsertCampaignPhase({
            id: ph.id, campaignPlanId: ph.campaignPlanId,
            organizationId: ph.organizationId, clientId: ph.clientId,
            name: ph.name, phaseOrder: ph.phaseOrder, status,
            objective: ph.objective, exitCriteria: ph.exitCriteria,
        });
        logActivity({ clientId, eventType: 'campaign.phase_status_changed', metadata: { phase: ph.name, newStatus: status } });
        onRefresh();
    };

    const handleDelete = async (id: string) => {
        await deleteCampaignPhase(id);
        onRefresh();
    };

    return (
        <SectionCard
            icon={Clock} title="Timeline" count={phases.length}
            expanded={expanded} onToggle={onToggle} onAdd={startAdd}
        >
            {phases.length === 0 && !adding && (
                <p className="text-sm text-muted-foreground italic">No phases defined yet.</p>
            )}
            <div className="space-y-2">
                {phases.map((ph, idx) => (
                    <div key={ph.id} className="flex items-start gap-3 group">
                        <div className="flex flex-col items-center pt-1">
                            <div className={cn(
                                'w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold',
                                ph.status === 'completed' ? 'border-blue-500 bg-blue-500/20 text-blue-500' :
                                ph.status === 'active' ? 'border-green-500 bg-green-500/20 text-green-500' :
                                'border-border text-muted-foreground',
                            )}>
                                {ph.status === 'completed' ? <Check className="h-3 w-3" /> : idx}
                            </div>
                            {idx < phases.length - 1 && <div className="w-px h-full min-h-[2rem] bg-border/50 mt-1" />}
                        </div>
                        {editingId === ph.id ? (
                            <div className="flex-1">
                                <PhaseEditForm form={form} setForm={setForm} onSave={() => handleSave(ph)} onCancel={() => setEditingId(null)} />
                            </div>
                        ) : (
                            <div className="flex-1 p-3 rounded-lg bg-muted/30 border border-border/30 space-y-1 cursor-pointer hover:border-border/60" onClick={() => startEdit(ph)}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm">{ph.name}</span>
                                        <select
                                            value={ph.status}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => { e.stopPropagation(); handleStatusChange(ph, e.target.value); }}
                                            className={cn(
                                                'text-[10px] font-medium rounded-full px-2 py-0.5 border outline-none cursor-pointer appearance-none',
                                                PHASE_STATUS_COLORS[ph.status],
                                            )}
                                        >
                                            <option value="upcoming">Upcoming</option>
                                            <option value="active">Active</option>
                                            <option value="completed">Completed</option>
                                            <option value="skipped">Skipped</option>
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        {ph.startDate && <span>{new Date(ph.startDate + 'T00:00:00').toLocaleDateString()}</span>}
                                        {ph.startDate && ph.endDate && <span>→</span>}
                                        {ph.endDate && <span>{new Date(ph.endDate + 'T00:00:00').toLocaleDateString()}</span>}
                                        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 text-muted-foreground transition-all" />
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDelete(ph.id); }}
                                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1"
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </button>
                                    </div>
                                </div>
                                {ph.objective && <p className="text-xs text-muted-foreground">{ph.objective}</p>}
                                {ph.exitCriteria && (
                                    <div className="text-xs text-muted-foreground">
                                        <span className="font-medium">Exit criteria:</span> {ph.exitCriteria}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
            {adding && (
                <PhaseEditForm form={form} setForm={setForm} onSave={handleAdd} onCancel={() => { setAdding(false); }} />
            )}
        </SectionCard>
    );
}

// ===========================================================================
// Expectations Section
// ===========================================================================

function ExpEditForm({ form, setForm, onSave, onCancel }: {
    form: { statement: string; type: string; targetWindowDays: string; confidence: string; preconditions: string; escalationRule: string };
    setForm: (fn: (f: typeof form) => typeof form) => void;
    onSave: () => void; onCancel: () => void;
}) {
    return (
        <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-primary/30">
            <textarea
                value={form.statement}
                onChange={(e) => setForm(f => ({ ...f, statement: e.target.value }))}
                placeholder="Expectation statement…"
                rows={2}
                className="w-full bg-transparent border border-border/50 rounded-md text-sm p-2 outline-none focus:border-primary resize-none"
            />
            <div className="flex items-center gap-2">
                <InlineSelect value={form.type} onChange={v => setForm(f => ({ ...f, type: v }))} options={EXPECTATION_TYPES} />
                <input type="number" value={form.targetWindowDays} onChange={e => setForm(f => ({ ...f, targetWindowDays: e.target.value }))} placeholder="Days" className="bg-transparent border border-border/50 rounded-md text-xs py-1 px-2 w-20 outline-none focus:border-primary" />
                <InlineSelect value={form.confidence} onChange={v => setForm(f => ({ ...f, confidence: v }))} options={CONFIDENCE_OPTIONS} />
            </div>
            <InlineInput value={form.preconditions} onChange={v => setForm(f => ({ ...f, preconditions: v }))} placeholder="Preconditions (optional)…" />
            <InlineInput value={form.escalationRule} onChange={v => setForm(f => ({ ...f, escalationRule: v }))} placeholder="Escalation rule (optional)…" />
            <div className="flex justify-end gap-2">
                <button onClick={onSave} className="text-green-500 hover:text-green-400 p-1"><Check className="h-4 w-4" /></button>
                <button onClick={onCancel} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
            </div>
        </div>
    );
}

function ExpectationsSection({ plan, organizationId, clientId, expanded, onToggle, onRefresh }: {
    plan: CampaignPlan; organizationId: string; clientId: string;
    expanded: boolean; onToggle: () => void; onRefresh: () => void;
}) {
    const expectations = plan.expectations ?? [];
    const [adding, setAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState({ statement: '', type: '', targetWindowDays: '', confidence: 'medium', preconditions: '', escalationRule: '' });

    const startEdit = (exp: CampaignExpectation) => {
        setEditingId(exp.id);
        setForm({
            statement: exp.statement, type: exp.type ?? '',
            targetWindowDays: exp.targetWindowDays != null ? String(exp.targetWindowDays) : '',
            confidence: exp.confidence ?? 'medium',
            preconditions: exp.preconditions ?? '', escalationRule: exp.escalationRule ?? '',
        });
    };

    const handleSave = async (exp: CampaignExpectation) => {
        if (!form.statement.trim()) return;
        await upsertCampaignExpectation({
            id: exp.id, campaignPlanId: plan.id, organizationId, clientId,
            statement: form.statement.trim(), type: form.type || undefined,
            targetWindowDays: form.targetWindowDays ? Number(form.targetWindowDays) : undefined,
            confidence: form.confidence || undefined,
            preconditions: form.preconditions.trim() || undefined,
            escalationRule: form.escalationRule.trim() || undefined,
            sortOrder: exp.sortOrder,
        });
        setEditingId(null);
        onRefresh();
    };

    const handleAdd = async () => {
        if (!form.statement.trim()) return;
        await upsertCampaignExpectation({
            campaignPlanId: plan.id, organizationId, clientId,
            statement: form.statement.trim(), type: form.type || undefined,
            targetWindowDays: form.targetWindowDays ? Number(form.targetWindowDays) : undefined,
            confidence: form.confidence || undefined,
            preconditions: form.preconditions.trim() || undefined,
            escalationRule: form.escalationRule.trim() || undefined,
            sortOrder: expectations.length,
        });
        setForm({ statement: '', type: '', targetWindowDays: '', confidence: 'medium', preconditions: '', escalationRule: '' });
        setAdding(false);
        onRefresh();
    };

    const startAdd = () => {
        setForm({ statement: '', type: '', targetWindowDays: '', confidence: 'medium', preconditions: '', escalationRule: '' });
        setAdding(true);
    };

    const handleDelete = async (id: string) => {
        await deleteCampaignExpectation(id);
        onRefresh();
    };

    const windowLabel = (days: number) => {
        if (days <= 60) return `${days}d`;
        if (days <= 365) return `${Math.round(days / 30)}mo`;
        return `${Math.round(days / 365)}yr`;
    };

    return (
        <SectionCard
            icon={ShieldCheck} title="Expectations" count={expectations.length}
            expanded={expanded} onToggle={onToggle} onAdd={startAdd}
        >
            {expectations.length === 0 && !adding && (
                <p className="text-sm text-muted-foreground italic">No expectations defined yet.</p>
            )}
            {expectations.map(exp => editingId === exp.id ? (
                <ExpEditForm key={exp.id} form={form} setForm={setForm} onSave={() => handleSave(exp)} onCancel={() => setEditingId(null)} />
            ) : (
                <div key={exp.id} className="p-3 rounded-lg bg-muted/30 border border-border/30 group space-y-1 cursor-pointer hover:border-border/60" onClick={() => startEdit(exp)}>
                    <div className="flex items-start justify-between">
                        <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                                {exp.type && (
                                    <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                        {EXPECTATION_TYPES.find(t => t.value === exp.type)?.label ?? exp.type}
                                    </span>
                                )}
                                {exp.targetWindowDays && (
                                    <span className="text-[10px] text-muted-foreground">
                                        {windowLabel(exp.targetWindowDays)} window
                                    </span>
                                )}
                                {exp.confidence && (
                                    <span className={cn('text-[10px]', CONFIDENCE_OPTIONS.find(c => c.value === exp.confidence)?.color)}>
                                        {exp.confidence} confidence
                                    </span>
                                )}
                            </div>
                            <p className="text-sm">{exp.statement}</p>
                            {exp.preconditions && (
                                <p className="text-xs text-muted-foreground"><span className="font-medium">Preconditions:</span> {exp.preconditions}</p>
                            )}
                            {exp.escalationRule && (
                                <p className="text-xs text-yellow-500"><span className="font-medium">Escalation:</span> {exp.escalationRule}</p>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 text-muted-foreground transition-all" />
                            <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(exp.id); }}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                </div>
            ))}
            {adding && (
                <ExpEditForm form={form} setForm={setForm} onSave={handleAdd} onCancel={() => setAdding(false)} />
            )}
        </SectionCard>
    );
}
