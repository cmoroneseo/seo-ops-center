'use client';

import { Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VAULT_TYPE_LABEL, type VaultEntry } from '@/lib/vault/types';
import type { VaultRole } from '@/lib/vault/permissions';
import { vaultEmptyState } from '@/lib/vault/permissions';
import { Button } from '@/components/ui/button';
import { VAULT_TYPE_CLASS, formatVaultDate } from './format';

export function EntryList({
    entries,
    activeIndex,
    onSelect,
    onActive,
    role,
    filtered,
    onCreate,
}: {
    entries: VaultEntry[] | null;
    activeIndex: number;
    onSelect: (entry: VaultEntry) => void;
    onActive: (index: number) => void;
    role: VaultRole;
    filtered: boolean;
    onCreate: () => void;
}) {
    if (entries === null) {
        return (
            <div className="space-y-2" aria-hidden="true">
                {Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className="h-16 animate-pulse rounded-lg border border-border bg-muted/40" />
                ))}
            </div>
        );
    }

    if (entries.length === 0) {
        const empty = vaultEmptyState(role);
        return (
            <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
                <h3 className="text-base font-semibold">{filtered ? 'No entries match' : empty.title}</h3>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                    {filtered ? 'Clear a filter or try a different search.' : empty.body}
                </p>
                {!filtered && empty.action && (
                    <Button type="button" className="mt-5" onClick={onCreate}>{empty.action}</Button>
                )}
            </div>
        );
    }

    return (
        <div role="listbox" aria-label="Vault entries" aria-activedescendant={entries[activeIndex] ? `vault-entry-${entries[activeIndex].id}` : undefined} className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {entries.map((entry, index) => (
                <button
                    id={`vault-entry-${entry.id}`}
                    key={entry.id}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    onClick={() => onSelect(entry)}
                    onFocus={() => onActive(index)}
                    className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left outline-none focus-visible:bg-accent/40',
                        index === activeIndex && 'bg-accent/30',
                    )}
                >
                    <span className={cn('mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', VAULT_TYPE_CLASS[entry.entryType])}>
                        {VAULT_TYPE_LABEL[entry.entryType]}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                            {entry.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-label="Pinned" />}
                            <span className="truncate font-medium">{entry.title}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-sm text-muted-foreground">{entry.body}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatVaultDate(entry.effectiveOn)}</span>
                </button>
            ))}
        </div>
    );
}
