'use client';

import { cn } from '@/lib/utils';
import type { VaultEntry } from '@/lib/vault/types';
import { formatVaultDate } from './format';

export function HistoryTimeline({
    history,
    currentId,
    onSelect,
}: {
    history: VaultEntry[];
    currentId: string;
    onSelect: (entryId: string) => void;
}) {
    if (history.length === 0) {
        return <p className="text-sm text-muted-foreground">History —</p>;
    }
    const ordered = [...history].sort((a, b) => b.versionNo - a.versionNo);
    return (
        <ol className="space-y-3">
            {ordered.map(entry => (
                <li key={entry.id}>
                    <button
                        type="button"
                        onClick={() => onSelect(entry.id)}
                        className={cn(
                            'w-full rounded-lg border px-3 py-2 text-left',
                            entry.id === currentId ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
                        )}
                    >
                        <span className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                            <span>Version {entry.versionNo}</span>
                            <span className="capitalize">{entry.status}</span>
                        </span>
                        <span className="mt-1 block text-sm font-medium">{entry.title}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{formatVaultDate(entry.effectiveOn)}</span>
                    </button>
                </li>
            ))}
        </ol>
    );
}
