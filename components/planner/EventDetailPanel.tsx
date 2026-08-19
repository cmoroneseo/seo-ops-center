'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { X, Trash2, MapPin, Users, Building2, Clock, Check, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlannerEvent, TimeLog } from '@/lib/types';
import { PlannerItem } from '@/lib/planner/items';
import { updatePlannerEvent, deletePlannerEvent } from '@/lib/supabase/planner-events';
import {
    createTimeLog, getTimeLogForPlannerEvent, getClientTimesheetSyncEnabled,
} from '@/lib/supabase/time-logs';
import { localDateForInstant } from '@/lib/planner/local-date';
import { durationMinutes } from '@/lib/planner/layout';
import { TeamMember } from './MeetWithFilter';
import { BasecampProjectPicker, type BasecampProject } from './BasecampProjectPicker';
import { KIND_STYLES } from './EventCard';

interface EventDetailPanelProps {
    item: PlannerItem;
    members: TeamMember[];
    organizationId?: string;
    userId?: string;
    /** Most-recent-first Basecamp projects for internal time. */
    recentProjects?: BasecampProject[];
    onProjectUsed?: (project: BasecampProject) => void;
    onClose: () => void;
    onChanged: () => void;
    onDeleted: () => void;
}

export function EventDetailPanel({
    item, members, organizationId, userId, recentProjects = [], onProjectUsed,
    onClose, onChanged, onDeleted,
}: EventDetailPanelProps) {
    const isEvent = item.source === 'event';
    const event = isEvent ? (item.raw as PlannerEvent) : null;

    const [title, setTitle] = useState(item.title);
    const [description, setDescription] = useState(event?.description ?? '');
    const [loggedLog, setLoggedLog] = useState<TimeLog | null>(null);
    const [isLogging, setIsLogging] = useState(false);
    // Only offer "Send to Basecamp" when this client has timesheet sync on —
    // same gate the timer and Log Hours modal use.
    const [bcAvailable, setBcAvailable] = useState(false);
    const [sendToBasecamp, setSendToBasecamp] = useState(true);
    // Internal time stays in SEO PM unless the person explicitly chooses a
    // Basecamp destination. Recents remain shortcuts, never an implicit sync.
    const [internalProject, setInternalProject] = useState<BasecampProject | undefined>(undefined);

    // Has this block already been turned into time? Keeps the action idempotent.
    const eventId = event?.id;
    useEffect(() => {
        if (!eventId) { setLoggedLog(null); return; }
        let cancelled = false;
        void getTimeLogForPlannerEvent(eventId).then(log => {
            if (!cancelled) setLoggedLog(log);
        });
        return () => { cancelled = true; };
    }, [eventId]);

    useEffect(() => {
        if (!event?.clientId) { setBcAvailable(false); return; }
        let cancelled = false;
        void getClientTimesheetSyncEnabled(event.clientId).then(on => {
            if (!cancelled) setBcAvailable(on);
        });
        return () => { cancelled = true; };
    }, [event?.clientId]);

    const blockMinutes = event ? Math.max(1, durationMinutes(item.startsAt, item.endsAt)) : 0;
    const isPast = new Date(item.endsAt).getTime() <= Date.now();

    /**
     * Turn the block into a time log. A client meeting is tracked but must not
     * eat SEO budget, so anything with a client that is not task work is flagged
     * countsTowardBudget: false.
     */
    const logTime = async () => {
        if (!event || !organizationId || isLogging) return;
        setIsLogging(true);
        const hours = Math.round((blockMinutes / 60) * 100) / 100;
        const res = await createTimeLog({
            organizationId,
            userId,
            clientId: event.clientId,
            plannerEventId: event.id,
            date: localDateForInstant(item.startsAt),
            hours,
            description: event.title,
            billable: Boolean(event.clientId),
            countsTowardBudget: false,
            // Only meaningful for internal work; client logs resolve their own.
            basecampProjectId: !event.clientId && internalProject
                ? Number(internalProject.id)
                : undefined,
        }, {
            // Independent of countsTowardBudget: a meeting is excluded from SEO
            // budget but still belongs on the client's Basecamp timesheet.
            syncToBasecamp: event.clientId
                ? (bcAvailable && sendToBasecamp)
                : Boolean(internalProject),
        });
        setIsLogging(false);
        if (!res.success) {
            console.error('[planner] log time failed:', res.error);
            return;
        }
        setLoggedLog(res.data ?? null);
        if (!event.clientId && internalProject) onProjectUsed?.(internalProject);
        // The Basecamp push is fire-and-forget and takes a few round trips, so
        // poll briefly until it resolves either way. A single delayed read was
        // too early and left a successful sync looking like it never happened.
        const pushed = (event.clientId && bcAvailable && sendToBasecamp)
            || (!event.clientId && Boolean(internalProject));
        if (pushed) void pollForSyncResult(event.id);
    };

    /** Re-read the log until Basecamp reports success or failure, then stop. */
    const pollForSyncResult = async (evId: string) => {
        for (const delay of [1500, 2500, 4000, 6000]) {
            await new Promise(r => setTimeout(r, delay));
            const fresh = await getTimeLogForPlannerEvent(evId);
            if (!fresh) return;
            setLoggedLog(fresh);
            if (fresh.basecampEntryId || fresh.basecampSyncError) return;
        }
    };

    useEffect(() => {
        setTitle(item.title);
        setDescription(item.source === 'event' ? (item.raw as PlannerEvent).description ?? '' : '');
    }, [item]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const save = async () => {
        if (!event) return;
        const trimmed = title.trim();
        if (!trimmed) return;
        if (trimmed === event.title && description === (event.description ?? '')) return;
        const saved = await updatePlannerEvent(event.id, { title: trimmed, description });
        if (saved) onChanged();
    };

    const attendeeNames = (event?.attendeeIds ?? [])
        .map(id => members.find(m => m.userId === id)?.name)
        .filter(Boolean);

    return (
        <aside className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <span className={cn('h-2.5 w-2.5 rounded-full', KIND_STYLES[item.kind].accent)} />
                <span className="text-xs font-medium capitalize text-muted-foreground">{item.kind}</span>
                <button
                    onClick={onClose}
                    aria-label="Close details"
                    className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="space-y-4 px-4 py-4">
                <input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    onBlur={() => void save()}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    readOnly={!isEvent}
                    className="w-full rounded-md bg-transparent text-base font-semibold outline-none focus:bg-muted focus:px-2 focus:py-1"
                />

                <div className="text-xs text-muted-foreground">
                    {format(new Date(item.startsAt), 'EEEE, MMMM d')}
                    <br />
                    {item.allDay
                        ? 'All day'
                        : `${format(new Date(item.startsAt), 'h:mm a')} – ${format(new Date(item.endsAt), 'h:mm a')}`}
                </div>

                {event?.location && (
                    <div className="flex items-center gap-2 text-xs">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        {event.location}
                    </div>
                )}

                {item.clientName && (
                    <div className="flex items-center gap-2 text-xs">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                        {item.clientName}
                    </div>
                )}

                {attendeeNames.length > 0 && (
                    <div className="flex items-start gap-2 text-xs">
                        <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span>{attendeeNames.join(', ')}</span>
                    </div>
                )}

                {isEvent && (
                    <div className="rounded-lg border border-border p-2.5">
                        {loggedLog ? (
                            <div className="space-y-1">
                                <div className="flex items-center gap-2 text-xs text-emerald-500">
                                    <Check className="h-3.5 w-3.5 shrink-0" />
                                    <span>{loggedLog.hours}h logged from this block</span>
                                </div>
                                {loggedLog.basecampSyncError ? (
                                    <div className="flex items-start gap-2 text-[10px] text-destructive">
                                        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                                        <span>Basecamp: {loggedLog.basecampSyncError}</span>
                                    </div>
                                ) : loggedLog.basecampEntryId ? (
                                    <div className="text-[10px] text-muted-foreground">
                                        Synced to the Basecamp timesheet.
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            <>
                                {!event?.clientId && (
                                    <div className="mb-2">
                                        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                            Basecamp project
                                        </div>
                                        <BasecampProjectPicker
                                            key={organizationId ?? 'missing-organization'}
                                            organizationId={organizationId}
                                            value={internalProject}
                                            recents={recentProjects}
                                            onChange={setInternalProject}
                                        />
                                    </div>
                                )}

                                {bcAvailable && (
                                    <button
                                        role="switch"
                                        aria-checked={sendToBasecamp}
                                        onClick={() => setSendToBasecamp(v => !v)}
                                        className="mb-2 flex w-full items-center gap-2 text-left"
                                    >
                                        <span
                                            className={cn(
                                                'relative h-4 w-7 shrink-0 rounded-full transition-colors',
                                                sendToBasecamp ? 'bg-green-500' : 'bg-muted',
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform',
                                                    sendToBasecamp ? 'translate-x-3.5' : 'translate-x-0.5',
                                                )}
                                            />
                                        </span>
                                        <span className="text-[11px]">Send to Basecamp timesheet</span>
                                    </button>
                                )}

                                <button
                                    onClick={() => void logTime()}
                                    disabled={isLogging || !organizationId}
                                    className="flex w-full items-center justify-center gap-2 rounded-md bg-muted px-3 py-1.5 text-xs font-medium hover:bg-muted/70 disabled:opacity-50"
                                >
                                    <Clock className="h-3.5 w-3.5" />
                                    {isLogging
                                        ? 'Logging…'
                                        : !event?.clientId && internalProject
                                            ? `Log ${blockMinutes} min → ${internalProject.name}`
                                            : `Log ${blockMinutes} min`}
                                </button>
                                <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                                    {event?.clientId
                                        ? 'Tracked against the client, but does not count toward their SEO budget.'
                                        : internalProject
                                            ? 'Tracked as internal time and sent to that Basecamp timesheet.'
                                            : 'Tracked as internal time. Choose a project to also send it to Basecamp.'}
                                    {!isPast && ' This block has not finished yet.'}
                                </p>
                            </>
                        )}
                    </div>
                )}

                {isEvent ? (
                    <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        onBlur={() => void save()}
                        placeholder="Add description"
                        rows={5}
                        className="w-full resize-none rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-primary"
                    />
                ) : (
                    <p className="text-xs text-muted-foreground">
                        {item.source === 'task'
                            ? 'This block is a task. Edit it from the Tasks page.'
                            : 'This is a reminder.'}
                    </p>
                )}
            </div>

            {isEvent && event && (
                <button
                    onClick={async () => {
                        if (!confirm('Delete this event?')) return;
                        const ok = await deletePlannerEvent(event.id);
                        if (ok) onDeleted();
                    }}
                    className="mx-4 mb-4 mt-auto flex items-center justify-center gap-2 rounded-md border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                >
                    <Trash2 className="h-3.5 w-3.5" /> Delete event
                </button>
            )}
        </aside>
    );
}
