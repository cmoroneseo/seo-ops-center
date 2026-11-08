'use client';

import { useState, type FormEvent } from 'react';
import {
    CATEGORY_LABEL,
    CONTENT_LABEL,
    CONTENT_STATES,
    INITIATIVE_CATEGORIES,
    INITIATIVE_PHASES,
    INITIATIVE_TARGET_MONTHS,
    PHASE_LABEL,
    UNSET_MARK,
    formatInitiativeDay,
    measurementStrip,
    roadmapPhaseGroups,
    safeHttpUrl,
    statePresentation,
    timelineModel,
    type CampaignInitiative,
    type ContentState,
    type InitiativeCategory,
    type InitiativeDraft,
    type InitiativeState,
    type InitiativeTargetMonth,
    type TimelineRow,
} from '@/lib/campaign-workspace/initiatives';
import { saveCampaignInitiative } from '@/lib/supabase/campaign-initiatives';
import { cn } from '@/lib/utils';
import { InitiativeMark, initiativeBarClass, initiativeToneClass } from './initiative-status';

const STATE_OPTIONS: { value: InitiativeState; label: string }[] = [
    { value: 'planned', label: 'Planned' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'awaiting_approval', label: 'Awaiting Approval' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'on_hold', label: 'On Hold' },
    { value: 'completed_verified', label: 'Completed & Verified' },
];

interface ItemForm {
    key: string;
    id: string | null;
    title: string;
    contentState: ContentState;
    draftUrl: string;
    liveUrl: string;
    publishedOn: string;
}

interface FormState {
    id: string | null;
    title: string;
    purpose: string;
    ownerName: string;
    phase: string;
    category: string;
    targetMonth: string;
    priority: '1' | '2' | '3' | '4';
    state: InitiativeState;
    startsOn: string;
    endsOn: string;
    pageUrl: string;
    successMetricLabel: string;
    evidenceUrl: string;
    verifiedOn: string;
    items: ItemForm[];
}

