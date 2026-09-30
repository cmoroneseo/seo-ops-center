'use client';

import { FormEvent, useEffect, useState } from 'react';
import { monthLabel } from '@/lib/reports/sections';

interface ContactRow {
    id: string;
    email: string;
    display_name: string;
    user_id: string | null;
    revoked_at: string | null;
}

interface StaffPayload {
    contacts: ContactRow[];
    plan: { id: string; title: string } | null;
    planShare: { state: string; sharedAt: string; approvalRequestedAt: string } | null;
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
        const response = await fetch('/api/client-portal/staff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, ...payload }),
        });
        const body = await response.json().catch(() => null);
        setBusy(false);
        if (!response.ok) {
            setError(body?.error ?? 'Could not save');
            return null;
        }
        if (typeof body?.link === 'string') {
            setLink(body.link);
            setNotice(body.emailed
                ? 'Invite emailed. You can also copy the link.'
                : body.emailRequested
                    ? 'Email did not send. Copy the link instead.'
                    : 'Link ready to copy. It works once.');
        } else {
            setNotice('Saved.');
        }
        await reload();
        return body;
    }

    async function invite(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        await act({
            action: 'invite',
            displayName: form.get('displayName'),
            email: form.get('email'),
            nextPath: '/portal',
        });
        event.currentTarget.reset();
    }

    async function addWaiting(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const deliverableId = String(form.get('deliverableId') ?? '');
        await act({
            action: 'add_waiting',
            title: form.get('title'),
            detail: form.get('detail'),
            ...(deliverableId ? { deliverableId } : {}),
        });
        event.currentTarget.reset();
    }

    return (
        <div className="space-y-8">
            <div>
                <h3 className="text-lg font-semibold">Client portal</h3>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    Invite {clientName} contacts to follow progress, approve the SEO Plan, and open shared reports.
                    Internal notes, assignees, drafts, and timesheets stay in the workspace.
                </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
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
                    <button disabled={busy} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                        Send invite
                    </button>
                </form>
                <ul className="mt-4 divide-y divide-border text-sm">
                    {(data?.contacts ?? []).map(contact => (
                        <li key={contact.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                            <span>
                                {contact.display_name} · {contact.email}
                                <span className="ml-2 text-xs text-muted-foreground">
                                    {contact.revoked_at ? 'Revoked' : contact.user_id ? 'Signed in' : 'Invited'}
                                </span>
                            </span>
                            <span className="flex gap-2">
                                <button type="button" className="text-primary hover:underline" disabled={busy} onClick={() => act({ action: 'invite', displayName: contact.display_name, email: contact.email, nextPath: '/portal/plan', emailLink: false })}>
                                    Copy plan link
                                </button>
                                {!contact.revoked_at && (
                                    <button type="button" className="text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => act({ action: 'revoke', contactId: contact.id })}>
                                        Revoke
                                    </button>
                                )}
                            </span>
                        </li>
                    ))}
                    {data && data.contacts.length === 0 && <li className="py-2 text-muted-foreground">No contacts yet.</li>}
                </ul>
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
                <h4 className="font-semibold">SEO Plan</h4>
                {!data?.plan && <p className="mt-2 text-sm text-muted-foreground">Create the SEO Plan before sharing it.</p>}
                {data?.plan && (
                    <div className="mt-2 space-y-2 text-sm">
                        <p>{data.plan.title}</p>
                        <p className="text-muted-foreground">
                            {data.planShare ? `Shared · client status: ${data.planShare.state.replace(/_/g, ' ')}` : 'Not shared'}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {!data.planShare && (
                                <button type="button" disabled={busy} onClick={() => act({ action: 'share_plan' })} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">Share with client</button>
                            )}
                            {data.planShare && (
                                <>
                                    <button type="button" disabled={busy} onClick={() => act({ action: 'request_plan_again' })} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-50">Ask for approval again</button>
                                    <button type="button" disabled={busy} onClick={() => act({ action: 'unshare_plan' })} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-50">Stop sharing</button>
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
                                <span>{report.title} · {monthLabel(report.report_month)} · {report.status}</span>
                                {report.status === 'published' ? (
                                    <button
                                        type="button"
                                        disabled={busy}
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
                    <input name="title" required placeholder="What you need from them" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                    <textarea name="detail" rows={2} placeholder="Optional detail they can act on" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                    <select name="deliverableId" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                        <option value="">Not linked to a deliverable</option>
                        {(data?.deliverables ?? []).map(item => (
                            <option key={item.id} value={item.id}>{item.title} ({item.status})</option>
                        ))}
                    </select>
                    <button disabled={busy} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Add to their inbox</button>
                </form>
                <ul className="mt-4 divide-y divide-border text-sm">
                    {(data?.waiting ?? []).filter(item => !item.resolved_at).map(item => (
                        <li key={item.id} className="flex items-start justify-between gap-3 py-2">
                            <span>
                                <span className="font-medium">{item.title}</span>
                                {item.detail && <span className="mt-0.5 block text-muted-foreground">{item.detail}</span>}
                            </span>
                            <button type="button" disabled={busy} onClick={() => act({ action: 'resolve_waiting', waitingId: item.id })} className="text-primary hover:underline">Resolve</button>
                        </li>
                    ))}
                </ul>
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
                <h4 className="font-semibold">Client notes</h4>
                <ul className="mt-3 space-y-2 text-sm">
                    {(data?.feedback ?? []).map(entry => (
                        <li key={entry.id} className="rounded-lg bg-muted/40 px-3 py-2">
                            <p className="text-xs text-muted-foreground">{entry.author_label} · {entry.subject_type} · {new Date(entry.created_at).toLocaleString()}</p>
                            <p className="mt-1 whitespace-pre-wrap">{entry.body}</p>
                        </li>
                    ))}
                    {data && data.feedback.length === 0 && <li className="text-muted-foreground">No notes yet.</li>}
                </ul>
            </section>
        </div>
    );
}
