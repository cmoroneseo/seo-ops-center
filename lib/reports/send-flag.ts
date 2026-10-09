/**
 * Server switch for scheduled client-report email.
 * Unset or any value other than `true` queues nothing and emails nothing.
 * Approve and the October report path keep working while this is off.
 * Separate from NEXT_PUBLIC_SEARCH_REPORTING, which only gates the renderer.
 */
export function reportSendEnabled(): boolean {
    return process.env.REPORT_SEND_ENABLED === 'true';
}