function formKey(): string {
    return globalThis.crypto?.randomUUID?.() ?? `new-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function blankForm(): FormState {
    return {
        id: null,
        title: '',
        purpose: '',
        ownerName: '',
        phase: '',
        category: '',
        targetMonth: '',
        priority: '2',
        state: 'planned',
        startsOn: '',
        endsOn: '',
        pageUrl: '',
        successMetricLabel: '',
        evidenceUrl: '',
        verifiedOn: '',
        items: [],
    };
}

function formFromInitiative(initiative: CampaignInitiative): FormState {
    return {
        id: initiative.id,
        title: initiative.title,
        purpose: initiative.purpose ?? '',
        ownerName: initiative.ownerName ?? '',
        phase: initiative.phase ?? '',
        category: initiative.category ?? '',
        targetMonth: initiative.targetMonth == null ? '' : String(initiative.targetMonth),
        priority: String(initiative.priority) as FormState['priority'],
        state: initiative.state,
        startsOn: initiative.startsOn ?? '',
        endsOn: initiative.endsOn ?? '',
        pageUrl: initiative.pageUrl ?? '',
        successMetricLabel: initiative.successMetricLabel ?? '',
        evidenceUrl: initiative.evidenceUrl ?? '',
        verifiedOn: initiative.verifiedOn ?? '',
        items: [...initiative.items]
            .sort((a, b) => a.position - b.position)
            .map(item => ({
                key: item.id,
                id: item.id,
                title: item.title,
                contentState: item.contentState,
                draftUrl: item.draftUrl ?? '',
                liveUrl: item.liveUrl ?? '',
                publishedOn: item.publishedOn ?? '',
            })),
    };
}

function toDraft(form: FormState): InitiativeDraft {
    return {
        title: form.title,
        purpose: form.purpose,
        ownerName: form.ownerName,
        phase: form.phase,
        category: form.category,
        targetMonth: form.targetMonth,
        priority: form.priority,
        state: form.state,
        startsOn: form.startsOn,
        endsOn: form.endsOn,
        pageUrl: form.pageUrl,
        successMetricLabel: form.successMetricLabel,
        evidenceUrl: form.evidenceUrl,
        verifiedOn: form.verifiedOn,
        items: form.items.map(item => ({
            id: item.id,
            title: item.title,
            contentState: item.contentState,
            draftUrl: item.draftUrl,
            liveUrl: item.liveUrl,
            publishedOn: item.publishedOn,
        })),
    };
}

const fieldClass = 'h-11 w-full rounded-md border border-[#e4e4e7] bg-white px-2.5 text-[13px] text-[#18181b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#18181b]';
const labelClass = 'mb-1 block text-[12px] font-medium text-[#52525b]';

export function RoadmapPanel({
    initiatives,
    today,
    message,
    clientId,
    organizationId,
    selectedId,
    onSelect,
    onSaved,
}: {
    initiatives: readonly CampaignInitiative[];
    today: string;
    message: string | null;
    clientId?: string;
    organizationId?: string;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onSaved: (id: string) => void;
}) {
    const [form, setForm] = useState<FormState | null>(null);
    const model = timelineModel(initiatives, today);
    const groups = roadmapPhaseGroups(model.rows);
    const selected = initiatives.find(item => item.id === selectedId) ?? initiatives[0] ?? null;

    return (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                    <div role="radiogroup" aria-label="Roadmap layout" className="inline-flex rounded-lg bg-[#ececef] p-1">
                        <button
                            type="button"
                            role="radio"
                            aria-checked="false"
                            disabled
                            title="Board is not available yet"
                            className="min-h-11 cursor-not-allowed rounded-md px-3 text-[13px] text-[#a1a1aa]"
                        >
                            Board
                        </button>
                        <button
                            type="button"
                            role="radio"
                            aria-checked="true"
                            className="min-h-11 rounded-md bg-white px-3 text-[13px] font-medium text-primary shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#18181b]"
                        >
                            Timeline
                        </button>
                    </div>
                    <p className="text-[12px] text-[#71717a]">Board is not available yet.</p>
                    <button
                        type="button"
                        data-action="add-initiative"
                        onClick={() => setForm(blankForm())}
                        className="min-h-11 rounded-md border border-[#e4e4e7] bg-white px-3 text-[13px] font-medium text-[#18181b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#18181b]"
                    >
                        Add initiative
                    </button>
                </div>

                <div className="overflow-x-auto rounded-xl border border-[#e4e4e7] bg-white" data-region="timeline">
                    {message ? (
                        <p className="px-4 py-16 text-center text-[13px] leading-5 text-[#52525b]">{message}</p>
                    ) : model.rows.length === 0 ? (
                        <div>
                            <div className="border-b border-[#e4e4e7] px-4 py-3 text-[12px] font-medium text-[#71717a]">
                                Initiative / why it matters
                            </div>
                            <p className="px-4 py-16 text-center text-[13px] leading-5 text-[#52525b]">
                                No initiatives yet. Dates are not set, so there is no bar.
                            </p>
                        </div>
                    ) : (
                        <table className="w-full min-w-[760px] border-collapse text-left">
                            <caption className="sr-only">Initiative timeline. A row without dates has no bar. Category and target month do not move the schedule.</caption>
                            <thead>
                                <tr className="border-b border-[#e4e4e7] text-[12px] font-medium text-[#71717a]">
                                    <th scope="col" className="px-4 py-3 font-medium">Initiative / why it matters</th>
                                    <th scope="col" className="px-3 py-3 font-medium">Category</th>
                                    <th scope="col" className="w-14 px-2 py-3 font-medium">Target</th>
                                    <th scope="col" className="w-12 px-2 py-3 font-medium">Priority</th>
                                    <th scope="col" className="min-w-[28rem] px-4 py-3 font-medium">
                                        <ScheduleHeader model={model} />
                                    </th>
                                </tr>
                            </thead>
                            {groups ? groups.map(group => (
                                <tbody key={group.phase ?? 'unset'} data-phase-group={group.phase ?? 'unset'}>
                                    <tr>
                                        <th colSpan={5} scope="rowgroup" className="bg-[#f4f4f6] px-4 py-2 text-left text-[12px] font-semibold text-[#18181b]">
                                            {group.label}
                                        </th>
                                    </tr>
                                    {group.rows.map(row => (
                                        <InitiativeTimelineRow
                                            key={row.id}
                                            row={row}
                                            active={selected?.id === row.id}
                                            todayFraction={model.todayFraction}
                                            onSelect={onSelect}
                                        />
                                    ))}
                                </tbody>
                            )) : (
                                <tbody>
                                    {model.rows.map(row => (
                                        <InitiativeTimelineRow
                                            key={row.id}
                                            row={row}
                                            active={selected?.id === row.id}
                                            todayFraction={model.todayFraction}
                                            onSelect={onSelect}
                                        />
                                    ))}
                                </tbody>
                            )}
                        </table>
                    )}
                </div>
            </div>

            {form ? (
                <InitiativeForm
                    form={form}
                    setForm={setForm}
                    clientId={clientId}
                    organizationId={organizationId}
                    onClose={() => setForm(null)}
                    onSaved={(id) => {
                        setForm(null);
                        onSaved(id);
                    }}
                />
            ) : (
                <Detail initiative={message ? null : selected} message={message} today={today} onEdit={(initiative) => {
                    onSelect(initiative.id);
                    setForm(formFromInitiative(initiative));
                }} />
            )}
        </div>
    );
}

function InitiativeTimelineRow({
    row,
    active,
    todayFraction,
    onSelect,
}: {
    row: TimelineRow;
    active: boolean;
    todayFraction: number | null;
    onSelect: (id: string) => void;
}) {
    return (
        <tr
            data-initiative={row.id}
            data-phase={row.phase ?? ''}
            data-category={row.category ?? ''}
            data-target-month={row.targetMonth ?? ''}
            data-dates={row.bar ? 'set' : 'unset'}
            data-tone={row.tone}
            aria-selected={active}
            className={cn('border-b border-[#e4e4e7] last:border-b-0', active ? 'bg-[#fdf2f8]' : 'bg-white')}
        >
            <td className="px-4 py-3 align-top">
                <button
                    type="button"
                    onClick={() => onSelect(row.id)}
                    className="min-h-[59px] w-full rounded-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#18181b]"
                >
                    <span className="block text-[13px] font-medium leading-5 text-[#18181b]">{row.title}</span>
                    {row.purpose ? <span className="mt-0.5 block text-[13px] leading-5 text-[#52525b]">{row.purpose}</span> : null}
                    <span className={cn('mt-1 inline-flex items-center gap-2 text-[12px] font-medium leading-4', initiativeToneClass(row.tone))}>
                        <InitiativeMark tone={row.tone} />
                        {row.stateLabel}
                    </span>
                </button>
            </td>
            <td className="px-3 py-3 align-middle">
                <CategoryTag category={row.category} />
            </td>
            <td className="w-14 px-2 py-3 text-center align-middle">
                <TargetMark month={row.targetMonth} />
            </td>
            <td className="px-2 py-3 align-middle text-[12px] text-[#71717a]">{row.priorityLabel}</td>
            <td className="relative px-4 py-3 align-middle">
                {todayFraction != null ? (
                    <span
                        data-today="true"
                        className="pointer-events-none absolute inset-y-0 border-l border-dashed border-[#a1a1aa]"
                        style={{ left: `calc(1rem + (100% - 2rem) * ${todayFraction})` }}
                    />
                ) : null}
                <p className="text-[12px] leading-5 text-[#71717a]">{row.datesLabel}</p>
                {row.bar ? (
                    <span
                        data-bar={row.bar.kind}
                        className={cn('mt-2 block h-2 rounded-full', initiativeBarClass(row.tone))}
                        style={row.bar.kind === 'point'
                            ? { width: '10px', marginLeft: `calc(${row.bar.start * 100}% - 5px)` }
                            : { width: `max(8px, ${(row.bar.end - row.bar.start) * 100}%)`, marginLeft: `${row.bar.start * 100}%` }}
                    />
                ) : null}
            </td>
        </tr>
    );
}

function CategoryTag({ category }: { category: InitiativeCategory | null }) {
    if (!category) return <UnsetMark />;
    return (
        <span className="inline-block max-w-[9.5rem] truncate whitespace-nowrap rounded bg-[#f4f4f6] px-1.5 py-0.5 text-[12px] leading-4 text-[#3f3f46]">
            {CATEGORY_LABEL[category]}
        </span>
    );
}

function TargetMark({ month }: { month: InitiativeTargetMonth | null }) {
    if (!month) return <UnsetMark />;
    return (
        <span title={`Month ${month} of engagement (planned)`} className="text-[12px] font-medium tabular-nums text-[#18181b]">
            M{month}
        </span>
    );
}

function UnsetMark() {
    return <span data-empty="true" className="text-[13px] leading-5 text-[#a1a1aa]">{UNSET_MARK}</span>;
}

function ScheduleHeader({ model }: { model: ReturnType<typeof timelineModel> }) {
    if (model.months.length === 0) return <span>Schedule</span>;
    return (
        <span className="relative block pt-4">
            {model.todayLabel && model.todayFraction != null ? (
                <span
                    className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-[#52525b]"
                    style={{ left: `${model.todayFraction * 100}%` }}
                >
                    {model.todayLabel}
                </span>
            ) : null}
            <span className="grid" style={{ gridTemplateColumns: `repeat(${model.months.length}, minmax(0, 1fr))` }}>
                {model.months.map(month => (
                    <span key={month.key}>{month.label}</span>
                ))}
            </span>
        </span>
    );
}

function Detail({
    initiative,
    message,
    today,
    onEdit,
}: {
    initiative: CampaignInitiative | null;
    message: string | null;
    today: string;
    onEdit: (initiative: CampaignInitiative) => void;
}) {
    if (!initiative) {
        return (
            <section className="rounded-xl border border-[#e4e4e7] bg-white p-4">
                <h2 className="text-[15px] font-semibold leading-5">Initiative detail</h2>
                <p className="mt-3 text-[13px] text-[#52525b]">{message ?? 'No initiative selected.'}</p>
                <dl className="mt-2">
                    <Row label="Purpose" value="Not set yet" />
                    <Row label="Phase" value={UNSET_MARK} quiet />
                    <Row label="Category" value={UNSET_MARK} quiet />
                    <Row label="Target month" value={UNSET_MARK} quiet />
                    <Row label="Delivery checklist" value="No deliverables yet" />
                    <Row label="Measurement" value="Not yet measurable" />
                </dl>
                <p className="mt-3 text-[12px] leading-5 text-[#71717a]">
                    Published work is delivery, not a measured result.
                </p>
            </section>
        );
    }
    const presentation = statePresentation(initiative, today);
    const strip = measurementStrip(initiative);
    const pageUrl = safeHttpUrl(initiative.pageUrl);
    const evidenceUrl = safeHttpUrl(initiative.evidenceUrl);
    return (
        <section className="rounded-xl border border-[#e4e4e7] bg-white p-4" data-region="initiative-detail">
            <div className="flex items-start justify-between gap-3">
                <h2 className="min-w-0 text-[15px] font-semibold leading-5">{initiative.title}</h2>
                <button
                    type="button"
                    data-action="edit-initiative"
                    onClick={() => onEdit(initiative)}
                    className="min-h-11 shrink-0 rounded-md px-2 text-[13px] font-medium text-[#18181b] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#18181b]"
                >
                    Edit
                </button>
            </div>
            <p data-tone={presentation.tone} className={cn('mt-2 text-[12px] font-medium', initiativeToneClass(presentation.tone))}>
                {presentation.label}
            </p>
            <h3 className="mt-4 text-[10px] font-medium uppercase tracking-wide text-[#71717a]">Purpose</h3>
            <p className="mt-1 text-[13px] leading-5 text-[#18181b]">{initiative.purpose ?? 'Not set yet'}</p>
            <dl className="mt-3">
                <Row label="Phase" value={initiative.phase ? PHASE_LABEL[initiative.phase] : UNSET_MARK} quiet={!initiative.phase} />
                <Row label="Category" value={initiative.category ? CATEGORY_LABEL[initiative.category] : UNSET_MARK} quiet={!initiative.category} />
                <Row label="Target month" value={initiative.targetMonth ? `Month ${initiative.targetMonth}` : UNSET_MARK} quiet={!initiative.targetMonth} />
                <Row label="Owner" value={initiative.ownerName ?? 'Not set yet'} />
                <Row label="Priority" value={`P${initiative.priority}`} />
                <Row label="Page" value={pageUrl ?? 'Not set yet'} />
            </dl>
            {pageUrl ? (
                <a href={pageUrl} target="_blank" rel="noreferrer noopener" className="mt-1 block truncate text-[12px] text-[#52525b] underline-offset-2 hover:underline">
                    {pageUrl}
                </a>
            ) : null}
            <h3 className="mt-4 text-[10px] font-medium uppercase tracking-wide text-[#71717a]">Delivery checklist</h3>
            {initiative.items.length === 0 ? (
                <p className="mt-1 text-[13px] text-[#52525b]">No deliverables yet</p>
            ) : (
                <ul className="mt-2 space-y-2">
                    {initiative.items.map(item => {
                        const live = safeHttpUrl(item.liveUrl);
                        const draft = safeHttpUrl(item.draftUrl);
                        return (
                            <li key={item.id} className="text-[13px] leading-5">
                                <p className="text-[#18181b]">{CONTENT_LABEL[item.contentState]} · {item.title}</p>
                                {item.publishedOn ? <p className="text-[12px] text-[#71717a]">Published {formatInitiativeDay(item.publishedOn)}</p> : null}
                                {live ? <a href={live} target="_blank" rel="noreferrer noopener" className="block truncate text-[12px] text-[#52525b] underline-offset-2 hover:underline">{live}</a> : null}
                                {!live && draft ? <a href={draft} target="_blank" rel="noreferrer noopener" className="block truncate text-[12px] text-[#52525b] underline-offset-2 hover:underline">{draft}</a> : null}
                            </li>
                        );
                    })}
                </ul>
            )}
            {presentation.tone === 'fresh' || presentation.tone === 'stale' ? (
                <div className="mt-4">
                    <h3 className="text-[10px] font-medium uppercase tracking-wide text-[#71717a]">Evidence</h3>
                    {evidenceUrl ? (
                        <a href={evidenceUrl} target="_blank" rel="noreferrer noopener" className="mt-1 block truncate text-[12px] text-[#52525b] underline-offset-2 hover:underline">{evidenceUrl}</a>
                    ) : null}
                    {initiative.verifiedOn ? <p className="mt-1 text-[12px] text-[#71717a]">Verified {formatInitiativeDay(initiative.verifiedOn)}</p> : null}
                </div>
            ) : null}
            <div data-region="measurement" data-measurement="not-yet" className="mt-4 border-t border-[#e4e4e7] pt-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[#71717a]">Measurement / {strip.status}</p>
                {strip.label ? <p className="mt-1 text-[13px] text-[#52525b]">{strip.label}</p> : null}
                <p className="mt-2 text-[12px] leading-5 text-[#71717a]">
                    Published work is delivery, not a measured result.
                </p>
            </div>
        </section>
    );
}

function Row({ label, value, quiet }: { label: string; value: string; quiet?: boolean }) {
    return (
        <div className="flex items-baseline justify-between gap-4 border-b border-[#e4e4e7] py-2.5 last:border-b-0">
            <dt className="text-[13px] text-[#52525b]">{label}</dt>
            <dd className={cn('max-w-[13rem] truncate text-right text-[13px]', quiet ? 'text-[#a1a1aa]' : 'text-[#18181b]')}>{value}</dd>
        </div>
    );
}

function InitiativeForm({
    form,
    setForm,
    clientId,
    organizationId,
    onClose,
    onSaved,
}: {
    form: FormState;
    setForm: (form: FormState) => void;
    clientId?: string;
    organizationId?: string;
    onClose: () => void;
    onSaved: (id: string) => void;
}) {
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const formId = form.id ?? 'new';

    function patch(partial: Partial<FormState>) {
        setForm({ ...form, ...partial });
    }

    async function onSubmit(event: FormEvent) {
        event.preventDefault();
        if (saving) return;
        if (!clientId) {
            setError('This client is not available.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const saved = await saveCampaignInitiative({
                clientId,
                assertedOrganizationId: organizationId ?? null,
                initiativeId: form.id,
                draft: toDraft(form),
            });
            onSaved(saved.id);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not save this initiative.');
            setSaving(false);
        }
    }

    return (
        <form onSubmit={onSubmit} autoComplete="off" className="rounded-xl border border-[#e4e4e7] bg-white p-4" data-region="initiative-form">
            <h2 className="text-[15px] font-semibold leading-5">{form.id ? 'Edit initiative' : 'Add initiative'}</h2>
            <div className="mt-3 space-y-3">
                <label className="block">
                    <span className={labelClass}>Title</span>
                    <input id={`${formId}-title`} value={form.title} onChange={event => patch({ title: event.target.value })} className={fieldClass} maxLength={160} required />
                </label>
                <label className="block">
                    <span className={labelClass}>Purpose</span>
                    <textarea value={form.purpose} onChange={event => patch({ purpose: event.target.value })} className={cn(fieldClass, 'h-20 py-2')} maxLength={600} />
                </label>
                <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                        <span className={labelClass}>Owner</span>
                        <input value={form.ownerName} onChange={event => patch({ ownerName: event.target.value })} className={fieldClass} maxLength={120} />
                    </label>
                    <label className="block">
                        <span className={labelClass}>Priority</span>
                        <select value={form.priority} onChange={event => patch({ priority: event.target.value as FormState['priority'] })} className={fieldClass}>
                            <option value="1">P1</option>
                            <option value="2">P2</option>
                            <option value="3">P3</option>
                            <option value="4">P4</option>
                        </select>
                    </label>
                    <label className="block">
                        <span className={labelClass}>Phase</span>
                        <select value={form.phase} onChange={event => patch({ phase: event.target.value })} className={fieldClass}>
                            <option value="">{UNSET_MARK}</option>
                            {INITIATIVE_PHASES.map(phase => <option key={phase} value={phase}>{PHASE_LABEL[phase]}</option>)}
                        </select>
                    </label>
                    <label className="block">
                        <span className={labelClass}>Category</span>
                        <select value={form.category} onChange={event => patch({ category: event.target.value })} className={fieldClass}>
                            <option value="">{UNSET_MARK}</option>
                            {INITIATIVE_CATEGORIES.map(category => <option key={category} value={category}>{CATEGORY_LABEL[category]}</option>)}
                        </select>
                    </label>
                    <label className="col-span-2 block">
                        <span className={labelClass}>Target month</span>
                        <select value={form.targetMonth} onChange={event => patch({ targetMonth: event.target.value })} className={fieldClass}>
                            <option value="">{UNSET_MARK}</option>
                            {INITIATIVE_TARGET_MONTHS.map(month => <option key={month} value={String(month)}>{`Month ${month}`}</option>)}
                        </select>
                        <span className="mt-1 block text-[12px] leading-4 text-[#71717a]">Planned engagement month. Doesn't set dates — schedule uses Starts/Ends.</span>
                    </label>
                </div>
                <label className="block">
                    <span className={labelClass}>State</span>
                    <select value={form.state} onChange={event => patch({ state: event.target.value as InitiativeState })} className={fieldClass}>
                        {STATE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                        <span className={labelClass}>Start date</span>
                        <input type="date" value={form.startsOn} onChange={event => patch({ startsOn: event.target.value })} className={fieldClass} />
                    </label>
                    <label className="block">
                        <span className={labelClass}>End date</span>
                        <input type="date" value={form.endsOn} onChange={event => patch({ endsOn: event.target.value })} className={fieldClass} />
                    </label>
                </div>
                <label className="block">
                    <span className={labelClass}>Page URL</span>
                    <input type="url" value={form.pageUrl} onChange={event => patch({ pageUrl: event.target.value })} className={fieldClass} placeholder="https://" />
                </label>
                <label className="block">
                    <span className={labelClass}>Success metric label</span>
                    <input value={form.successMetricLabel} onChange={event => patch({ successMetricLabel: event.target.value })} className={fieldClass} maxLength={160} />
                    <span className="mt-1 block text-[12px] leading-4 text-[#71717a]">A label only. This does not record a result.</span>
                </label>
                <label className="block">
                    <span className={labelClass}>Evidence URL</span>
                    <input type="url" value={form.evidenceUrl} onChange={event => patch({ evidenceUrl: event.target.value })} className={fieldClass} placeholder="https://" />
                </label>
                <label className="block">
                    <span className={labelClass}>Verification date</span>
                    <input type="date" value={form.verifiedOn} onChange={event => patch({ verifiedOn: event.target.value })} className={fieldClass} />
                    <span className="mt-1 block text-[12px] leading-4 text-[#71717a]">Completed &amp; Verified needs an evidence URL and this date.</span>
                </label>
            </div>

            <h3 className="mt-4 text-[13px] font-semibold">Delivery checklist</h3>
            <div className="mt-2 space-y-3">
                {form.items.map((item, index) => (
                    <fieldset key={item.key} className="space-y-2 rounded-lg border border-[#e4e4e7] p-2">
                        <legend className="px-1 text-[12px] text-[#71717a]">Item {index + 1}</legend>
                        <input value={item.title} onChange={event => updateItem(form, setForm, item.key, { title: event.target.value })} className={fieldClass} placeholder="Title" maxLength={160} aria-label="Checklist title" />
                        <select value={item.contentState} onChange={event => updateItem(form, setForm, item.key, { contentState: event.target.value as ContentState })} className={fieldClass} aria-label="Checklist state">
                            {CONTENT_STATES.map(state => <option key={state} value={state}>{CONTENT_LABEL[state]}</option>)}
                        </select>
                        <input type="url" value={item.draftUrl} onChange={event => updateItem(form, setForm, item.key, { draftUrl: event.target.value })} className={fieldClass} placeholder="Draft URL" aria-label="Draft URL" />
                        <input type="url" value={item.liveUrl} onChange={event => updateItem(form, setForm, item.key, { liveUrl: event.target.value })} className={fieldClass} placeholder="Live URL" aria-label="Live URL" />
                        <input type="date" value={item.publishedOn} onChange={event => updateItem(form, setForm, item.key, { publishedOn: event.target.value })} className={fieldClass} aria-label="Publish date" />
                        <button
                            type="button"
                            onClick={() => setForm({ ...form, items: form.items.filter(candidate => candidate.key !== item.key) })}
                            className="min-h-11 text-[13px] text-[#52525b] underline-offset-2 hover:underline"
                        >
                            Remove item
                        </button>
                    </fieldset>
                ))}
                <button
                    type="button"
                    onClick={() => setForm({
                        ...form,
                        items: [...form.items, { key: formKey(), id: null, title: '', contentState: 'draft', draftUrl: '', liveUrl: '', publishedOn: '' }],
                    })}
                    className="min-h-11 text-[13px] font-medium text-[#18181b] underline-offset-2 hover:underline"
                >
                    Add checklist item
                </button>
            </div>

            {error ? <p role="alert" className="mt-3 text-[13px] leading-5 text-[#9f1239]">{error}</p> : null}
            <div className="mt-4 flex gap-2">
                <button type="submit" disabled={saving} className="min-h-11 rounded-md bg-[#18181b] px-3 text-[13px] font-medium text-white disabled:opacity-60">
                    {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={onClose} className="min-h-11 rounded-md px-3 text-[13px] font-medium text-[#18181b]">
                    Cancel
                </button>
            </div>
            <p className="mt-3 text-[12px] leading-5 text-[#71717a]">Dates stay unset until you enter them. A checklist item is delivery, not a measured result.</p>
        </form>
    );
}

function updateItem(form: FormState, setForm: (form: FormState) => void, key: string, partial: Partial<ItemForm>) {
    setForm({
        ...form,
        items: form.items.map(item => item.key === key ? { ...item, ...partial } : item),
    });
}
