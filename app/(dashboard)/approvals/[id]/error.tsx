'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function ApprovalError({ reset }: { reset: () => void }) {
  return <section className="mx-auto max-w-lg space-y-4 rounded-xl border border-border bg-card p-4">
    <h1 className="font-semibold">This approval request couldn't be displayed.</h1>
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" onClick={reset}>Try again</Button>
      <Link href="/approvals" className="text-sm underline underline-offset-4">Back to approvals</Link>
    </div>
  </section>;
}
