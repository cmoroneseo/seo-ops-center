'use client';

import { useState, useEffect } from 'react';
import { Activity, Clock, StickyNote, ChevronDown, ChevronUp, FileText, Filter } from 'lucide-react';
import { ClientProject, TimeLog, ClientNote } from '@/lib/types';
import { getTimeLogs } from '@/lib/supabase/time-logs';
import { getClientNotes } from '@/lib/supabase/client-notes';
import { useOrganization } from '@/components/providers/organization-provider';
import { cn } from '@/lib/utils';

type ActivityType = 'all' | 'hours' | 'notes';

type ActivityItem =
    | { type: 'time_log'; data: TimeLog; date: Date }
    | { type: 'note'; data: ClientNote; date: Date };

interface ActivityFeedProps {
    client: ClientProject;
}

function formatDate(date: Date): string {
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'long' });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function groupByDate(items: ActivityItem[]): { label: string; items: ActivityItem[] }[] {
    const groups: Map<string, ActivityItem[]> = new Map();
    for (const item of items) {
        const label = formatDate(item.date);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label)!.push(item);
    }
    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

function TimeLogRow({ log }: { log: TimeLog }) {
    const [expanded, setExpanded] = useState(false);
    const hasDescription = log.description && log.description.trim().length > 0;
    const longDesc = hasDescription && log.description.length > 60;

    return (
        <div className="flex items-start gap-3 py-3">
            <div className="w-7 h-7 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <Clock className="h-3.5 w-3.5 text-blue-500" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                    <p className="text-sm leading-snug">
                        <span className="font-semibold text-blue-500">{log.hours}h</span>
                        <span className="text-foreground/80"> logged</span>
                        <span className="text-muted-foreground text-xs ml-1.5">
                            {new Date(log.date.includes('T') ? log.date : log.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                    </p>
                    {longDesc && (
                        <button
                            onClick={() => setExpanded(!expanded)}
                            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5"
                        >
                            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                    )}
                </div>
                {hasDescription && (
                    <p className={cn(
                        'text-xs text-muted-foreground mt-0.5 leading-relaxed',
                        !expanded && longDesc && 'truncate'
                    )}>
                        {log.description}
                    </p>
                )}
            </div>
        </div>
    );
}

function NoteRow({ note }: { note: ClientNote }) {
    const [expanded, setExpanded] = useState(false);
    const longContent = note.content.length > 80;

    function getInitials(name: string) {
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }

    return (
        <div className="flex items-start gap-3 py-3">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0 mt-0.5">
                {getInitials(note.authorName)}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                    <p className="text-sm leading-snug">
                        <span className="font-semibold">{note.authorName}</span>
                        <span className="text-muted-foreground"> added a note</span>
                        <span className="text-muted-foreground text-xs ml-1.5">
                            {new Date(note.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        </span>
                    </p>
                    {longContent && (
                        <button
                            onClick={() => setExpanded(!expanded)}
                            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5"
                        >
                            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                    )}
                </div>
                <p className={cn(
                    'text-xs text-muted-foreground mt-0.5 leading-relaxed whitespace-pre-wrap',
                    !expanded && longContent && 'line-clamp-2'
                )}>
                    {note.content}
                </p>
            </div>
        </div>
    );
}

export function ActivityFeed({ client }: ActivityFeedProps) {
    const { organization } = useOrganization();
    const [allItems, setAllItems] = useState<ActivityItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<ActivityType>('all');
    const [showAll, setShowAll] = useState(false);

    useEffect(() => {
        if (!organization) return;
        Promise.all([
            getTimeLogs(organization.id, { clientId: client.id }),
            getClientNotes(client.id),
        ]).then(([logs, notes]) => {
            const items: ActivityItem[] = [
                ...logs.map(l => ({
                    type: 'time_log' as const,
                    data: l,
                    date: new Date(l.date.includes('T') ? l.date : l.date + 'T00:00:00'),
                })),
                ...notes.map(n => ({
                    type: 'note' as const,
                    data: n,
                    date: new Date(n.createdAt),
                })),
            ];
            items.sort((a, b) => b.date.getTime() - a.date.getTime());
            setAllItems(items);
            setLoading(false);
        });
    }, [organization?.id, client.id]);

    const filtered = filter === 'all'
        ? allItems
        : allItems.filter(i => (filter === 'hours' ? i.type === 'time_log' : i.type === 'note'));

    const SHOW_LIMIT = 20;
    const visible = showAll ? filtered : filtered.slice(0, SHOW_LIMIT);
    const grouped = groupByDate(visible);

    const hourCount = allItems.filter(i => i.type === 'time_log').length;
    const noteCount = allItems.filter(i => i.type === 'note').length;
    const totalHours = allItems
        .filter((i): i is { type: 'time_log'; data: TimeLog; date: Date } => i.type === 'time_log')
        .reduce((sum, i) => sum + i.data.hours, 0);

    return (
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-border/50 bg-muted/20">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-primary" />
                        <h3 className="text-lg font-semibold">Activity Feed</h3>
                        {allItems.length > 0 && (
                            <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
                                {allItems.length}
                            </span>
                        )}
                    </div>
                </div>

                {/* Stats row */}
                {allItems.length > 0 && (
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                        <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-blue-500" />
                            <span className="font-semibold text-blue-500">{totalHours.toFixed(1)}h</span> total logged
                        </span>
                        <span className="flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            {hourCount} sessions
                        </span>
                        <span className="flex items-center gap-1">
                            <StickyNote className="h-3 w-3 text-primary" />
                            {noteCount} notes
                        </span>
                    </div>
                )}

                {/* Filter tabs */}
                <div className="flex gap-1 bg-background rounded-lg p-1 border border-border w-fit">
                    {(['all', 'hours', 'notes'] as ActivityType[]).map(f => (
                        <button
                            key={f}
                            onClick={() => { setFilter(f); setShowAll(false); }}
                            className={cn(
                                'px-3 py-1 text-xs font-medium rounded-md transition-all capitalize',
                                filter === f
                                    ? 'bg-primary text-primary-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            {f === 'all' ? `All (${allItems.length})` : f === 'hours' ? `Hours (${hourCount})` : `Notes (${noteCount})`}
                        </button>
                    ))}
                </div>
            </div>

            {/* Feed */}
            {loading ? (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">Loading activity...</div>
            ) : filtered.length === 0 ? (
                <div className="px-6 py-10 text-center">
                    <Activity className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No activity yet</p>
                    <p className="text-xs text-muted-foreground/50 mt-1">
                        Log hours or add notes to start tracking
                    </p>
                </div>
            ) : (
                <div className="px-6 pb-4">
                    {grouped.map(group => (
                        <div key={group.label}>
                            {/* Date group header */}
                            <div className="sticky top-0 bg-card/95 backdrop-blur-sm py-2 mt-4 first:mt-3">
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    {group.label}
                                </span>
                            </div>
                            {/* Items in group */}
                            <div className="divide-y divide-border/30">
                                {group.items.map(item => (
                                    <div key={`${item.type}-${item.data.id}`}>
                                        {item.type === 'time_log' ? (
                                            <TimeLogRow log={item.data} />
                                        ) : (
                                            <NoteRow note={item.data} />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}

                    {filtered.length > SHOW_LIMIT && (
                        <button
                            onClick={() => setShowAll(!showAll)}
                            className="mt-4 w-full text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1 py-2 rounded-lg hover:bg-muted/30"
                        >
                            {showAll
                                ? <><ChevronUp className="h-3.5 w-3.5" /> Show less</>
                                : <><ChevronDown className="h-3.5 w-3.5" /> Show {filtered.length - SHOW_LIMIT} more</>
                            }
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
