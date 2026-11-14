'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { applySuggestion, type GbpPostPayload } from '@/lib/gbp-approvals/registry';
import { weekday } from './sample';
import { ItemStatus } from './AgencyStatus';

interface Version {
    id: string;
    item_id: string;
    version_no: number;
    payload: GbpPostPayload;
    photo_path: string | null;
    change_note: string | null;
    created_at: string;
}
interface ClientResponse {
    id: string;
    item_id: string;
    comment: string | null;
    suggested_title: string | null;
    suggested_body: string | null;
    replacement_photo_path: string | null;
    created_at: string;
    decision: string;
}
interface ApprovalItem {
    id: string;
    position: number;
    status: 'pending' | 'approved' | 'changes_requested';
    decision_lock_reason: string | null;
    version: Version | null;
    response: ClientResponse | null;
}
interface ApprovalPayload {
    request: { id: string; title: string; round: number } | null;
    items?: ApprovalItem[];
    versions?: Version[];
    responses?: ClientResponse[];
    events?: Array<{ id: string; kind: string; created_at: string }>;
    photos?: Record<string, string | null>;
    link?: { expiresAt: string; revokedAt: string | null; viewCount: number } | null;
    role?: string;
}

export function TaskApprovalsPanel({ taskId, taskTitle }: { taskId: string; taskTitle: string }) {
    const [data, setData] = useState<ApprovalPayload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [url, setUrl] = useState('');
    const [notice, setNotice] = useState('');
    const [confirmRevoke, setConfirmRevoke] = useState(false);
    const load = useCallback(async () => {
        const response = await fetch(`/api/gbp-approvals/tasks/${taskId}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Approvals could not be loaded.');
        return response.json() as Promise<ApprovalPayload>;
    }, [taskId]);

    useEffect(() => {
        let cancelled = false;
        setData(null);
        setUrl('');
        setError(null);
        load().then(body => { if (!cancelled) setData(body); })
            .catch(() => { if (!cancelled) setError('Approvals could not be loaded.'); });
        return () => { cancelled = true; };
    }, [load]);

    async function act(path: string, body?: unknown) {
        if (!data?.request) return;
        setBusy(true);
        setError(null);
        setNotice('');
        try {
            const response = await fetch(`/api/gbp-approvals/requests/${data.request.id}/${path}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body ?? {}),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error ?? 'The change could not be saved.');
            if (result.url) setUrl(result.url);
            if (path === 'link/revoke') { setUrl(''); setConfirmRevoke(false); }
            setNotice('Saved. Share the review link yourself; nothing is sent automatically.');
            setData(await load());
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'The change could not be saved.');
        } finally { setBusy(false); }
    }

    const writer = ['owner', 'admin', 'member'].includes(data?.role ?? '');
    const link = data?.link;
    return (
        <section className="space-y-3 rounded-lg border border-border bg-card p-3 text-card-foreground" aria-label="Approvals" aria-busy={busy}>
            <h3 className="text-sm font-semibold">Approvals</h3>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {notice && <p role="status" className="text-sm">{notice}</p>}
            {!data && !error && <p className="text-sm text-muted-foreground">Loading approvals…</p>}
            {data && !data.request && <p className="text-sm text-muted-foreground">No approval request for {taskTitle} yet.</p>}
            {data?.request && <>
                <p className="text-sm font-medium">{data.request.title} · Round {data.request.round}</p>
                <p className="text-sm text-muted-foreground">{data.items?.filter(item => item.status === 'approved').length} approved · {data.items?.filter(item => item.status === 'changes_requested').length} changes requested · {data.items?.filter(item => item.status === 'pending').length} pending</p>
                <p className="text-sm text-muted-foreground">{!link ? 'No share link issued.' : `${link.revokedAt ? 'Link revoked' : Date.parse(link.expiresAt) <= Date.now() ? 'Link expired' : 'Link active'} · expires ${new Date(link.expiresAt).toLocaleDateString()} · ${link.viewCount} views`}</p>
                {writer && <div className="flex flex-wrap gap-2">
                    {(!link || link.revokedAt) && <Button type="button" variant="outline" disabled={busy} onClick={() => void act('link/issue')}>Issue share link</Button>}
                    {link && !link.revokedAt && <>
                        <Button type="button" variant="outline" disabled={busy} onClick={() => void act('link/extend')}>Extend 14 days</Button>
                        <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmRevoke(true)}>Revoke</Button>
                    </>}
                </div>}
                {confirmRevoke && <div className="space-y-2 rounded-md border border-border p-3">
                    <p className="text-sm">Revoke this link? The client will lose access.</p>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => void act('link/revoke')}>Confirm revoke</Button>{' '}
                    <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmRevoke(false)}>Cancel</Button>
                </div>}
                {url && <div className="space-y-2">
                    <label className="block text-sm">Review link (shown only this session)
                        <input readOnly value={url} className="mt-1 w-full rounded-md border border-input bg-background p-2 text-foreground" onFocus={event => event.target.select()} />
                    </label>
                    <Button type="button" variant="outline" onClick={() => { void navigator.clipboard.writeText(url).then(() => setNotice('Link copied.')).catch(() => setError('Select and copy the link above.')); }}>Copy link</Button>
                </div>}
                {writer && link && !url && <p className="text-xs text-muted-foreground">The original URL cannot be retrieved. Extend keeps the same link. To replace a lost link, revoke it and issue a new one.</p>}
                <ul className="divide-y divide-border">
                    {data.items?.map(item => <li key={item.id} className="space-y-2 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium">Post {item.position} · v{item.version?.version_no} · {item.version?.payload.title}</p>
                            <ItemStatus status={item.status} />
                        </div>
                        <p className="text-sm text-muted-foreground">Planned for {item.version ? weekday(item.version.payload.scheduledDate) : '—'}</p>
                        {item.decision_lock_reason && <p className="text-sm">Decision locked · {item.decision_lock_reason === 'marked_final' ? 'Marked final' : 'Agency revision'}</p>}
                        {item.response?.comment && <p className="whitespace-pre-wrap text-sm">Client note: {item.response.comment}</p>}
                        {item.response?.suggested_title && <p className="text-sm">Suggested title: {item.response.suggested_title}</p>}
                        {item.response?.suggested_body && <p className="whitespace-pre-wrap text-sm">Suggested text: {item.response.suggested_body}</p>}
                        {item.response?.replacement_photo_path && data.photos?.[item.response.replacement_photo_path] && <img src={data.photos[item.response.replacement_photo_path]!} alt={`Client replacement photo for post ${item.position}`} className="max-h-48 rounded-md object-contain" />}
                        {writer && item.version && <RevisionEditor key={item.version.id} item={item} busy={busy} onPost={entry => act('versions', { items: [entry] })} />}
                        {writer && item.status !== 'pending' && !item.decision_lock_reason && <Button type="button" variant="outline" disabled={busy} onClick={() => void act('final', { itemId: item.id })}>Mark final</Button>}
                    </li>)}
                </ul>
                <details className="text-sm">
                    <summary className="cursor-pointer font-medium">History · events and versions</summary>
                    <ol className="mt-2 space-y-2">
                        {[
                            ...(data.events ?? []).map(event => ({ id: event.id, at: event.created_at, text: event.kind.replaceAll('_', ' ') })),
                            ...(data.versions ?? []).map(version => ({ id: version.id, at: version.created_at, text: `Post ${data.items?.find(item => item.id === version.item_id)?.position} · v${version.version_no}: ${version.payload.body}${version.change_note ? ` · ${version.change_note}` : ''}` })),
                            ...(data.responses ?? []).map(response => ({ id: response.id, at: response.created_at, text: `Client ${response.decision.replaceAll('_', ' ')}${response.comment ? `: ${response.comment}` : ''}` })),
                        ].sort((a, b) => b.at.localeCompare(a.at)).map(entry => <li key={entry.id} className="whitespace-pre-wrap rounded-md bg-muted p-2"><time className="block text-xs text-muted-foreground">{new Date(entry.at).toLocaleString()}</time>{entry.text}</li>)}
                    </ol>
                </details>
            </>}
        </section>
    );
}

