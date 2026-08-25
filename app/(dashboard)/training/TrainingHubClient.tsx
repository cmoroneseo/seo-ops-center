'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowRight, BookOpen, Check, ChevronDown, ChevronRight, Circle,
    FileCheck2, Library, MapPin, Search, Target, Upload,
} from 'lucide-react';
import type { TrainingGuideDocument, TrainingGuideSection } from '@/lib/training-guide';
import { isTrainingGuideMessage, parseTrainingGuideState, type SavedTrainingGuideState } from '@/lib/training-guide-state';
import { cn } from '@/lib/utils';
import {
    Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';

type SectionProgress = Record<string, { completed: number; total: number }>;
const STORAGE_KEY = 'seo-ops:training:seo-playbook-2026:full';

export default function TrainingHubClient({ guide }: { guide: TrainingGuideDocument }) {
    const groups = useMemo(() => {
        const grouped = new Map<string, TrainingGuideSection[]>();
        guide.sections.forEach((section) => grouped.set(section.group, [...(grouped.get(section.group) ?? []), section]));
        return [...grouped.entries()].map(([title, sections]) => ({ id: sections[0]?.track ?? title, title, sections }));
    }, [guide.sections]);
    const [selectedId, setSelectedId] = useState('lp4b');
    const [openGroups, setOpenGroups] = useState(() => new Set(groups.map((group) => group.title)));
    const [progress, setProgress] = useState({ completed: 0, total: guide.totalChecklistItems });
    const [sectionProgress, setSectionProgress] = useState<SectionProgress>({});
    const [uploadOpen, setUploadOpen] = useState(false);
    const [queuedFile, setQueuedFile] = useState('');
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const savedStateRef = useRef<SavedTrainingGuideState>({ checked: [], selectedId: 'lp4b' });
    const selectedIdRef = useRef('lp4b');
    const selected = guide.sections.find((section) => section.id === selectedId) ?? guide.sections[0];
    const percent = progress.total === 0 ? 0 : Math.round((progress.completed / progress.total) * 100);

    useEffect(() => {
        const sectionIds = guide.sections.map((section) => section.id);
        try {
            savedStateRef.current = parseTrainingGuideState(window.localStorage.getItem(STORAGE_KEY), sectionIds, guide.totalChecklistItems);
            selectedIdRef.current = savedStateRef.current.selectedId;
            setSelectedId(savedStateRef.current.selectedId);
        } catch { /* Progress remains session-only if browser storage is unavailable. */ }
        function persist(next: SavedTrainingGuideState) {
            savedStateRef.current = next;
            try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Non-blocking prototype persistence. */ }
        }
        function receiveGuideMessage(event: MessageEvent<unknown>) {
            if (event.source !== iframeRef.current?.contentWindow || !isTrainingGuideMessage(event.data, sectionIds, guide.totalChecklistItems)) return;
            if (event.data.type === 'seo-playbook-ready') {
                iframeRef.current?.contentWindow?.postMessage({ type: 'seo-playbook-restore', checked: savedStateRef.current.checked }, '*');
                iframeRef.current?.contentWindow?.postMessage({ type: 'seo-playbook-navigate', id: savedStateRef.current.selectedId, behavior: 'auto' }, '*');
            }
            if (event.data.type === 'seo-playbook-progress') {
                persist({ checked: event.data.checked, selectedId: selectedIdRef.current });
                setProgress({ completed: event.data.completed, total: event.data.total });
                setSectionProgress(Object.fromEntries(event.data.sections.map((section) => [section.id, { completed: section.completed, total: section.total }])));
            }
            if (event.data.type === 'seo-playbook-section') {
                const sectionId = event.data.id;
                selectedIdRef.current = sectionId;
                setSelectedId(sectionId);
                persist({ checked: savedStateRef.current.checked, selectedId: sectionId });
            }
        }
        window.addEventListener('message', receiveGuideMessage);
        return () => window.removeEventListener('message', receiveGuideMessage);
    }, [guide.sections, guide.totalChecklistItems]);

    function navigateTo(sectionId: string, behavior: 'auto' | 'smooth' = 'smooth') {
        selectedIdRef.current = sectionId;
        setSelectedId(sectionId);
        savedStateRef.current = { ...savedStateRef.current, selectedId: sectionId };
        try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(savedStateRef.current)); } catch { /* Non-blocking prototype persistence. */ }
        iframeRef.current?.contentWindow?.postMessage({ type: 'seo-playbook-navigate', id: sectionId, behavior }, '*');
        iframeRef.current?.focus();
    }

    return (
        <div className="min-h-full bg-[#090a0b] text-zinc-100 xl:h-full xl:overflow-hidden">
            <header className="flex h-[76px] items-center justify-between border-b border-white/10 px-5 lg:px-8">
                <div>
                    <div className="flex items-center gap-2.5"><Library className="h-5 w-5 text-primary" /><h1 className="text-xl font-semibold tracking-tight">Training Hub</h1></div>
                    <p className="mt-1 text-xs text-zinc-500">Practical training for consistent, evidence-led SEO delivery.</p>
                </div>
                <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
                    <DialogTrigger asChild>
                        <button type="button" className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/20 px-4 text-sm font-semibold transition hover:border-primary/60 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                            <Upload className="h-4 w-4" /><span className="hidden sm:inline">Upload training</span>
                        </button>
                    </DialogTrigger>
                    <DialogContent className="border-white/15 bg-[#111214] text-zinc-100 shadow-2xl sm:max-w-md">
                        <DialogHeader><DialogTitle>Upload training</DialogTitle><DialogDescription>Add an HTML guide or resource for the team to review.</DialogDescription></DialogHeader>
                        <label className="flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-white/20 px-5 py-8 text-center hover:border-primary/60 hover:bg-primary/5">
                            <Upload className="h-6 w-6 text-primary" /><span className="mt-3 text-sm font-semibold">Choose a training file</span><span className="mt-1 text-xs text-zinc-500">HTML, PDF, or DOCX · prototype review only</span>
                            <input type="file" accept=".html,.htm,.pdf,.doc,.docx" className="peer sr-only" onChange={(event) => setQueuedFile(event.target.files?.[0]?.name ?? '')} />
                            <span className="pointer-events-none mt-3 rounded-md px-2 py-1 text-xs text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary">Browse files</span>
                        </label>
                        {queuedFile && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{queuedFile} is ready for review.</p>}
                        <DialogFooter><DialogClose asChild><button type="button" className="h-11 w-full rounded-xl bg-primary text-sm font-bold text-primary-foreground hover:bg-primary/90">Done</button></DialogClose></DialogFooter>
                    </DialogContent>
                </Dialog>
            </header>

            <div className="grid xl:h-[calc(100%-76px)] xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <section className="border-r border-white/10 px-5 py-5 lg:px-8 xl:overflow-y-auto">
                    <div className="grid gap-5 xl:grid-cols-[160px_minmax(0,1fr)]">
                        <div className="mx-auto w-[160px] xl:mx-0">
                            <div className="overflow-hidden rounded-xl border border-white/15 bg-zinc-950 shadow-2xl shadow-black/30">
                                <Image src="/training/seo-playbook-cover.png" alt="The SEO Playbook 2026 cover" width={1040} height={1512} priority className="aspect-[190/276] h-auto w-full object-cover" />
                            </div>
                            <p className="mt-2 text-center text-[10px] uppercase tracking-[0.18em] text-zinc-600">Compiled Aug 20, 2026</p>
                        </div>
                        <div className="min-w-0 self-center">
                            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Complete edition</p>
                            <h2 className="mt-2 max-w-[18ch] font-serif text-3xl leading-[1.02] tracking-tight text-[#fbf8f1] xl:text-[36px]">The SEO Playbook: Universal and Local Fundamentals, Graded by Evidence</h2>
                            <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">The complete uploaded guide, preserved section by section with its original evidence, examples, tables, notes, and sources.</p>
                            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-300">
                                <span className="inline-flex items-center gap-1.5"><BookOpen className="h-4 w-4 text-zinc-500" />2 tracks</span>
                                <span className="inline-flex items-center gap-1.5"><Library className="h-4 w-4 text-zinc-500" />{guide.sections.length} sections</span>
                                <span className="inline-flex items-center gap-1.5"><FileCheck2 className="h-4 w-4 text-zinc-500" />{guide.totalChecklistItems} source items</span>
                            </div>
                            <div className="mt-5">
                                <div className="mb-2 flex items-center justify-between text-xs"><span className="text-zinc-300">{progress.completed} of {progress.total} checklist items complete</span><span className="font-semibold">{percent}%</span></div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Playbook completion" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} /></div>
                            </div>
                            <button type="button" onClick={() => navigateTo(selected.id)} className="mt-5 inline-flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/15 transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#090a0b]">Resume full guide <ArrowRight className="h-4 w-4" /></button>
                        </div>
                    </div>

                    <div className="mt-5 flex items-end justify-between">
                        <div><h2 className="text-lg font-semibold">Complete guide contents</h2><p className="mt-1 text-xs text-zinc-500">Every section from the uploaded resource, in source order.</p></div>
                        <button type="button" onClick={() => setOpenGroups(new Set(openGroups.size === groups.length ? [] : groups.map((group) => group.title)))} className="text-xs text-zinc-400 hover:text-white">{openGroups.size === groups.length ? 'Collapse all' : 'Expand all'}</button>
                    </div>
                    <div className="mt-3 overflow-hidden rounded-xl border border-white/15 bg-white/[0.025]">
                        {groups.map((group, groupIndex) => {
                            const open = openGroups.has(group.title);
                            const groupTotals = group.sections.reduce((total, section) => {
                                const current = sectionProgress[section.id] ?? { completed: 0, total: section.checklistItems };
                                return { completed: total.completed + current.completed, total: total.total + current.total };
                            }, { completed: 0, total: 0 });
                            const groupPercent = groupTotals.total ? Math.round(groupTotals.completed / groupTotals.total * 100) : 0;
                            return <div key={group.title} className={cn(groupIndex > 0 && 'border-t border-white/10')}>
                                <button type="button" onClick={() => setOpenGroups((current) => { const next = new Set(current); if (next.has(group.title)) next.delete(group.title); else next.add(group.title); return next; })} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/[0.035]">
                                    {group.id === 'core' ? <Target className="h-5 w-5 text-zinc-400" /> : group.id === 'local' ? <MapPin className="h-5 w-5 text-zinc-400" /> : <FileCheck2 className="h-5 w-5 text-zinc-400" />}
                                    <span className="min-w-0 flex-1 text-sm font-semibold"><span className="mr-2 text-zinc-500">{groupIndex + 1}.</span>{group.title}</span><span className="hidden text-xs text-zinc-500 sm:block">{group.sections.length} sections</span><span className="rounded-full border border-primary/50 px-2 py-0.5 text-[11px] font-semibold">{groupPercent}%</span><ChevronDown className={cn('h-4 w-4 text-zinc-500 transition-transform', open && 'rotate-180')} />
                                </button>
                                {open && <div className="border-t border-white/10 px-2 py-1.5">{group.sections.map((section) => {
                                    const active = section.id === selected.id;
                                    const current = sectionProgress[section.id] ?? { completed: 0, total: section.checklistItems };
                                    const complete = current.total > 0 && current.completed === current.total;
                                    return <button key={section.id} type="button" onClick={() => navigateTo(section.id)} aria-current={active ? 'step' : undefined} className={cn('group relative flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left transition', active ? 'bg-primary/15 text-white' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100')}>
                                        <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', complete ? 'border-primary bg-primary text-white' : active ? 'border-primary text-primary' : 'border-zinc-600')}>{complete ? <Check className="h-3 w-3" /> : active ? <ChevronRight className="h-3 w-3" /> : <Circle className="h-2.5 w-2.5" />}</span>
                                        <span className="min-w-0 flex-1 truncate text-sm">{section.title}</span>{current.total > 0 && <span className="text-xs tabular-nums text-zinc-500">{current.completed}/{current.total}</span>}
                                    </button>;
                                })}</div>}
                            </div>;
                        })}
                    </div>
                </section>

                <article className="bg-[#f8f5ee] text-[#201f1c] xl:m-4 xl:h-[calc(100%-2rem)] xl:overflow-hidden xl:rounded-2xl">
                    <div className="flex h-12 items-center justify-between border-b border-[#dcd5c8] px-4 text-xs text-zinc-500">
                        <span className="min-w-0 truncate"><strong className="text-primary">Full guide</strong><ChevronRight className="mx-1 inline h-3.5 w-3.5" />{selected.title}</span>
                        <span className="hidden items-center gap-1.5 sm:inline-flex"><Search className="h-3.5 w-3.5" />Search and evidence filters are inside the guide</span>
                    </div>
                    <iframe ref={iframeRef} src="/training-guide#lp4b" title="Complete SEO Playbook 2026" className="h-[900px] w-full border-0 bg-[#f8f5ee] xl:h-[calc(100%-3rem)]" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" />
                </article>
            </div>
        </div>
    );
}
