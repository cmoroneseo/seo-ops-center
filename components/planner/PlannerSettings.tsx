'use client';

import { useEffect, useRef, useState } from 'react';
import { Settings, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlannerPreferences } from '@/lib/planner/preferences';
import { usePlannerDialogFocus } from './usePlannerDialogFocus';

interface PlannerSettingsProps {
    prefs: PlannerPreferences;
    onChange: (next: PlannerPreferences) => void;
}

function hourLabel(hour: number): string {
    if (hour === 0 || hour === 24) return '12 am';
    if (hour === 12) return '12 pm';
    return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

const HOURS = Array.from({ length: 25 }, (_, i) => i);

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
                <div className="text-xs font-medium">{label}</div>
                {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}

function Toggle({
    id, label, checked, onChange,
}: {
    id: string;
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <button
            id={id}
            type="button"
            role="switch"
            aria-label={label}
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className="flex h-11 w-11 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
            <span
                className={cn(
                    'relative h-5 w-9 rounded-full transition-colors',
                    checked ? 'bg-primary' : 'bg-muted-foreground/30',
                )}
            >
                <span
                    className={cn(
                        'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                        checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
                    )}
                />
            </span>
        </button>
    );
}

const selectCls =
    'min-h-11 rounded-md border border-border bg-transparent px-2 text-xs outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary';

export function PlannerSettings({ prefs, onChange }: PlannerSettingsProps) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    usePlannerDialogFocus(dialogRef, open, () => setOpen(false));

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => {
            document.removeEventListener('mousedown', onDown);
        };
    }, [open]);

    const set = <K extends keyof PlannerPreferences>(key: K, value: PlannerPreferences[K]) =>
        onChange({ ...prefs, [key]: value });

    return (
        <div className="relative" ref={rootRef}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-label="Planner settings"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls="planner-settings-dialog"
                className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
                <Settings className="h-4 w-4" />
            </button>

            {open && (
                <div
                    ref={dialogRef}
                    id="planner-settings-dialog"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="planner-settings-title"
                    tabIndex={-1}
                    className="fixed inset-x-3 top-32 z-[70] max-h-[calc(100dvh-8.75rem)] w-auto overflow-y-auto rounded-xl border border-border bg-popover p-3 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:max-h-[calc(100dvh-5rem)] sm:w-[300px]"
                >
                    <div className="mb-1 flex items-center">
                        <span id="planner-settings-title" className="text-sm font-semibold">Planner settings</span>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            aria-label="Close settings"
                            className="ml-auto flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    <div className="divide-y divide-border/60">
                        <Row label="Start week on">
                            <select
                                className={selectCls}
                                aria-label="Start week on"
                                value={prefs.weekStartsOn}
                                onChange={e => set('weekStartsOn', Number(e.target.value) === 1 ? 1 : 0)}
                            >
                                <option value={0}>Sunday</option>
                                <option value={1}>Monday</option>
                            </select>
                        </Row>

                        <Row label="Show weekends">
                            <Toggle
                                id="planner-show-weekends"
                                label="Show weekends"
                                checked={prefs.showWeekends}
                                onChange={v => set('showWeekends', v)}
                            />
                        </Row>

                        <Row label="Day starts / ends" hint="Hours drawn on the grid">
                            <div className="flex items-center gap-1">
                                <select
                                    className={selectCls}
                                    aria-label="Day starts at"
                                    value={prefs.dayStartHour}
                                    onChange={e => set('dayStartHour', Number(e.target.value))}
                                >
                                    {HOURS.slice(0, 24).map(h => (
                                        <option key={h} value={h}>{hourLabel(h)}</option>
                                    ))}
                                </select>
                                <span className="text-[10px] text-muted-foreground">–</span>
                                <select
                                    className={selectCls}
                                    aria-label="Day ends at"
                                    value={prefs.dayEndHour}
                                    onChange={e => set('dayEndHour', Number(e.target.value))}
                                >
                                    {HOURS.filter(h => h > prefs.dayStartHour).map(h => (
                                        <option key={h} value={h}>{hourLabel(h)}</option>
                                    ))}
                                </select>
                            </div>
                        </Row>

                        <Row label="Working hours" hint="Outside these is shaded">
                            <div className="flex items-center gap-1">
                                <select
                                    className={selectCls}
                                    aria-label="Working hours start at"
                                    value={prefs.workDayStartHour}
                                    onChange={e => set('workDayStartHour', Number(e.target.value))}
                                >
                                    {HOURS.slice(0, 24).map(h => (
                                        <option key={h} value={h}>{hourLabel(h)}</option>
                                    ))}
                                </select>
                                <span className="text-[10px] text-muted-foreground">–</span>
                                <select
                                    className={selectCls}
                                    aria-label="Working hours end at"
                                    value={prefs.workDayEndHour}
                                    onChange={e => set('workDayEndHour', Number(e.target.value))}
                                >
                                    {HOURS.filter(h => h > prefs.workDayStartHour).map(h => (
                                        <option key={h} value={h}>{hourLabel(h)}</option>
                                    ))}
                                </select>
                            </div>
                        </Row>

                        <Row
                            label="Roll overdue into today"
                            hint="Show overdue tasks in today's column"
                        >
                            <Toggle
                                id="planner-roll-overdue"
                                label="Roll overdue into today"
                                checked={prefs.rollOverdueIntoToday}
                                onChange={v => set('rollOverdueIntoToday', v)}
                            />
                        </Row>
                    </div>
                </div>
            )}
        </div>
    );
}
