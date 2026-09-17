import type { Metadata } from 'next';
import { FileText, LinkIcon, TimerOff } from 'lucide-react';

import { recordPortalView, resolveShareToken } from '@/lib/approvals/portal-data';
import { ReviewPortal } from '@/components/approvals/ReviewPortal';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Content review',
    robots: { index: false, follow: false, nocache: true },
};

const DENIALS = {
    expired: {
        icon: TimerOff,
        title: 'This review link has expired',
        body: 'Links expire for security. Ask your account manager to send a fresh one — your previous feedback is safe.',
    },
    revoked: {
        icon: LinkIcon,
        title: 'This review link is no longer active',
        body: 'It was turned off by the team. Get in touch with your account manager for a current link.',
    },
    not_found: {
        icon: FileText,
        title: 'We couldn’t find that review',
        body: 'Double-check the link — it may have been copied incompletely.',
    },
} as const;

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const result = await resolveShareToken(token);

    if (!result.ok) {
        // Deliberately says nothing about which client or documents the link pointed at.
        const { icon: Icon, title, body } = DENIALS[result.denial];
        return (
            <main className="flex min-h-screen items-center justify-center bg-background px-6">
                <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center">
                    <Icon className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
                    <h1 className="mb-2 text-lg font-semibold text-foreground">{title}</h1>
                    <p className="text-sm text-muted-foreground">{body}</p>
                </div>
            </main>
        );
    }

    // Fire-and-forget: a failed counter must never block the review.
    void recordPortalView(result.payload.linkId).catch(() => {});

    return <ReviewPortal payload={result.payload} token={token} />;
}
