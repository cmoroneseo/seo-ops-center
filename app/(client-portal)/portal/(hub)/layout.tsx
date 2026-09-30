import { redirect } from 'next/navigation';
import { PortalShell } from '@/components/portal/PortalShell';
import { countPending } from '@/lib/portal/data';
import { requirePortalAccess } from '@/lib/portal/session';

export const dynamic = 'force-dynamic';

export const metadata = {
    title: 'Client portal',
    robots: { index: false, follow: false },
};

export default async function PortalHubLayout({ children }: { children: React.ReactNode }) {
    const access = await requirePortalAccess();
    if (!access.ok) {
        if (access.status === 401) redirect('/portal/login');
        return (
            <div className="mx-auto max-w-lg px-4 py-16 text-sm text-muted-foreground">
                This portal is for invited client contacts. Ask your account team for a sign-in link.
            </div>
        );
    }
    const pendingCount = await countPending(access.identity.contact);
    return (
        <PortalShell
            contact={access.identity.contact}
            contacts={access.identity.contacts}
            pendingCount={pendingCount}
        >
            {children}
        </PortalShell>
    );
}
