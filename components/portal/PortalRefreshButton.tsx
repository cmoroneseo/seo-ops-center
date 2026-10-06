'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

export function PortalRefreshButton() {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    return (
        <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => router.refresh())}
            className="portal-button portal-button-secondary"
        >
            <RefreshCw size={14} aria-hidden="true" />
            {pending ? 'Refreshing…' : 'Refresh conversation'}
        </button>
    );
}
