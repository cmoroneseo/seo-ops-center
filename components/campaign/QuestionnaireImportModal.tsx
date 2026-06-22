'use client';

import { useState, useRef } from 'react';
import {
    Upload, FileText, Loader2, X, Check, ChevronDown, ChevronRight,
    Target, BarChart3, Layers, Clock, ShieldCheck, AlertTriangle, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types for extracted data
// ---------------------------------------------------------------------------

interface ExtractedIntake {
    businessName?: string;
    businessDescription?: string;
    targetServices?: string[];
    targetLocations?: string[];
    primaryConversionEvents?: string[];
    analyticsConfidence?: string;
    knownCompetitors?: string[];
    constraints?: string[];
    riskNotes?: string[];
}

interface ExtractedGoal {
    title: string;
    category?: string;
    description?: string;
    _selected: boolean;
}

interface ExtractedKpi {
    metricName: string;
    kpiGroup?: string;
    source?: string;
    baselineValue?: number | null;
    targetValue?: number | null;
    confidence?: string;
    _selected: boolean;
}

interface ExtractedWorkstream {
    name: string;
    category?: string;
    rationale?: string;
    _selected: boolean;
}

interface ExtractedPhase {
    name: string;
    phaseOrder: number;
    objective?: string;
    _selected: boolean;
}

interface ExtractedExpectation {
    type?: string;
    statement: string;
    targetWindowDays?: number;
    confidence?: string;
    _selected: boolean;
}

export interface ExtractedCampaignData {
    intake: ExtractedIntake;
    goals: ExtractedGoal[];
    kpis: ExtractedKpi[];
    workstreams: ExtractedWorkstream[];
    phases: ExtractedPhase[];
    expectations: ExtractedExpectation[];
    strategyModel?: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface QuestionnaireImportModalProps {
    onClose: () => void;
    onConfirm: (data: ExtractedCampaignData) => void;
}

// ---------------------------------------------------------------------------
// PDF text extraction via browser
// ---------------------------------------------------------------------------

async function extractTextFromFile(file: File): Promise<string> {
    if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
        return file.text();
    }
    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let text = '';
        let i = 0;
        while (i < bytes.length) {
            const start = findNext(bytes, '(', i);
            if (start === -1) break;
            const end = findMatchingParen(bytes, start);
            if (end === -1) { i = start + 1; continue; }
            const slice = bytes.slice(start + 1, end);
            const decoded = new TextDecoder('latin1').decode(slice);
            if (decoded.length > 1 && /[a-zA-Z]/.test(decoded)) {
                text += decoded + ' ';
            }
            i = end + 1;
        }
        if (text.trim().length < 100) {
            return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
                .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
                .replace(/\s{3,}/g, '\n')
                .trim();
        }
        return text.replace(/\s{3,}/g, '\n').trim();
    }
    return file.text();
}

function findNext(bytes: Uint8Array, char: string, from: number): number {
    const code = char.charCodeAt(0);
    for (let i = from; i < bytes.length; i++) {
        if (bytes[i] === code && (i === 0 || bytes[i - 1] !== 0x5c)) return i;
    }
    return -1;
}

