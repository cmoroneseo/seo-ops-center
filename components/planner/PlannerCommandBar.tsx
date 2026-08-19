'use client';

import { useEffect, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { format } from 'date-fns';
import {
    PlannerItem, plannerSourceLabel, plannerTimeLabel,
} from '@/lib/planner/items';
import { TeamMember } from './MeetWithFilter';
import { PlannerView } from './PlannerHeader';
import { usePlannerDialogFocus } from './usePlannerDialogFocus';

interface PlannerCommandBarProps {
    items: PlannerItem[];
    members: TeamMember[];
    onSelectItem: (item: PlannerItem) => void;
    onSelectMember: (userId: string) => void;
    onGoToToday: () => void;
    onViewChange: (view: PlannerView) => void;
}

export function PlannerCommandBar({
    items, members, onSelectItem, onSelectMember, onGoToToday, onViewChange,
}: PlannerCommandBarProps) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    usePlannerDialogFocus(dialogRef, open, () => setOpen(false), {
        trapFocus: true,
        focusOnOpen: false,
        restoreFocusRef: triggerRef,
    });

    // Cmd+/ — Cmd+K and Cmd+Shift+T belong to TopNav.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === '/' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setOpen(o => !o);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    const run = (fn: () => void) => { fn(); setOpen(false); };
    const taskItems = items.filter(item => item.source === 'task');
    const eventItems = items.filter(item => item.source === 'event');
    const reminderItems = items.filter(item => item.source === 'reminder');

    return (
        <>
            <button
                ref={triggerRef}
                onClick={() => setOpen(true)}
                aria-expanded={open}
                aria-controls="planner-command-dialog"
                className={`${open ? 'lg:hidden' : 'lg:flex'} fixed bottom-6 left-1/2 z-40 hidden w-[420px] -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-popover px-4 py-2.5 text-xs text-muted-foreground shadow-lg hover:border-primary/40`}
            >
                <Search className="h-3.5 w-3.5" />
                Search tasks, events, reminders, teammates, commands...
                <kbd className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px]">⌘/</kbd>
            </button>
        {open && (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-32"
            onMouseDown={event => {
                if (event.target === event.currentTarget) setOpen(false);
            }}
        >
            <div
                ref={dialogRef}
                id="planner-command-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Planner search and commands"
                tabIndex={-1}
                className="w-[520px]"
            >
            <Command
                className="overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
                loop
            >
                <div className="flex items-center gap-2 border-b border-border px-3">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <Command.Input
                        autoFocus
                        placeholder="Search tasks, events, reminders, teammates, commands..."
                        className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                    />
                </div>

                <Command.List className="max-h-80 overflow-y-auto p-2">
                    <Command.Empty className="py-6 text-center text-xs text-muted-foreground">
                        No results.
                    </Command.Empty>

                    {taskItems.length > 0 && (
                        <Command.Group
                            heading="Tasks"
                            className="text-[10px] uppercase tracking-wide text-muted-foreground"
                        >
                            {taskItems.slice(0, 30).map(item => (
                                <Command.Item
                                    key={item.id}
                                    value={`${item.title} ${plannerSourceLabel(item)}`}
                                    onSelect={() => run(() => onSelectItem(item))}
                                    className="cursor-pointer rounded px-2 py-1.5 text-sm data-[selected=true]:bg-muted"
                                >
                                    <span className="truncate">{item.title}</span>
                                    <span className="ml-2 text-[10px] text-muted-foreground">
                                        {format(new Date(item.startsAt), 'EEE')} · {plannerTimeLabel(item)}
                                    </span>
                                </Command.Item>
                            ))}
                        </Command.Group>
                    )}

                    {eventItems.length > 0 && (
                        <Command.Group
                            heading="Events"
                            className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground"
                        >
                            {eventItems.slice(0, 30).map(item => (
                                <Command.Item
                                    key={item.id}
                                    value={`${item.title} ${plannerSourceLabel(item)}`}
                                    onSelect={() => run(() => onSelectItem(item))}
                                    className="cursor-pointer rounded px-2 py-1.5 text-sm data-[selected=true]:bg-muted"
                                >
                                    <span className="truncate">{item.title}</span>
                                    <span className="ml-2 text-[10px] text-muted-foreground">
                                        {format(new Date(item.startsAt), 'EEE')} · {plannerTimeLabel(item)}
                                    </span>
                                </Command.Item>
                            ))}
                        </Command.Group>
                    )}

                    {reminderItems.length > 0 && (
                        <Command.Group
                            heading="Reminders"
                            className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground"
                        >
                            {reminderItems.slice(0, 30).map(item => (
                                <Command.Item
                                    key={item.id}
                                    value={`${item.title} ${plannerSourceLabel(item)}`}
                                    onSelect={() => run(() => onSelectItem(item))}
                                    className="cursor-pointer rounded px-2 py-1.5 text-sm data-[selected=true]:bg-muted"
                                >
                                    <span className="truncate">{item.title}</span>
                                    <span className="ml-2 text-[10px] text-muted-foreground">
                                        {format(new Date(item.startsAt), 'EEE')} · {plannerTimeLabel(item)}
                                    </span>
                                </Command.Item>
                            ))}
                        </Command.Group>
                    )}

                    {members.length > 0 && (
                        <Command.Group
                            heading="Teammates"
                            className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground"
                        >
                            {members.map(m => (
                                <Command.Item
                                    key={m.userId}
                                    value={m.name}
                                    onSelect={() => run(() => onSelectMember(m.userId))}
                                    className="cursor-pointer rounded px-2 py-1.5 text-sm data-[selected=true]:bg-muted"
                                >
                                    Filter to {m.name}
                                </Command.Item>
                            ))}
                        </Command.Group>
                    )}

                    <Command.Group
                        heading="Commands"
                        className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground"
                    >
                        <Command.Item
                            onSelect={() => run(onGoToToday)}
                            className="cursor-pointer rounded px-2 py-1.5 text-sm data-[selected=true]:bg-muted"
                        >
                            Go to today
                        </Command.Item>
                        {(['day', 'week', 'month'] as PlannerView[]).map(v => (
                            <Command.Item
                                key={v}
                                onSelect={() => run(() => onViewChange(v))}
                                className="cursor-pointer rounded px-2 py-1.5 text-sm capitalize data-[selected=true]:bg-muted"
                            >
                                Switch to {v} view
                            </Command.Item>
                        ))}
                    </Command.Group>
                </Command.List>
            </Command>
            </div>
        </div>
        )}
        </>
    );
}
