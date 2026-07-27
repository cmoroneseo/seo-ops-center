'use client';

import { useState } from 'react';
import { Users, X } from 'lucide-react';

export interface TeamMember {
    userId: string;
    name: string;
}

interface MeetWithFilterProps {
    members: TeamMember[];
    selectedIds: string[];
    onToggle: (userId: string) => void;
}

export function MeetWithFilter({ members, selectedIds, onToggle }: MeetWithFilterProps) {
    const [query, setQuery] = useState('');

    const matches = query.trim()
        ? members.filter(m => m.name.toLowerCase().includes(query.trim().toLowerCase()))
        : [];

    return (
        <div className="border-b border-border/60 px-3 py-3">
            <div className="mb-2 text-sm font-medium">Meet with</div>

            <div className="relative">
                <Users className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search for people..."
                    className="w-full rounded-md border border-border bg-transparent py-1.5 pl-7 pr-2 text-xs outline-none focus:border-primary"
                />
            </div>

            {matches.length > 0 && (
                <div className="mt-1 space-y-0.5">
                    {matches.map(m => (
                        <button
                            key={m.userId}
                            onClick={() => { onToggle(m.userId); setQuery(''); }}
                            className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted"
                        >
                            {m.name}
                        </button>
                    ))}
                </div>
            )}

            {selectedIds.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                    {selectedIds.map(id => {
                        const member = members.find(m => m.userId === id);
                        return (
                            <button
                                key={id}
                                onClick={() => onToggle(id)}
                                className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
                            >
                                {member?.name ?? 'Teammate'}
                                <X className="h-2.5 w-2.5" />
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
