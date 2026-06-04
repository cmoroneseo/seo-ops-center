'use client';

import { useState, useEffect, useRef } from 'react';
import { Activity, Clock, StickyNote, ChevronDown, ChevronUp, FileText, UserCheck, Plug, Unlink, Settings2, MoreVertical, Printer, Download } from 'lucide-react';
import { ClientProject, TimeLog, ClientNote, ClientAssignment, ClientActivityEvent } from '@/lib/types';
import { getTimeLogs } from '@/lib/supabase/time-logs';
import { getClientNotes } from '@/lib/supabase/client-notes';
import { getClientAssignments } from '@/lib/supabase/client-assignments';
import { getClientActivity } from '@/lib/supabase/client-activity';
import { useOrganization } from '@/components/providers/organization-provider';
import { cn } from '@/lib/utils';

type ActivityType = 'all' | 'hours' | 'notes' | 'assignments' | 'integrations';

type ActivityItem =
    | { type: 'time_log'; data: TimeLog; date: Date }
    | { type: 'note'; data: ClientNote; date: Date }
    | { type: 'assignment'; data: ClientAssignment; date: Date }
    | { type: 'integration_event'; data: ClientActivityEvent; date: Date };

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

const SERVICE_LABELS: Record<string, string> = {
    ga4: 'Google Analytics 4',
    gsc: 'Google Search Console',
    gbp: 'Google Business Profile',
    ahrefs: 'Ahrefs',
};

