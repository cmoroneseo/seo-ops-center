'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
    CONTENT_PLAN_COLUMNS,
    CONTENT_PLAN_HONESTY,
    CONTENT_PLAN_STATUSES,
    CONTENT_PLAN_STATUS_LABEL,
    CONTENT_PLAN_TYPES,
    CONTENT_PLAN_TYPE_LABEL,
    CONTENT_PLAN_UNSET,
    contentPlanDraftFromRow,
    contentPlanForMonth,
    contentPlanView,
    emptyContentPlanDraft,
    type ContentPlanDraft,
    type ContentPlanRow,
} from '@/lib/campaign-workspace/content-plan';
import { isPlanMonth, monthKeyFromDay, planMonthTitle } from '@/lib/seo-plan/plan-sections';
import { OVERVIEW_MONTH_EVENT, readOverviewMonth } from '@/lib/seo-plan/plan-month-url';
import {
    createCampaignContentPlanRow,
    deleteCampaignContentPlanRow,
    listCampaignContentPlan,
    updateCampaignContentPlanRow,
} from '@/lib/supabase/campaign-content-plan';
import { cn } from '@/lib/utils';

const fieldClass = 'h-11 w-full rounded-md border border-[#e4e4e7] bg-white px-2.5 text-[13px] text-[#18181b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#18181b]';
const labelClass = 'mb-1 block text-[12px] font-medium text-[#52525b]';

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
    return (
        <div>
            <label htmlFor={id} className={labelClass}>{label}</label>
            {children}
        </div>
    );
}

function Unset() {
    return <span className="text-[#a1a1aa]">{CONTENT_PLAN_UNSET}</span>;
}

