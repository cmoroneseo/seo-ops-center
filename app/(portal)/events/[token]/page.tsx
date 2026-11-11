import type { Metadata } from 'next';
import { FileText, LinkIcon, TimerOff } from 'lucide-react';
import { GtmEventsReport } from '@/components/reports/GtmEventsReport';
import { findPublicShareByHash } from '@/lib/reports/gtm-share-store';
import { resolvePublicShare } from '@/lib/reports/gtm-share';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Event report',
    robots: { index: false, follow: false, nocache: true },
};

const DENIALS = {
    expired: {
        icon: TimerOff,
        title: 'This report link has expired',
        body: 'Ask your account manager for a current link.',
    },
    revoked: {
        icon: LinkIcon,
        title: 'This report link is no longer active',
        body: 'It was turned off by the team. Ask your account manager for a current link.',
    },
    not_found: {
        icon: FileText,
        title: 'We couldn’t find that report',
        body: 'Double-check the link. It may have been copied incompletely.',
    },
} as const;

export default async function PublicGtmEventsPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const result = await resolvePublicShare(token, { expectedKind: 'events', findByHash: findPublicShareByHash });
    if (!result.ok || result.kind !== 'events') {
        const denial = result.ok ? 'not_found' : result.denial;
        const { icon: Icon, title, body } = DENIALS[denial];
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
    return <GtmEventsReport report={result.snapshot} showChrome />;
}
