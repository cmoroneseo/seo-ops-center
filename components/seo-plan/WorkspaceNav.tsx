'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const PRIMARY = [
    ['overview', 'Overview'],
    ['campaign', 'Plan'],
    ['tasks', 'Tasks'],
    ['insights', 'Search'],
] as const;

const MORE = [
    ['inventory', 'Site Inventory'],
    ['topical-map', 'Topical Map'],
    ['approvals', 'Approvals'],
    ['portal', 'Portal management'],
    ['integrations', 'Integrations'],
] as const;

const MORE_IDS = new Set<string>([...MORE.map(([id]) => id), 'vault']);

export function WorkspaceNav({
    active,
    vault,
    onSelect,
}: {
    active: string;
    vault: boolean;
    onSelect: (tab: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const moreActive = MORE_IDS.has(active);

    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    return (
        <div className="flex items-center gap-1 overflow-x-auto border-b border-border/50" role="tablist" aria-label="Client">
            {PRIMARY.map(([id, label]) => (
                <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active === id}
                    onClick={() => onSelect(id)}
                    className={cn(
                        'shrink-0 whitespace-nowrap border-b-2 -mb-px px-4 py-2 text-sm font-medium transition-colors',
                        active === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                >
                    {label}
                </button>
            ))}
            <div className="relative shrink-0" ref={menuRef}>
                <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    onClick={() => setOpen(value => !value)}
                    className={cn(
                        'flex items-center gap-1 whitespace-nowrap border-b-2 -mb-px px-4 py-2 text-sm font-medium transition-colors',
                        moreActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                >
                    More
                    <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {open && (
                    <div role="menu" className="absolute right-0 z-20 mt-1 min-w-52 rounded-lg border border-border bg-card p-1 shadow-lg">
                        {MORE.map(([id, label]) => (
                            <button
                                key={id}
                                type="button"
                                role="menuitem"
                                onClick={() => { setOpen(false); onSelect(id); }}
                                className={cn('block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted', active === id && 'bg-muted')}
                            >
                                {label}
                            </button>
                        ))}
                        {vault && (
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => { setOpen(false); onSelect('vault'); }}
                                className={cn('block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted', active === 'vault' && 'bg-muted')}
                            >
                                Vault
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
