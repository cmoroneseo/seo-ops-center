'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Loader2, Sparkles, X } from 'lucide-react';

import { KeywordSeedStep } from '@/components/topical-map/KeywordSeedStep';
import { loadKeywordSuggestions } from '@/lib/onboarding/load-keyword-suggestions';
import { keywordStepHint, type KeywordRow, type MetricSource } from '@/lib/onboarding/keyword-metrics';
import { getClientProfile, saveClientProfile } from '@/lib/supabase/topical-map';
import { generationRequestBody, normalizeSeedKeywords, selectedSeedKeywords } from '@/lib/topical-map/seed-keywords';
import { WIZARD_STEPS, continueLabel, wizardStepperItems, type WizardStep, type WizardStepperItem } from '@/lib/topical-map/wizard-steps';
import type { TopicalMapProfile } from '@/lib/types';
import { cn } from '@/lib/utils';

type Step = WizardStep;

const STEPS: readonly Step[] = WIZARD_STEPS;

const FOCUS = 'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#ec4899]';
const BUTTON_LG = cn('inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-[18px] text-sm font-semibold disabled:opacity-50', FOCUS);
const SECONDARY_LG = cn(BUTTON_LG, 'border-[#d4d4d8] bg-white text-[#18181b] hover:bg-[#fafafa]');
const PRIMARY_LG = cn(BUTTON_LG, 'border-[#18181b] bg-[#18181b] text-white hover:bg-[#27272a]');

/** Brand, Competitors, Keywords, Review and build. Done comes from saved state, not from position. */
export function WizardStepper({ items }: { items: WizardStepperItem[] }) {
    return (
        <nav aria-label="Steps" className="mb-4 rounded-xl border border-[#e4e4e7] bg-white px-5 py-4">
            <ol className="flex flex-wrap items-center gap-y-3">
                {items.map((item, index) => (
                    <li key={item.id} className={cn('flex items-center', index < items.length - 1 && 'flex-1')}>
                        <div className="flex items-center gap-2.5" aria-current={item.status === 'current' ? 'step' : undefined}>
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'grid h-7 w-7 flex-none place-items-center rounded-full border-2 text-[12.5px] font-bold',
                                    item.status === 'done' && 'border-[#15803d] bg-[#15803d] text-white',
                                    item.status === 'current' && 'border-[#18181b] bg-[#18181b] text-white shadow-[0_0_0_4px_#fce7f3]',
                                    item.status === 'todo' && 'border-[#d4d4d8] bg-white text-[#52525b]',
                                )}
                            >
                                {item.status === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : index + 1}
                            </span>
                            <div>
                                <b className="block text-[13.5px] font-bold">{item.label}</b>
                                <small
                                    className={cn(
                                        'text-xs',
                                        item.status === 'done' && 'font-semibold text-[#15803d]',
                                        item.status === 'current' && 'font-bold text-[#be185d]',
                                        item.status === 'todo' && 'text-[#52525b]',
                                    )}
                                >
                                    {item.statusLabel}
                                </small>
                            </div>
                        </div>
                        {index < items.length - 1 && (
                            <span aria-hidden="true" className={cn('mx-4 h-0.5 min-w-6 flex-1', item.status === 'done' ? 'bg-[#15803d]' : 'bg-[#d4d4d8]')} />
                        )}
                    </li>
                ))}
            </ol>
        </nav>
    );
}

interface MapGenerationWizardProps {
    organizationId: string;
    clientId: string;
    clientName: string;
    initialStep?: Step;
    onClose: () => void;
    onGenerated: () => void;
}

const LANGUAGES: { value: string; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'es', label: 'Spanish' },
    { value: 'fr', label: 'French' },
    { value: 'de', label: 'German' },
    { value: 'pt', label: 'Portuguese' },
];

function ChipList({ items, onRemove }: { items: string[]; onRemove: (item: string) => void }) {
    if (items.length === 0) return <p className="text-xs text-muted-foreground">None added yet.</p>;
    return (
        <div className="flex flex-wrap gap-2">
            {items.map(item => (
                <span key={item} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs">
                    {item}
                    <button type="button" onClick={() => onRemove(item)} aria-label={`Remove ${item}`} className="text-muted-foreground hover:text-foreground">
                        <X className="h-3 w-3" />
                    </button>
                </span>
            ))}
        </div>
    );
}

