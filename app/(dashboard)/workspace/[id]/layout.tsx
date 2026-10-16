import { SeoPlanStageListProvider } from '@/components/seo-plan/use-seo-plan-stage-list';
import { SeoPlanV2Provider } from '@/components/seo-plan/use-seo-plan-v2';
import { resolveSessionOrganization } from '@/lib/reports/session-org';
import { seoPlanStageListEnabled, seoPlanV2Enabled } from '@/lib/seo-plan/flags';

/**
 * The client workspace is a client page. Resolve the Plan v2 flag and the
 * stage-list flag here so the first paint already knows which plan to draw.
 */
export default async function WorkspaceClientLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    let enabled: boolean | null = null;
    let stageList = false;
    try {
        const session = await resolveSessionOrganization();
        if (session.ok) {
            enabled = seoPlanV2Enabled(process.env, session.organizationId);
            stageList = seoPlanStageListEnabled(process.env, session.organizationId);
        }
    } catch {
        enabled = null;
        stageList = false;
    }
    return (
        <SeoPlanV2Provider enabled={enabled}>
            <SeoPlanStageListProvider enabled={stageList}>{children}</SeoPlanStageListProvider>
        </SeoPlanV2Provider>
    );
}