export function ContentPlanTable({
    month,
    rows,
    mode,
    error,
    onCreate,
    onUpdate,
    onDelete,
}: {
    month: string;
    rows: readonly ContentPlanRow[];
    mode: 'loading' | 'unavailable' | 'ready';
    error?: string | null;
    onCreate?: (draft: ContentPlanDraft) => Promise<void>;
    onUpdate?: (id: string, draft: ContentPlanDraft) => Promise<ContentPlanRow>;
    onDelete?: (id: string) => Promise<void>;
}) {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [draft, setDraft] = useState<ContentPlanDraft>(emptyContentPlanDraft());
    const [saving, setSaving] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const label = planMonthTitle(month);
    const visible = contentPlanForMonth(rows, month);
    const message = localError ?? error ?? null;

    function patch(next: Partial<ContentPlanDraft>) {
        setDraft(current => ({ ...current, ...next }));
    }

    function select(row: ContentPlanRow) {
        setSelectedId(row.id);
        setDraft(contentPlanDraftFromRow(row));
        setLocalError(null);
        setConfirmingDelete(false);
    }

    function startNew() {
        setSelectedId(null);
        setDraft(emptyContentPlanDraft());
        setLocalError(null);
        setConfirmingDelete(false);
    }

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setLocalError(null);
        try {
            if (selectedId) {
                if (!onUpdate) return;
                const saved = await onUpdate(selectedId, draft);
                setDraft(contentPlanDraftFromRow(saved));
                setSelectedId(saved.id);
            } else if (onCreate) {
                await onCreate(draft);
                setDraft(emptyContentPlanDraft());
            }
        } catch (caught) {
            setLocalError(caught instanceof Error ? caught.message : 'Could not save this content.');
        } finally {
            setSaving(false);
        }
    }

    async function remove() {
        if (!selectedId || !onDelete || saving) return;
        setSaving(true);
        setLocalError(null);
        try {
            await onDelete(selectedId);
            startNew();
        } catch (caught) {
            setLocalError(caught instanceof Error ? caught.message : 'Could not remove this content.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <section
            data-region="content-plan"
            data-content-plan-state={mode}
            data-indexed="false"
            data-performing="false"
            data-verified="false"
            aria-labelledby="content-plan-heading"
            className="rounded-xl border border-[#e4e4e7] bg-white p-4"
        >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 id="content-plan-heading" className="text-[15px] font-semibold leading-5">Content Plan</h2>
                <p className="text-[13px] text-[#52525b]">
                    <span data-content-plan-month={month}>{label}</span>
                    <span className="text-[#71717a]"> · follows the work month</span>
                </p>
            </div>
            <p data-content-honesty="published" className="mt-2 max-w-3xl text-[12px] leading-5 text-[#52525b]">
                {CONTENT_PLAN_HONESTY}
            </p>

            {mode === 'loading' ? <p className="mt-4 text-[13px] text-[#71717a]">Loading content plan…</p> : null}
            {mode === 'unavailable' ? <p role="alert" className="mt-4 text-[13px] text-[#52525b]">Content plan is not available.</p> : null}

            {mode === 'ready' ? (
                <>
                    <div className="mt-4 overflow-x-auto">
                        <table className="w-full min-w-[72rem] border-collapse text-left text-[13px]">
                            <caption className="sr-only">Content Plan for {label}</caption>
                            <thead>
                                <tr className="border-b border-[#e4e4e7] text-[11px] font-medium uppercase tracking-wide text-[#71717a]">
                                    {CONTENT_PLAN_COLUMNS.map(column => (
                                        <th key={column} scope="col" className="px-3 py-2 font-medium">{column}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {visible.length === 0 ? (
                                    <tr>
                                        <td colSpan={CONTENT_PLAN_COLUMNS.length} className="px-3 py-6 text-[13px] text-[#71717a]">
                                            No content for {label}.
                                        </td>
                                    </tr>
                                ) : visible.map(row => {
                                    const view = contentPlanView(row);
                                    const selected = selectedId === row.id;
                                    return (
                                        <tr
                                            key={row.id}
                                            data-content-row={row.id}
                                            data-content-status={row.status ?? ''}
                                            data-published={view.published ? 'true' : 'false'}
                                            data-indexed="false"
                                            data-performing="false"
                                            data-verified="false"
                                            className={cn('border-b border-[#f4f4f5]', selected && 'bg-[#fdf2f8]')}
                                        >
                                            <td data-field="month" data-unset="false" className="whitespace-nowrap px-3 py-2">{view.monthLabel}</td>
                                            <td data-field="published-on" data-unset={view.publishedOn === CONTENT_PLAN_UNSET ? 'true' : 'false'} className="whitespace-nowrap px-3 py-2">
                                                {view.publishedOn === CONTENT_PLAN_UNSET ? <Unset /> : view.publishedOn}
                                            </td>
                                            <td data-field="status" data-unset={row.status ? 'false' : 'true'} className="whitespace-nowrap px-3 py-2">
                                                {row.status ? view.statusLabel : <Unset />}
                                            </td>
                                            <td data-field="content-type" data-unset={row.contentType ? 'false' : 'true'} className="whitespace-nowrap px-3 py-2">
                                                {row.contentType ? view.contentTypeLabel : <Unset />}
                                            </td>
                                            <td data-field="title" data-unset="false" className="min-w-48 px-3 py-2">
                                                <div className="flex items-start justify-between gap-3">
                                                    <span>{view.title}</span>
                                                    <button
                                                        type="button"
                                                        aria-pressed={selected}
                                                        onClick={() => select(row)}
                                                        className="shrink-0 text-[12px] font-medium text-[#18181b] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#18181b]"
                                                    >
                                                        Edit
                                                    </button>
                                                </div>
                                            </td>
                                            <td data-field="keyword" data-unset={row.keyword ? 'false' : 'true'} className="px-3 py-2">
                                                {row.keyword ? view.keyword : <Unset />}
                                            </td>
                                            <td data-field="volume" data-unset={row.searchVolume == null ? 'true' : 'false'} className="px-3 py-2">
                                                {row.searchVolume == null ? <Unset /> : view.volume}
                                            </td>
                                            <td data-field="difficulty" data-unset={row.keywordDifficulty == null ? 'true' : 'false'} className="px-3 py-2">
                                                {row.keywordDifficulty == null ? <Unset /> : view.difficulty}
                                            </td>
                                            <td data-field="due-on" data-unset={view.dueOn === CONTENT_PLAN_UNSET ? 'true' : 'false'} className="whitespace-nowrap px-3 py-2">
                                                {view.dueOn === CONTENT_PLAN_UNSET ? <Unset /> : view.dueOn}
                                            </td>
                                            <td data-field="draft-link" data-unset={view.draftUrl ? 'false' : 'true'} className="max-w-[12rem] px-3 py-2">
                                                {view.draftUrl ? <a href={view.draftUrl} target="_blank" rel="noreferrer" className="break-all text-[#18181b] underline-offset-2 hover:underline">{view.draftUrl}</a> : <Unset />}
                                            </td>
                                            <td data-field="live-link" data-unset={view.liveUrl ? 'false' : 'true'} className="max-w-[12rem] px-3 py-2">
                                                {view.liveUrl ? <a href={view.liveUrl} target="_blank" rel="noreferrer" className="break-all text-[#18181b] underline-offset-2 hover:underline">{view.liveUrl}</a> : <Unset />}
                                            </td>
                                            <td data-field="matching-product" data-unset={row.matchingProduct ? 'false' : 'true'} className="px-3 py-2">
                                                {row.matchingProduct ? view.matchingProduct : <Unset />}
                                            </td>
                                            <td data-field="internal-link" data-unset={view.internalUrl ? 'false' : 'true'} className="max-w-[12rem] px-3 py-2">
                                                {view.internalUrl ? <a href={view.internalUrl} target="_blank" rel="noreferrer" className="break-all text-[#18181b] underline-offset-2 hover:underline">{view.internalUrl}</a> : <Unset />}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <form onSubmit={submit} autoComplete="off" className="mt-4 border-t border-[#e4e4e7] pt-4" aria-label={selectedId ? 'Edit content' : 'Add content'}>
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-[13px] font-semibold">{selectedId ? 'Edit content' : 'Add content'}</h3>
                            {selectedId ? (
                                <button type="button" onClick={startNew} className="min-h-11 text-[13px] text-[#52525b] underline-offset-2 hover:underline">
                                    New content
                                </button>
                            ) : null}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                                <Field id="content-plan-title" label="Title">
                                    <input
                                        id="content-plan-title"
                                        required
                                        value={draft.title}
                                        maxLength={240}
                                        onChange={event => patch({ title: event.target.value })}
                                        className={fieldClass}
                                    />
                                </Field>
                            </div>
                            <Field id="content-plan-status" label="Status">
                                <select id="content-plan-status" aria-label="Status" value={draft.status} onChange={event => patch({ status: event.target.value })} className={fieldClass}>
                                    <option value="">{CONTENT_PLAN_UNSET}</option>
                                    {CONTENT_PLAN_STATUSES.map(status => (
                                        <option key={status} value={status}>{CONTENT_PLAN_STATUS_LABEL[status]}</option>
                                    ))}
                                </select>
                            </Field>
                            <Field id="content-plan-type" label="Content Type">
                                <select id="content-plan-type" aria-label="Content Type" value={draft.contentType} onChange={event => patch({ contentType: event.target.value })} className={fieldClass}>
                                    <option value="">{CONTENT_PLAN_UNSET}</option>
                                    {CONTENT_PLAN_TYPES.map(type => (
                                        <option key={type} value={type}>{CONTENT_PLAN_TYPE_LABEL[type]}</option>
                                    ))}
                                </select>
                            </Field>
                            <Field id="content-plan-keyword" label="KW">
                                <input id="content-plan-keyword" value={draft.keyword} maxLength={180} onChange={event => patch({ keyword: event.target.value })} className={fieldClass} />
                            </Field>
                            <Field id="content-plan-product" label="Matching Product/Service">
                                <input id="content-plan-product" value={draft.matchingProduct} maxLength={180} onChange={event => patch({ matchingProduct: event.target.value })} className={fieldClass} />
                            </Field>
                            <Field id="content-plan-volume" label="Volume">
                                <input id="content-plan-volume" inputMode="numeric" aria-label="Volume" value={draft.searchVolume} placeholder={CONTENT_PLAN_UNSET} onChange={event => patch({ searchVolume: event.target.value })} className={fieldClass} />
                            </Field>
                            <Field id="content-plan-difficulty" label="KD">
                                <input id="content-plan-difficulty" inputMode="numeric" aria-label="KD" value={draft.keywordDifficulty} placeholder={CONTENT_PLAN_UNSET} onChange={event => patch({ keywordDifficulty: event.target.value })} className={fieldClass} />
                            </Field>
                            <Field id="content-plan-published" label="Published Date">
                                <input id="content-plan-published" type="date" aria-label="Published Date" value={draft.publishedOn} onChange={event => patch({ publishedOn: event.target.value })} className={fieldClass} />
                            </Field>
                            <Field id="content-plan-due" label="Due Date">
                                <input id="content-plan-due" type="date" aria-label="Due Date" value={draft.dueOn} onChange={event => patch({ dueOn: event.target.value })} className={fieldClass} />
                            </Field>
                            <Field id="content-plan-draft" label="Draft Link">
                                <input id="content-plan-draft" type="url" aria-label="Draft Link" value={draft.draftUrl} placeholder="https://" maxLength={500} onChange={event => patch({ draftUrl: event.target.value })} className={fieldClass} />
                            </Field>
                            <Field id="content-plan-live" label="Live Link">
                                <input id="content-plan-live" type="url" aria-label="Live Link" value={draft.liveUrl} placeholder="https://" maxLength={500} onChange={event => patch({ liveUrl: event.target.value })} className={fieldClass} />
                            </Field>
                            <div className="sm:col-span-2">
                                <Field id="content-plan-internal" label="Internal Link">
                                    <input id="content-plan-internal" type="url" aria-label="Internal Link" value={draft.internalUrl} placeholder="https://" maxLength={500} onChange={event => patch({ internalUrl: event.target.value })} className={fieldClass} />
                                </Field>
                            </div>
                        </div>
                        {message ? <p role="alert" className="mt-3 text-[13px] text-[#b45309]">{message}</p> : null}
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                            <button
                                type="submit"
                                disabled={saving || (selectedId ? !onUpdate : !onCreate)}
                                className="min-h-11 rounded-md bg-[#18181b] px-3 text-[13px] font-medium text-white disabled:opacity-60"
                            >
                                {selectedId ? 'Save content' : 'Add content'}
                            </button>
                            {selectedId && onDelete ? (
                                confirmingDelete ? (
                                    <button type="button" onClick={() => void remove()} disabled={saving} className="min-h-11 text-[13px] text-[#b45309] underline-offset-2 hover:underline">
                                        Remove this content
                                    </button>
                                ) : (
                                    <button type="button" onClick={() => setConfirmingDelete(true)} className="min-h-11 text-[13px] text-[#52525b] underline-offset-2 hover:underline">
                                        Remove
                                    </button>
                                )
                            ) : null}
                        </div>
                    </form>
                </>
            ) : null}
        </section>
    );
}

function useWorkMonth(today: string, monthProp: string | undefined): string | null {
    const override = monthProp && isPlanMonth(monthProp) ? monthProp : null;
    const [liveMonth, setLiveMonth] = useState<string | null>(null);
    useEffect(() => {
        if (override) return;
        const sync = () => {
            setLiveMonth(readOverviewMonth(window.location.search) ?? monthKeyFromDay(today));
        };
        sync();
        window.addEventListener('popstate', sync);
        window.addEventListener(OVERVIEW_MONTH_EVENT, sync);
        return () => {
            window.removeEventListener('popstate', sync);
            window.removeEventListener(OVERVIEW_MONTH_EVENT, sync);
        };
    }, [override, today]);
    return override ?? liveMonth;
}

export function ContentPlanSection({
    clientId,
    organizationId,
    today,
    month: monthProp,
    rows: rowsProp,
}: {
    clientId?: string;
    organizationId?: string;
    today: string;
    /** Set in tests. When present, the section does not read the work-month URL. */
    month?: string;
    /** Set in tests. When present, the section does not read stored rows. */
    rows?: readonly ContentPlanRow[];
}) {
    const month = useWorkMonth(today, monthProp);
    const monthRef = useRef(month);
    monthRef.current = month;
    const controlled = rowsProp !== undefined;
    const [loaded, setLoaded] = useState<ContentPlanRow[]>([]);
    const [loadState, setLoadState] = useState<'loading' | 'ready' | 'unavailable'>(
        controlled || !clientId ? 'ready' : 'loading',
    );

    useEffect(() => {
        if (controlled || !clientId || !month) return;
        let active = true;
        setLoadState('loading');
        listCampaignContentPlan(clientId, month).then(result => {
            if (!active) return;
            setLoaded(result.rows);
            setLoadState(result.unavailable ? 'unavailable' : 'ready');
        }).catch(() => {
            if (!active) return;
            setLoaded([]);
            setLoadState('unavailable');
        });
        return () => {
            active = false;
        };
    }, [controlled, clientId, month]);

    if (!month) {
        return (
            <section
                data-region="content-plan"
                data-content-plan-state="waiting"
                data-indexed="false"
                data-performing="false"
                data-verified="false"
                aria-busy="true"
                className="rounded-xl border border-[#e4e4e7] bg-white p-4"
            >
                <h2 className="text-[15px] font-semibold">Content Plan</h2>
                <p data-content-honesty="published" className="mt-2 text-[12px] leading-5 text-[#52525b]">{CONTENT_PLAN_HONESTY}</p>
                <p className="mt-3 text-[13px] text-[#71717a]">Content plan follows the work month.</p>
            </section>
        );
    }

    const workMonth = month;
    const mode = controlled ? 'ready' : loadState;
    const source = controlled ? rowsProp ?? [] : loaded;
    const writable = Boolean(clientId) && mode === 'ready';

    async function create(draft: ContentPlanDraft) {
        if (!clientId) throw new Error('This client is not available.');
        const saved = await createCampaignContentPlanRow({
            clientId,
            assertedOrganizationId: organizationId,
            planMonth: workMonth,
            draft,
        });
        setLoaded(current => monthRef.current === workMonth
            ? contentPlanForMonth([...current.filter(row => row.id !== saved.id), saved], workMonth)
            : current);
    }

    async function update(id: string, draft: ContentPlanDraft) {
        if (!clientId) throw new Error('This client is not available.');
        const saved = await updateCampaignContentPlanRow({
            clientId,
            assertedOrganizationId: organizationId,
            id,
            draft,
        });
        setLoaded(current => monthRef.current === workMonth
            ? contentPlanForMonth(current.map(row => row.id === saved.id ? saved : row), workMonth)
            : current);
        return saved;
    }

    async function remove(id: string) {
        if (!clientId) throw new Error('This client is not available.');
        await deleteCampaignContentPlanRow({ clientId, id });
        setLoaded(current => monthRef.current === workMonth ? current.filter(row => row.id !== id) : current);
    }

    return (
        <ContentPlanTable
            key={workMonth}
            month={workMonth}
            rows={source}
            mode={mode === 'loading' ? 'loading' : mode === 'unavailable' ? 'unavailable' : 'ready'}
            onCreate={writable ? create : undefined}
            onUpdate={writable ? update : undefined}
            onDelete={writable ? remove : undefined}
        />
    );
}
