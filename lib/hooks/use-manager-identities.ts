'use client';
import { useEffect, useState } from 'react';
import { getOrganizationMembers } from '../supabase/organizations';
import type { ManagerIdentity } from '../workspace/client-managers';

const EMPTY_MEMBERS: ManagerIdentity[] = [];

export function useManagerIdentities(organizationId?: string) {
    const [loaded, setLoaded] = useState<{organizationId:string; members:ManagerIdentity[]} | null>(null);
    useEffect(() => {
        if (!organizationId) return;
        let cancelled = false;
        getOrganizationMembers(organizationId).then(members => {
            if (!cancelled) setLoaded({organizationId,members:members.map(member=>({id:member.userId,name:member.user.fullName || member.user.email,email:member.user.email}))});
        });
        return () => { cancelled = true; };
    }, [organizationId]);
    return loaded && loaded.organizationId === organizationId ? loaded.members : EMPTY_MEMBERS;
}
