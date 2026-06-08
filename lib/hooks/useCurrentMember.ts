'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useOrganization } from '@/components/providers/organization-provider';

export interface CurrentMember {
    userId: string;
    email: string;
    displayName: string;   // full name from metadata, or email prefix
    role: 'owner' | 'admin' | 'member' | 'viewer';
    isOwner: boolean;
    isLoading: boolean;
}

export function useCurrentMember(): CurrentMember {
    const { organization, memberships } = useOrganization();
    const [userId, setUserId] = useState('');
    const [email, setEmail] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const supabase = createClient();
        if (!supabase) { setIsLoading(false); return; }

        supabase.auth.getSession().then((result: { data: { session: any } }) => {
            const session = result.data.session;
            if (!session?.user) { setIsLoading(false); return; }
            const user = session.user;
            setUserId(user.id);
            setEmail(user.email ?? '');
            // Prefer full_name from metadata, fall back to email prefix
            const name =
                user.user_metadata?.full_name ||
                user.user_metadata?.name ||
                (user.email ? user.email.split('@')[0] : 'Team');
            setDisplayName(name);
            setIsLoading(false);
        });
    }, []);

    // Find this user's role in the current org
    const membership = memberships.find(m => m.userId === userId);
    const role = (membership?.role ?? 'member') as CurrentMember['role'];

    return {
        userId,
        email,
        displayName,
        role,
        isOwner: role === 'owner',
        isLoading,
    };
}