function RevisionEditor({ item, busy, onPost }: { item: ApprovalItem; busy: boolean; onPost: (entry: unknown) => Promise<void> }) {
    const version = item.version!;
    const [body, setBody] = useState(version.payload.body);
    const [note, setNote] = useState('');
    const response = item.response;
    const hasSuggestion = Boolean(response?.suggested_title || response?.suggested_body || response?.replacement_photo_path);
    function post(accept: boolean) {
        return onPost({
            itemId: item.id,
            payload: accept && response ? applySuggestion(version.payload, { title: response.suggested_title, body: response.suggested_body }) : { ...version.payload, body },
            photoPath: accept ? response?.replacement_photo_path ?? version.photo_path : version.photo_path,
            changeNote: note,
            source: accept ? 'accepted_suggestion' : 'manual',
            sourceResponseId: accept ? response?.id : null,
        });
    }
    return <details className="space-y-2 text-sm">
        <summary className="cursor-pointer font-medium">Revise post · v{version.version_no + 1}</summary>
        <label className="block">Post text<textarea value={body} maxLength={2000} onChange={event => setBody(event.target.value)} className="mt-1 min-h-24 w-full rounded-md border border-input bg-background p-2 text-foreground" /></label>
        <label className="block">Change note the client will see<textarea value={note} maxLength={500} onChange={event => setNote(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background p-2 text-foreground" /></label>
        <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busy || !note.trim() || !body.trim()} onClick={() => void post(false)}>Post v{version.version_no + 1}</Button>
            {hasSuggestion && <Button type="button" variant="outline" disabled={busy || !note.trim()} onClick={() => void post(true)}>Accept suggestion into v{version.version_no + 1}</Button>}
        </div>
        <p className="text-xs text-muted-foreground">Client suggestions become a revision only when accepted. Re-share the same review link for approval.</p>
    </details>;
}
