'use client';

import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { CHANGE_TYPES, CHANGE_TYPE_LABEL, KPI_LABEL, KPIS, TREATMENTS, TREATMENT_CHANGE_TYPE, TREATMENT_LABEL } from '@/lib/change-log/types';
import { GROUP_PAGE_LIMIT, SINGLE_PAGE_LIMIT, validateChange, type ChangeInput } from '@/lib/change-log/validate';

const EMPTY: ChangeInput = {
    title: '',
    changeType: 'h1',
    beforeText: '',
    afterText: '',
    liveAtLocal: '',
    approvedByName: '',
    approvedAtLocal: '',
    backupReference: '',
    revertInstructions: '',
    kpi: 'clicks',
    compareLastYear: false,
    testKind: 'single',
    treatment: '',
    pages: [{ url: '', label: '', cmsPageId: '', cmsWidgetId: '' }],
    queries: [''],
};

export function ChangeForm({
    initial,
    example,
    pending,
    onCancel,
    onSubmit,
}: {
    initial?: ChangeInput;
    example: boolean;
    pending: boolean;
    onCancel: () => void;
    onSubmit: (input: ChangeInput) => void;
}) {
    const [input, setInput] = useState<ChangeInput>(initial ?? EMPTY);
    const [error, setError] = useState<string | null>(null);
    const [paste, setPaste] = useState('');
    const grouped = input.testKind === 'group';
    const pageLimit = grouped ? GROUP_PAGE_LIMIT : SINGLE_PAGE_LIMIT;

    function setPage(index: number, patch: Partial<ChangeInput['pages'][number]>) {
        setInput(current => ({
            ...current,
            pages: current.pages.map((page, pageIndex) => pageIndex === index ? { ...page, ...patch } : page),
        }));
    }

    function addPasted() {
        const urls = paste.split(/\s+/).map(line => line.trim()).filter(line => /^https?:\/\//i.test(line));
        if (urls.length === 0) return;
        setInput(current => {
            const pages = current.pages.filter(page => page.url.trim());
            for (const url of urls) {
                if (pages.length >= pageLimit) break;
                if (pages.some(page => page.url.trim() === url)) continue;
                pages.push({ url, label: '', cmsPageId: '', cmsWidgetId: '' });
            }
            return { ...current, pages: pages.length > 0 ? pages : current.pages };
        });
        setPaste('');
    }

    function submit(event: FormEvent) {
        event.preventDefault();
        const problem = validateChange({
            ...input,
            queries: input.queries,
        });
        if (problem) {
            setError(problem);
            return;
        }
        setError(null);
        onSubmit(input);
    }

    return (
        <form onSubmit={submit} className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold">Log a change</h2>
                    <p className="text-sm text-muted-foreground">Times are Pacific time. This doesn&apos;t change the live site.</p>
                </div>
                <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
                    <Button type="submit" disabled={pending}>{pending ? 'Saving…' : example ? 'Review example' : 'Save change'}</Button>
                </div>
            </div>
            {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
            <fieldset>
                <legend className="text-sm font-medium">Pages in this test</legend>
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                    <label className="inline-flex items-center gap-2">
                        <input
                            type="radio"
                            name="testKind"
                            value="single"
                            checked={!grouped}
                            onChange={() => setInput({ ...input, testKind: 'single', treatment: '' })}
                        />
                        One page
                    </label>
                    <label className="inline-flex items-center gap-2">
                        <input
                            type="radio"
                            name="testKind"
                            value="group"
                            checked={grouped}
                            onChange={() => setInput({
                                ...input,
                                testKind: 'group',
                                treatment: input.treatment || 'title_meta',
                                changeType: input.treatment ? input.changeType : TREATMENT_CHANGE_TYPE.title_meta,
                            })}
                        />
                        Group of pages
                    </label>
                </div>
                {grouped && <p className="mt-1 text-xs text-muted-foreground">Same change on every page. One went-live date. Not a split test.</p>}
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
                {grouped && (
                    <label className="block text-sm sm:col-span-2">
                        <span className="mb-1 block font-medium">Treatment</span>
                        <select
                            className="field"
                            value={input.treatment || 'title_meta'}
                            onChange={event => {
                                const treatment = event.target.value;
                                const known = TREATMENTS.find(item => item === treatment);
                                setInput({
                                    ...input,
                                    treatment,
                                    changeType: known ? TREATMENT_CHANGE_TYPE[known] : input.changeType,
                                });
                            }}
                        >
                            {TREATMENTS.map(item => <option key={item} value={item}>{TREATMENT_LABEL[item]}</option>)}
                        </select>
                    </label>
                )}
                <label className="block text-sm">
                    <span className="mb-1 block font-medium">Title</span>
                    <input className="field" value={input.title} onChange={event => setInput({ ...input, title: event.target.value })} />
                </label>
                <label className="block text-sm">
                    <span className="mb-1 block font-medium">Change type</span>
                    <select className="field" value={input.changeType} onChange={event => setInput({ ...input, changeType: event.target.value })}>
                        {CHANGE_TYPES.map(type => <option key={type} value={type}>{CHANGE_TYPE_LABEL[type]}</option>)}
                    </select>
                </label>
                <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block font-medium">Before</span>
                    <textarea className="field min-h-20" value={input.beforeText} onChange={event => setInput({ ...input, beforeText: event.target.value })} />
                </label>
                <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block font-medium">After</span>
                    <textarea className="field min-h-20" value={input.afterText} onChange={event => setInput({ ...input, afterText: event.target.value })} />
                </label>
                <label className="block text-sm">
                    <span className="mb-1 block font-medium">Went live (Pacific time)</span>
                    <input className="field" type="datetime-local" value={input.liveAtLocal} onChange={event => setInput({ ...input, liveAtLocal: event.target.value })} />
                </label>
                <label className="block text-sm">
                    <span className="mb-1 block font-medium">Approved by</span>
                    <input className="field" value={input.approvedByName} onChange={event => setInput({ ...input, approvedByName: event.target.value })} />
                </label>
                <label className="block text-sm">
                    <span className="mb-1 block font-medium">Approved at (Pacific time, optional)</span>
                    <input className="field" type="datetime-local" value={input.approvedAtLocal} onChange={event => setInput({ ...input, approvedAtLocal: event.target.value })} />
                </label>
                <label className="block text-sm">
                    <span className="mb-1 block font-medium">What we&apos;re watching</span>
                    <select className="field" value={input.kpi} onChange={event => setInput({ ...input, kpi: event.target.value })}>
                        {KPIS.map(kpi => <option key={kpi} value={kpi}>{KPI_LABEL[kpi]}</option>)}
                    </select>
                </label>
                <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block font-medium">Saved copy of the old version</span>
                    <input className="field" value={input.backupReference} onChange={event => setInput({ ...input, backupReference: event.target.value })} />
                </label>
                <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block font-medium">How to undo</span>
                    <textarea className="field min-h-16" value={input.revertInstructions} onChange={event => setInput({ ...input, revertInstructions: event.target.value })} />
                </label>
            </div>
            <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Pages</legend>
                {input.pages.map((page, index) => (
                    <div key={index} className="grid gap-2 sm:grid-cols-4">
                        <input className="field sm:col-span-2" placeholder="https://" aria-label="Page address" value={page.url} onChange={event => setPage(index, { url: event.target.value })} />
                        <input className="field" placeholder="Label" aria-label="Page label" value={page.label} onChange={event => setPage(index, { label: event.target.value })} />
                        <div className="grid grid-cols-2 gap-2">
                            <input className="field" placeholder="Page id" aria-label="Page id" value={page.cmsPageId} onChange={event => setPage(index, { cmsPageId: event.target.value })} />
                            <input className="field" placeholder="Section id" aria-label="Section id" value={page.cmsWidgetId} onChange={event => setPage(index, { cmsWidgetId: event.target.value })} />
                        </div>
                    </div>
                ))}
                {input.pages.length < pageLimit && (
                    <button type="button" className="text-sm text-primary" onClick={() => setInput({ ...input, pages: [...input.pages, { url: '', label: '', cmsPageId: '', cmsWidgetId: '' }] })}>
                        Add another page
                    </button>
                )}
                {input.pages.length > 1 && (
                    <button
                        type="button"
                        className="text-sm text-muted-foreground"
                        onClick={() => setInput({ ...input, pages: input.pages.slice(0, -1) })}
                    >
                        Remove last page
                    </button>
                )}
                {grouped && (
                    <div className="space-y-2 pt-2">
                        <label className="block text-sm">
                            <span className="mb-1 block font-medium">Add several addresses</span>
                            <textarea
                                className="field min-h-16"
                                aria-label="Paste page addresses"
                                placeholder="One https:// address per line"
                                value={paste}
                                onChange={event => setPaste(event.target.value)}
                            />
                        </label>
                        <button type="button" className="text-sm text-primary" onClick={addPasted}>Add these pages</button>
                    </div>
                )}
            </fieldset>
            <label className="block text-sm">
                <span className="mb-1 block font-medium">Search terms people used, one per line</span>
                <textarea
                    className="field min-h-20"
                    value={input.queries.join('\n')}
                    onChange={event => setInput({ ...input, queries: event.target.value.split('\n') })}
                />
            </label>
            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={input.compareLastYear} onChange={event => setInput({ ...input, compareLastYear: event.target.checked })} />
                Also read the same dates last year. The result still uses the 28 days before the change.
            </label>
        </form>
    );
}
