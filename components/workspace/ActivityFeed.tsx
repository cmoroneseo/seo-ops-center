'use client';

import { useState, useEffect } from 'react';
import { Activity, Clock, StickyNote, ChevronDown, ChevronUp, FileText, UserCheck } from 'lucide-react';
import { ClientProject, TimeLog, ClientNote, ClientAssignment } from '@/lib/types';
import { getTimeLogs } from '@/lib/supabase/time-logs';
import { getClientNotes } from '@/lib/supabase/client-notes';
import { getClientAssignments } from '@/lib/supabase/client-assignments';
import { useOrganization } from '@/components/providers/organization-provider';
import { cn } from '@/lib/utils';

type ActivityType = 'all' | 'hours' | 'notes' | 'assignments';

type ActivityItem =
    | { type: 'time_log'; data: TimeLog; date: Date }
    | { type: 'note'; data: ClientNote; date: Date }
    | { type: 'assignment'; data: ClientAssignment; date: Date };

interface ActivityFeedProps {
    client: ClientProject;
    refreshKey?: number; // increment to force refresh
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

function AssignmentRow({ assignment }: { assignment: ClientAssignment }) {
    return (
        <div className="flex items-start gap-3 py-3">
            <div className="w-7 h-7 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <UserCheck className="h-3.5 w-3.5 text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm leading-snug">
                    <span className="text-muted-foreground">Reassigned to </span>
                    <span className="font-semibold text-amber-500">{assignment.assignedTo}</span>
                    {assignment.assignedBy && (
                        <span className="text-muted-foreground"> by {assignment.assignedBy}</span>
                    )}
                    <span className="text-muted-foreground text-xs ml-1.5">
                        {new Date(assignment.assignedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                </p>
                {assignment.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed italic">
                        "{assignment.notes}"
                    </p>
                )}
            </div>
        </div>
    );
}

export function ActivityFeed({ client, refreshKey }: ActivityFeedProps) {
    const { organization } = useOrganization();
    const [allItems, setAllItems] = useState<ActivityItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<ActivityType>('all');
    const [showAll, setShowAll] = useState(false);

    useEffect(() => {
        if (!organization) return;
        setLoading(true);
        Promise.all([
            getTimeLogs(organization.id, { clientId: client.id }),
            getClientNotes(client.id),
            getClientAssignments(client.id),
        ]).then(([logs, notes, assignments]) => {
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
                ...assignments.map(a => ({
                    type: 'assignment' as const,
                    data: a,
                    date: new Date(a.assignedAt),
                })),
            ];
            items.sort((a, b) => b.date.getTime() - a.date.getTime());
            setAllItems(items);
            setLoading(false);
        });
    }, [organization?.id, client.id, refreshKey]);

    const filtered = filter === 'all'
        ? allItems
        : allItems.filter(i => {
            if (filter === 'hours') return i.type === 'time_log';
            if (filter === 'notes') return i.type === 'note';
            if (filter === 'assignments') return i.type === 'assignment';
            return true;
        });

    const SHOW_LIMIT = 20;
    const visible = showAll ? filtered : filtered.slice(0, SHOW_LIMIT);
    const grouped = groupByDate(visible);

    const hourCount = allItems.filter(i => i.type === 'time_log').length;
    const noteCount = allItems.filter(i => i.type === 'note').length;
    const assignmentCount = allItems.filter(i => i.type === 'assignment').length;
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
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3 flex-wrap">
                        <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-blue-500" />
                            <span className="font-semibold text-blue-500">{totalHours.toFixed(1)}h</span> total
                        </span>
                        <span className="flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            {hourCount} sessions
                        </span>
                        <span className="flex items-center gap-1">
                            <StickyNote className="h-3 w-3 text-primary" />
                            {noteCount} notes
                        </span>
                        {assignmentCount > 0 && (
                            <span className="flex items-center gap-1">
                                <UserCheck className="h-3 w-3 text-amber-500" />
                                {assignmentCount} reassignment{assignmentCount !== 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                )}

                {/* Filter tabs */}
                <div className="flex gap-1 bg-background rounded-lg p-1 border border-border w-fit flex-wrap">
                    {([
                        { key: 'all', label: `All (${allItems.length})` },
                        { key: 'hours', label: `Hours (${hourCount})` },
                        { key: 'notes', label: `Notes (${noteCount})` },
                        ...(assignmentCount > 0 ? [{ key: 'assignments', label: `Assignments (${assignmentCount})` }] : []),
                    ] as { key: ActivityType; label: string }[]).map(f => (
                        <button
                            key={f.key}
                            onClick={() => { setFilter(f.key); setShowAll(false); }}
                            className={cn(
                                'px-3 py-1 text-xs font-medium rounded-md transition-all capitalize',
                                filter === f.key
                                    ? 'bg-primary text-primary-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            {f.label}
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
                            <div className="sticky top-0 bg-card/95 backdrop-blur-sm py-2 mt-4 first:mt-3">
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    {group.label}
                                </span>
                            </div>
                            <div className="divide-y divide-border/30">
                                {group.items.map(item => (
                                    <div key={`${item.type}-${item.data.id}`}>
                                        {item.type === 'time_log' ? (
                                            <TimeLogRow log={item.data} />
                                        ) : item.type === 'note' ? (
                                            <NoteRow note={item.data} />
                                        ) : (
                                            <AssignmentRow assignment={item.data} />
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
