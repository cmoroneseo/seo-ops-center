import { SeoPlanV2Provider } from '@/components/seo-plan/use-seo-plan-v2';
import { resolveSessionOrganization } from '@/lib/reports/session-org';
import { seoPlanV2Enabled } from '@/lib/seo-plan/flags';

/**
 * The client workspace is a client page. Resolve the Plan v2 flag here so the
 * first paint already knows whether pre-launch hours say "Hours start after
 * launch" and which tab row to draw.
 */
export default async function WorkspaceClientLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    let enabled: boolean | null = null;
    try {
        const session = await resolveSessionOrganization();
        if (session.ok) enabled = seoPlanV2Enabled(process.env, session.organizationId);
    } catch {
        enabled = null;
    }
    return <SeoPlanV2Provider enabled={enabled}>{children}</SeoPlanV2Provider>;
}
