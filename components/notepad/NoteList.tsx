'use client';

import { useMemo, useState } from 'react';
import { ClipboardList, Plus, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PersonalNote } from '@/lib/types';

interface NoteListProps {
    notes: PersonalNote[];
    isLoading: boolean;
    showArchived: boolean;
    onToggleArchived: () => void;
    onOpenNote: (note: PersonalNote) => void;
    onCreateNote: () => void;
}

function stripHtml(html: string): string {
    if (typeof window === 'undefined') return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function relativeTime(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function NoteList({ notes, isLoading, showArchived, onToggleArchived, onOpenNote, onCreateNote }: NoteListProps) {
    const [searchOpen, setSearchOpen] = useState(false);
    const [search, setSearch] = useState('');

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return notes;
        return notes.filter((n) =>
            n.title.toLowerCase().includes(q) || stripHtml(n.contentHtml).toLowerCase().includes(q),
        );
    }, [notes, search]);

    return (
        <div className="flex h-full flex-col">
            {/* Search / actions row */}
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                {searchOpen ? (
                    <>
                        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <input
                            autoFocus
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search notes…"
                            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                        />
                        <button
                            onClick={() => { setSearchOpen(false); setSearch(''); }}
                            className="rounded-md p-1 text-muted-foreground hover:bg-accent/20"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            onClick={onCreateNote}
                            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                            <Plus className="h-4 w-4" /> New note
                        </button>
                        <button
                            onClick={() => setSearchOpen(true)}
                            className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-accent/20"
                            title="Search notes"
                        >
                            <Search className="h-4 w-4" />
                        </button>
                    </>
                )}
            </div>

            {/* List / states */}
            <div className="min-h-0 flex-1 overflow-y-auto">
                {isLoading ? (
                    <div className="space-y-2 p-3">
                        {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />)}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                        <ClipboardList className="h-12 w-12 text-muted-foreground/40" />
                        <p className="mt-4 text-sm font-semibold text-foreground">
                            {search ? 'No matching notes' : showArchived ? 'No archived notes' : 'Create personal notes'}
                        </p>
                        {!search && !showArchived && (
                            <>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Capture thoughts, call notes, and ideas — only you can see them.
                                </p>
                                <button
                                    onClick={onCreateNote}
                                    className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                                >
                                    Create a note
                                </button>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="p-1.5">
                        {filtered.map((note) => {
                            const snippet = stripHtml(note.contentHtml);
                            return (
                                <button
                                    key={note.id}
                                    onClick={() => onOpenNote(note)}
                                    className="block w-full rounded-lg px-3 py-2.5 text-left hover:bg-accent/20 transition-colors"
                                >
                                    <div className="flex items-baseline justify-between gap-2">
                                        <p className="truncate text-sm font-medium text-foreground">{note.title || 'Untitled'}</p>
                                        <span className="shrink-0 text-[10px] text-muted-foreground">{relativeTime(note.updatedAt)}</span>
                                    </div>
                                    {snippet && <p className="mt-0.5 truncate text-xs text-muted-foreground">{snippet}</p>}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer: archived toggle */}
            <div className="border-t border-border px-3 py-1.5">
                <button
                    onClick={onToggleArchived}
                    className={cn(
                        'text-xs transition-colors',
                        showArchived ? 'font-medium text-primary' : 'text-muted-foreground hover:text-foreground',
                    )}
                >
                    {showArchived ? '← Back to notes' : 'Archived'}
                </button>
            </div>
        </div>
    );
}