function findMatchingParen(bytes: Uint8Array, start: number): number {
    let depth = 0;
    for (let i = start; i < bytes.length; i++) {
        if (bytes[i] === 0x28 && (i === 0 || bytes[i - 1] !== 0x5c)) depth++;
        if (bytes[i] === 0x29 && (i === 0 || bytes[i - 1] !== 0x5c)) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

// ---------------------------------------------------------------------------
// Category label helpers
// ---------------------------------------------------------------------------

const GOAL_CATS: Record<string, string> = {
    leads: 'Leads', sales: 'Sales', local_visibility: 'Local Visibility',
    authority: 'Authority', traffic: 'Traffic', content_moat: 'Content Moat',
    launch_support: 'Launch Support', reputation: 'Reputation', other: 'Other',
};

const KPI_GROUPS: Record<string, string> = {
    visibility: 'Visibility', traffic: 'Traffic', conversion: 'Conversion',
    authority: 'Authority', content: 'Content', technical: 'Technical',
};

const WS_CATS: Record<string, string> = {
    research_strategy: 'Research & Strategy', technical_seo: 'Technical SEO',
    on_page: 'On-Page', content: 'Content', authority: 'Authority / Links',
    local_seo: 'Local SEO', analytics: 'Analytics', cro: 'CRO',
};

const EXP_TYPES: Record<string, string> = {
    ranking: 'Ranking', traffic: 'Traffic', conversion: 'Conversion',
    content: 'Content', technical: 'Technical', authority: 'Authority', local: 'Local',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuestionnaireImportModal({ onClose, onConfirm }: QuestionnaireImportModalProps) {
    const [step, setStep] = useState<'upload' | 'extracting' | 'review'>('upload');
    const [pasteText, setPasteText] = useState('');
    const [error, setError] = useState('');
    const [data, setData] = useState<ExtractedCampaignData | null>(null);
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
        intake: true, goals: true, kpis: true, workstreams: true, phases: true, expectations: true,
    });
    const fileRef = useRef<HTMLInputElement>(null);

    const toggleSection = (key: string) =>
        setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

    const handleExtract = async (text: string) => {
        if (text.trim().length < 50) {
            setError('Text is too short. Please paste the full questionnaire or upload the PDF.');
            return;
        }
        setStep('extracting');
        setError('');
        try {
            const res = await fetch('/api/campaign/extract-intake', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Extraction failed');
            }
            const raw = await res.json();
            const extracted: ExtractedCampaignData = {
                intake: raw.intake ?? {},
                goals: (raw.goals ?? []).map((g: any) => ({ ...g, _selected: true })),
                kpis: (raw.kpis ?? []).map((k: any) => ({ ...k, _selected: true })),
                workstreams: (raw.workstreams ?? []).map((w: any) => ({ ...w, _selected: true })),
                phases: (raw.phases ?? []).map((p: any) => ({ ...p, _selected: true })),
                expectations: (raw.expectations ?? []).map((e: any) => ({ ...e, _selected: true })),
                strategyModel: raw.strategyModel,
            };
            setData(extracted);
            setStep('review');
        } catch (err: any) {
            setError(err.message || 'Failed to extract data');
            setStep('upload');
        }
    };

    const handleFileUpload = async (file: File) => {
        try {
            const text = await extractTextFromFile(file);
            await handleExtract(text);
        } catch {
            setError('Failed to read file. Try pasting the text instead.');
            setStep('upload');
        }
    };

    const toggleItem = (section: 'goals' | 'kpis' | 'workstreams' | 'phases' | 'expectations', index: number) => {
        if (!data) return;
        setData({
            ...data,
            [section]: data[section].map((item: any, i: number) =>
                i === index ? { ...item, _selected: !item._selected } : item
            ),
        });
    };

    const selectedCounts = data ? {
        goals: data.goals.filter(g => g._selected).length,
        kpis: data.kpis.filter(k => k._selected).length,
        workstreams: data.workstreams.filter(w => w._selected).length,
        phases: data.phases.filter(p => p._selected).length,
        expectations: data.expectations.filter(e => e._selected).length,
    } : null;

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] bg-black/60 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-primary" />
                        <h2 className="text-lg font-semibold">
                            {step === 'upload' && 'Import from Questionnaire'}
                            {step === 'extracting' && 'Analyzing Questionnaire…'}
                            {step === 'review' && 'Review Extracted Data'}
                        </h2>
                    </div>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {/* Upload step */}
                    {step === 'upload' && (
                        <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                Upload a client questionnaire PDF or paste the text. We'll extract goals, KPIs, workstreams, timeline, and expectations to seed the campaign plan.
                            </p>

                            {/* File upload */}
                            <div
                                onClick={() => fileRef.current?.click()}
                                className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/40 transition-colors"
                            >
                                <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                                <p className="text-sm font-medium">Drop a PDF or click to upload</p>
                                <p className="text-xs text-muted-foreground mt-1">PDF or TXT files</p>
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept=".pdf,.txt,.doc,.docx"
                                    className="hidden"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleFileUpload(file);
                                    }}
                                />
                            </div>

                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <div className="flex-1 h-px bg-border" />
                                <span>or paste text</span>
                                <div className="flex-1 h-px bg-border" />
                            </div>

                            {/* Paste area */}
                            <textarea
                                value={pasteText}
                                onChange={(e) => setPasteText(e.target.value)}
                                placeholder="Paste the questionnaire text here…"
                                rows={8}
                                className="w-full bg-muted/30 border border-border/50 rounded-xl text-sm p-4 outline-none focus:border-primary resize-none"
                            />

                            {error && (
                                <div className="flex items-center gap-2 text-sm text-red-500">
                                    <AlertTriangle className="h-4 w-4" />
                                    {error}
                                </div>
                            )}

                            <div className="flex justify-end">
                                <button
                                    onClick={() => handleExtract(pasteText)}
                                    disabled={pasteText.trim().length < 50}
                                    className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <Sparkles className="h-4 w-4" />
                                    Extract Campaign Data
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Extracting step */}
                    {step === 'extracting' && (
                        <div className="flex flex-col items-center justify-center py-16 space-y-4">
                            <Loader2 className="h-10 w-10 text-primary animate-spin" />
                            <p className="text-sm text-muted-foreground">Reading questionnaire and extracting SEO campaign data…</p>
                            <p className="text-xs text-muted-foreground/60">This usually takes 10–15 seconds</p>
                        </div>
                    )}

                    {/* Review step */}
                    {step === 'review' && data && (
                        <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                Review the extracted data below. Uncheck items you don't want included. Everything checked will be added to the campaign plan.
                            </p>

                            {/* Intake context */}
                            <ReviewSection
                                icon={FileText} title="Client Context" expanded={expandedSections.intake}
                                onToggle={() => toggleSection('intake')}
                            >
                                <div className="space-y-2 text-sm">
                                    {data.intake.businessName && (
                                        <div><span className="text-muted-foreground">Business:</span> {data.intake.businessName}</div>
                                    )}
                                    {data.intake.businessDescription && (
                                        <div><span className="text-muted-foreground">Description:</span> {data.intake.businessDescription}</div>
                                    )}
                                    {data.intake.targetServices && data.intake.targetServices.length > 0 && (
                                        <div>
                                            <span className="text-muted-foreground">Target services:</span>{' '}
                                            {data.intake.targetServices.join(', ')}
                                        </div>
                                    )}
                                    {data.intake.targetLocations && data.intake.targetLocations.length > 0 && (
                                        <div>
                                            <span className="text-muted-foreground">Locations:</span>{' '}
                                            {data.intake.targetLocations.join(', ')}
                                        </div>
                                    )}
                                    {data.intake.knownCompetitors && data.intake.knownCompetitors.length > 0 && (
                                        <div>
                                            <span className="text-muted-foreground">Competitors:</span>{' '}
                                            {data.intake.knownCompetitors.join(', ')}
                                        </div>
                                    )}
                                    {data.intake.analyticsConfidence && (
                                        <div>
                                            <span className="text-muted-foreground">Analytics confidence:</span>{' '}
                                            <span className={cn(
                                                'font-medium',
                                                data.intake.analyticsConfidence === 'none' ? 'text-red-500' :
                                                data.intake.analyticsConfidence === 'partial' ? 'text-yellow-500' : 'text-green-500'
                                            )}>
                                                {data.intake.analyticsConfidence}
                                            </span>
                                        </div>
                                    )}
                                    {data.intake.constraints && data.intake.constraints.length > 0 && (
                                        <div>
                                            <span className="text-muted-foreground">Constraints:</span>
                                            <ul className="list-disc list-inside ml-2 text-xs text-muted-foreground">
                                                {data.intake.constraints.map((c, i) => <li key={i}>{c}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                    {data.intake.riskNotes && data.intake.riskNotes.length > 0 && (
                                        <div>
                                            <span className="text-muted-foreground">Risk notes:</span>
                                            <ul className="list-disc list-inside ml-2 text-xs text-yellow-500">
                                                {data.intake.riskNotes.map((r, i) => <li key={i}>{r}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            </ReviewSection>

                            {/* Goals */}
                            <ReviewSection
                                icon={Target} title={`Goals (${selectedCounts!.goals}/${data.goals.length})`}
                                expanded={expandedSections.goals} onToggle={() => toggleSection('goals')}
                            >
                                {data.goals.map((g, i) => (
                                    <CheckableRow
                                        key={i} selected={g._selected} onToggle={() => toggleItem('goals', i)}
                                        label={g.title}
                                        badge={g.category ? GOAL_CATS[g.category] ?? g.category : undefined}
                                        detail={g.description}
                                    />
                                ))}
                            </ReviewSection>

                            {/* KPIs */}
                            <ReviewSection
                                icon={BarChart3} title={`KPIs (${selectedCounts!.kpis}/${data.kpis.length})`}
                                expanded={expandedSections.kpis} onToggle={() => toggleSection('kpis')}
                            >
                                {data.kpis.map((k, i) => (
                                    <CheckableRow
                                        key={i} selected={k._selected} onToggle={() => toggleItem('kpis', i)}
                                        label={k.metricName}
                                        badge={k.kpiGroup ? KPI_GROUPS[k.kpiGroup] ?? k.kpiGroup : undefined}
                                        detail={[
                                            k.baselineValue != null ? `Baseline: ${k.baselineValue}` : null,
                                            k.targetValue != null ? `Target: ${k.targetValue}` : null,
                                            k.source ? `Source: ${k.source.toUpperCase()}` : null,
                                            k.confidence ? `${k.confidence} confidence` : null,
                                        ].filter(Boolean).join(' · ')}
                                    />
                                ))}
                            </ReviewSection>

                            {/* Workstreams */}
                            <ReviewSection
                                icon={Layers} title={`Workstreams (${selectedCounts!.workstreams}/${data.workstreams.length})`}
                                expanded={expandedSections.workstreams} onToggle={() => toggleSection('workstreams')}
                            >
                                {data.workstreams.map((w, i) => (
                                    <CheckableRow
                                        key={i} selected={w._selected} onToggle={() => toggleItem('workstreams', i)}
                                        label={w.name}
                                        badge={w.category ? WS_CATS[w.category] ?? w.category : undefined}
                                        detail={w.rationale}
                                    />
                                ))}
                            </ReviewSection>

                            {/* Phases */}
                            <ReviewSection
                                icon={Clock} title={`Timeline (${selectedCounts!.phases}/${data.phases.length})`}
                                expanded={expandedSections.phases} onToggle={() => toggleSection('phases')}
                            >
                                {data.phases.map((p, i) => (
                                    <CheckableRow
                                        key={i} selected={p._selected} onToggle={() => toggleItem('phases', i)}
                                        label={`${p.phaseOrder}. ${p.name}`}
                                        detail={p.objective}
                                    />
                                ))}
                            </ReviewSection>

                            {/* Expectations */}
                            <ReviewSection
                                icon={ShieldCheck} title={`Expectations (${selectedCounts!.expectations}/${data.expectations.length})`}
                                expanded={expandedSections.expectations} onToggle={() => toggleSection('expectations')}
                            >
                                {data.expectations.map((e, i) => (
                                    <CheckableRow
                                        key={i} selected={e._selected} onToggle={() => toggleItem('expectations', i)}
                                        label={e.statement}
                                        badge={e.type ? EXP_TYPES[e.type] ?? e.type : undefined}
                                        detail={[
                                            e.targetWindowDays ? `${e.targetWindowDays}d window` : null,
                                            e.confidence ? `${e.confidence} confidence` : null,
                                        ].filter(Boolean).join(' · ')}
                                    />
                                ))}
                            </ReviewSection>
                        </div>
                    )}
                </div>

                {/* Footer */}
                {step === 'review' && data && (
                    <div className="flex items-center justify-between px-6 py-4 border-t border-border/50">
                        <button
                            onClick={() => { setStep('upload'); setData(null); }}
                            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Start over
                        </button>
                        <button
                            onClick={() => onConfirm(data)}
                            className="flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-700 transition-colors"
                        >
                            <Check className="h-4 w-4" />
                            Create Campaign Plan
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ReviewSection({ icon: Icon, title, expanded, onToggle, children }: {
    icon: any; title: string; expanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
    return (
        <div className="rounded-lg border border-border/50 bg-muted/10">
            <div
                className="flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none"
                onClick={onToggle}
            >
                {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                <Icon className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">{title}</span>
            </div>
            {expanded && <div className="px-4 pb-3 space-y-1.5">{children}</div>}
        </div>
    );
}

function CheckableRow({ selected, onToggle, label, badge, detail }: {
    selected: boolean; onToggle: () => void;
    label: string; badge?: string; detail?: string;
}) {
    return (
        <div
            onClick={onToggle}
            className={cn(
                'flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer transition-colors',
                selected ? 'bg-muted/30' : 'bg-muted/10 opacity-50',
            )}
        >
            <div className={cn(
                'w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-colors',
                selected ? 'bg-primary border-primary' : 'border-border',
            )}>
                {selected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{label}</span>
                    {badge && (
                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full shrink-0">
                            {badge}
                        </span>
                    )}
                </div>
                {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
            </div>
        </div>
    );
}
