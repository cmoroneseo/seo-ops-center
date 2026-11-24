'use client';

import type { ReactNode } from 'react';
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
    key={version.id} draft={draft} requestId={data.request.id} images={data.photos}
    item={{ ...item, version: { ...version, payload: version.payload as GbpPostPayload } }}
    busy={busy} onPost={save}
  />;
}
