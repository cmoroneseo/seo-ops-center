'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { authorizedProjectId, authorizedRecentProjects } from '@/lib/basecamp/project-selection';

export interface BasecampProject {
    id: string;
    name: string;
}

interface BasecampProjectPickerProps {
    /** Active organization used to authorize the project catalog request. */
    organizationId?: string;
    /** Currently chosen destination, if any. */
    value?: BasecampProject;
    /** Most-recent-first; pinned above the search results. */
    recents: BasecampProject[];
    onChange: (project: BasecampProject) => void;
}

/**
 * Destination picker for internal time.
 *
 * There are ~100 Basecamp projects, so this is search-first — but the handful
 * you actually log internal time against are pinned, which is the common case.
 * Projects are fetched once, lazily, the first time the picker is opened.
 */
export function BasecampProjectPicker({ organizationId, value, recents, onChange }: BasecampProjectPickerProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [projects, setProjects] = useState<BasecampProject[] | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open || projects || isLoading) return;
        if (!organizationId) {
            setError('Organization context is required to load Basecamp projects.');
            return;
        }
        setIsLoading(true);
        setError(null);
        fetch(`/api/integrations/basecamp/projects?organizationId=${encodeURIComponent(organizationId)}`)
            .then(async r => {
                if (!r.ok) throw new Error('Unable to load Basecamp projects');
                return r.json();
            })
            .then(j => {
                const list = (j.projects ?? j ?? []) as { id: number | string; name: string }[];
                setProjects(
                    Array.isArray(list)
                        ? list.map(p => ({ id: String(p.id), name: String(p.name).trim() }))
                        : [],
                );
            })
            .catch(() => setError('Couldn\'t load Basecamp projects.'))
            .finally(() => setIsLoading(false));
    }, [open, projects, isLoading, organizationId]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return authorizedRecentProjects(projects, recents);
        return (projects ?? []).filter(p => p.name.toLowerCase().includes(q)).slice(0, 8);
    }, [query, projects, recents]);

    const pick = (p: BasecampProject) => {
        const projectId = authorizedProjectId(projects, p.id);
        const authorizedProject = projects?.find(project => project.id === projectId);
        if (!authorizedProject) return;
        onChange(authorizedProject);
        setQuery('');
        setOpen(false);
    };

    const authorizedValue = projects?.find(project => project.id === value?.id);
    const authorizedRecents = authorizedRecentProjects(projects, recents);

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen(o => !o)}
                className="flex w-full items-center gap-1.5 rounded-md border border-border px-2 py-1 text-left text-[11px] hover:border-primary/40"
            >
                <span className={cn('min-w-0 flex-1 truncate', !authorizedValue && 'text-muted-foreground')}>
                    {authorizedValue ? authorizedValue.name : 'Choose a Basecamp project'}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            </button>

            {open && (
                <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-popover/95 shadow-xl backdrop-blur-xl">
                    <div className="flex items-center gap-1.5 border-b border-border/70 px-2">
                        <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <input
                            autoFocus
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search projects…"
                            className="flex-1 bg-transparent py-1.5 text-[11px] outline-none placeholder:text-muted-foreground"
                        />
                    </div>

                    {!query && authorizedRecents.length > 0 && (
                        <div className="px-2 pt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            Recent
                        </div>
                    )}

                    <div className="max-h-52 overflow-y-auto py-1">
                        {isLoading && (
                            <div className="px-2 py-2 text-[11px] text-muted-foreground">Loading projects…</div>
                        )}
                        {error && (
                            <div className="px-2 py-2 text-[11px] text-destructive">
                                {error}
                            </div>
                        )}
                        {!isLoading && !error && results.length === 0 && (
                            <div className="px-2 py-2 text-[11px] text-muted-foreground">
                                {query ? 'No project matches that.' : 'Search to find a project.'}
                            </div>
                        )}
                        {results.map(p => (
                            <button
                                key={p.id}
                                onClick={() => pick(p)}
                                className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] hover:bg-muted"
                            >
                                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                                {value?.id === p.id && (
                                    <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
