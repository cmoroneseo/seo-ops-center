'use client';

import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { GbpPostPreview } from '@/components/gbp-approvals/PublicReview';
import type { GbpPostPayload } from '@/lib/gbp-approvals/registry';
import type { PagePayload } from '@/lib/approvals-v2/registry';
import { approvalPlainText } from '@/lib/approvals-v2/text';
export function PreviewDialog({
  clientName,
  items
}: {
  clientName: string;
  items: {
    id: string;
    payload: GbpPostPayload | PagePayload;
    photoUrl: string | null;
  }[];
}) {
  return <Dialog>
    <DialogTrigger asChild>
      <Button variant="outline"><Eye size={16} />Preview as client</Button>
    </DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
      <DialogTitle>Prepared for {clientName}</DialogTitle>
      <DialogDescription>Internal preview only. No link is created and no review can be submitted here.</DialogDescription>
      {items.map(({
        id,
        payload,
        photoUrl
      }, index) => <article key={id} className="space-y-3 rounded-lg border p-4">
          {'pageKind' in payload ? <>
            <h2 className="font-semibold">
              {payload.title}
            </h2>
            <p className="text-sm">Title tag: {payload.metaTitle}</p>
            <p className="text-sm">Meta description: {payload.metaDescription}</p>
            <p className="break-all text-sm">/{payload.slug}/</p>
            <p className="text-sm">Planned for {payload.plannedDate ?? 'Not set'}</p>
            <p className="whitespace-pre-wrap text-sm">
              {approvalPlainText(payload.body)}
            </p>
          </> : <div className="gbp-public" style={{
            minHeight: 0
          }}>
            <GbpPostPreview clientName={clientName} post={{
              ...payload,
              position: index + 1,
              scheduled: payload.scheduledDate,
              offerStart: payload.offerStart ?? '',
              offerEnd: payload.offerEnd ?? '',
              photo: photoUrl,
              status: 'pending'
            }} />
          </div>}
        </article>)}
    </DialogContent>
  </Dialog>;
}
