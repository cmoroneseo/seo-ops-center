import type { Metadata } from 'next';
import { FileText, LinkIcon, TimerOff } from 'lucide-react';
import { RoadmapReportView } from '@/components/reports/RoadmapReportView';
import { openScopedPublicRoadmap } from '@/lib/reports/roadmap-server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export const metadata: Metadata = {
    title: 'Roadmap',
    robots: { index: false, follow: false, nocache: true },
};

const DENIALS = {
    expired: {
        icon: TimerOff,
        title: 'This link has expired',
        body: 'Ask your account manager for a current link.',
    },
    revoked: {
        icon: LinkIcon,
        title: 'This link is no longer active',
        body: 'It was turned off. Ask your account manager for a current link.',
    },
    not_found: {
        icon: FileText,
        title: 'We couldn’t find that plan',
        body: 'Double-check the link. It may have been copied incompletely.',
    },
} as const;

export default async function PublicRoadmapPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const result = await openScopedPublicRoadmap(token);
    if (!result.ok) {
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
    return (
        <main className="min-h-screen bg-white px-6 py-10">
            <div className="mx-auto max-w-3xl">
                <RoadmapReportView roadmap={result.roadmap} />
            </div>
        </main>
    );
}
