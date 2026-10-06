'use client';

import { FormEvent, useEffect, useState } from 'react';
import { monthLabel } from '@/lib/reports/sections';
import Link from 'next/link';
import { reportTitleMonthMismatch } from '@/lib/portal/readiness';
import { Eye, ExternalLink } from 'lucide-react';
import { PortalReadiness, PortalUpdateManager, PortalTimingManager, PortalConversationManager, type ManagementExtrasData } from './PortalManagementExtras';

interface ContactRow {
    id: string;
    email: string;
    display_name: string;
    user_id: string | null;
    revoked_at: string | null;
}

interface StaffPayload extends ManagementExtrasData {
    contacts: ContactRow[];
    plan: { id: string; title: string } | null;
    planShare: { state: string; sharedAt: string; approvalRequestedAt: string; version: number; needsPublish: boolean } | null;
    decisions: { id: string; decision: string; actor_label: string; note: string | null; decided_at: string }[];
    reports: { id: string; title: string; report_month: string; status: string }[];
    sharedReportIds: string[];
    waiting: { id: string; title: string; detail: string | null; resolved_at: string | null }[];
    feedback: { id: string; author_label: string; body: string; created_at: string; subject_type: string }[];
    deliverables: { id: string; title: string; status: string }[];
}

export function ClientPortalStaffPanel({ clientId, clientName }: { clientId: string; clientName: string }) {
    const [data, setData] = useState<StaffPayload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [link, setLink] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const disabled = busy || !data || data.role === 'viewer';

    async function reload() {
        const response = await fetch(`/api/client-portal/staff?clientId=${encodeURIComponent(clientId)}`);
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            setError(body?.error ?? 'Could not load the portal');
            return;
        }
        setData(body);
        setError(null);
    }

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/client-portal/staff?clientId=${encodeURIComponent(clientId)}`)
            .then(response => response.json().then(body => ({ ok: response.ok, body })))
            .then(result => {
                if (cancelled) return;
                if (!result.ok) setError(result.body?.error ?? 'Could not load the portal');
                else setData(result.body);
            })
            .catch(() => { if (!cancelled) setError('Could not load the portal'); });
        return () => { cancelled = true; };
    }, [clientId]);

    async function act(payload: Record<string, unknown>) {
        setBusy(true);
        setNotice(null);
        setError(null);
        try {
            const response = await fetch('/api/client-portal/staff', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, ...payload }),
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) throw new Error(body?.error ?? 'Could not save. Please try again.');
            if (typeof body?.link === 'string') {
                setLink(body.link);
                setNotice(body.emailed ? 'Invite emailed. You can also copy the link.' : body.emailRequested ? 'Email did not send. Copy the link instead.' : 'Link ready to copy. It works once.');
            } else { setNotice('Saved.'); }
            await reload();
            return body;
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not save. Please try again.');
            return null;
        } finally { setBusy(false); }
    }

    async function invite(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        const result = await act({
            action: 'invite',
            displayName: form.get('displayName'),
            email: form.get('email'),
            nextPath: '/portal',
        });
        if (result?.ok) formElement.reset();
    }

    async function addWaiting(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        const deliverableId = String(form.get('deliverableId') ?? '');
        const result = await act({
            action: 'add_waiting',
            title: form.get('title'),
            detail: form.get('detail'),
            dueDate: form.get('dueDate'),
            impact: form.get('impact'),
            ...(deliverableId ? { deliverableId } : {}),
        });
        if (result?.ok) formElement.reset();
    }

    return (
        <div className="space-y-8">
            <div>
                <div className="flex flex-wrap items-center gap-3"><h3 className="text-lg font-semibold">Portal management</h3><span className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">Staff only</span></div>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    Manage what {clientName} sees in their separate client portal. Invite contacts, share the SEO Plan and reports, and respond to their messages.
                    Internal notes, assignees, drafts, and timesheets stay in the workspace.
                </p>
                <Link href={`/portal-preview/${clientId}`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground hover:bg-muted"><Eye size={16} aria-hidden="true" />Preview as client<ExternalLink size={14} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></Link>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
            {!data && !error && <p role="status" className="text-sm text-muted-foreground">Loading portal management…</p>}
            {data && <PortalReadiness data={data} />}
            {link && (
                <label className="block text-sm">
                    Sign-in link (works once)
                    <input readOnly value={link} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs" onFocus={event => event.currentTarget.select()} />
                </label>
            )}

            <section className="rounded-xl border border-border bg-card p-5">
                <h4 className="font-semibold">Contacts</h4>
                <form onSubmit={invite} className="mt-3 flex flex-wrap items-end gap-2">
                    <label className="text-sm">
                        Name
                        <input name="displayName" required className="mt-1 block rounded-lg border border-border bg-background px-3 py-2" />
                    </label>
                    <label className="text-sm">
                        Email
                        <input name="email" type="email" required className="mt-1 block rounded-lg border border-border bg-background px-3 py-2" />
                    </label>
                    <button disabled={disabled} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                        Send invite
                    </button>
                </form>
                <ul className="mt-4 divide-y divide-border text-sm">
                    {(data?.contacts ?? []).map(contact => (
                        <li key={contact.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                            <span>
                                {contact.display_name} · {contact.email}
                                <span className="ml-2 text-xs text-muted-foreground">
                                    {contact.revoked_at ? 'Revoked' : data?.visits.some(visit => visit.contact_id === contact.id) ? `Visited ${new Date(data.visits.find(visit => visit.contact_id === contact.id)!.visited_at).toLocaleDateString()}` : contact.user_id ? 'Access activated · No visit yet' : 'Invited · No visit yet'}
                                </span>
                            </span>
                            <span className="flex gap-2">
                                <button type="button" className="text-primary hover:underline" disabled={disabled} onClick={() => act({ action: 'invite', displayName: contact.display_name, email: contact.email, nextPath: '/portal/plan', emailLink: false })}>
                                    Copy plan link
                                </button>
                                {!contact.revoked_at && (
                                    <button type="button" className="text-muted-foreground hover:text-destructive" disabled={disabled} onClick={() => act({ action: 'revoke', contactId: contact.id })}>
                                        Revoke
                                    </button>
                                )}
                            </span>
                        </li>
                    ))}
                    {data && data.contacts.length === 0 && <li className="py-2 text-muted-foreground">No contacts yet.</li>}
                </ul>
            </section>

            {data && <PortalUpdateManager data={data} act={act} disabled={disabled} />}

            <section className="rounded-xl border border-border bg-card p-5">
                <h4 className="font-semibold">SEO Plan</h4>
                {!data?.plan && <p className="mt-2 text-sm text-muted-foreground">Create the SEO Plan before sharing it.</p>}
                {data?.plan && (
                    <div className="mt-2 space-y-2 text-sm">
                        <p>{data.plan.title}</p>
                        <p className="text-muted-foreground">
                            {data.planShare ? `Published version ${data.planShare.version} · ${data.planShare.state.replace(/_/g, ' ')}` : 'Not shared'}
                        </p>
                        {data.planShare?.needsPublish && <p className="text-sm text-muted-foreground">The internal plan differs from the published version. Publish a new version when it is ready for the client.</p>}
                        <div className="flex flex-wrap gap-2">
                            {!data.planShare && (
                                <button type="button" disabled={disabled} onClick={() => act({ action: 'share_plan' })} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">Publish plan and notify client</button>
                            )}
                            {data.planShare && (
                                <>
                                    <button type="button" disabled={disabled} onClick={() => act({ action: 'request_plan_again' })} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-50">Publish new version and request approval</button>
                                    <button type="button" disabled={disabled} onClick={() => act({ action: 'unshare_plan' })} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-50">Stop sharing</button>
                                </>
                            )}
                        </div>
                        {data.decisions.length > 0 && (
                            <ul className="mt-3 space-y-1 text-muted-foreground">
                                {data.decisions.map(decision => (
                                    <li key={decision.id}>
                                        {decision.actor_label} {decision.decision === 'approved' ? 'approved' : 'requested changes'} on {new Date(decision.decided_at).toLocaleString()}
                                        {decision.note ? ` — ${decision.note}` : ''}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
                <h4 className="font-semibold">Reports</h4>
                <ul className="mt-3 divide-y divide-border text-sm">
                    {(data?.reports ?? []).map(report => {
                        const shared = data?.sharedReportIds.includes(report.id);
                        return (
                            <li key={report.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                                <span>{report.title} · {monthLabel(report.report_month)} · {report.status}{reportTitleMonthMismatch(report.title, report.report_month) && <span className="mt-1 block text-destructive">Title and reporting month disagree. Correct this in Reports before sharing. <Link href={`/reports/${report.id}`} className="underline">Open report</Link></span>}</span>
                                {report.status === 'published' ? (
                                    <button
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => act({ action: shared ? 'unshare_report' : 'share_report', reportId: report.id })}
                                        className="text-primary hover:underline disabled:opacity-50"
                                    >
                                        {shared ? 'Unshare' : 'Share'}
                                    </button>
                                ) : (
                                    <span className="text-xs text-muted-foreground">Publish before sharing</span>
                                )}
                            </li>
                        );
                    })}
                    {data && data.reports.length === 0 && <li className="py-2 text-muted-foreground">No reports for this client.</li>}
                </ul>
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
                <h4 className="font-semibold">Waiting on the client</h4>
                <p className="mt-1 text-xs text-muted-foreground">Write what the client should see. This does not copy internal deliverable notes.</p>
                <form onSubmit={addWaiting} className="mt-3 space-y-2">
                    <label className="block text-sm font-medium">What you need from the client<input name="title" required maxLength={140} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></label>
                    <label className="block text-sm font-medium">Details (optional)<textarea name="detail" maxLength={2000} rows={2} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></label>
                    <label className="block text-sm font-medium">Requested response date (optional)<input type="date" name="dueDate" className="mt-1 block rounded-lg border border-border bg-background px-3 py-2 text-sm" /></label>
                    <label className="block text-sm font-medium">What this unlocks (optional)<input name="impact" maxLength={500} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></label>
                    <label className="block text-sm font-medium">Related deliverable (optional)<select name="deliverableId" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                        <option value="">Not linked to a deliverable</option>
                        {(data?.deliverables ?? []).map(item => (
                            <option key={item.id} value={item.id}>{item.title} ({item.status})</option>
                        ))}
                    </select></label>
                    <button disabled={disabled} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Add to their inbox</button>
                </form>
                <ul className="mt-4 divide-y divide-border text-sm">
                    {(data?.waiting ?? []).filter(item => !item.resolved_at).map(item => (
                        <li key={item.id} className="flex items-start justify-between gap-3 py-2">
                            <span>
                                <span className="font-medium">{item.title}</span>
                                {item.detail && <span className="mt-0.5 block text-muted-foreground">{item.detail}</span>}
                            </span>
                            <button type="button" disabled={disabled} onClick={() => act({ action: 'resolve_waiting', waitingId: item.id })} className="text-primary hover:underline">Resolve</button>
                        </li>
                    ))}
                </ul>
            </section>

            {data && <PortalTimingManager data={data} act={act} disabled={disabled} />}
            {data && <PortalConversationManager data={data} act={act} disabled={disabled} />}

        </div>
    );
}
