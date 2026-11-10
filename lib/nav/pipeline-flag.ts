/**
 * Opt-in for the Blogr-style client sidebar.
 *
 * Unset or any value other than `true` keeps today's client groups.
 * This is a different switch from keyword tracking and the campaign workspace.
 */
export function pipelineNavEnabled(): boolean {
    return process.env.NEXT_PUBLIC_PIPELINE_NAV === 'true';
}
