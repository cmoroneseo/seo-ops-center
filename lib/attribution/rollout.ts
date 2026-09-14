const SANDBOX_CANARY_ORG_ID = '06e536b9-beac-49bc-8c96-1df021102590';

export function isAttributionEnabledForOrganization(
    organizationId: string,
    configuredAllowlist = process.env.NEXT_PUBLIC_ATTRIBUTION_ORG_IDS,
): boolean {
    const entries = (configuredAllowlist ?? SANDBOX_CANARY_ORG_ID)
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    return entries.includes('*') || entries.includes(organizationId);
}
