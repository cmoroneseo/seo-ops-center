'use client';

import { useEffect, useState } from 'react';
import { useOrganization } from '@/components/providers/organization-provider';

/** Null until the allowlist check returns. False hides the nav item. */
export function useAgencyDashboardEnabled(): boolean {
    const { organization } = useOrganization();
    const [enabled, setEnabled] = useState(false);

    useEffect(() => {
        if (!organization?.id) {
            setEnabled(false);
            return;
        }
        let cancelled = false;
        fetch('/api/agency-dashboard/availability', { cache: 'no-store' })
            .then(response => response.ok ? response.json() : { enabled: false })
            .then(body => { if (!cancelled) setEnabled(body?.enabled === true); })
            .catch(() => { if (!cancelled) setEnabled(false); });
        return () => { cancelled = true; };
    }, [organization?.id]);

    return enabled;
}
