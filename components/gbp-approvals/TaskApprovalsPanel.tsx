'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { applySuggestion, type GbpPostPayload } from '@/lib/gbp-approvals/registry';
import { CreateDraftButton } from '@/components/approvals-v2/CreateDraftButton';
import { StatusChip, LinkStatus } from '@/components/approvals-v2/Shared';
import type { ApprovalRow } from '@/lib/approvals-v2/list';
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
export function TaskApprovalsPanel({
  taskId,
  taskTitle
}: {
  taskId: string;
  taskTitle: string;
}) {
  const [rows, setRows] = useState<ApprovalRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setRows(null);
    setError('');
    async function load() {
      const all: ApprovalRow[] = [];
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams({
          archived: 'true'
        });
        if (cursor) params.set('cursor', cursor);
        const response = await fetch(`/api/approval-requests/by-task/${taskId}?${params}`, {
          signal: controller.signal,
          cache: 'no-store'
        });
        if (!response.ok) throw new Error('Approvals could not be loaded.');
        const result = await response.json();
        all.push(...result.rows);
        cursor = result.nextCursor;
      } while (cursor);
      if (!controller.signal.aborted) setRows(all);
    }
    void load().catch(() => {
      if (!controller.signal.aborted) setError('Approvals could not be loaded.');
    });
    return () => controller.abort();
  }, [taskId]);
  return <section className="space-y-3 rounded-lg border border-border bg-card p-3" aria-label="Approvals">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">Approvals</h3>
      <CreateDraftButton taskId={taskId} taskTitle={taskTitle} />
    </div>
    {error && <p role="alert">
      {error}
    </p>}
    {!rows && !error && <p>Loading approvals…</p>}
    {rows?.length === 0 && <p>No approval requests for {taskTitle} yet.</p>}
    {rows?.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-3">
      <div>
        <p>
          {row.title}
        </p>
        <p className="text-sm text-muted-foreground">
          <StatusChip group={row.group} />
          <LinkStatus row={row} />
        </p>
      </div>
      <Link className="inline-flex min-h-11 items-center underline" href={`/approvals/${row.id}`}>Open</Link>
    </div>)}
  </section>;
}
export function RevisionEditor({
  item,
  busy,
  onPost,
  staffDraftRequestId
}: {
  item: ApprovalItem;
  busy: boolean;
  onPost: (entry: unknown) => Promise<unknown>;
  staffDraftRequestId?: string;
}) {
  const version = item.version!;
  const [body, setBody] = useState(version.payload.body);
  const [note, setNote] = useState('');
  const [title, setTitle] = useState(version.payload.title);
  const [ctaUrl, setCtaUrl] = useState(version.payload.ctaUrl);
  const [photoPath, setPhotoPath] = useState(version.photo_path);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  async function uploadPhoto(file?: File) {
    if (!staffDraftRequestId || !file) return;
    setUploading(true);
    setUploadError('');
    try {
      const response = await fetch(`/api/approval-requests/${staffDraftRequestId}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, contentType: file.type, size: file.size }),
      });
      const asset = await response.json();
      if (!response.ok) throw new Error(asset.error);
      const upload = await fetch(asset.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!upload.ok) throw new Error('Photo upload failed. Try again.');
      setPhotoPath(asset.objectKey);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Photo upload failed.');
    } finally {
      setUploading(false);
    }
  }
  const response = item.response;
  const hasSuggestion = Boolean(response?.suggested_title || response?.suggested_body || response?.replacement_photo_path);
  function post(accept: boolean) {
    return onPost({
      itemId: item.id,
      payload: accept && response ? applySuggestion(version.payload, {
        title: response.suggested_title,
        body: response.suggested_body
      }) : {
        ...version.payload,
        ...(staffDraftRequestId ? { title, ctaUrl } : {}),
        body
      },
      photoPath: accept ? response?.replacement_photo_path ?? photoPath : photoPath,
      changeNote: note,
      source: accept ? 'accepted_suggestion' : 'manual',
      sourceResponseId: accept ? response?.id : null
    });
  }
  const fields = <>
    {staffDraftRequestId && <>
      <label className="block">Post title<input value={title} maxLength={80} onChange={event => setTitle(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border p-2" /></label>
      <label className="block">Button URL<input type="url" value={ctaUrl} onChange={event => setCtaUrl(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border p-2" /></label>
      <label className="block">Upload photo (JPG, PNG or WebP, up to 10 MB)<input type="file" accept="image/jpeg,image/png,image/webp"
        disabled={uploading || busy} onChange={event => void uploadPhoto(event.target.files?.[0])} className="mt-1 block w-full rounded-md border p-2" /></label>
      {uploading && <p role="status">Uploading photo…</p>}
      {photoPath && photoPath !== version.photo_path && <p role="status">Photo uploaded. Save the revision to use it.</p>}
      {uploadError && <p role="alert">{uploadError}</p>}
    </>}
    <label className="block">Post text<textarea
      value={body}
      maxLength={2000}
      onChange={event => setBody(event.target.value)}
      className="mt-1 min-h-24 w-full rounded-md border border-input bg-background p-2 text-foreground" /></label>
    <label className="block">Change note the client will see<textarea
      value={note}
      maxLength={500}
      onChange={event => setNote(event.target.value)}
      className="mt-1 w-full rounded-md border border-input bg-background p-2 text-foreground" /></label>
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={busy || uploading || (staffDraftRequestId ? !title.trim() : !note.trim()) || !body.trim()}
        onClick={() => void post(false)}>Post v{version.version_no + 1}</Button>
      {hasSuggestion && <Button
        type="button"
        variant="outline"
        disabled={busy || !note.trim()}
        onClick={() => void post(true)}>Accept suggestion into v{version.version_no + 1}</Button>}
    </div>
    {!staffDraftRequestId && <p className="text-xs text-muted-foreground">Client suggestions become a revision only when accepted. Re-share the same review link for approval.</p>}
  </>;
  return staffDraftRequestId ? <div className="space-y-3 text-sm">{fields}</div> : <details className="space-y-2 text-sm">
    <summary className="cursor-pointer font-medium">Revise post · v{version.version_no + 1}</summary>
    {fields}
  </details>;
}
