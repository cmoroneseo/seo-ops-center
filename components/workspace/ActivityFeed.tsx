'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { Activity, Clock, StickyNote, ChevronDown, ChevronUp, FileText, UserCheck, Plug, Unlink, Settings2, MoreVertical, Printer, Download, Pencil, RefreshCw, CheckSquare, ClipboardList, Send, Package, Building2, Target, Shield } from 'lucide-react';
// ChevronDown/ChevronUp kept — used in TimeLogRow and NoteRow expand toggles
import { ClientProject, TimeLog, ClientNote, ClientAssignment, ClientActivityEvent } from '@/lib/types';
import { getTimeLogs } from '@/lib/supabase/time-logs';
import { EditTimeLogSheet } from '@/components/timer/EditTimeLogSheet';
import { getClientNotes } from '@/lib/supabase/client-notes';
import { getClientAssignments } from '@/lib/supabase/client-assignments';
import { getClientActivity } from '@/lib/supabase/client-activity';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { useOrganization } from '@/components/providers/organization-provider';
import { cn } from '@/lib/utils';

type ActivityType = 'all' | 'hours' | 'notes' | 'tasks' | 'deliverables' | 'updates' | 'assignments' | 'integrations';

type ActivityItem =
    | { type: 'time_log'; data: TimeLog; date: Date }
    | { type: 'note'; data: ClientNote; date: Date }
    | { type: 'assignment'; data: ClientAssignment; date: Date }
    | { type: 'integration_event'; data: ClientActivityEvent; date: Date };

/** Bucket an activity item into a filter domain based on its event type. */
function domainOf(item: ActivityItem): Exclude<ActivityType, 'all'> {
    if (item.type === 'time_log') return 'hours';
    if (item.type === 'note') return 'notes';
    if (item.type === 'assignment') return 'assignments';
    const t = item.data.eventType;
    if (t.startsWith('task.')) return 'tasks';
    if (t.startsWith('deliverable.')) return 'deliverables';
    if (t.startsWith('client.') || t === 'retainer.amended') return 'updates';
    if (t.startsWith('campaign.')) return 'updates';
    return 'integrations';
}

interface ActivityFeedProps {
    client: ClientProject;
    refreshKey?: number; // increment to force refresh
}

function formatDate(date: Date): string {
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
    const includeYear = date.getFullYear() !== now.getFullYear();
    const dateStr = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        ...(includeYear ? { year: 'numeric' } : {}),
    });
    if (diffDays === 0) return `Today — ${dateStr}`;
    if (diffDays === 1) return `Yesterday — ${dateStr}`;
    return dateStr;
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

function renderNoteText(text: string) {
    const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
    return parts.map((part, i) => {
        const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (match) {
            return <a key={i} href={match[2]} className="text-primary underline underline-offset-2 hover:opacity-80">{match[1]}</a>;
        }
        return <span key={i}>{part}</span>;
    });
}

