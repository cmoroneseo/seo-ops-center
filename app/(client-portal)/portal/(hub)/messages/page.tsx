import { redirect } from 'next/navigation';
import { PortalRefreshButton } from '@/components/portal/PortalRefreshButton';
import { FeedbackThread } from '@/components/portal/FeedbackThread';
import { loadPortalMessages } from '@/lib/portal/data';
import { requirePortalAccess } from '@/lib/portal/session';

export const dynamic = 'force-dynamic';

export default async function PortalMessagesPage() {
    const access = await requirePortalAccess();
    if (!access.ok) redirect('/portal/login');
    const entries = await loadPortalMessages(access.identity.contact);
    return <div className="mx-auto max-w-3xl"><div className="mb-6 text-foreground"><h1 className="text-3xl font-bold tracking-tight">A direct line to your team.</h1><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Questions, ideas, or a quick update — keep the conversation moving between reports.</p></div><section className="portal-panel"><div className="flex flex-wrap items-center justify-between gap-3"><h2>Your conversation</h2><PortalRefreshButton /></div><p className="portal-panel-description">Notes here are shared with your account team and invited contacts for {access.identity.contact.clientName}. Your team’s replies appear in this conversation.</p>{entries.length === 0 && <p className="mt-5 text-sm text-muted-foreground">Start with whatever’s on your mind. You don’t need to wait for the next report.</p>}<FeedbackThread key={access.identity.contact.clientId} subjectType="general" subjectId={access.identity.contact.clientId} entries={entries} /></section></div>;
}
