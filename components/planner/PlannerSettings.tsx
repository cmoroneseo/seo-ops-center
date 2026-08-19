'use client';

import { useEffect, useRef, useState } from 'react';
import { Settings, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlannerPreferences } from '@/lib/planner/preferences';

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

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
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
        </button>
    );
}

const selectCls =
    'rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none focus:border-primary';

export function PlannerSettings({ prefs, onChange }: PlannerSettingsProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const set = <K extends keyof PlannerPreferences>(key: K, value: PlannerPreferences[K]) =>
        onChange({ ...prefs, [key]: value });

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen(o => !o)}
                aria-label="Planner settings"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
                <Settings className="h-4 w-4" />
            </button>

            {open && (
                <div className="absolute right-0 top-9 z-50 w-[300px] rounded-xl border border-border bg-popover p-3 shadow-xl">
                    <div className="mb-1 flex items-center">
                        <span className="text-sm font-semibold">Planner settings</span>
                        <button
                            onClick={() => setOpen(false)}
                            aria-label="Close settings"
                            className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    <div className="divide-y divide-border/60">
                        <Row label="Start week on">
                            <select
                                className={selectCls}
                                value={prefs.weekStartsOn}
                                onChange={e => set('weekStartsOn', Number(e.target.value) === 1 ? 1 : 0)}
                            >
                                <option value={0}>Sunday</option>
                                <option value={1}>Monday</option>
                            </select>
                        </Row>

                        <Row label="Show weekends">
                            <Toggle
                                checked={prefs.showWeekends}
                                onChange={v => set('showWeekends', v)}
                            />
                        </Row>

                        <Row label="Day starts / ends" hint="Hours drawn on the grid">
                            <div className="flex items-center gap-1">
                                <select
                                    className={selectCls}
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
