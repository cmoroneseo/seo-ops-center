'use client';

import React from 'react';

export function ArchivedClientNotice({ name, onDismiss }: { name: string; onDismiss: () => void }) {
    return (
        <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm">
            <p><span className="font-medium">{name}</span> was archived and removed from the active list.</p>
            <button type="button" onClick={onDismiss} className="shrink-0 text-muted-foreground hover:text-foreground">
                Dismiss
            </button>
        </div>
    );
}