function TimeLogRow({ log, onEdit, loggerName }: { log: TimeLog; onEdit: (log: TimeLog) => void; loggerName?: string }) {
    const [expanded, setExpanded] = useState(false);
    const [showNotes, setShowNotes] = useState(false);
    const hasDescription = log.description && log.description.trim().length > 0;
    const longDesc = hasDescription && log.description.length > 60;
    const hasNotes = log.sessionNotes && log.sessionNotes.length > 0;

    return (
        <div className="group flex items-start gap-3 py-3">
            <div className="w-7 h-7 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <Clock className="h-3.5 w-3.5 text-blue-500" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                    <p className="text-sm leading-snug">
                        <span className="font-semibold text-blue-500">{log.hours}h</span>
                        <span className="text-foreground/80"> logged</span>
                        {loggerName && <span className="text-foreground/80"> by <span className="font-semibold">{loggerName}</span></span>}
                        <span className="text-muted-foreground text-xs ml-1.5">
                            {new Date(log.date.includes('T') ? log.date : log.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                    </p>
                    <div className="flex items-center gap-1 shrink-0">
                        {longDesc && (
                            <button
                                onClick={() => setExpanded(!expanded)}
                                className="text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                            >
                                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                        )}
                        <button
                            onClick={() => onEdit(log)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground mt-0.5 ml-1"
                            title="Edit entry"
                        >
                            <Pencil className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
                {(hasDescription || log.taskTitle) && (
                    <p className={cn(
                        'text-xs text-muted-foreground mt-0.5 leading-relaxed',
                        !expanded && longDesc && 'truncate'
                    )}>
                        {hasDescription && log.description}
                        {log.taskTitle && (
                            <span className={hasDescription ? 'ml-1.5' : ''}>
                                {hasDescription && '·'} <span className="italic">via "{log.taskTitle}"</span>
                            </span>
                        )}
                    </p>
                )}
                {hasNotes && (
                    <div className="mt-1.5">
                        <button
                            onClick={() => setShowNotes(p => !p)}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <StickyNote className="h-3 w-3" />
                            {log.sessionNotes.length} session note{log.sessionNotes.length !== 1 ? 's' : ''}
                            {showNotes ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                        </button>
                        {showNotes && (
                            <div className="mt-1.5 pl-2 border-l-2 border-primary/20 space-y-1.5">
                                {log.sessionNotes.map(n => (
                                    <div key={n.id}>
                                        <p className="text-xs text-foreground/80 leading-relaxed">{renderNoteText(n.text)}</p>
                                        <span className="text-[10px] text-muted-foreground">
                                            {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
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
    basecamp: 'Basecamp',
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
    const isImport = eventType === 'integration.tasks_imported';
    const importedCount = metadata.imported as number | undefined;

    const iconColor = isConnect ? 'text-green-500' : isDisconnect ? 'text-red-400' : isImport ? 'text-blue-500' : 'text-yellow-500';
    const bgColor = isConnect ? 'bg-green-500/10' : isDisconnect ? 'bg-red-400/10' : isImport ? 'bg-blue-500/10' : 'bg-yellow-500/10';
    const Icon = isConnect ? Plug : isDisconnect ? Unlink : isImport ? Download : Settings2;

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
                    {isImport && (
                        <span className="text-foreground/80">
                            imported {importedCount ?? ''} task{importedCount === 1 ? '' : 's'} from{' '}
                        </span>
                    )}
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

function RetainerAmendedRow({ event }: { event: ClientActivityEvent }) {
    const { metadata, actorName, occurredAt } = event;
    const oldHours = metadata.oldSeoHours as number | undefined;
    const newHours = metadata.newSeoHours as number | undefined;
    const note = metadata.note as string | null | undefined;
    const hoursChanged = oldHours !== undefined && newHours !== undefined && oldHours !== newHours;

    return (
        <div className="flex items-start gap-3 py-3">
            <div className="w-7 h-7 rounded-full bg-violet-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <RefreshCw className="h-3.5 w-3.5 text-violet-500" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm leading-snug">
                    {actorName && <span className="font-semibold">{actorName} </span>}
                    <span className="text-foreground/80">updated retainer</span>
                    {hoursChanged && (
                        <span className="text-muted-foreground"> — SEO hours </span>
                    )}
                    {hoursChanged && (
                        <span className="text-violet-500 font-medium">{oldHours}h → {newHours}h</span>
                    )}
                    <span className="text-muted-foreground text-xs ml-1.5">
                        {new Date(occurredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                </p>
                {note && (
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed italic">"{note}"</p>
                )}
            </div>
        </div>
    );
}

function humanizeStatus(s?: string): string {
    if (!s) return '';
    return s.replace(/_/g, ' ');
}

function TaskEventRow({ event }: { event: ClientActivityEvent }) {
    const { eventType, metadata, actorName, occurredAt } = event;
    const title = metadata.title as string | undefined;
    const category = metadata.category as string | undefined;
    const priority = metadata.priority as string | undefined;
    const status = metadata.status as string | undefined;

    const parentTitle = metadata.parentTitle as string | undefined;

    const isCompleted = eventType === 'task.completed';
    const isAssigned = eventType === 'task.assigned';
    const isStatus = eventType === 'task.status_changed';
    // Real subtask vs. a recurring-task backlink (which reuses the parent's title).
    const isSubtask = eventType === 'task.created' && !!metadata.parentTaskId && parentTitle !== title;

    const accent = isCompleted ? 'text-green-500' : isAssigned ? 'text-amber-500' : 'text-blue-500';
    const bg = isCompleted ? 'bg-green-500/10' : isAssigned ? 'bg-amber-500/10' : 'bg-blue-500/10';
    const Icon = isCompleted ? CheckSquare : isAssigned ? UserCheck : ClipboardList;

    let verb = 'created task ';
    if (isCompleted) verb = 'completed task ';
    else if (isAssigned) verb = 'updated assignees on ';
    else if (isStatus) verb = 'updated task ';
    else if (isSubtask) verb = 'created subtask ';

    return (
        <div className="flex items-start gap-3 py-3">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${bg}`}>
                <Icon className={`h-3.5 w-3.5 ${accent}`} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm leading-snug">
                    {actorName && <span className="font-semibold">{actorName} </span>}
                    <span className="text-foreground/80">{verb}</span>
                    {title && <span className={`font-medium ${accent}`}>"{title}"</span>}
                    {isStatus && status && <span className="text-muted-foreground"> → <span className="capitalize">{humanizeStatus(status)}</span></span>}
                    <span className="text-muted-foreground text-xs ml-1.5">
                        {new Date(occurredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                </p>
                {isSubtask && parentTitle && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                        in <span className="text-foreground/70">"{parentTitle}"</span>
                    </p>
                )}
                {!isSubtask && !isStatus && !isAssigned && (category || priority) && (
                    <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                        {[category, priority ? `${priority} priority` : null].filter(Boolean).join(' · ')}
                    </p>
                )}
            </div>
        </div>
    );
}

function DeliverableEventRow({ event }: { event: ClientActivityEvent }) {
    const { eventType, metadata, actorName, occurredAt } = event;
    const title = metadata.title as string | undefined;
    const fromStatus = metadata.fromStatus as string | undefined;
    const toStatus = metadata.toStatus as string | undefined;

    const isPublished = eventType === 'deliverable.published';
    const isCreated = eventType === 'deliverable.created';

    const accent = isPublished ? 'text-green-500' : isCreated ? 'text-indigo-500' : 'text-amber-500';
    const bg = isPublished ? 'bg-green-500/10' : isCreated ? 'bg-indigo-500/10' : 'bg-amber-500/10';
    const Icon = isPublished ? Send : Package;

    const verb = isPublished ? 'published ' : isCreated ? 'created deliverable ' : 'updated deliverable ';

    return (
        <div className="flex items-start gap-3 py-3">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${bg}`}>
                <Icon className={`h-3.5 w-3.5 ${accent}`} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm leading-snug">
                    {actorName && <span className="font-semibold">{actorName} </span>}
                    <span className="text-foreground/80">{verb}</span>
                    {title && <span className={`font-medium ${accent}`}>"{title}"</span>}
                    <span className="text-muted-foreground text-xs ml-1.5">
                        {new Date(occurredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                </p>
                {!isCreated && !isPublished && fromStatus && toStatus && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                        <span className="line-through opacity-50">{fromStatus}</span> → {toStatus}
                    </p>
                )}
            </div>
        </div>
    );
}

function ClientEventRow({ event }: { event: ClientActivityEvent }) {
    const { eventType, metadata, actorName, occurredAt } = event;
    const isCreated = eventType === 'client.created';
    const isTier = eventType === 'client.tier_changed';

    let detail: ReactNode = null;
    let verb = 'onboarded the client';
    if (eventType === 'client.status_changed') {
        verb = 'changed status';
        detail = <><span className="line-through opacity-50">{String(metadata.fromStatus ?? '')}</span> → {String(metadata.toStatus ?? '')}</>;
    } else if (isTier) {
        verb = 'changed tier';
        detail = <>Tier {String(metadata.fromTier ?? '')} → Tier {String(metadata.toTier ?? '')}</>;
    }

    return (
        <div className="flex items-start gap-3 py-3">
            <div className="w-7 h-7 rounded-full bg-teal-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <Building2 className="h-3.5 w-3.5 text-teal-500" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm leading-snug">
                    {actorName && <span className="font-semibold">{actorName} </span>}
                    <span className="text-foreground/80">{verb}</span>
                    <span className="text-muted-foreground text-xs ml-1.5">
                        {new Date(occurredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                </p>
                {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
            </div>
        </div>
    );
}

function CampaignEventRow({ event }: { event: ClientActivityEvent }) {
    const { eventType, metadata, actorName, occurredAt } = event;

    const CAMPAIGN_VERBS: Record<string, string> = {
        'campaign.created': 'created campaign plan',
        'campaign.submitted_for_review': 'submitted campaign plan for review',
        'campaign.approved': 'approved campaign plan',
        'campaign.phase_status_changed': 'updated campaign phase',
        'campaign.expectation_flagged': 'flagged an expectation at risk',
        'campaign.kpi_rebaselined': 'rebaselined a KPI',
    };

    const verb = CAMPAIGN_VERBS[eventType] ?? 'updated campaign plan';
    const template = metadata.template as string | undefined;
    const phase = metadata.phase as string | undefined;
    const newStatus = metadata.newStatus as string | undefined;

    const isApproved = eventType === 'campaign.approved';
    const isFlagged = eventType === 'campaign.expectation_flagged';

    const accent = isApproved ? 'text-green-500' : isFlagged ? 'text-red-500' : 'text-purple-500';
    const bg = isApproved ? 'bg-green-500/10' : isFlagged ? 'bg-red-500/10' : 'bg-purple-500/10';
    const Icon = isFlagged ? Shield : Target;

    return (
        <div className="flex items-start gap-3 py-3">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${bg}`}>
                <Icon className={`h-3.5 w-3.5 ${accent}`} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm leading-snug">
                    {actorName && <span className="font-semibold">{actorName} </span>}
                    <span className="text-foreground/80">{verb}</span>
                    <span className="text-muted-foreground text-xs ml-1.5">
                        {new Date(occurredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                </p>
                {template && template !== 'blank' && (
                    <p className="text-xs text-muted-foreground mt-0.5">Template: {template.replace(/_/g, ' ')}</p>
                )}
                {phase && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {phase}{newStatus ? ` → ${newStatus.replace(/_/g, ' ')}` : ''}
                    </p>
                )}
            </div>
        </div>
    );
}

/** Dispatch a logged activity event to the right row renderer by domain. */
function EventRow({ event }: { event: ClientActivityEvent }) {
    const t = event.eventType;
    if (t === 'retainer.amended') return <RetainerAmendedRow event={event} />;
    if (t.startsWith('task.')) return <TaskEventRow event={event} />;
    if (t.startsWith('deliverable.')) return <DeliverableEventRow event={event} />;
    if (t.startsWith('client.')) return <ClientEventRow event={event} />;
    if (t.startsWith('campaign.')) return <CampaignEventRow event={event} />;
    return <IntegrationEventRow event={event} />;
}

// ── PDF Export ─────────────────────────────────────────────────────────────

function clientInitials(name: string) {
    return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function buildPrintHTML(client: ClientProject, items: ActivityItem[], memberNames: Record<string, string> = {}): string {
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
            const who = memberNames[log.userId];
            const desc = [log.description || 'SEO Work', log.taskTitle ? `via "${log.taskTitle}"` : ''].filter(Boolean).join(' · ');
            return `<tr><td>${fmtDate(item.date)}</td><td><strong>${log.hours}h logged</strong>${who ? ` by ${who}` : ''}</td><td>${desc}</td></tr>`;
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
            const m = e.metadata;
            // "domain.action" → "Domain action"
            const label = e.eventType.replace(/\./g, ' ').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
            let detail = '';
            if (e.eventType.startsWith('integration.')) {
                detail = ({ ga4: 'Google Analytics 4', gsc: 'Google Search Console', gbp: 'Google Business Profile', ahrefs: 'Ahrefs', basecamp: 'Basecamp' } as Record<string, string>)[m.service as string] ?? String(m.service ?? '');
            } else if (m.title) {
                detail = String(m.title);
            } else if (m.toStatus) {
                detail = `${m.fromStatus ?? ''} → ${m.toStatus}`;
            } else if (m.clientName) {
                detail = String(m.clientName);
            }
            if (e.actorName) detail = detail ? `${detail} · ${e.actorName}` : String(e.actorName);
            return `<tr><td>${fmtDate(item.date)}</td><td>${label}</td><td>${detail}</td></tr>`;
        }
        return '';
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Activity Feed – ${client.clientName}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 40px; color: #111; font-size: 13px; }
  .header { display: flex; align-items: center; gap: 16px; margin-bottom: 32px; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; }
  .logo { width: 52px; height: 52px; border-radius: 50%; background: #6366f1; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; flex-shrink: 0; overflow: hidden; }
  .logo img { width: 52px; height: 52px; object-fit: cover; border-radius: 50%; }
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
  <div class="logo">${client.logoUrl ? `<img src="${client.logoUrl}" alt="${client.clientName}" />` : initials}</div>
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

function downloadPDF(client: ClientProject, items: ActivityItem[], memberNames: Record<string, string> = {}) {
    const html = buildPrintHTML(client, items, memberNames);
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
}

// ── Three-dot menu ──────────────────────────────────────────────────────────

function FeedMenu({ client, items, memberNames }: { client: ClientProject; items: ActivityItem[]; memberNames: Record<string, string> }) {
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
                        onClick={() => { setOpen(false); downloadPDF(client, items, memberNames); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                    >
                        <Download className="h-3.5 w-3.5 text-muted-foreground" />
                        Download PDF
                    </button>
                    <button
                        onClick={() => { setOpen(false); const html = buildPrintHTML(client, items, memberNames); const win = window.open('', '_blank'); if (!win) return; win.document.write(html); win.document.close(); win.focus(); setTimeout(() => win.print(), 400); }}
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
    const [editingLog, setEditingLog] = useState<TimeLog | null>(null);
    const [memberNames, setMemberNames] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!organization) return;
        setLoading(true);
        Promise.all([
            getTimeLogs(organization.id, { clientId: client.id }),
            getClientNotes(client.id),
            getClientAssignments(client.id),
            getClientActivity(client.id),
            getOrganizationMembers(organization.id),
        ]).then(([logs, notes, assignments, activityEvents, members]) => {
            setMemberNames(
                Object.fromEntries(
                    members.map(m => [m.userId, m.user.fullName || m.user.email || 'Unknown']),
                ),
            );
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
        : allItems.filter(i => domainOf(i) === filter);

    const grouped = groupByDate(filtered);

    const counts = allItems.reduce((acc, i) => {
        const d = domainOf(i);
        acc[d] = (acc[d] ?? 0) + 1;
        return acc;
    }, {} as Record<string, number>);
    const hourCount = counts.hours ?? 0;
    const noteCount = counts.notes ?? 0;
    const assignmentCount = counts.assignments ?? 0;
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
                    <FeedMenu client={client} items={allItems} memberNames={memberNames} />
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
                        ...(counts.tasks ? [{ key: 'tasks', label: `Tasks (${counts.tasks})` }] : []),
                        ...(counts.deliverables ? [{ key: 'deliverables', label: `Deliverables (${counts.deliverables})` }] : []),
                        ...(counts.updates ? [{ key: 'updates', label: `Updates (${counts.updates})` }] : []),
                        ...(assignmentCount > 0 ? [{ key: 'assignments', label: `Assignments (${assignmentCount})` }] : []),
                        ...(counts.integrations ? [{ key: 'integrations', label: `Integrations (${counts.integrations})` }] : []),
                    ] as { key: ActivityType; label: string }[]).map(f => (
                        <button
                            key={f.key}
                            onClick={() => setFilter(f.key)}
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
                <div className="overflow-y-auto max-h-[520px] px-6 pb-4 scroll-smooth">
                    {grouped.map(group => (
                        <div key={group.label}>
                            <div className="sticky top-0 bg-card/95 backdrop-blur-sm py-2 mt-4 first:mt-3 z-10">
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    {group.label}
                                </span>
                            </div>
                            <div className="divide-y divide-border/30">
                                {group.items.map(item => (
                                    <div key={`${item.type}-${item.data.id}`}>
                                        {item.type === 'time_log' ? (
                                            <TimeLogRow log={item.data} onEdit={setEditingLog} loggerName={memberNames[item.data.userId]} />
                                        ) : item.type === 'note' ? (
                                            <NoteRow note={item.data} />
                                        ) : item.type === 'assignment' ? (
                                            <AssignmentRow assignment={item.data} />
                                        ) : (
                                            <EventRow event={item.data} />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {editingLog && (
                <EditTimeLogSheet
                    log={editingLog}
                    onClose={() => setEditingLog(null)}
                    onSaved={updated => {
                        setAllItems(prev => prev.map(item =>
                            item.type === 'time_log' && item.data.id === updated.id
                                ? { ...item, data: updated }
                                : item
                        ));
                        setEditingLog(null);
                    }}
                />
            )}
        </div>
    );
}
