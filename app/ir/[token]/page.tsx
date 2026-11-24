import React from 'react';
import type { Metadata } from 'next';
import { InternalReview } from '@/components/internal-review/InternalReview';
import { loadInternalReview } from '@/lib/internal-review/public';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
    title: 'Internal review',
    robots: { index: false, follow: false },
};

export default async function InternalReviewPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const view = await loadInternalReview(token);
    return view ? <InternalReview view={view} token={token} /> : <InternalReview view={null} />;
}
