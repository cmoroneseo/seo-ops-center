'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevronRightSm,
    Plus, TrendingUp, TrendingDown, Minus, Clock, Pencil, Trash2, Check, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MonthlyPlan, WeeklyPlan, ClientProject, TimeLog } from '@/lib/types';
import { getMonthlyPlans, upsertMonthlyPlan } from '@/lib/supabase/monthly-plans';
import { getTimeLogs, createTimeLog, updateTimeLog, deleteTimeLog } from '@/lib/supabase/time-logs';
import { getSeoHoursForMonth } from '@/lib/supabase/change-log';
import { useOrganization } from '@/components/providers/organization-provider';
import { createClient } from '@/lib/supabase/client';

interface MonthlyPlannerCardProps {
    client: ClientProject;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseWeekLabel(label: string, year: number): { start: Date; end: Date } | null {
    const m = label.match(/(\w+)\s+(\d+)[–\-](\w+)\s+(\d+)/);
    if (!m) return null;
    const mo: Record<string, number> = {
        Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
        Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    const sm = mo[m[1]], em = mo[m[3]];
    if (sm === undefined || em === undefined) return null;
    return { start: new Date(year, sm, parseInt(m[2])), end: new Date(year, em, parseInt(m[4])) };
}

function getWeekNumForDate(date: Date, weeks: WeeklyPlan[], month: string): number {
    const year = parseInt(month.split('-')[0]);
    const ranges = weeks.map(w => ({ n: w.weekNumber, range: parseWeekLabel(w.label, year) }));
    const matched = ranges.find(r => r.range && date >= r.range.start && date <= r.range.end);
    if (matched) return matched.n;
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    return Math.ceil((date.getDate() + first.getDay()) / 7);
}

function getPaceStatus(budget: number, logged: number, month: string): 'on-pace' | 'at-risk' | 'underdelivering' | null {
    const now = new Date();
    const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (month !== cur || budget === 0) return null;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const pctMonth = now.getDate() / daysInMonth;
    const pctUsed = logged / budget;
    if (pctUsed > pctMonth + 0.15) return 'at-risk';
    if (pctUsed < pctMonth - 0.2) return 'underdelivering';
    return 'on-pace';
}

function generateDefaultWeeks(month: string): WeeklyPlan[] {
    const [y, m] = month.split('-').map(Number);
    const weeks: WeeklyPlan[] = [];
    let cur = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    let n = 1;
    const fmt = (d: Date) => d.toLocaleString('default', { month: 'short', day: 'numeric' });
    while (cur <= end && n <= 5) {
        const s = new Date(cur), e = new Date(cur);
        while (e.getDay() !== 5 && e < end) e.setDate(e.getDate() + 1);
        if (e > end) e.setTime(end.getTime());
        weeks.push({ weekNumber: n, label: `${fmt(s)}–${fmt(e)}`, planned: 0, logged: 0, variance: 0 });
        n++;
        const next = new Date(e);
        next.setDate(next.getDate() + (e.getDay() === 5 ? 3 : 1));
        if (next.getDay() === 0) next.setDate(next.getDate() + 1);
        cur = next;
    }
    return weeks;
}

function fmtDate(dateStr: string) {
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00');
    return d.toLocaleDateString('default', { month: 'short', day: 'numeric' });
}

// ── Sub-components ─────────────────────────────────────────────────────────

interface WorkEntryRowProps {
    log: TimeLog;
    isImported?: boolean;
    onSave: (id: string, hours: number, description: string) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}

function WorkEntryRow({ log, isImported, onSave, onDelete }: WorkEntryRowProps) {
    const [editing, setEditing] = useState(false);
    const [editHours, setEditHours] = useState(String(log.hours));
    const [editDesc, setEditDesc] = useState(log.description);
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        await onSave(log.id, Number(editHours), editDesc);
        setSaving(false);
        setEditing(false);
    };

    if (editing) {
        return (
            <div className="ml-4 pl-3 border-l border-border/50 py-1.5 space-y-2">
                <div className="flex gap-2">
                    <input
                        type="number" step="0.25" min="0.25" value={editHours}
                        onChange={e => setEditHours(e.target.value)}
                        className="w-16 px-2 py-1 text-xs rounded border border-primary bg-background outline-none"
                    />
                    <input
                        autoFocus
                        type="text" value={editDesc}
                        onChange={e => setEditDesc(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
                        className="flex-1 px-2 py-1 text-xs rounded border border-primary bg-background outline-none"
                    />
                </div>
                <div className="flex gap-1.5">
                    <button onClick={handleSave} disabled={saving}
                        className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                        <Check className="h-3 w-3" />{saving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setEditing(false)}
                        className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-muted hover:bg-muted/70">
                        <X className="h-3 w-3" />Cancel
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="ml-4 pl-3 border-l border-border/50 py-1 flex items-start justify-between group/entry">
            <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(log.date)}</span>
                <span className="text-xs font-semibold whitespace-nowrap">{log.hours}h</span>
                <span className="text-xs text-foreground/70 truncate">{log.description || 'SEO Work'}</span>
                {isImported && (
                    <span className="text-[10px] text-muted-foreground/60 border border-border/40 rounded px-1 whitespace-nowrap">imported</span>
                )}
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover/entry:opacity-100 transition-opacity flex-shrink-0 ml-2">
                <button onClick={() => setEditing(true)}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                    <Pencil className="h-3 w-3" />
                </button>
                <button onClick={() => onDelete(log.id)}
                    className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors">
                    <Trash2 className="h-3 w-3" />
                </button>
            </div>
        </div>
    );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function MonthlyPlannerCard({ client }: MonthlyPlannerCardProps) {
    const { organization } = useOrganization();
    const now = new Date();
    const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    const [plan, setPlan] = useState<MonthlyPlan | null>(null);
    const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
    const [editingWeek, setEditingWeek] = useState<number | null>(null);
    const [editedPlanned, setEditedPlanned] = useState('');

    // Log form
    const [showLogForm, setShowLogForm] = useState(false);
    const [logDate, setLogDate] = useState(now.toISOString().split('T')[0]);
    const [logHours, setLogHours] = useState('');
    const [logDesc, setLogDesc] = useState('');
    const [isLogging, setIsLogging] = useState(false);

    // Month notes
    const [monthNotes, setMonthNotes] = useState('');
    const [notesSaved, setNotesSaved] = useState(false);
    const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Historical-aware hours target for the currently viewed month
    const [effectiveSeoHours, setEffectiveSeoHours] = useState(client.seoHours);

    const load = useCallback(async () => {
        if (!organization) return;
        setIsLoading(true);
        const [plans, logs, historicalHours] = await Promise.all([
            getMonthlyPlans(organization.id, { clientId: client.id, month }),
            getTimeLogs(organization.id, { clientId: client.id, month }),
            getSeoHoursForMonth(organization.id, client.id, month, client.seoHours),
        ]);
        const p = plans[0] ?? null;
        setPlan(p);
        setMonthNotes(p?.notes ?? '');
        setTimeLogs(logs);
        setEffectiveSeoHours(historicalHours);
        setIsLoading(false);
    }, [organization?.id, client.id, month, client.seoHours]);

    useEffect(() => { load(); }, [load]);

    const navMonth = (dir: -1 | 1) => {
        const [y, m] = month.split('-').map(Number);
        const d = new Date(y, m - 1 + dir, 1);
        setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        setExpandedWeeks(new Set());
    };

    // ── Computed ───────────────────────────────────────────────────────────

    const weeks: WeeklyPlan[] = plan?.weeks.length ? plan.weeks : generateDefaultWeeks(month);
    const isHistorical = timeLogs.length === 0 && (plan?.weeks ?? []).some(w => w.logged > 0);

    // Group real time_logs by week number
    const logsByWeek: Record<number, TimeLog[]> = {};
    for (const log of timeLogs) {
        const d = new Date(log.date.includes('T') ? log.date : log.date + 'T00:00:00');
        const wn = getWeekNumForDate(d, weeks, month);
        if (!logsByWeek[wn]) logsByWeek[wn] = [];
        logsByWeek[wn].push(log);
    }

    // Logged hours per week: real logs if exist, else fall back to plan.weeks.logged
    const loggedByWeek: Record<number, number> = isHistorical
        ? Object.fromEntries((plan?.weeks ?? []).map(w => [w.weekNumber, w.logged]))
        : Object.fromEntries(Object.entries(logsByWeek).map(([wn, logs]) => [wn, logs.reduce((s, l) => s + l.hours, 0)]));

    const totalPlanned = weeks.reduce((s, w) => s + w.planned, 0);
    const totalLogged = Object.values(loggedByWeek).reduce((s, h) => s + h, 0);
    const remaining = effectiveSeoHours - totalLogged;
    const pct = effectiveSeoHours > 0 ? Math.min((totalLogged / effectiveSeoHours) * 100, 100) : 0;
    const pace = getPaceStatus(effectiveSeoHours, totalLogged, month);
    const monthLabel = new Date(month + '-15').toLocaleString('default', { month: 'long', year: 'numeric' });

    // Week preview for log form
    const logDateWeek = (() => {
        if (!logDate) return null;
        const d = new Date(logDate + 'T00:00:00');
        const logMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (logMonth !== month) return null;
        const wn = getWeekNumForDate(d, weeks, month);
        const w = weeks.find(w => w.weekNumber === wn);
        return w ? `W${wn} · ${w.label}` : null;
    })();

    // ── Actions ────────────────────────────────────────────────────────────

    const saveWeekPlanned = async (weekNum: number, value: number) => {
        if (!organization) return;
        const updated = weeks.map(w => w.weekNumber === weekNum ? { ...w, planned: value } : w);
        await upsertMonthlyPlan({ organizationId: organization.id, clientId: client.id, month, weeks: updated, notes: plan?.notes });
        await load();
    };

    const handleLogHours = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!organization) return;
        setIsLogging(true);
        const supabase = createClient();
        const userId = supabase ? (await supabase.auth.getUser()).data.user?.id ?? '' : '';
        const result = await createTimeLog({
            organizationId: organization.id, clientId: client.id, userId,
            date: logDate, hours: Number(logHours), description: logDesc || 'SEO Work', billable: true,
        });
        if (result.success) {
            // Auto-expand the week this entry landed in
            const d = new Date(logDate + 'T00:00:00');
            const wn = getWeekNumForDate(d, weeks, month);
            setExpandedWeeks(prev => new Set([...prev, wn]));
        }
        setIsLogging(false);
        setShowLogForm(false);
        setLogHours('');
        setLogDesc('');
        await load();
    };

    const handleUpdateEntry = async (id: string, hours: number, description: string) => {
        await updateTimeLog(id, { hours, description });
        await load();
    };

    const handleDeleteEntry = async (id: string) => {
        await deleteTimeLog(id);
        await load();
    };

    // Convert a historical imported-week into a real time_log entry for editing
    const handleEditImported = async (weekNum: number, hours: number) => {
        if (!organization || hours <= 0) return;
        const supabase = createClient();
        const userId = supabase ? (await supabase.auth.getUser()).data.user?.id ?? '' : '';
        const week = weeks.find(w => w.weekNumber === weekNum);
        // Use Monday of that week as the date
        const year = parseInt(month.split('-')[0]);
        const range = week ? parseWeekLabel(week.label, year) : null;
        const date = range ? range.start.toISOString().split('T')[0] : `${month}-01`;
        await createTimeLog({
            organizationId: organization.id, clientId: client.id, userId,
            date, hours, description: 'Imported from spreadsheet', billable: true,
        });
        // Clear the imported value from plan so real time_log takes over
        const updated = weeks.map(w => w.weekNumber === weekNum ? { ...w, logged: 0 } : w);
        await upsertMonthlyPlan({ organizationId: organization.id, clientId: client.id, month, weeks: updated, notes: plan?.notes });
        setExpandedWeeks(prev => new Set([...prev, weekNum]));
        await load();
    };

    const saveMonthNotes = async (val: string) => {
        if (!organization) return;
        await upsertMonthlyPlan({ organizationId: organization.id, clientId: client.id, month, weeks, notes: val });
        setNotesSaved(true);
        setTimeout(() => setNotesSaved(false), 2000);
    };

    const handleMonthNotesChange = (val: string) => {
        setMonthNotes(val);
        setNotesSaved(false);
        if (notesTimer.current) clearTimeout(notesTimer.current);
    };

    const paceConfig = {
        'at-risk': { label: 'At Risk', cls: 'bg-red-500/10 text-red-500 border-red-500/20' },
        'underdelivering': { label: 'Underdelivering', cls: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' },
        'on-pace': { label: 'On Pace', cls: 'bg-green-500/10 text-green-500 border-green-500/20' },
    };

    // ── Render ─────────────────────────────────────────────────────────────

    return (
        <div className="rounded-xl border border-border/50 bg-card p-4 sm:p-6 space-y-5">

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-primary" />
                        <h3 className="text-lg font-semibold">Monthly Planner</h3>
                    </div>
                    {pace && (
                        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full border', paceConfig[pace].cls)}>
                            {paceConfig[pace].label}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={() => navMonth(-1)} className="p-1.5 hover:bg-muted rounded-md transition-colors">
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-sm font-medium w-36 text-center">{monthLabel}</span>
                    <button onClick={() => navMonth(1)} className="p-1.5 hover:bg-muted rounded-md transition-colors">
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Budget bar */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                        <span className="font-semibold text-foreground">{totalLogged.toFixed(1)}</span> of {effectiveSeoHours}h used
                    </span>
                    <span className={cn('font-medium text-sm', remaining < 0 ? 'text-red-500' : 'text-muted-foreground')}>
                        {remaining >= 0 ? `${remaining.toFixed(1)}h remaining` : `${Math.abs(remaining).toFixed(1)}h over budget`}
                    </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                        className={cn('h-full rounded-full transition-all duration-700',
                            pct >= 100 ? 'bg-red-500' : pct >= 85 ? 'bg-yellow-500' : 'bg-primary')}
                        style={{ width: `${pct}%` }}
                    />
                </div>
            </div>

            {/* Week table */}
            {isLoading ? (
                <div className="py-6 text-center text-sm text-muted-foreground">Loading plan...</div>
            ) : (
                <div className="space-y-0.5">
                    {/* Column headers */}
                    <div className="grid grid-cols-4 gap-2 px-2 sm:px-8 pb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        <span>Week</span>
                        <span className="text-right">Planned</span>
                        <span className="text-right">Logged</span>
                        <span className="text-right">Variance</span>
                    </div>

                    {weeks.map((week) => {
                        const logged = loggedByWeek[week.weekNumber] ?? 0;
                        const variance = week.planned - logged;
                        const isEditingPlanned = editingWeek === week.weekNumber;
                        const isExpanded = expandedWeeks.has(week.weekNumber);
                        const weekLogs = logsByWeek[week.weekNumber] ?? [];
                        const hasContent = weekLogs.length > 0 || (isHistorical && logged > 0);

                        return (
                            <div key={week.weekNumber}>
                                {/* Week row */}
                                <div className="grid grid-cols-4 gap-2 items-center px-2 py-1.5 rounded-lg hover:bg-muted/30 transition-colors group/week">
                                    {/* Expand toggle + label */}
                                    <button
                                        onClick={() => hasContent && setExpandedWeeks(prev => {
                                            const next = new Set(prev);
                                            next.has(week.weekNumber) ? next.delete(week.weekNumber) : next.add(week.weekNumber);
                                            return next;
                                        })}
                                        className={cn('flex items-center gap-1 text-left', hasContent ? 'cursor-pointer' : 'cursor-default')}
                                    >
                                        {hasContent
                                            ? isExpanded
                                                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                                : <ChevronRightSm className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                            : <span className="w-3.5 flex-shrink-0" />
                                        }
                                        <span className="text-sm text-muted-foreground truncate">{week.label}</span>
                                    </button>

                                    {/* Planned — click to edit */}
                                    <div className="text-right">
                                        {isEditingPlanned ? (
                                            <input
                                                autoFocus type="number" step="0.25" min="0"
                                                className="w-16 text-right text-sm bg-background border border-primary rounded px-1 py-0.5 outline-none"
                                                value={editedPlanned}
                                                onChange={e => setEditedPlanned(e.target.value)}
                                                onBlur={() => { setEditingWeek(null); saveWeekPlanned(week.weekNumber, Number(editedPlanned)); }}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') { setEditingWeek(null); saveWeekPlanned(week.weekNumber, Number(editedPlanned)); }
                                                    if (e.key === 'Escape') setEditingWeek(null);
                                                }}
                                            />
                                        ) : (
                                            <button
                                                className="text-sm font-medium hover:text-primary transition-colors"
                                                title="Click to edit planned hours"
                                                onClick={() => { setEditingWeek(week.weekNumber); setEditedPlanned(String(week.planned)); }}
                                            >
                                                {week.planned > 0 ? `${week.planned}h` : <span className="text-muted-foreground/40 text-xs">set</span>}
                                            </button>
                                        )}
                                    </div>

                                    {/* Logged */}
                                    <span className="text-sm text-right">
                                        {logged > 0 ? `${logged.toFixed(1)}h` : <span className="text-muted-foreground">—</span>}
                                    </span>

                                    {/* Variance */}
                                    <div className="flex items-center justify-end gap-0.5">
                                        {week.planned > 0 || logged > 0 ? (
                                            <span className={cn('text-sm font-medium flex items-center gap-0.5',
                                                variance > 0.05 ? 'text-green-500' : variance < -0.05 ? 'text-red-500' : 'text-muted-foreground')}>
                                                {variance > 0.05 ? <TrendingUp className="h-3 w-3" />
                                                    : variance < -0.05 ? <TrendingDown className="h-3 w-3" />
                                                        : <Minus className="h-3 w-3" />}
                                                {Math.abs(variance).toFixed(1)}h
                                            </span>
                                        ) : <span className="text-muted-foreground text-sm">—</span>}
                                    </div>
                                </div>

                                {/* Expanded work log */}
                                {isExpanded && (
                                    <div className="pb-2 space-y-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
                                        {weekLogs.length > 0 ? (
                                            weekLogs.map(log => (
                                                <WorkEntryRow
                                                    key={log.id}
                                                    log={log}
                                                    onSave={handleUpdateEntry}
                                                    onDelete={handleDeleteEntry}
                                                />
                                            ))
                                        ) : isHistorical && logged > 0 ? (
                                            /* Historical imported entry */
                                            <div className="ml-4 pl-3 border-l border-border/50 py-1.5 flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-semibold">{logged}h</span>
                                                    <span className="text-xs text-muted-foreground">Imported from spreadsheet</span>
                                                    <span className="text-[10px] text-muted-foreground/60 border border-border/40 rounded px-1">imported</span>
                                                </div>
                                                <button
                                                    onClick={() => handleEditImported(week.weekNumber, logged)}
                                                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                                                >
                                                    <Pencil className="h-3 w-3" />Convert to editable entry
                                                </button>
                                            </div>
                                        ) : null}

                                        {/* Quick add entry for this week */}
                                        <button
                                            onClick={() => {
                                                const year = parseInt(month.split('-')[0]);
                                                const range = parseWeekLabel(week.label, year);
                                                if (range) setLogDate(range.start.toISOString().split('T')[0]);
                                                setShowLogForm(true);
                                            }}
                                            className="ml-7 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                                        >
                                            <Plus className="h-3 w-3" />Add entry
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* Totals row */}
                    <div className="grid grid-cols-4 gap-2 items-center px-2 sm:px-8 py-2.5 mt-1 border-t border-border/50">
                        <span className="text-sm font-semibold">Total</span>
                        <span className="text-sm font-semibold text-right">{totalPlanned > 0 ? `${totalPlanned}h` : '—'}</span>
                        <span className="text-sm font-semibold text-right">{totalLogged > 0 ? `${totalLogged.toFixed(1)}h` : '—'}</span>
                        <span className={cn('text-sm font-semibold text-right',
                            totalPlanned - totalLogged > 0.05 ? 'text-green-500'
                                : totalPlanned - totalLogged < -0.05 ? 'text-red-500'
                                    : 'text-muted-foreground')}>
                            {totalPlanned > 0 || totalLogged > 0 ? `${Math.abs(totalPlanned - totalLogged).toFixed(1)}h` : '—'}
                        </span>
                    </div>
                </div>
            )}

            {/* Log Hours form */}
            <div className="border-t border-border/50 pt-4">
                {showLogForm ? (
                    <form onSubmit={handleLogHours} className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Date</label>
                                <input
                                    type="date" required value={logDate}
                                    onChange={e => setLogDate(e.target.value)}
                                    className="w-full px-2 py-1.5 text-sm rounded-md bg-background border border-border outline-none focus:ring-1 focus:ring-primary"
                                />
                                {logDateWeek && (
                                    <p className="text-[11px] text-primary mt-1">→ Will count toward {logDateWeek}</p>
                                )}
                            </div>
                            <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Hours</label>
                                <input
                                    type="number" step="0.25" min="0.25" required placeholder="0.00"
                                    value={logHours} onChange={e => setLogHours(e.target.value)}
                                    className="w-full px-2 py-1.5 text-sm rounded-md bg-background border border-border outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground mb-1 block">What did you work on?</label>
                            <input
                                type="text" placeholder="e.g. Blog post, GBP update, technical audit…"
                                value={logDesc} onChange={e => setLogDesc(e.target.value)}
                                className="w-full px-2 py-1.5 text-sm rounded-md bg-background border border-border outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                        <div className="flex gap-2">
                            <button type="submit" disabled={isLogging}
                                className="flex-1 py-1.5 text-sm rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                                {isLogging ? 'Saving…' : 'Log Hours'}
                            </button>
                            <button type="button" onClick={() => setShowLogForm(false)}
                                className="px-4 py-1.5 text-sm rounded-md bg-muted hover:bg-muted/70 transition-colors">
                                Cancel
                            </button>
                        </div>
                    </form>
                ) : (
                    <button onClick={() => setShowLogForm(true)}
                        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                        <Plus className="h-4 w-4" />Log Hours
                    </button>
                )}
            </div>

            {/* Month Notes — short month-level context, distinct from persistent Client Notes */}
            <div className="border-t border-border/50 pt-4 space-y-2">
                <div className="flex items-center justify-between">
                    <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Month Notes
                    </label>
                    {notesSaved && (
                        <span className="flex items-center gap-1 text-xs text-green-500 animate-in fade-in">
                            <Check className="h-3 w-3" />Saved
                        </span>
                    )}
                </div>
                <textarea
                    rows={3}
                    placeholder="e.g. Client paused week 3, Q2 strategy pivot, focus on local pages…"
                    value={monthNotes}
                    onChange={e => handleMonthNotesChange(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveMonthNotes(monthNotes); }}
                    className="w-full px-3 py-2 text-sm rounded-md bg-background border border-border outline-none focus:ring-1 focus:ring-primary resize-none overflow-hidden"
                />
                <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">⌘ + Enter to save</span>
                    <button
                        onClick={() => saveMonthNotes(monthNotes)}
                        className="px-3 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
                    >
                        Save Notes
                    </button>
                </div>
            </div>
        </div>
    );
}