export function MapGenerationWizard({ organizationId, clientId, clientName, initialStep = 'profile', onClose, onGenerated }: MapGenerationWizardProps) {
    const [step, setStep] = useState<Step>(STEPS.includes(initialStep) ? initialStep : 'profile');
    const [loadingProfile, setLoadingProfile] = useState(true);
    const [error, setError] = useState('');

    const [brandName, setBrandName] = useState('');
    const [businessDescription, setBusinessDescription] = useState('');
    const [contentLanguage, setContentLanguage] = useState('en');
    const [rivals, setRivals] = useState<string[]>([]);
    const [focusTopics, setFocusTopics] = useState<string[]>([]);
    const [rivalInput, setRivalInput] = useState('');
    const [topicInput, setTopicInput] = useState('');
    const [chosenKeywords, setChosenKeywords] = useState<string[]>([]);

    const [keywordRows, setKeywordRows] = useState<KeywordRow[]>([]);
    const [keywordVisit, setKeywordVisit] = useState(0);
    const [keywordLoading, setKeywordLoading] = useState(false);
    const [keywordNotice, setKeywordNotice] = useState<string | null>(null);
    const [searchConsole, setSearchConsole] = useState<MetricSource>('missing');
    const selectionTouched = useRef(false);
    const savedKeywords = useRef<string[]>([]);
    const keywordRequest = useRef(0);
    const draftRef = useRef({ brandName, businessDescription, focusTopics, rivals, keywordRows });
    draftRef.current = { brandName, businessDescription, focusTopics, rivals, keywordRows };

    const [drafting, setDrafting] = useState(false);
    const [suggestingRivals, setSuggestingRivals] = useState(false);
    const [suggestingTopics, setSuggestingTopics] = useState(false);
    const [savingKeywords, setSavingKeywords] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const profile = await getClientProfile(clientId);
            if (cancelled) return;
            if (profile) {
                setBrandName(profile.brandName);
                setBusinessDescription(profile.businessDescription);
                setContentLanguage(profile.contentLanguage || 'en');
                setRivals(profile.rivals ?? []);
                setFocusTopics(profile.focusTopics ?? []);
                const keywords = normalizeSeedKeywords(profile.keywords);
                savedKeywords.current = keywords;
                setChosenKeywords(keywords);
            }
            setLoadingProfile(false);
        })();
        return () => { cancelled = true; };
    }, [clientId]);

    useEffect(() => {
        if (loadingProfile || step !== 'keywords' || keywordVisit > 0) return;
        setKeywordVisit(1);
    }, [loadingProfile, step, keywordVisit]);

    useEffect(() => {
        if (keywordVisit === 0 || loadingProfile) return;
        const request = ++keywordRequest.current;
        const draft = draftRef.current;
        const touched = selectionTouched.current;
        setKeywordLoading(true);
        setError('');
        void loadKeywordSuggestions({
            clientId,
            brandName: draft.brandName,
            businessDescription: draft.businessDescription,
            focusTopics: draft.focusTopics,
            rivals: draft.rivals,
            saved: touched ? selectedSeedKeywords(draft.keywordRows) : savedKeywords.current,
            selectionTouched: touched,
        }).then(result => {
            if (request !== keywordRequest.current) return;
            setKeywordRows(result.rows);
            setSearchConsole(result.searchConsole);
            setKeywordNotice(result.notice);
            setKeywordLoading(false);
        }).catch(() => {
            if (request !== keywordRequest.current) return;
            setKeywordLoading(false);
            setError('Keywords could not be loaded. You can still add your own.');
        });
    }, [keywordVisit, loadingProfile, clientId]);

    const addRival = () => {
        const value = rivalInput.trim();
        if (value && !rivals.includes(value)) setRivals(prev => [...prev, value]);
        setRivalInput('');
    };
    const addTopic = () => {
        const value = topicInput.trim();
        if (value && !focusTopics.includes(value)) setFocusTopics(prev => [...prev, value]);
        setTopicInput('');
    };

    const profilePayload = (keywords: string[]): TopicalMapProfile => ({
        brandName: brandName.trim(),
        businessDescription: businessDescription.trim(),
        contentLanguage,
        focusTopics,
        rivals,
        keywords,
    });

    const keywordsForGeneration = () => keywordVisit > 0 ? selectedSeedKeywords(keywordRows) : chosenKeywords;

    const handleAiDraft = async () => {
        setDrafting(true);
        setError('');
        try {
            const res = await fetch('/api/topical-map/generate-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || 'AI draft failed');
            const profile = body.profile ?? {};
            if (profile.brand_name) setBrandName(String(profile.brand_name));
            if (profile.business_description) setBusinessDescription(String(profile.business_description));
            if (Array.isArray(profile.focus_topics)) {
                setFocusTopics(prev => Array.from(new Set([...prev, ...profile.focus_topics.map(String)])));
            }
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'AI draft failed');
        } finally {
            setDrafting(false);
        }
    };

    const handleSuggest = async (type: 'rivals' | 'topics') => {
        const setLoadingFlag = type === 'rivals' ? setSuggestingRivals : setSuggestingTopics;
        setLoadingFlag(true);
        setError('');
        try {
            const res = await fetch('/api/topical-map/suggest-seeds', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type,
                    brandName,
                    businessDescription,
                    existing: type === 'rivals' ? rivals : focusTopics,
                }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || 'Suggestion failed');
            const suggestions = (body.suggestions ?? []).map(String);
            if (type === 'rivals') setRivals(prev => Array.from(new Set([...prev, ...suggestions])));
            else setFocusTopics(prev => Array.from(new Set([...prev, ...suggestions])));
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Suggestion failed');
        } finally {
            setLoadingFlag(false);
        }
    };

    const handleGenerate = async () => {
        setSubmitting(true);
        setError('');
        const keywords = keywordsForGeneration();
        const profile = profilePayload(keywords);
        try {
            const saved = await saveClientProfile(clientId, profile);
            if (!saved.success) throw new Error(saved.error || 'Failed to save profile');

            // Fire the generation request but don't block the UI on it — it runs
            // as one long server request, writing progress to the map row as it
            // goes. MapProgressCard polls that row directly, so we switch to the
            // generating view as soon as the request is under way.
            fetch('/api/topical-map/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(generationRequestBody({ clientId, organizationId, keywords })),
            }).catch(reason => {
                console.error('Topical map generation request failed', reason);
            });

            onGenerated();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Failed to start generation');
            setSubmitting(false);
        }
    };

    const goToKeywords = () => {
        setStep('keywords');
        setKeywordVisit(visit => visit + 1);
    };

    const advanceFromKeywords = async () => {
        setSavingKeywords(true);
        setError('');
        const keywords = selectedSeedKeywords(keywordRows);
        try {
            const saved = await saveClientProfile(clientId, profilePayload(keywords));
            if (!saved.success) throw new Error(saved.error || 'Failed to save keywords');
            savedKeywords.current = keywords;
            setChosenKeywords(keywords);
            setStep('confirm');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Failed to save keywords');
        } finally {
            setSavingKeywords(false);
        }
    };

    const toggleKeyword = (keyword: string) => {
        selectionTouched.current = true;
        setKeywordRows(rows => rows.map(row => row.keyword === keyword ? { ...row, selected: !row.selected } : row));
    };

    const replaceKeywordRows = (rows: KeywordRow[]) => {
        selectionTouched.current = true;
        setKeywordRows(rows);
    };

    const canAdvanceFromProfile = brandName.trim().length > 0 && businessDescription.trim().length > 0;
    const summaryKeywords = keywordsForGeneration();
    const stepIndex = STEPS.indexOf(step);
    const name = clientName.trim() || 'this client';
    const selectedCount = keywordRows.filter(row => row.selected).length;
    const stepper = wizardStepperItems({
        current: step,
        brandDone: canAdvanceFromProfile,
        competitorsDone: rivals.some(rival => rival.trim()),
        keywordsDone: chosenKeywords.length > 0,
    });
    const continueDisabled = (step === 'profile' && !canAdvanceFromProfile)
        || (step === 'keywords' && (keywordLoading || savingKeywords))
        || (step === 'confirm' && submitting);
    const goBack = () => {
        if (stepIndex <= 0) onClose();
        else setStep(STEPS[stepIndex - 1]);
    };
    const goForward = () => {
        if (step === 'profile') setStep('seeds');
        else if (step === 'seeds') goToKeywords();
        else if (step === 'keywords') void advanceFromKeywords();
        else void handleGenerate();
    };
    const busy = savingKeywords || submitting;

    return (
        <section aria-labelledby="map-wizard-title" className="text-[#18181b]">
            <nav aria-label="Breadcrumb" className="mb-1.5 text-[12.5px] text-[#52525b]">
                <ol className="flex flex-wrap items-center gap-1">
                    <li><Link href="/workspace" className={cn('rounded hover:text-[#be185d] hover:underline', FOCUS)}>Clients</Link></li>
                    <li aria-hidden="true">/</li>
                    <li>
                        <Link href={`/workspace/${encodeURIComponent(clientId)}?tab=overview`} className={cn('rounded hover:text-[#be185d] hover:underline', FOCUS)}>
                            {name}
                        </Link>
                    </li>
                    <li aria-hidden="true">/</li>
                    <li>
                        <button type="button" onClick={onClose} className={cn('rounded hover:text-[#be185d] hover:underline', FOCUS)}>Topical Map</button>
                    </li>
                    <li aria-hidden="true">/</li>
                    <li aria-current="page">Build topic map</li>
                </ol>
            </nav>
            <h1 id="map-wizard-title" className="mb-4 text-2xl font-bold tracking-[-.01em]">Build {name}&apos;s topic map</h1>

            <WizardStepper items={stepper} />

            <div className="rounded-xl border border-[#e4e4e7] bg-white px-6 py-[22px]">
                    {loadingProfile ? (
                        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />Loading brand profile…
                        </div>
                    ) : (
                        <>
                            {step === 'profile' && (
                                <div className="space-y-4">
                                    <div>
                                        <h2 className="text-lg font-bold">Confirm {name}&apos;s brand</h2>
                                        <p className="mt-1 text-[13.5px] text-[#52525b]">
                                            Confirm the brand profile for {name}. The topic map is built around it.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void handleAiDraft()}
                                        disabled={drafting}
                                        className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-medium text-primary disabled:opacity-50"
                                    >
                                        {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                                        {drafting ? 'Drafting…' : 'Draft from pages already on the site'}
                                    </button>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">Brand name</label>
                                        <input
                                            value={brandName}
                                            onChange={e => setBrandName(e.target.value)}
                                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                                            placeholder="Acme Roofing Co."
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">Business description</label>
                                        <textarea
                                            value={businessDescription}
                                            onChange={e => setBusinessDescription(e.target.value)}
                                            rows={4}
                                            className="mt-1 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                                            placeholder="What the business does, who it serves, and where."
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">Content language</label>
                                        <select
                                            value={contentLanguage}
                                            onChange={e => setContentLanguage(e.target.value)}
                                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                                        >
                                            {LANGUAGES.map(lang => <option key={lang.value} value={lang.value}>{lang.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                            )}

                            {step === 'seeds' && (
                                <div className="space-y-6">
                                    <div>
                                        <h2 className="text-lg font-bold">Who {name} competes with</h2>
                                        <p className="mt-1 text-[13.5px] text-[#52525b]">
                                            Add the businesses {name} competes with online, and the topics the business wants to be known for.
                                        </p>
                                    </div>
                                    <div>
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-medium text-muted-foreground">Competitors</label>
                                            <button
                                                type="button"
                                                onClick={() => void handleSuggest('rivals')}
                                                disabled={suggestingRivals}
                                                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary disabled:opacity-50"
                                            >
                                                {suggestingRivals ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                                                Suggest
                                            </button>
                                        </div>
                                        <div className="mt-2 flex gap-2">
                                            <input
                                                value={rivalInput}
                                                onChange={e => setRivalInput(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRival(); } }}
                                                placeholder="competitor.com"
                                                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                                            />
                                            <button type="button" onClick={addRival} className="rounded-lg border border-border px-3 py-2 text-sm">Add</button>
                                        </div>
                                        <div className="mt-3"><ChipList items={rivals} onRemove={v => setRivals(prev => prev.filter(r => r !== v))} /></div>
                                    </div>

                                    <div>
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-medium text-muted-foreground">Focus topics</label>
                                            <button
                                                type="button"
                                                onClick={() => void handleSuggest('topics')}
                                                disabled={suggestingTopics}
                                                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary disabled:opacity-50"
                                            >
                                                {suggestingTopics ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                                                Suggest
                                            </button>
                                        </div>
                                        <div className="mt-2 flex gap-2">
                                            <input
                                                value={topicInput}
                                                onChange={e => setTopicInput(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTopic(); } }}
                                                placeholder="emergency roof repair"
                                                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                                            />
                                            <button type="button" onClick={addTopic} className="rounded-lg border border-border px-3 py-2 text-sm">Add</button>
                                        </div>
                                        <div className="mt-3"><ChipList items={focusTopics} onRemove={v => setFocusTopics(prev => prev.filter(t => t !== v))} /></div>
                                    </div>
                                </div>
                            )}

                            {step === 'keywords' && (
                                <KeywordSeedStep
                                    clientId={clientId}
                                    clientName={clientName}
                                    rows={keywordRows}
                                    searchConsole={searchConsole}
                                    loading={keywordLoading}
                                    notice={keywordNotice}
                                    onToggle={toggleKeyword}
                                    onRows={replaceKeywordRows}
                                    onSuggestAgain={() => setKeywordVisit(visit => visit + 1)}
                                />
                            )}

                            {step === 'confirm' && (
                                <div className="space-y-4">
                                    <div>
                                        <h2 className="text-lg font-bold">Review and build</h2>
                                        <p className="mt-1 text-[13.5px] text-[#52525b]">
                                            This builds a new draft topic map for {name} from the brand, competitors and the keywords you chose. Any current topic map is archived.
                                        </p>
                                    </div>
                                    <dl className="space-y-3 rounded-xl border border-border bg-muted/30 p-4 text-sm">
                                        <div><dt className="text-xs text-muted-foreground">Brand</dt><dd className="font-medium">{brandName || '—'}</dd></div>
                                        <div><dt className="text-xs text-muted-foreground">Description</dt><dd>{businessDescription || '—'}</dd></div>
                                        <div><dt className="text-xs text-muted-foreground">Language</dt><dd>{LANGUAGES.find(l => l.value === contentLanguage)?.label ?? contentLanguage}</dd></div>
                                        <div><dt className="text-xs text-muted-foreground">Competitors ({rivals.length})</dt><dd>{rivals.join(', ') || '—'}</dd></div>
                                        <div><dt className="text-xs text-muted-foreground">Focus topics ({focusTopics.length})</dt><dd>{focusTopics.join(', ') || '—'}</dd></div>
                                        <div><dt className="text-xs text-muted-foreground">Keywords ({summaryKeywords.length})</dt><dd>{summaryKeywords.join(', ') || '—'}</dd></div>
                                    </dl>
                                </div>
                            )}
                        </>
                    )}

                    {error && (
                        <div role="alert" className="mt-4 flex items-center gap-2 text-sm text-[#b91c1c]">
                            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{error}
                        </div>
                    )}

                <div className="mt-5 flex flex-wrap items-center gap-[14px] border-t border-[#e4e4e7] pt-[18px]">
                    <button type="button" onClick={goBack} className={SECONDARY_LG}>
                        {step === 'profile' ? 'Cancel' : <><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back</>}
                    </button>
                    {step === 'keywords' && <span className="text-[12.5px] text-[#52525b]">{keywordStepHint(searchConsole)}</span>}
                    <button type="button" onClick={goForward} disabled={continueDisabled || loadingProfile} className={cn(PRIMARY_LG, 'ml-auto')}>
                        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        {savingKeywords ? 'Saving…' : submitting ? 'Starting…' : continueLabel(step, selectedCount)}
                        {!busy && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                    </button>
                </div>
            </div>
        </section>
    );
}
