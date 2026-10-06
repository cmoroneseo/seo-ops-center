import { notFound, redirect } from 'next/navigation';
import { PortalShell } from '@/components/portal/PortalShell';
import {
    PortalHomeContent, PortalMessagesContent, PortalPendingContent,
    PortalPlanContent, PortalReportContent, PortalReportsContent,
} from '@/components/portal/PortalPages';
import { countPending } from '@/lib/portal/data';
import { loadPortalPreview } from '@/lib/portal/preview';
import { previewPage } from '@/lib/portal/preview-policy';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Preview as client', robots: { index: false, follow: false } };

export default async function ClientPreviewPage({ params }: {
    params: Promise<{ clientId: string; path?: string[] }>;
}) {
    const { clientId, path } = await params;
    const destination = previewPage(path);
    if (!destination) notFound();
    const access = await loadPortalPreview(clientId);
    if (!access.ok) {
        if (access.status === 401) redirect('/login');
        if (access.status !== 500) notFound();
        throw new Error(access.error);
    }
    const contact = access.scope;
    const pendingCount = await countPending(contact).catch(() => null);
    const content = destination.page === 'home' ? <PortalHomeContent contact={contact} />
        : destination.page === 'plan' ? <PortalPlanContent contact={contact} />
        : destination.page === 'pending' ? <PortalPendingContent contact={contact} />
        : destination.page === 'messages' ? <PortalMessagesContent contact={contact} />
        : destination.page === 'reports' ? <PortalReportsContent contact={contact} />
        : <PortalReportContent contact={contact} id={destination.reportId!} />;
    return <PortalShell contact={contact} contacts={[]} pendingCount={pendingCount} previewBasePath={`/portal-preview/${contact.clientId}`}>
        {content}
    </PortalShell>;
}