function IntegrationEventRow({ event }: { event: ClientActivityEvent }) {
    const { eventType, metadata, actorName, occurredAt } = event;
    const service = metadata.service as string;
    const serviceLabel = SERVICE_LABELS[service] ?? service?.toUpperCase();
    const displayName = metadata.display_name as string | undefined;
    const oldDisplayName = metadata.old_display_name as string | undefined;
    const locationAddress = metadata.location_address as string | undefined;

    const isConnect = eventType === 'integration.connected';
    const isDisconnect = eventType === 'integration.disconnected';
    const isReconfig = eventType === 'integration.reconfigured';

    const iconColor = isConnect ? 'text-green-500' : isDisconnect ? 'text-red-400' : 'text-yellow-500';
    const bgColor = isConnect ? 'bg-green-500/10' : isDisconnect ? 'bg-red-400/10' : 'bg-yellow-500/10';
    const Icon = isConnect ? Plug : isDisconnect ? Unlink : Settings2;

    return (
        <div className="flex items-start gap-3 py-3">
            <div className={`w-7 h-7 rounded-full ${bgColor} flex items-center justify-center shrink-0 mt-0.5`}>
                <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm leading-snug">
                    {actorName && <span className="font-semibold">{actorName} </span>}
                    {isConnect && <span className="text-foreground/80">connected </span>}
                    {isDisconnect && <span className="text-foreground/80">disconnected </span>}
                    {isReconfig && <span className="text-foreground/80">changed </span>}
                    <span className={`font-medium ${iconColor}`}>{serviceLabel}</span>
                    <span className="text-muted-foreground text-xs ml-1.5">
                        {new Date(occurredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                </p>
                {displayName && (isConnect || isReconfig) && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {isReconfig && oldDisplayName ? (
                            <><span className="line-through opacity-50">{oldDisplayName}</span> → {displayName}</>
                        ) : (
                            <>{displayName}{locationAddress ? ` · ${locationAddress}` : ''}</>
                        )}
                    </p>
                )}
            </div>
        </div>
    );
}

// ── PDF Export ─────────────────────────────────────────────────────────────

function clientInitials(name: string) {
    return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function buildPrintHTML(client: ClientProject, items: ActivityItem[]): string {
    const initials = clientInitials(client.clientName);
    const now = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const totalHours = items
        .filter((i): i is { type: 'time_log'; data: TimeLog; date: Date } => i.type === 'time_log')
        .reduce((s, i) => s + i.data.hours, 0);

    function fmtDate(d: Date) {
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    const rows = items.map(item => {
        if (item.type === 'time_log') {
            const log = item.data as TimeLog;
            return `<tr><td>${fmtDate(item.date)}</td><td><strong>${log.hours}h logged</strong></td><td>${log.description || 'SEO Work'}</td></tr>`;
        }
        if (item.type === 'note') {
            const note = item.data as ClientNote;
            return `<tr><td>${fmtDate(item.date)}</td><td>Note by ${note.authorName}</td><td>${note.content}</td></tr>`;
        }
        if (item.type === 'assignment') {
            const a = item.data as ClientAssignment;
            return `<tr><td>${fmtDate(item.date)}</td><td>Reassigned</td><td>To ${a.assignedTo}${a.assignedBy ? ` by ${a.assignedBy}` : ''}</td></tr>`;
        }
        if (item.type === 'integration_event') {
            const e = item.data as ClientActivityEvent;
            const svc = ({ ga4: 'Google Analytics 4', gsc: 'Google Search Console', gbp: 'Google Business Profile', ahrefs: 'Ahrefs' } as Record<string, string>)[e.metadata.service as string] ?? String(e.metadata.service);
            return `<tr><td>${fmtDate(item.date)}</td><td>${e.eventType.replace('integration.', '').replace(/^\w/, c => c.toUpperCase())} – ${svc}</td><td>${e.actorName ?? ''}</td></tr>`;
        }
        return '';
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Activity Feed – ${client.clientName}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 40px; color: #111; font-size: 13px; }
  .header { display: flex; align-items: center; gap: 16px; margin-bottom: 32px; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; }
  .logo { width: 52px; height: 52px; border-radius: 50%; background: #6366f1; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; flex-shrink: 0; }
  .client-name { font-size: 22px; font-weight: 700; margin: 0 0 2px; }
  .meta { color: #6b7280; font-size: 12px; margin: 0; }
  .stats { display: flex; gap: 24px; margin-bottom: 24px; }
  .stat { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 18px; }
  .stat-value { font-size: 20px; font-weight: 700; color: #6366f1; }
  .stat-label { font-size: 11px; color: #6b7280; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
  td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  td:first-child { white-space: nowrap; color: #6b7280; font-size: 12px; }
  tr:last-child td { border-bottom: none; }
  @media print { body { margin: 24px; } }
</style></head><body>
<div class="header">
  <div class="logo">${initials}</div>
  <div>
    <p class="client-name">${client.clientName}</p>
    <p class="meta">Activity Report &nbsp;·&nbsp; Generated ${now}</p>
  </div>
</div>
<div class="stats">
  <div class="stat"><div class="stat-value">${totalHours.toFixed(1)}h</div><div class="stat-label">Total Hours Logged</div></div>
  <div class="stat"><div class="stat-value">${items.filter(i => i.type === 'time_log').length}</div><div class="stat-label">Work Sessions</div></div>
  <div class="stat"><div class="stat-value">${items.filter(i => i.type === 'note').length}</div><div class="stat-label">Notes</div></div>
  <div class="stat"><div class="stat-value">${items.length}</div><div class="stat-label">Total Events</div></div>
</div>
<table>
  <thead><tr><th>Date</th><th>Event</th><th>Details</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
}

function downloadPDF(client: ClientProject, items: ActivityItem[]) {
    const html = buildPrintHTML(client, items);
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
}

// ── Three-dot menu ──────────────────────────────────────────────────────────

function FeedMenu({ client, items }: { client: ClientProject; items: ActivityItem[] }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen(v => !v)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Feed options"
            >
                <MoreVertical className="h-4 w-4" />
            </button>
            {open && (
                <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-lg border border-border bg-card shadow-lg py-1">
                    <button
                        onClick={() => { setOpen(false); downloadPDF(client, items); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                    >
                        <Download className="h-3.5 w-3.5 text-muted-foreground" />
                        Download PDF
                    </button>
                    <button
                        onClick={() => { setOpen(false); const html = buildPrintHTML(client, items); const win = window.open('', '_blank'); if (!win) return; win.document.write(html); win.document.close(); win.focus(); setTimeout(() => win.print(), 400); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                    >
                        <Printer className="h-3.5 w-3.5 text-muted-foreground" />
                        Print
                    </button>
                </div>
            )}
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
            getClientActivity(client.id),
        ]).then(([logs, notes, assignments, activityEvents]) => {
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
                ...activityEvents.map(e => ({
                    type: 'integration_event' as const,
                    data: e,
                    date: new Date(e.occurredAt),
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
            if (filter === 'integrations') return i.type === 'integration_event';
            return true;
        });

    const SHOW_LIMIT = 20;
    const visible = showAll ? filtered : filtered.slice(0, SHOW_LIMIT);
    const grouped = groupByDate(visible);

    const hourCount = allItems.filter(i => i.type === 'time_log').length;
    const noteCount = allItems.filter(i => i.type === 'note').length;
    const assignmentCount = allItems.filter(i => i.type === 'assignment').length;
    const integrationCount = allItems.filter(i => i.type === 'integration_event').length;
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
                    <FeedMenu client={client} items={allItems} />
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
                        ...(integrationCount > 0 ? [{ key: 'integrations', label: `Integrations (${integrationCount})` }] : []),
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
                                        ) : item.type === 'assignment' ? (
                                            <AssignmentRow assignment={item.data} />
                                        ) : (
                                            <IntegrationEventRow event={item.data} />
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
