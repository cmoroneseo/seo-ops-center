'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Sparkles, X } from 'lucide-react';

import { getClientProfile, saveClientProfile } from '@/lib/supabase/topical-map';
import type { TopicalMapProfile } from '@/lib/types';
import { cn } from '@/lib/utils';

type Step = 'profile' | 'seeds' | 'confirm';

interface MapGenerationWizardProps {
    organizationId: string;
    clientId: string;
    clientName: string;
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

export function MapGenerationWizard({ organizationId, clientId, clientName, onClose, onGenerated }: MapGenerationWizardProps) {
    const [step, setStep] = useState<Step>('profile');
    const [loadingProfile, setLoadingProfile] = useState(true);
    const [error, setError] = useState('');

    const [brandName, setBrandName] = useState('');
    const [businessDescription, setBusinessDescription] = useState('');
    const [contentLanguage, setContentLanguage] = useState('en');
    const [rivals, setRivals] = useState<string[]>([]);
    const [focusTopics, setFocusTopics] = useState<string[]>([]);
    const [rivalInput, setRivalInput] = useState('');
    const [topicInput, setTopicInput] = useState('');

    const [drafting, setDrafting] = useState(false);
    const [suggestingRivals, setSuggestingRivals] = useState(false);
    const [suggestingTopics, setSuggestingTopics] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const profile = await getClientProfile(clientId);
            if (cancelled || !profile) { setLoadingProfile(false); return; }
            setBrandName(profile.brandName);
            setBusinessDescription(profile.businessDescription);
            setContentLanguage(profile.contentLanguage || 'en');
            setRivals(profile.rivals ?? []);
            setFocusTopics(profile.focusTopics ?? []);
            setLoadingProfile(false);
        })();
        return () => { cancelled = true; };
    }, [clientId]);

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
        const profile: TopicalMapProfile = { brandName, businessDescription, contentLanguage, focusTopics, rivals };
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
                body: JSON.stringify({ clientId, organizationId }),
            }).catch(reason => {
                console.error('Topical map generation request failed', reason);
            });

            onGenerated();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Failed to start generation');
            setSubmitting(false);
        }
    };

    const canAdvanceFromProfile = brandName.trim().length > 0 && businessDescription.trim().length > 0;

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[5vh] backdrop-blur-sm">
            <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card shadow-2xl">
                <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-primary" />
                        <h2 className="text-lg font-semibold">
                            {step === 'profile' && 'Confirm Brand Profile'}
                            {step === 'seeds' && 'Rivals & Focus Topics'}
                            {step === 'confirm' && 'Generate Topical Map'}
                        </h2>
                    </div>
                    <button onClick={onClose} aria-label="Close" className="p-1 text-muted-foreground hover:text-foreground">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="flex items-center gap-2 px-6 pt-4 text-xs text-muted-foreground">
                    {(['profile', 'seeds', 'confirm'] as Step[]).map((s, idx) => (
                        <div key={s} className="flex items-center gap-2">
                            <span className={cn('flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold',
                                step === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')}>
                                {idx + 1}
                            </span>
                            {idx < 2 && <span className="h-px w-6 bg-border" />}
                        </div>
                    ))}
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {loadingProfile ? (
                        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />Loading brand profile…
                        </div>
                    ) : (
                        <>
                            {step === 'profile' && (
                                <div className="space-y-4">
                                    <p className="text-sm text-muted-foreground">
                                        Confirm the brand profile for {clientName}. This anchors the topical map's tone and scope.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => void handleAiDraft()}
                                        disabled={drafting}
                                        className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-medium text-primary disabled:opacity-50"
                                    >
                                        {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                                        {drafting ? 'Drafting…' : 'AI Draft from crawled pages'}
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
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-medium text-muted-foreground">Rivals</label>
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

                            {step === 'confirm' && (
                                <div className="space-y-4">
                                    <p className="text-sm text-muted-foreground">
                                        This generates a new draft topical map for {clientName}. It runs across several stages — search demand,
                                        existing pages, and AI architecture — and any prior active map is archived.
                                    </p>
                                    <dl className="space-y-3 rounded-xl border border-border bg-muted/30 p-4 text-sm">
                                        <div><dt className="text-xs text-muted-foreground">Brand</dt><dd className="font-medium">{brandName || '—'}</dd></div>
                                        <div><dt className="text-xs text-muted-foreground">Description</dt><dd>{businessDescription || '—'}</dd></div>
                                        <div><dt className="text-xs text-muted-foreground">Language</dt><dd>{LANGUAGES.find(l => l.value === contentLanguage)?.label ?? contentLanguage}</dd></div>
                                        <div><dt className="text-xs text-muted-foreground">Rivals ({rivals.length})</dt><dd>{rivals.join(', ') || '—'}</dd></div>
                                        <div><dt className="text-xs text-muted-foreground">Focus topics ({focusTopics.length})</dt><dd>{focusTopics.join(', ') || '—'}</dd></div>
                                    </dl>
                                </div>
                            )}
                        </>
                    )}

                    {error && (
                        <div className="mt-4 flex items-center gap-2 text-sm text-red-500">
                            <AlertTriangle className="h-4 w-4 shrink-0" />{error}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between border-t border-border/50 px-6 py-4">
                    <button
                        type="button"
                        onClick={() => (step === 'profile' ? onClose() : setStep(step === 'seeds' ? 'profile' : 'seeds'))}
                        className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                    >
                        {step === 'profile' ? 'Cancel' : 'Back'}
                    </button>
                    {step !== 'confirm' ? (
                        <button
                            type="button"
                            disabled={step === 'profile' && !canAdvanceFromProfile}
                            onClick={() => setStep(step === 'profile' ? 'seeds' : 'confirm')}
                            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                        >
                            Next
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => void handleGenerate()}
                            disabled={submitting}
                            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                        >
                            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                            {submitting ? 'Starting…' : 'Generate Topical Map'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
