'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { PlannerEvent, Task, Reminder } from '@/lib/types';
import { listPlannerEvents } from '@/lib/supabase/planner-events';
import { getTasks } from '@/lib/supabase/tasks';
import { listReminders } from '@/lib/supabase/personal-reminders';
import { PlannerItem, eventToItem, taskToItem, reminderToItem } from '@/lib/planner/items';
import { PlannerHeader, PlannerView } from '@/components/planner/PlannerHeader';
import { WeekGrid } from '@/components/planner/WeekGrid';

export default function PlannerPage() {
    const { organization } = useOrganization();
    const { userId } = useCurrentMember();

    const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
    const [view, setView] = useState<PlannerView>('week');
    const [events, setEvents] = useState<PlannerEvent[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [reminders, setReminders] = useState<Reminder[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Visible range. Week view spans Sun-Sat; day view is a single day. Month
    // view widens the range in Task 11.
    const range = useMemo(() => {
        if (view === 'day') {
            const start = new Date(anchorDate);
            start.setHours(0, 0, 0, 0);
            return { start, end: addDays(start, 1) };
        }
        return { start: startOfWeek(anchorDate), end: addDays(endOfWeek(anchorDate), 1) };
    }, [anchorDate, view]);

    const load = useCallback(async () => {
        if (!organization?.id || !userId) return;
        setIsLoading(true);
        const [e, t, r] = await Promise.all([
            listPlannerEvents({
                organizationId: organization.id,
                rangeStart: range.start.toISOString(),
                rangeEnd: range.end.toISOString(),
            }),
            getTasks(organization.id, {}),
            listReminders({ organizationId: organization.id, userId }),
        ]);
        setEvents(e);
        setTasks(t);
        setReminders(r);
        setIsLoading(false);
    }, [organization?.id, userId, range.start, range.end]);

    useEffect(() => { void load(); }, [load]);

    // Everything that belongs on the grid, normalized to one shape.
    const items: PlannerItem[] = useMemo(() => {
        const fromTasks = tasks
            .map(taskToItem)
            .filter((i): i is PlannerItem => i !== null);
        return [
            ...events.map(eventToItem),
            ...fromTasks,
            ...reminders.filter(r => r.status === 'pending').map(reminderToItem),
        ];
    }, [events, tasks, reminders]);

    // Tasks with no startDate are the backlog.
    const backlog = useMemo(
        () => tasks.filter(t => !t.startDate && t.status !== 'done'),
        [tasks],
    );

    const days = useMemo(
        () => (view === 'day'
            ? [range.start]
            : eachDayOfInterval({ start: range.start, end: addDays(range.end, -1) })),
        [range.start, range.end, view],
    );

    const step = view === 'day' ? 1 : 7;
    const handlePrev = () => setAnchorDate(d => addDays(d, -step));
    const handleNext = () => setAnchorDate(d => addDays(d, step));
    const handleToday = () => setAnchorDate(new Date());

    return (
        <div className="flex h-full min-h-0 w-full">
            <div className="flex flex-1 min-w-0 flex-col">
                <PlannerHeader
                    anchorDate={anchorDate}
                    view={view}
                    onPrev={handlePrev}
                    onNext={handleNext}
                    onToday={handleToday}
                    onViewChange={setView}
                />
                <WeekGrid days={days} items={items} />
            </div>
        </div>
    );
}
