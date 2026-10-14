'use client';

import { googleAccountEmptyHint } from '@/lib/google/account';

/** Shown when a property list is empty so the connected Google account is obvious. */
export function GoogleAccountEmptyHint({ email, onReconnect }: { email?: string; onReconnect?: () => void }) {
    if (!email || !onReconnect) return null;
    const hint = googleAccountEmptyHint(email);
    const action = 'Reconnect with another Google account.';
    const lead = hint.slice(0, hint.length - action.length).trimEnd();
    return (
        <p className="text-center text-sm text-muted-foreground">
            {lead}{' '}
            <button type="button" onClick={onReconnect} className="underline">{action}</button>
        </p>
    );
}
