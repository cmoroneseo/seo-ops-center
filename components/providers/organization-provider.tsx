'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Organization, OrganizationMember } from '@/lib/types'
import { useRouter } from 'next/navigation'

interface OrganizationContextType {
    organization: Organization | null
    memberships: OrganizationMember[]
    isLoading: boolean
    setOrganization: (org: Organization) => void
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined)

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
    const [organization, setOrganization] = useState<Organization | null>(null)
    const [memberships, setMemberships] = useState<OrganizationMember[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const router = useRouter()
    const supabase = createClient()

    // Mock Data for Testing
    const mockOrganization: Organization = {
        id: 'org-1',
        name: 'Demo Agency',
        slug: 'demo-agency',
        subscriptionStatus: 'active',
        planType: 'starter',
        createdAt: new Date().toISOString()
    }

    const mockMember: OrganizationMember = {
        id: 'mem-1',
        organizationId: 'org-1',
        userId: 'user-1',
        role: 'owner',
        createdAt: new Date().toISOString(),
        organization: mockOrganization
    }

    useEffect(() => {
        let isMounted = true;

        const loadOrg = async () => {
            // MOCK MODE: If no supabase client, use mock data
            if (!supabase) {
                console.log('OrganizationProvider: No Supabase client found, using mock data');
                setMemberships([mockMember]);
                setOrganization(mockOrganization);
                setIsLoading(false);
                return;
            }

            try {
                // 1. Get Session instead of User for faster initial check
                const { data: { session } } = await supabase.auth.getSession();
                if (!session?.user) {
                    console.log('OrganizationProvider: No session found');
                    if (isMounted) {
                        setOrganization(null);
                        setMemberships([]);
                        setIsLoading(false);
                    }
                    return;
                }

                console.log('OrganizationProvider: Authenticated user:', session.user.email);

                // 2. Fetch memberships with organization details
                const { data: members, error } = await supabase
                    .from('organization_members')
                    .select(`
                        *,
                        organization:organizations(*)
                    `)
                    .eq('user_id', session.user.id);

                if (error) {
                    console.error('OrganizationProvider: Fetch error:', error);
                    throw error;
                }

                if (isMounted) {
                    if (members && members.length > 0) {
                        const mappedMembers = members.map((m: any) => ({
                            id: m.id,
                            organizationId: m.organization_id,
                            userId: m.user_id,
                            role: m.role,
                            createdAt: m.created_at,
                            organization: m.organization ? {
                                id: m.organization.id,
                                name: m.organization.name,
                                slug: m.organization.slug,
                                stripeCustomerId: m.organization.stripe_customer_id,
                                subscriptionStatus: m.organization.subscription_status,
                                planType: m.organization.plan_type || 'starter',
                                createdAt: m.organization.created_at
                            } : null
                        })).filter((m: any) => m.organization !== null);

                        console.log('OrganizationProvider: Found memberships:', mappedMembers.length);
                        setMemberships(mappedMembers as OrganizationMember[]);

                        if (mappedMembers.length > 0) {
                            const savedOrgId = localStorage.getItem('selectedOrgId');
                            const foundOrg = mappedMembers.find((m: any) => m.organization?.id === savedOrgId);
                            setOrganization(foundOrg?.organization || mappedMembers[0].organization);
                        } else {
                            setOrganization(null);
                        }
                    } else {
                        console.log('OrganizationProvider: Zero memberships found');
                        setOrganization(null);
                        setMemberships([]);
                    }
                }
            } catch (error) {
                console.error('OrganizationProvider: Critical failure:', error);
            } finally {
                if (isMounted) setIsLoading(false);
            }
        };

        loadOrg();
        return () => { isMounted = false; };
    }, [supabase]);

    const handleSetOrganization = (org: Organization) => {
        setOrganization(org)
        localStorage.setItem('selectedOrgId', org.id)
    }

    return (
        <OrganizationContext.Provider value={{
            organization,
            memberships,
            isLoading,
            setOrganization: handleSetOrganization
        }}>
            {children}
        </OrganizationContext.Provider>
    )
}

export function useOrganization() {
    const context = useContext(OrganizationContext)
    if (context === undefined) {
        throw new Error('useOrganization must be used within an OrganizationProvider')
    }
    return context
}
