import { BrandThemeStyle } from '@/components/providers/brand-theme-style';
import { DashboardShell } from '@/components/dashboard/DashboardShell';

/**
 * Server layout for the dashboard segment.
 *
 * Exists so the organization's brand colour can be resolved during SSR and
 * emitted with the first byte of HTML — the interactive shell below is a
 * client component and cannot do that itself.
 */
export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <>
            <BrandThemeStyle />
            <DashboardShell>{children}</DashboardShell>
        </>
    );
}
