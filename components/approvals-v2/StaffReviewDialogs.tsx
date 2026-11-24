'use client';

import type { FormEvent, ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { RevisionEditor } from '@/components/gbp-approvals/TaskApprovalsPanel';
import { PageEditor } from './PageEditor';
import type { GbpPostPayload } from '@/lib/gbp-approvals/registry';
import type { StaffReviewData, StaffReviewItem, ReviewAction } from './StaffReviewTypes';

export function ReviewDialog({ title, description, onClose, children, className, initialFocus, restoreFocus }: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  initialFocus?: () => HTMLElement | null;
  restoreFocus?: () => HTMLElement | null;
}) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className={`ar-dialog max-h-[90dvh] overflow-y-auto ${className ?? ''}`}
      onOpenAutoFocus={event => {
        const element = initialFocus?.();
        if (element) {
          event.preventDefault();
          element.focus();
        }
      }}
      onCloseAutoFocus={event => {
        if (restoreFocus) {
          event.preventDefault();
          restoreFocus()?.focus();
        }
      }}>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription className={description ? undefined : 'sr-only'}>{description ?? title}</DialogDescription>
      {children}
    </DialogContent>
  </Dialog>;
}

export function RequestEditForm({ data, busy, act, onClose }: { data: StaffReviewData; busy: boolean; act: ReviewAction; onClose: () => void }) {
  return <form className="ar-form" onSubmit={async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = form.get('dueAt');
    if (await act('', {
      title: form.get('title'),
      dueAt: date ? new Date(String(date)).toISOString() : null,
      questions: String(form.get('questions')).split('\n').filter(Boolean).map(prompt => ({ prompt })),
    }, 'PATCH')) onClose();
  }}>
    <label>Title<input name="title" required maxLength={200} defaultValue={data.request.title} /></label>
    <label>Due date<input type="date" name="dueAt" defaultValue={data.request.due_at?.slice(0, 10)} /></label>
    <label>Questions (one per line)<textarea name="questions" defaultValue={data.questions.map(question => question.prompt).join('\n')} rows={4} /></label>
    <button className="ar-button" disabled={busy}>Save draft details</button>
  </form>;
}

export function AddReviewItemForm({ itemType, busy, act, onClose }: { itemType: string; busy: boolean; act: ReviewAction; onClose: () => void }) {
  const page = itemType === 'page';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = form.get('date');
    const common = { schemaVersion: 1, title: form.get('title') };
    const payload = page ? {
      ...common, pageKind: form.get('kind'), slug: form.get('slug'), metaTitle: form.get('metaTitle'),
      metaDescription: form.get('metaDescription'), targetKeyword: form.get('keyword') || undefined,
      plannedDate: date || undefined, body: { format: 'markdown', text: form.get('body') },
    } : {
      ...common, postType: 'update', body: form.get('body'), scheduledDate: date,
      offerStart: null, offerEnd: null, terms: '', ctaLabel: 'Learn more', ctaUrl: form.get('ctaUrl'),
    };
    if (await act('', { items: [{ itemType, payload, photoPath: form.get('photo') || null }] }, 'PATCH')) onClose();
  }
  return <form className="ar-form" onSubmit={submit}>
    {page && <label>Page kind<select name="kind"><option value="service">Service page</option><option value="city">City page</option><option value="blog">Blog draft</option></select></label>}
    <label>Title<input name="title" required maxLength={page ? 200 : 80} /></label>
    {page && <>
      <label>Slug<input name="slug" required maxLength={200} /></label>
      <label>Target keyword<input name="keyword" maxLength={120} /></label>
      <label>Meta title<input name="metaTitle" required maxLength={120} /></label>
      <label>Meta description<textarea name="metaDescription" maxLength={320} /></label>
    </>}
    <label>{page ? 'Page content (Markdown)' : 'Post text'}<textarea name="body" required rows={4} maxLength={page ? 800000 : 2000} /></label>
    <label>Planned for<input name="date" type="date" required={!page} /></label>
    {!page && <label>Learn more URL<input name="ctaUrl" type="url" pattern="https://.*" required /></label>}
    <label>{page ? 'Mockup' : 'Photo'} URL (optional)<input name="photo" type="url" pattern="https://.*" /></label>
    <button className="ar-button" disabled={busy}>{page ? 'Add page' : 'Add post'}</button>
  </form>;
}

export function ReviewItemEditor({ data, item, busy, act, onClose }: {
  data: StaffReviewData;
  item: StaffReviewItem;
  busy: boolean;
  act: ReviewAction;
  onClose: () => void;
}) {
  const version = item.version;
  if (!version) return null;
  const draft = data.request.stage === 'draft';
  const save = async (entry: unknown) => {
    if (await act('versions', { items: [entry] })) onClose();
  };
  return 'pageKind' in version.payload ? <PageEditor
    key={version.id} expanded domain={data.request.clients?.domain} requestId={data.request.id} itemId={item.id}
    payload={version.payload} photoPath={version.photo_path} photoUrl={data.photos[version.photo_path ?? ''] ?? null}
    images={data.photos} sent={!draft} versionNo={version.version_no} busy={busy} onSave={save}
  /> : <RevisionEditor
    key={version.id} staffDraftRequestId={draft ? data.request.id : undefined}
    item={{ ...item, version: { ...version, payload: version.payload as GbpPostPayload } }}
    busy={busy} onPost={save}
  />;
}
