'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { portalDate, portalToday } from '@/lib/portal/dashboard';
import type { PortalFeedbackEntry } from '@/lib/portal/progress';
import type { PortalUpdate } from '@/lib/portal/readiness';

export interface ManagementExtrasData {
    role: string;
    readiness: { key: string; label: string; complete: boolean }[];
    latestUpdate: PortalUpdate | null;
    analyticsShared: boolean;
    pendingEmails: number; failedEmails: number; emailAvailable: boolean;
    members: { id: string; name: string }[];
    visits: { contact_id: string; visited_at: string; visited_on: string }[];
    deliveryUpdates: { id: string; title: string; status: string; dueDate?: string; delivered_on?: string;
        timing_note?: string; revised_due_date?: string; responsibility?: string }[];
    threads: { subjectType: string; subjectId: string; title: string; entries: PortalFeedbackEntry[];
        ownerId: string | null; needsReply: boolean; latestClientAt: string | null; canReply: boolean }[];
}

type Act = (input: Record<string, unknown>) => Promise<{ ok?: boolean } | null>;
const inputClass = 'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
const buttonClass = 'min-h-10 rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground disabled:opacity-50';

function Field({ label, name, value, required = false, date = false, children }: {
    label: string; name: string; value?: string; required?: boolean; date?: boolean; children?: ReactNode;
}) {
    return <label className="block text-sm font-medium">{label}{children ?? (date ? <input name={name} defaultValue={value} type="date" required={required} className={inputClass} /> : <textarea name={name} defaultValue={value} maxLength={2000} required={required} rows={2} className={inputClass} />)}</label>;
}

async function submitForm(event: FormEvent<HTMLFormElement>, act: Act, action: string, extra?: Record<string, unknown>, reset = true) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await act({ action, ...Object.fromEntries(new FormData(form)), ...extra });
    if (result?.ok && reset) form.reset();
}

export function PortalReadiness({ data }: { data: ManagementExtrasData }) {
    const complete = data.readiness.every(item => item.complete);
    const activeDays = new Set(data.visits.map(visit => visit.visited_on)).size;
    return <section className="rounded-xl border border-border bg-card p-5">
        <h4 className="font-semibold">{complete ? 'Ready for client review' : 'Prepare the first client visit'}</h4>
        <p className="mt-2 text-sm text-muted-foreground">Make the first visit useful before sending an invite. A monthly report is optional during onboarding.</p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">{data.readiness.map(item => <li key={item.key} className="flex gap-2 text-sm"><span aria-hidden="true">{item.complete ? '✓' : '○'}</span><span>{item.label}<span className="sr-only">: {item.complete ? 'Complete' : 'Needs attention'}</span></span></li>)}</ul>
        <p className="mt-4 text-xs text-muted-foreground">Client visits: {activeDays} active {activeDays === 1 ? 'day' : 'days'} recorded · previews do not count.</p>
        {!data.emailAvailable && <p className="mt-3 text-sm text-destructive">Email delivery needs a verified sender and Resend configuration. Saved updates and replies remain available in the portal.</p>}
        {(data.pendingEmails > 0 || data.failedEmails > 0) && <p className="mt-3 text-sm text-muted-foreground">{data.pendingEmails} notification emails awaiting delivery · {data.failedEmails} failed after retries.</p>}
    </section>;
}

export function PortalUpdateManager({ data, act, disabled }: { data: ManagementExtrasData; act: Act; disabled: boolean }) {
    return <section className="rounded-xl border border-border bg-card p-5">
        <h4 className="font-semibold">Campaign update</h4>
        <p className="mt-2 text-sm text-muted-foreground">Publish a short update between reports. Invited contacts receive an email notification.</p>
        {data.latestUpdate && <p className="mt-3 text-sm text-muted-foreground">Last published {portalDate(data.latestUpdate.publishedAt)} by {data.latestUpdate.authorLabel} · Next update {portalDate(data.latestUpdate.nextUpdateOn)}{data.latestUpdate.nextUpdateOn < portalToday() && ' · Update due'}</p>}
        <form className="mt-4 space-y-3" onSubmit={event => submitForm(event, act, 'publish_update')}>
            <fieldset disabled={disabled} className="space-y-3">
                <Field name="shipped" label="What shipped or changed" required />
                <Field name="impact" label="Why it matters to the client" required />
                <Field name="nextSteps" label="What happens next" required />
                <Field name="blockers" label="Blockers or decisions needed (optional)" />
                <Field name="nextUpdateOn" label="Next update date" date required />
                <button className={buttonClass}>Publish client update</button>
            </fieldset>
        </form>
        <details className="mt-5 text-sm"><summary className="cursor-pointer font-medium">Search performance visibility</summary><p className="mt-2 text-muted-foreground">Share Google Search Console totals for completed months between reports. This setting does not publish reports or expose other analytics.</p><button disabled={disabled} type="button" className={`${buttonClass} mt-3`} onClick={() => act({ action: 'analytics', shared: !data.analyticsShared })}>{data.analyticsShared ? 'Stop sharing search totals' : 'Share search totals between reports'}</button><p className="mt-2 text-xs text-muted-foreground">Currently {data.analyticsShared ? 'shared' : 'limited to explicitly shared reports'}.</p></details>
    </section>;
}

