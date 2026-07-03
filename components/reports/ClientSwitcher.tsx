'use client';

// Compact always-visible client/"project" switcher for the Reports section.

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, Check } from 'lucide-react';
import { useActiveClient } from './ActiveClientContext';
import { cn } from '@/lib/utils';

function initials(name: string) {
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export function ClientSwitcher() {
    const { clients, activeClient, setActiveClientId } = useActiveClient();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery(''); }
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    const filtered = clients.filter(c => c.clientName.toLowerCase().includes(query.toLowerCase()));

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen(v => !v)}
                className="flex items-center gap-2.5 bg-card border border-border rounded-lg pl-2 pr-3 py-1.5 hover:border-primary/40 transition-colors min-w-[220px]"
            >
                {activeClient?.logoUrl
                    ? <img src={activeClient.logoUrl} alt="" className="h-6 w-6 rounded-md object-cover shrink-0" />
                    : <div className="h-6 w-6 rounded-md bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                        {activeClient ? initials(activeClient.clientName) : '—'}
                    </div>}
                <span className="text-sm font-medium truncate flex-1 text-left">
                    {activeClient?.clientName ?? 'Select a client'}
                </span>
                <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform', open && 'rotate-180')} />
            </button>

            {open && (
                <div className="absolute z-40 mt-1.5 w-80 bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
                    <div className="relative p-2 border-b border-border">
                        <Search className="absolute left-4 top-4.5 h-3.5 w-3.5 text-muted-foreground" />
                        <input
                            autoFocus
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search clients…"
                            className="w-full text-sm bg-muted/40 rounded-lg pl-8 pr-3 py-2 focus:outline-none"
                        />
                    </div>
                    <div className="max-h-72 overflow-y-auto py-1">
                        {filtered.length === 0 && (
                            <p className="px-4 py-6 text-sm text-muted-foreground text-center">No clients match “{query}”.</p>
                        )}
                        {filtered.map(c => (
                            <button
                                key={c.id}
                                onClick={() => { setActiveClientId(c.id); setOpen(false); setQuery(''); }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted transition-colors text-left"
                            >
                                {c.logoUrl
                                    ? <img src={c.logoUrl} alt="" className="h-6 w-6 rounded-md object-cover shrink-0" />
                                    : <div className="h-6 w-6 rounded-md bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">{initials(c.clientName)}</div>}
                                <span className="text-sm flex-1 truncate">{c.clientName}</span>
                                {activeClient?.id === c.id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
