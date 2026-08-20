interface OrganizationInput {
    name: string;
    slug: string;
}

interface OrganizationRecord extends OrganizationInput {
    id: string;
    subscription_status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';
    plan_type: 'starter' | 'pro' | 'agency' | 'enterprise' | null;
    created_at: string;
    [key: string]: unknown;
}

interface OrganizationBootstrapStore {
    createOrganization(input: OrganizationInput): Promise<OrganizationRecord>;
    bootstrapCurrentUserAsOwner(organizationId: string): Promise<void>;
}

export async function createOrganizationWithOwner(
    input: OrganizationInput,
    store: OrganizationBootstrapStore,
) {
    const organization = await store.createOrganization({ name: input.name, slug: input.slug });
    await store.bootstrapCurrentUserAsOwner(organization.id);
    return organization;
}
