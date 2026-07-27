'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { X, Trash2, MapPin, Users, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlannerEvent } from '@/lib/types';
import { PlannerItem } from '@/lib/planner/items';
import { updatePlannerEvent, deletePlannerEvent } from '@/lib/supabase/planner-events';
import { TeamMember } from './MeetWithFilter';
import { KIND_STYLES } from './EventCard';

interface EventDetailPanelProps {
    item: PlannerItem;
    members: TeamMember[];
    onClose: () => void;
    onChanged: () => void;
    onDeleted: () => void;
}

export function EventDetailPanel({ item, members, onClose, onChanged, onDeleted }: EventDetailPanelProps) {
    const isEvent = item.source === 'event';
    const event = isEvent ? (item.raw as PlannerEvent) : null;

    const [title, setTitle] = useState(item.title);
    const [description, setDescription] = useState(event?.description ?? '');

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
