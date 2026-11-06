'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ALL_CLIENTS_HREF, clientInitials } from '@/lib/nav/staff-shell';

export interface SwitcherClient {
    id: string;
    name: string;
    chip: string;
    logoUrl?: string;
}

function ClientMark({ client, className }: { client: Pick<SwitcherClient, 'name' | 'logoUrl'>; className?: string }) {
    if (client.logoUrl) {
        return (
            <span
                aria-hidden
                className={cn('h-8 w-8 shrink-0 rounded-lg bg-cover bg-center', className)}
                style={{ backgroundImage: `url(${JSON.stringify(client.logoUrl)})` }}
            />
        );
    }
    return (
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-[11px] font-semibold text-primary', className)}>
            {clientInitials(client.name)}
        </span>
    );
}

export function ClientSwitcherPanel({
    clients,
    selectedId,
    recentIds,
    hrefFor,
    onClear,
    onNavigate,
}: {
    clients: SwitcherClient[];
    selectedId: string | null;
    recentIds: string[];
    hrefFor: (clientId: string) => string;
    onClear: () => void;
    onNavigate?: () => void;
}) {
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const byId = useMemo(() => new Map(clients.map(client => [client.id, client])), [clients]);
    const trimmed = query.trim().toLowerCase();
    const matches = trimmed
        ? clients.filter(client => client.name.toLowerCase().includes(trimmed))
        : recentIds.map(id => byId.get(id)).filter((client): client is SwitcherClient => Boolean(client));
    const visible = trimmed ? matches : matches.slice(0, 5);
    const heading = trimmed ? 'Results' : 'Recent';

    return (
        <div className="flex flex-col">
            <div className="p-2">
                <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder="Search clients..."
                        aria-label="Search clients"
                        className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    />
                </div>
            </div>
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {heading}
            </div>
            <div className="max-h-64 overflow-y-auto px-1 pb-1">
                {visible.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-muted-foreground">
                        {trimmed ? 'No matches' : 'No recent clients'}
                    </p>
                ) : visible.map(client => {
                    const selected = client.id === selectedId;
                    return (
                        <Link
                            key={client.id}
                            href={hrefFor(client.id)}
                            title={client.name}
                            onClick={onNavigate}
                            className={cn(
                                'flex min-h-10 items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm',
                                selected ? 'bg-primary/15 text-primary' : 'hover:bg-muted',
                            )}
                        >
                            <ClientMark client={client} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium" title={client.name}>{client.name}</span>
                                <span className="block truncate text-[11px] text-muted-foreground">{client.chip}</span>
                            </span>
                            {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
                        </Link>
                    );
                })}
            </div>
            <div className="border-t border-border p-1">
                <Link
                    href={ALL_CLIENTS_HREF}
                    onClick={onNavigate}
                    className="flex h-10 items-center rounded-lg px-3 text-sm font-medium text-primary hover:bg-muted"
                >
                    View all clients
                </Link>
                <button
                    type="button"
                    onClick={() => {
                        onClear();
                        onNavigate?.();
                    }}
                    className="flex h-10 w-full items-center rounded-lg px-3 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                    No client · Agency home
                </button>
            </div>
        </div>
    );
}

export function ClientSwitcher({
    clients,
    selectedId,
    recentIds,
    hrefFor,
    onClear,
    open,
    onOpenChange,
}: {
    clients: SwitcherClient[];
    selectedId: string | null;
    recentIds: string[];
    hrefFor: (clientId: string) => string;
    onClear: () => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const selected = clients.find(client => client.id === selectedId) ?? null;
    const name = selected?.name ?? (selectedId ? 'Unknown client' : 'No client');
    const chip = selected?.chip ?? (selectedId ? 'Not in this list' : 'Agency home');

    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onOpenChange(false);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', close);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, onOpenChange]);

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                title={name}
                onClick={() => onOpenChange(!open)}
                className={cn(
                    'flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/50 text-left transition-colors hover:bg-sidebar-accent',
                    'h-10 justify-center px-0 xl:h-auto xl:justify-start xl:px-2 xl:py-2',
                )}
            >
                {selected ? (
                    <ClientMark client={selected} />
                ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[11px] font-semibold text-muted-foreground">
                        {selectedId ? '?' : '—'}
                    </span>
                )}
                <span className="hidden min-w-0 flex-1 xl:block">
                    <span className="block truncate text-sm font-medium text-sidebar-foreground" title={name}>
                        {name}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                        {chip}
                    </span>
                </span>
                <ChevronsUpDown className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground xl:block" />
            </button>
            {open && (
                <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg xl:left-0 xl:right-0 xl:w-auto">
                    <ClientSwitcherPanel
                        clients={clients}
                        selectedId={selectedId}
                        recentIds={recentIds}
                        hrefFor={hrefFor}
                        onClear={onClear}
                        onNavigate={() => onOpenChange(false)}
                    />
                </div>
            )}
        </div>
    );
}
