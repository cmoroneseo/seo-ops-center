import { BrandThemeStyle } from '@/components/providers/brand-theme-style';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { OrganizationProvider } from '@/components/providers/organization-provider';
import { loadDashboardBootstrap } from '@/lib/organization/load-dashboard-session';

/**
 * Server layout for the dashboard segment.
 *
 * Exists so the organization's brand colour can be resolved during SSR and
 * emitted with the first byte of HTML — the interactive shell below is a
 * client component and cannot do that itself.
 */
export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const boot = await loadDashboardBootstrap();
    const session = boot.status === 'unknown' ? null : boot.session;
    return (
        <>
            <BrandThemeStyle theme={session?.theme} />
            <OrganizationProvider initial={session ? { organization: session.organization, memberships: session.memberships } : null}>
                <DashboardShell>{children}</DashboardShell>
            </OrganizationProvider>
        </>
    );
}
