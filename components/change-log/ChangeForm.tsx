'use client';

import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { CHANGE_TYPES, CHANGE_TYPE_LABEL, KPI_LABEL, KPIS } from '@/lib/change-log/types';
import { validateChange, type ChangeInput } from '@/lib/change-log/validate';

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

    function setPage(index: number, patch: Partial<ChangeInput['pages'][number]>) {
        setInput(current => ({
            ...current,
            pages: current.pages.map((page, pageIndex) => pageIndex === index ? { ...page, ...patch } : page),
        }));
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
            <div className="grid gap-3 sm:grid-cols-2">
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
                        <input className="field sm:col-span-2" placeholder="https://" aria-label="Page URL" value={page.url} onChange={event => setPage(index, { url: event.target.value })} />
                        <input className="field" placeholder="Label" aria-label="Page label" value={page.label} onChange={event => setPage(index, { label: event.target.value })} />
                        <div className="grid grid-cols-2 gap-2">
                            <input className="field" placeholder="Page id" aria-label="CMS page id" value={page.cmsPageId} onChange={event => setPage(index, { cmsPageId: event.target.value })} />
                            <input className="field" placeholder="Widget" aria-label="CMS widget id" value={page.cmsWidgetId} onChange={event => setPage(index, { cmsWidgetId: event.target.value })} />
                        </div>
                    </div>
                ))}
                {input.pages.length < 8 && (
                    <button type="button" className="text-sm text-primary" onClick={() => setInput({ ...input, pages: [...input.pages, { url: '', label: '', cmsPageId: '', cmsWidgetId: '' }] })}>
                        Add another URL
                    </button>
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
