/**
 * Server switch for the opt-in Monday work digest.
 * Unset or any value other than `true` queues nothing and emails nothing.
 * The per-client weekly_digest setting stays off until staff opt in.
 */
export function weeklyDigestEnabled(): boolean {
    return process.env.WEEKLY_DIGEST_ENABLED === 'true';
}
