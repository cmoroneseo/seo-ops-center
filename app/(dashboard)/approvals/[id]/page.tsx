'use client';

import '@/components/approvals-v2/page-review.css';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, CheckCircle, Copy, Lock, Send, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { PreviewDialog } from '@/components/approvals-v2/PreviewDialog';
import { PagePreview } from '@/components/approvals-v2/PagePreview';
import { AgencyComments, type AgencyComment } from '@/components/approvals-v2/AgencyComments';
import { sanitizeDoc } from '@/lib/approvals-v2/page-doc';
import { PageEditor } from '@/components/approvals-v2/PageEditor';
import type { PagePayload } from '@/lib/approvals-v2/registry';
import { Button } from '@/components/ui/button';
import { GbpPostPreview } from '@/components/gbp-approvals/PublicReview';
import { RevisionEditor } from '@/components/gbp-approvals/TaskApprovalsPanel';
import { type GbpPostPayload } from '@/lib/gbp-approvals/registry';
import { approvalGroup } from '@/lib/approvals-v2/list';
import { InternalLinkControls } from '@/components/internal-review/InternalLinkControls';
import { feedbackLabel, type StaffInternalFeedback } from '@/lib/internal-review/model';
import { StatusChip, TypeChip } from '@/components/approvals-v2/Shared';
interface Version {
  id: string;
  item_id: string;
  version_no: number;
  payload: GbpPostPayload | PagePayload;
  photo_path: string | null;
  change_note: string | null;
  created_at: string;
}
interface Item {
  id: string;
  position: number;
  item_type: string;
  page_kind: string | null;
  status: 'pending' | 'approved' | 'changes_requested';
  current_version_id: string;
  released_version_id: string | null;
  decision_lock_reason: string | null;
  version: Version | null;
  releasedVersion: Version | null;
  response: {
    id: string;
    item_id: string;
    comment: string | null;
    suggested_title: string | null;
    suggested_body: string | null;
    replacement_photo_path: string | null;
    created_at: string;
    decision: string;
  } | null;
}
interface Data {
  request: {
    id: string;
    title: string;
    stage: string;
    archived_at: string | null;
    due_at: string | null;
    created_via: string;
    created_at: string;
    clients: {
      name: string;
      domain?: string;
      logo_url?: string | null;
    };
    item_type: string;
  };
  items: Item[];
  comments?: AgencyComment[];
  internalFeedback?: (StaffInternalFeedback & { itemId: string })[];
  internalFeedbackUnavailable?: boolean;
  versions: Version[];
  questions: {
    id: string;
    prompt: string;
  }[];
  events: {
    id: string;
    kind: string;
    created_at: string;
  }[];
  photos: Record<string, string | null>;
  link: {
    state: string;
    expiresAt: string;
    openedAt: string | null;
    revokedAt: string | null;
  } | null;
  owner: {
    id: string;
    full_name: string;
  } | null;
  botName: string | null;
  canSend: boolean;
  canWrite: boolean;
  sendReason: string | null;
}
export default function Page({
  params
}: {
  params: Promise<{
    id: string;
  }>;
}) {
  const {
    id
  } = use(params);
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [url, setUrl] = useState(''),
    [copied, setCopied] = useState(false),
    [confirmRevoke, setConfirmRevoke] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch(`/api/approval-requests/${id}`, {
      cache: 'no-store'
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    setData(body);
  }, [id]);
  useEffect(() => {
    void load().catch(e => setError(e.message));
  }, [load]);
  async function act(path: string, body: unknown = {}, method = 'POST') {
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/approval-requests/${id}${path ? '/' + path : ''}`, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.code === 'forbidden' ? 'You do not have permission to make this change.' : result.error);
      if (result.url) {
        setUrl(result.url);
        setCopied(false);
      }
      if (path === 'link/revoke') {
        setUrl('');
        setConfirmRevoke(false);
      }
      setNotice(path === 'send' || path === 'link/issue' ? 'Link created. Nothing was sent to the client.' : path === 'link/extend' ? 'Extended 14 days on the same link.' : 'Saved. Nothing was sent to the client.');
      await load();
      window.dispatchEvent(new Event('approvals:changed'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <div className="p-6">
    {error ? <p role="alert">
      {error}
    </p> : <p>Loading approval request…</p>}
  </div>;
  const draft = data.request.stage === 'draft',
    editable = data.canWrite && !data.request.archived_at;
  const expiry = data.link?.expiresAt ?? new Date(Date.now() + 14 * 86400000).toISOString();
  const sendButton = <Button
    className="min-h-11 bg-[#DB0A8B] text-white hover:bg-[#b90875]"
    aria-describedby={!data.canSend ? "send-permission-reason" : undefined}
    disabled={busy || !data.canSend || !data.items.length || !!data.request.archived_at}
    onClick={() => void act('send')}><Send size={16} />Send and create link</Button>;
  const share = <section className="space-y-3 rounded-xl border border-border bg-card p-4">
    <h2 className="font-semibold">
      {draft ? 'Send to client' : 'Share link'}
    </h2>
    {draft ? <>
      <p className="text-sm text-muted-foreground">Send creates a private review link. The app doesn’t email anyone; you share the link.</p>
      <p className="text-sm"><CheckCircle size={15} className="mr-1 inline text-emerald-700" />{data.items.length} items ready</p>
      <p className="text-sm">Client gives a name to respond. Email is optional.</p>
      <p className="text-sm">Link expires <strong>
        {new Date(expiry).toLocaleDateString()}
      </strong> · 14 days</p>
      {sendButton}
      {!data.canSend && <p id="send-permission-reason" className="text-sm text-muted-foreground">
        {data.sendReason}
      </p>}
    </> : <>
      {url ? <>
        <label className="block text-sm">Review URL<input
          readOnly
          value={url}
          className="mt-1 min-h-11 w-full rounded border p-2"
          onFocus={e => e.target.select()} /></label>
        <Button variant="outline" onClick={() => void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setNotice('Link copied.');
        }).catch(() => setError('Select and copy the URL above.'))}>
          <Copy size={15} />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </> : <p className="text-sm text-muted-foreground">The URL is shown only when created. Extend keeps the same link. To replace a lost link, revoke it and create another.</p>}
      <dl className="space-y-2 text-sm">
        <div>Status: {data.link?.state ?? 'No link yet'}</div>
        <div>Expires: {new Date(expiry).toLocaleString()}</div>
        <div>Opened: {data.link?.openedAt ? new Date(data.link.openedAt).toLocaleString() : 'Not opened yet'}</div>
      </dl>
      {editable && <div className="flex flex-wrap gap-2">
        {data.link && !data.link.revokedAt ? <>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void act('link/extend')}>Extend 14 days</Button>
          <Button variant="outline" onClick={() => setConfirmRevoke(true)}>Revoke</Button>
        </> : <Button
          variant="outline"
          disabled={busy || !data.canSend}
          onClick={() => void act('link/issue')}>Create new link</Button>}
      </div>}
      <Dialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <DialogContent>
          <DialogTitle>Revoke this link?</DialogTitle>
          <DialogDescription>The client will lose access. Previous feedback is kept.</DialogDescription>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void act('link/revoke')}>Confirm revoke</Button>
          <Button variant="ghost" onClick={() => setConfirmRevoke(false)}>Cancel</Button>
        </DialogContent>
      </Dialog>
    </>}
    <hr />
    <p className="text-sm">Owner: {data.owner?.full_name ?? data.botName ?? 'Unassigned'}</p>
    {editable && <Button
      variant="outline"
      disabled={busy}
      onClick={() => void act('owner', {
        ownerId: 'me'
      })}>Take ownership</Button>}
    {data.canWrite && <Button
      variant="ghost"
      disabled={busy}
      onClick={() => void act(data.request.archived_at ? 'unarchive' : 'archive')}>
      {data.request.archived_at ? 'Unarchive' : 'Archive'}
      {draft ? ' draft' : ''}
    </Button>}
  </section>;
  return <div className="space-y-4 p-4 pb-44 lg:p-6">
    <Link className="inline-flex min-h-11 items-center text-sm underline" href="/approvals">‹ Approvals</Link>
    <header>
      <h1 className="text-xl font-bold">
        {data.request.title}
      </h1>
      <p className="my-2 text-sm text-muted-foreground">{data.request.clients?.name} · Created {new Date(data.request.created_at).toLocaleDateString()}{data.botName ? ` by ${data.botName}` : ''}</p>
      <StatusChip group={approvalGroup(data.request.stage, data.items)} />
      <span className="ml-2"><TypeChip row={{ itemType: data.request.item_type, pageKinds: [...new Set(data.items.map(item => item.page_kind).filter((kind): kind is string => !!kind))] }} /></span>
      {data.request.archived_at && <span className="ml-2">Archived</span>}
      <div className="mt-3">
        <PreviewDialog logoSrc={data.request.clients?.logo_url ?? undefined} domain={data.request.clients?.domain} clientName={data.request.clients?.name ?? 'Client'} items={data.items.flatMap(item => {
          const version = (draft ? item.version : item.releasedVersion) ?? item.version;
          return version ? [{
            id: item.id,
            payload: version.payload,
            images: data.photos,
            photoUrl: data.photos[version.photo_path ?? ''] ?? null
          }] : [];
        })} />
      </div>
    </header>
    {error && <p role="alert" className="rounded border border-red-500 p-3 text-red-800">
      {error}
    </p>}
    {notice && <p role="status" className="rounded border border-emerald-600 bg-emerald-50 p-4 text-emerald-950">
      {notice}
    </p>}
    {draft && <div className="rounded-lg border border-sky-500 bg-sky-50 p-4 text-sm text-sky-950">
      <Lock size={16} className="mr-2 inline" />
      <strong>Internal draft: the client can&apos;t see this yet.</strong>
      <p className="mt-1">Review each item, edit or remove what isn’t ready, then press Send to create the client link.</p>
    </div>}
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <aside className={`${draft ? 'lg:order-2' : 'order-first lg:order-2'} space-y-4`}>
        {share}
        {data.request.item_type === 'gbp_post' && data.canWrite && (
          <InternalLinkControls key={id} requestId={id} canCreate={draft && editable} />
        )}
      </aside>
      <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
        {data.internalFeedbackUnavailable && <p role="status" className="text-sm text-muted-foreground">Internal feedback could not be loaded.</p>}
        {draft && editable && <details className="rounded-xl border bg-card p-4">
          <summary>Edit request details</summary>
          <form className="mt-3 space-y-3" onSubmit={e => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void act('', {
              title: form.get('title'),
              dueAt: form.get('dueAt') ? new Date(String(form.get('dueAt'))).toISOString() : null,
              questions: String(form.get('questions')).split('\n').filter(Boolean).map(prompt => ({
                prompt
              }))
            }, 'PATCH');
          }}>
            <label className="block">Title<input
              name="title"
              required
              maxLength={200}
              defaultValue={data.request.title}
              className="block min-h-11 w-full rounded border p-2" /></label>
            <label className="block">Due date<input
              type="date"
              name="dueAt"
              defaultValue={data.request.due_at?.slice(0, 10)}
              className="block min-h-11 rounded border p-2" /></label>
            <label className="block">Questions (one per line)<textarea
              name="questions"
              defaultValue={data.questions.map(q => q.prompt).join('\n')}
              className="block w-full rounded border p-2" /></label>
            <Button disabled={busy}>Save draft details</Button>
          </form>
        </details>}
        {data.items.map((item, index) => {
          const version = (!draft ? item.releasedVersion : item.version) ?? item.version;
          const p = version?.payload;
          if (!p) return null;
          const internalFeedback = data.internalFeedback?.filter(entry => entry.itemId === item.id) ?? [];
          return <article key={item.id} className="space-y-4 rounded-xl border border-border bg-card p-4">
            <header className="space-y-2">
              <h2 className="font-semibold">{index + 1}. {p.title}</h2>
              <TypeChip row={{
                itemType: item.item_type,
                pageKinds: item.page_kind ? [item.page_kind] : []
              }} />
              <span className="ml-2 text-sm">{draft ? '' : 'Locked · '}Version {version.version_no}</span>
              {!draft && <p className="text-sm text-muted-foreground">Editing creates version {version.version_no + 1}.</p>}
              {draft && editable && <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void act('', {
                    removeItemIds: [item.id]
                  }, 'PATCH')}><Trash2 size={14} />Remove</Button>
                {[-1, 1].map(direction => <Button
                  key={direction}
                  variant="outline"
                  aria-label={direction === -1 ? 'Move item up' : 'Move item down'}
                  disabled={busy || index + direction < 0 || index + direction >= data.items.length}
                  onClick={() => {
                    const ids = data.items.map(i => i.id);
                    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
                    void act('', {
                      itemOrder: ids
                    }, 'PATCH');
                  }}>
                  {direction === -1 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                </Button>)}
              </div>}
            </header>
            {'pageKind' in p ? <>
              {data.comments && <AgencyComments anchorOrder={sanitizeDoc(p.body).content.map(block => String(block.attrs?.blockId))} requestId={id} comments={data.comments.filter(comment => comment.item_id === item.id)} currentImages={Object.fromEntries([
                ['mockup', data.photos[version.photo_path ?? ''] ?? null],
                ...sanitizeDoc(p.body).content.filter(block => block.type === 'image').map(block => [String(block.attrs?.blockId), data.photos[String(block.attrs?.src)] ?? String(block.attrs?.src)])
              ])} canWrite={editable} refresh={() => { void load(); }} />}
              {editable && item.current_version_id !== item.released_version_id && !draft && <Button disabled={busy} onClick={() => void act('release')}>Release revision to client</Button>}
              <PagePreview domain={data.request.clients?.domain} payload={p} photoUrl={data.photos[version.photo_path ?? '']} images={data.photos} />
              {editable && item.version && <PageEditor
                key={item.version.id}
                domain={data.request.clients?.domain}
                requestId={id}
                itemId={item.id}
                payload={item.version.payload as PagePayload}
                photoPath={item.version.photo_path}
                photoUrl={data.photos[item.version.photo_path ?? ''] ?? null}
                images={data.photos}
                sent={!draft}
                versionNo={item.version.version_no}
                busy={busy}
                onSave={entry => act('versions', { items: [entry] })} />}
            </> : <>
              <p className="text-sm">Planned for {p.scheduledDate}</p>
              <div className="gbp-public" style={{
                minHeight: 0
              }}>
                <GbpPostPreview logoSrc={data.request.clients?.logo_url ?? undefined} clientName={data.request.clients?.name ?? 'Client'} post={{
                  position: item.position,
                  title: p.title,
                  scheduled: p.scheduledDate,
                  offerStart: p.offerStart ?? '',
                  offerEnd: p.offerEnd ?? '',
                  body: p.body,
                  photo: data.photos[version.photo_path ?? ''] ?? null,
                  status: item.status,
                  ctaLabel: p.ctaLabel,
                  ctaUrl: p.ctaUrl,
                  postType: p.postType
                }} />
              </div>
              {editable && item.version && <RevisionEditor
                key={item.version.id}
                item={{
                  ...item,
                  version: item.version ? {
                    ...item.version,
                    payload: item.version.payload as GbpPostPayload
                  } : null
                }}
                busy={busy}
                onPost={entry => act('versions', {
                  items: [entry]
                })} />}
            </>}
            {internalFeedback.length > 0 && <section className="space-y-2 rounded-lg border border-border p-3 text-sm">
              <h4 className="font-semibold">Internal feedback</h4>
              <ul className="space-y-3">
                {internalFeedback.map(entry => <li key={entry.id} className="wrap-break-word">
                  <p><strong>{entry.reviewerName}</strong> · {feedbackLabel(entry.decision)}{entry.versionNo !== null && ` · Version ${entry.versionNo}`}</p>
                  {entry.comment && <p className="whitespace-pre-wrap text-muted-foreground">{entry.comment}</p>}
                </li>)}
              </ul>
            </section>}
            {item.response && <div className="rounded-lg bg-muted p-3 text-sm">
              <strong>
                {item.response.decision.replaceAll('_', ' ')}
              </strong>
              <p>
                {item.response.comment}
              </p>
            </div>}
            {!draft && editable && item.status !== 'pending' && !item.decision_lock_reason && <Button
              variant="outline"
              disabled={busy}
              onClick={() => void act('final', {
                itemId: item.id
              })}>Mark final</Button>}
          </article>;
        })}
        {data.questions.length > 0 && <section className="rounded-xl border bg-card p-4">
          <h2 className="font-semibold">Questions for the client</h2>
          {data.questions.map(q => <p key={q.id} className="mt-2 text-sm">
            {q.prompt}
          </p>)}
        </section>}
        <details className="rounded-xl border bg-card p-4">
          <summary>History</summary>
          {data.versions.map(version => <p key={version.id} className="mt-2 text-sm">Version {version.version_no}: {version.payload.title} · {new Date(version.created_at).toLocaleString()}{version.change_note ? ` · ${version.change_note}` : ''}</p>)}
          {data.events.map(e => <p key={e.id} className="mt-2 text-sm">{e.kind.replaceAll('_', ' ')} · {new Date(e.created_at).toLocaleString()}</p>)}
        </details>
      </div>
    </div>
    {draft && <div className="fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] z-30 flex items-center justify-between gap-2 border-t bg-card p-3 lg:hidden">
      <span className="text-xs">{data.items.length} items<br />Expires {new Date(expiry).toLocaleDateString()}</span>
      {sendButton}
    </div>}
  </div>;
}
