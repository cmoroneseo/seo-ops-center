'use client';

import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { GbpPostPreview } from '@/components/gbp-approvals/PublicReview';
import type { GbpPostPayload } from '@/lib/gbp-approvals/registry';
import type { PagePayload } from '@/lib/approvals-v2/registry';
import { PagePreview } from './PagePreview';
export function PreviewDialog({
  domain,
  clientName,
  logoSrc,
  items
}: {
  domain?: string;
  clientName: string;
  logoSrc?: string;
  items: {
    id: string;
    payload: GbpPostPayload | PagePayload;
    photoUrl: string | null;
    images?: Record<string, string | null>;
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
        photoUrl,
        images
      }, index) => <article key={id} className="space-y-3 rounded-lg border p-4">
          {'pageKind' in payload ? <PagePreview domain={domain} payload={payload} photoUrl={photoUrl} images={images} /> : <div className="gbp-public" style={{
            minHeight: 0
          }}>
            <GbpPostPreview logoSrc={logoSrc} clientName={clientName} post={{
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
