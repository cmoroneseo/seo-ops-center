'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { applySuggestion, type GbpPostPayload } from '@/lib/gbp-approvals/registry';
import { MAX_GBP_PHOTOS, versionPhotoPaths } from '@/lib/gbp-approvals/photos';
import { PhotoGallery } from './PhotoGallery';
import { CreateDraftButton } from '@/components/approvals-v2/CreateDraftButton';
import { StatusChip, LinkStatus } from '@/components/approvals-v2/Shared';
import type { ApprovalRow } from '@/lib/approvals-v2/list';
interface Version {
  id: string;
  item_id: string;
  version_no: number;
  payload: GbpPostPayload;
  photo_path: string | null;
  photo_paths?: string[] | null;
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
  requestId,
  images,
  busy,
  onPost,
  draft
}: {
  item: ApprovalItem;
  requestId: string;
  images: Record<string, string | null>;
  busy: boolean;
  onPost: (entry: unknown) => Promise<unknown>;
  draft: boolean;
}) {
  const version = item.version!;
  const [body, setBody] = useState(version.payload.body);
  const [note, setNote] = useState('');
  const [title, setTitle] = useState(version.payload.title);
  const [ctaUrl, setCtaUrl] = useState(version.payload.ctaUrl);
  const [photos, setPhotos] = useState(() => versionPhotoPaths(version.photo_paths, version.photo_path)
    .map(path => ({ path, src: images[path] ?? null })));
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const response = item.response;
  const hasSuggestion = Boolean(response?.suggested_title || response?.suggested_body || response?.replacement_photo_path);
  async function upload(index: number, file: File) {
    if (uploading || busy) return;
    setUploading(true);
    setPhotoError('');
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size < 1 || file.size > 10485760) {
        throw new Error('Choose a JPG, PNG or WebP image up to 10 MB.');
      }
      const endpoint = `/api/approval-requests/${requestId}/assets`;
      const reserve = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, contentType: file.type, size: file.size }),
      });
      const { objectKey, signedUrl, error } = await reserve.json();
      if (!reserve.ok) throw new Error(error ?? 'Image could not be reserved.');
      const uploaded = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!uploaded.ok) throw new Error('Image upload failed. Try again.');
      const preview = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, objectKey }),
      });
      const result = await preview.json();
      if (!preview.ok) throw new Error(result.error ?? 'Preview unavailable.');
      setPhotos(current => {
        const next = [...current];
        next[index] = { path: objectKey, src: result.photoUrl };
        return next;
      });
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : 'Image upload failed.');
    } finally {
      setUploading(false);
    }
  }

  function post(accept: boolean) {
    const photoPaths = photos.map(photo => photo.path);
    if (accept && response?.replacement_photo_path) photoPaths[0] = response.replacement_photo_path;
    return onPost({
      itemId: item.id,
      expectedVersionId: version.id,
      payload: accept && response ? applySuggestion(version.payload, {
        title: response.suggested_title,
        body: response.suggested_body
      }) : {
        ...version.payload,
        ...(draft ? { title, ctaUrl } : {}),
        body
      },
      photoPaths,
      changeNote: note,
      source: accept ? 'accepted_suggestion' : 'manual',
      sourceResponseId: accept ? response?.id : null
    });
  }
  const fields = <>
    {draft && <>
      <label className="block">Post title<input value={title} maxLength={80} onChange={event => setTitle(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border p-2" /></label>
      <label className="block">Button URL<input type="url" value={ctaUrl} onChange={event => setCtaUrl(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border p-2" /></label>
    </>}
    <label className="block">Post text<textarea
      value={body}
      maxLength={2000}
      onChange={event => setBody(event.target.value)}
      className="mt-1 min-h-24 w-full rounded-md border border-input bg-background p-2 text-foreground" /></label>
    <fieldset disabled={busy || uploading} className="space-y-2">
      <legend className="font-medium">Post photos</legend>
      {photos.length > 0 && <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {photos.map(({ path, src }, index) => <li key={`${index}:${path}`} className="min-w-0 space-y-2 rounded-lg border p-3">
          <p className="font-medium">Photo {index + 1}{index === 0 ? ' · Primary' : ''}</p>
          <PhotoGallery sources={[src]} alt={`Photo ${index + 1} for ${version.payload.title}`} />
          <label className="block">Replace photo {index + 1}
            <input className="block w-full" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload(index, file);
            }} />
          </label>
          <Button type="button" variant="outline" size="sm" aria-label={`Remove photo ${index + 1}`}
            onClick={() => setPhotos(current => current.filter((_, position) => position !== index))}>Remove</Button>
        </li>)}
      </ol>}
      {photos.length < MAX_GBP_PHOTOS && <label className="block">Add photo
        <input className="block w-full" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(photos.length, file);
        }} />
      </label>}
      {uploading && <p role="status">Uploading photo…</p>}
      {photoError && <p role="alert">{photoError}</p>}
    </fieldset>
    {photos.length > 1 && <p className="text-xs text-muted-foreground">GHL Social Planner supports one image per GBP post. Publish the remaining photos by hand.</p>}
    <label className="block">Change note the client will see<textarea
      value={note}
      maxLength={500}
      onChange={event => setNote(event.target.value)}
      className="mt-1 w-full rounded-md border border-input bg-background p-2 text-foreground" /></label>
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={busy || uploading || (draft ? !title.trim() : !note.trim()) || !body.trim()}
        onClick={() => void post(false)}>Post v{version.version_no + 1}</Button>
      {hasSuggestion && <Button
        type="button"
        variant="outline"
        disabled={busy || uploading || !note.trim()}
        onClick={() => void post(true)}>Accept suggestion into v{version.version_no + 1}</Button>}
    </div>
    {!draft && <p className="text-xs text-muted-foreground">Client suggestions become a revision only when accepted. Re-share the same review link for approval.</p>}
  </>;
  return draft ? <div className="space-y-3 text-sm">{fields}</div> : <details className="space-y-2 text-sm">
    <summary className="cursor-pointer font-medium">Revise post · v{version.version_no + 1}</summary>
    {fields}
  </details>;
}