export function PortalTimingManager({ data, act, disabled }: { data: ManagementExtrasData; act: Act; disabled: boolean }) {
    const rows = data.deliveryUpdates.filter(item => ['In Progress', 'Review', 'Approved'].includes(item.status) && !item.delivered_on);
    if (!rows.length) return null;
    return <section className="rounded-xl border border-border bg-card p-5"><h4 className="font-semibold">Delivery timing</h4><p className="mt-2 text-sm text-muted-foreground">Explain delays and confirm next steps using client-facing text. Original dates and internal notes stay intact.</p>
        <div className="mt-4 space-y-3">{rows.map(item => <details key={item.id} className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-medium">{item.title}<span className="mt-1 block text-xs text-muted-foreground">{item.status === 'Review' ? 'Internal review' : item.status} · Planned {portalDate(item.dueDate)}{(item.revised_due_date ?? item.dueDate ?? '9999') < portalToday() && ' · Past planned date'}</span></summary>
            <form className="mt-4" onSubmit={event => submitForm(event, act, 'delivery_timing', { deliverableId: item.id }, false)}><fieldset disabled={disabled} className="space-y-3">
                <Field name="note" label="Client-facing timing explanation" value={item.timing_note} required />
                <Field name="revisedDueDate" label="Revised due date (optional until confirmed)" value={item.revised_due_date} date />
                <label className="block text-sm font-medium">Who owns the next step?<select name="responsibility" defaultValue={item.responsibility ?? 'team'} className={inputClass}><option value="team">Account team</option><option value="client">Client team</option></select></label>
                <button className={buttonClass}>Save timing update</button>
            </fieldset></form>
        </details>)}</div>
    </section>;
}

export function PortalConversationManager({ data, act, disabled }: { data: ManagementExtrasData; act: Act; disabled: boolean }) {
    const [selected, setSelected] = useState('');
    const threads = [...data.threads].sort((a, b) => Number(b.needsReply) - Number(a.needsReply));
    const active = threads.find(thread => `${thread.subjectType}:${thread.subjectId}` === selected) ?? threads[0];
    if (!active) return null;
    const scope = { subjectType: active.subjectType, subjectId: active.subjectId };
    return <section className="rounded-xl border border-border bg-card p-5"><h4 className="font-semibold">Client conversations</h4><p className="mt-2 text-sm text-muted-foreground">{threads.filter(thread => thread.needsReply).length} conversations need a reply. Replies stay with the original question and notify invited contacts.</p>
        <label className="mt-4 block text-sm font-medium">Conversation<select className={inputClass} value={`${active.subjectType}:${active.subjectId}`} onChange={event => setSelected(event.target.value)}>{threads.map(thread => <option key={`${thread.subjectType}:${thread.subjectId}`} value={`${thread.subjectType}:${thread.subjectId}`}>{thread.title}{thread.needsReply ? ' · Needs reply' : ''}</option>)}</select></label>
        <div className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-40 flex-1 text-sm font-medium">Conversation owner<select className={inputClass} disabled={disabled || !active.canReply} value={active.ownerId ?? ''} onChange={event => act({ action: 'conversation', ...scope, ownerId: event.target.value })}><option value="">Unassigned</option>{data.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>{active.needsReply && active.latestClientAt && <button className={buttonClass} disabled={disabled || !active.canReply} type="button" onClick={() => act({ action: 'conversation', ...scope, handledThrough: active.latestClientAt })}>Mark displayed question handled</button>}</div>
        <ol className="mt-4 max-h-96 space-y-3 overflow-auto" aria-label="Conversation">{active.entries.map(entry => <li key={entry.id} className="rounded-lg bg-muted/40 p-3 text-sm"><p className="text-xs text-muted-foreground">{entry.authorLabel}{entry.authorType === 'team' ? ' · Your team' : ' · Client'} · {new Date(entry.createdAt).toLocaleString()}</p><p className="mt-2 whitespace-pre-wrap break-words">{entry.body}</p></li>)}</ol>
        {!active.entries.length && <p className="mt-4 text-sm text-muted-foreground">No messages yet.</p>}
        {active.canReply ? <form key={`${active.subjectType}:${active.subjectId}`} className="mt-4 space-y-3" onSubmit={event => submitForm(event, act, 'reply', scope)}><fieldset disabled={disabled} className="space-y-3"><Field name="body" label={`Reply in ${active.title}`} required /><button className={buttonClass}>Send reply and notify client</button></fieldset></form> : <p className="mt-4 text-sm text-muted-foreground">This request is closed or its plan is no longer shared. Start a general conversation to follow up.</p>}
    </section>;
}
