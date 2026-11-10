import type { Metadata } from 'next';
import { FileText, LinkIcon, TimerOff } from 'lucide-react';
import { RoadmapReportView } from '@/components/reports/RoadmapReportView';
import { ROADMAP_COPY } from '@/lib/reports/roadmap';
import { loadPublicRoadmap } from '@/lib/reports/roadmap-server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: ROADMAP_COPY.title,
    robots: { index: false, follow: false, nocache: true },
};

const DENIALS = {
    expired: {
        icon: TimerOff,
        title: ROADMAP_COPY.publicExpiredTitle,
        body: ROADMAP_COPY.publicExpiredBody,
    },
    revoked: {
        icon: LinkIcon,
        title: ROADMAP_COPY.publicRevokedTitle,
        body: ROADMAP_COPY.publicRevokedBody,
    },
    not_found: {
        icon: FileText,
        title: ROADMAP_COPY.publicMissingTitle,
        body: ROADMAP_COPY.publicMissingBody,
    },
} as const;

export default async function PublicRoadmapPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const result = await loadPublicRoadmap(token);
    if (!result.ok) {
        const { icon: Icon, title, body } = DENIALS[result.denial];
        return (
            <main className="flex min-h-screen items-center justify-center bg-white px-6">
                <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-8 text-center">
                    <Icon className="mx-auto mb-4 h-8 w-8 text-neutral-500" />
                    <h1 className="mb-2 text-lg font-semibold text-neutral-900">{title}</h1>
                    <p className="text-sm text-neutral-600">{body}</p>
                </div>
            </main>
        );
    }
    if (!result.roadmap) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-white px-6">
                <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-8 text-center">
                    <h1 className="mb-2 text-lg font-semibold text-neutral-900">{ROADMAP_COPY.title}</h1>
                    <p className="text-sm text-neutral-600">{ROADMAP_COPY.notOnReport}</p>
                </div>
            </main>
        );
    }
    return (
        <main className="min-h-screen bg-neutral-100 px-4 py-10">
            <div className="mx-auto max-w-[860px] rounded-xl bg-white px-6 py-8 text-neutral-900 shadow-sm sm:px-10">
                <RoadmapReportView roadmap={result.roadmap} />
            </div>
        </main>
    );
}
