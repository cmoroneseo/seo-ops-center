'use client';

import Link from 'next/link';

export default function PreviewError({ reset }: { reset: () => void }) {
    return <div className="mx-auto max-w-lg px-4 py-16"><h1 className="text-xl font-semibold">Client preview is unavailable</h1><p className="mt-3 text-sm text-muted-foreground">We couldn’t load the shared content. Try again or return to your workspace.</p><div className="mt-5 flex gap-4"><button type="button" onClick={reset} className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Try again</button><Link href="/workspace" className="px-3 py-2 text-sm underline">Back to workspace</Link></div></div>;
}
