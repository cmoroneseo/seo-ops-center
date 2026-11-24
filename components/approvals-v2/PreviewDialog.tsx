'use client';

import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { GbpPostPreview } from '@/components/gbp-approvals/PublicReview';
import type { GbpPostPayload } from '@/lib/gbp-approvals/registry';
import type { PagePayload } from '@/lib/approvals-v2/registry';
import { ItemErrorBoundary } from './ItemErrorBoundary';
import { PagePreview } from './PagePreview';
export function PreviewDialog({
  domain,
  clientName,
  logoSrc,
  trigger,
  items
}: {
  domain?: string;
  clientName: string;
  logoSrc?: string;
  trigger?: React.ReactNode;
  items: {
    id: string;
    payload: GbpPostPayload | PagePayload;
    photoUrl: string | null;
    photoUrls?: (string | null)[];
    images?: Record<string, string | null>;
  }[];
}) {
  return <Dialog>
    <DialogTrigger asChild>
      {trigger ?? <Button variant="outline"><Eye size={16} />Preview as client</Button>}
    </DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
      <DialogTitle>Prepared for {clientName}</DialogTitle>
      <DialogDescription>Internal preview only. No link is created and no review can be submitted here.</DialogDescription>
      {items.map(({
        photoUrls,
        id,
        payload,
        photoUrl,
        images
      }, index) => <article key={id} className="space-y-3 rounded-lg border p-4">
          <ItemErrorBoundary title={payload.title}>
          {'pageKind' in payload ? <PagePreview domain={domain} payload={payload} photoUrl={photoUrl} images={images} /> : <div className="gbp-public" style={{
            minHeight: 0
          }}>
            <GbpPostPreview logoSrc={logoSrc} clientName={clientName} post={{
              ...payload,
              position: index + 1,
              photoSrcs: photoUrls,
              scheduled: payload.scheduledDate,
              photo: photoUrl,
              status: 'pending'
            }} />
          </div>}
          </ItemErrorBoundary>
        </article>)}
    </DialogContent>
  </Dialog>;
}
