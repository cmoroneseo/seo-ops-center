'use client';

import { ClientProject } from '@/lib/types';
import { X, Clock, Calendar, FileText, CheckCircle2 } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { createTimeLog, getClientTimesheetSyncEnabled } from '@/lib/supabase/time-logs';
import { basecampSyncNotice } from '@/lib/basecamp/sync-notice';
import { createClient } from '@/lib/supabase/client';
import { localTimeZone, workedWindowForEdit } from '@/lib/timer/manual-segment';
import { basecampSendHint, manualTimeDefaults, manualTimeWrite } from '@/lib/timer/manual-entry';
import { ReviewToggle } from '@/components/timer/ReviewToggle';

interface TimeLogModalProps {
    isOpen: boolean;
    onClose: () => void;
    clients: ClientProject[];
    initialClientId?: string;
    organizationId?: string;
    /** Tests pass a recorder. The modal otherwise writes the time log itself. */
    saveTimeLog?: typeof createTimeLog;
}

export function TimeLogModal({ isOpen, onClose, clients, initialClientId, organizationId, saveTimeLog = createTimeLog }: TimeLogModalProps) {
    const [selectedClientId, setSelectedClientId] = useState(initialClientId || '');
    const [selectedTaskId, setSelectedTaskId] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [startTime, setStartTime] = useState('');
    const [finishTime, setFinishTime] = useState('');
    const [hours, setHours] = useState('');
    const [description, setDescription] = useState('');
    const [formError, setFormError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const [bcAvailable, setBcAvailable] = useState(false);
    const [checkingBasecamp, setCheckingBasecamp] = useState(false);
    const [sendOverride, setSendOverride] = useState<boolean | undefined>(undefined);
    const [billable, setBillable] = useState(true);
    const [countsTowardBudget, setCountsTowardBudget] = useState(true);
    const basecampCheck = useRef<Promise<boolean>>(Promise.resolve(false));

    useEffect(() => {
        if (isOpen) {
            setSelectedClientId(initialClientId || '');
            setSelectedTaskId('');
            setStartTime('');
            setFinishTime('');
            setHours('');
            setDescription('');
            setFormError('');
            setShowSuccess(false);
            setSendOverride(undefined);
            const defaults = manualTimeDefaults();
            setBillable(defaults.billable);
            setCountsTowardBudget(defaults.countsTowardBudget);
        }
    }, [isOpen, initialClientId]);

    // Only offer "Send to Basecamp" when the selected client has timesheet sync enabled.
    // The ref is what submit awaits, so a fast save still uses this client's default.
    useEffect(() => {
        if (!selectedClientId) {
            basecampCheck.current = Promise.resolve(false);
            setBcAvailable(false);
            setCheckingBasecamp(false);
            return;
        }
        let active = true;
        setBcAvailable(false);
        setCheckingBasecamp(true);
        const pending = getClientTimesheetSyncEnabled(selectedClientId);
        basecampCheck.current = pending;
        pending.then(enabled => {
            if (!active) return;
            setBcAvailable(enabled);
            setCheckingBasecamp(false);
        });
        return () => { active = false; };
    }, [selectedClientId]);

    const entry = manualTimeWrite({
        billable,
        countsTowardBudget,
        sendOverride,
    }, { clientId: selectedClientId, basecampEligible: bcAvailable });
    const placement = workedWindowForEdit({
        segmentCount: 0,
        date,
        startTime,
        finishTime,
        timeZone: localTimeZone(),
    });
    const hoursLocked = Boolean(placement.window);
    const hoursValue = placement.window ? String(placement.window.hours) : hours;

    const selectedClient = clients.find(c => c.id === selectedClientId);
    const clientTasks = selectedClient?.tasks || [];

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        let userId: string | undefined;
        const supabase = createClient();
        if (supabase) {
            const { data } = await supabase.auth.getSession();
            userId = data.session?.user?.id;
        }

        if (placement.error) {
            setFormError(placement.error);
            setIsSubmitting(false);
            return;
        }
        const loggedHours = placement.window?.hours ?? parseFloat(hoursValue);
        if (!(loggedHours > 0)) {
            setFormError('Enter the hours you worked.');
            setIsSubmitting(false);
            return;
        }

        const clientEligible = await basecampCheck.current;
        const saved = manualTimeWrite({
            billable,
            countsTowardBudget,
            sendOverride,
        }, { clientId: selectedClientId, basecampEligible: clientEligible });
        const result = await saveTimeLog({
            organizationId: organizationId ?? 'org-1',
            clientId: selectedClientId,
            taskId: selectedTaskId || undefined,
            userId: userId ?? 'mock-user-1',
            date,
            hours: loggedHours,
            description,
            billable: saved.billable,
            countsTowardBudget: saved.countsTowardBudget,
        }, {
            syncToBasecamp: saved.syncToBasecamp,
            waitForBasecampSync: saved.syncToBasecamp,
            workedWindow: placement.window,
        });

        setIsSubmitting(false);
        if (!result.success) {
            setFormError(result.error || 'Could not save this entry.');
            return;
        }
        const syncNotice = basecampSyncNotice(result.basecampSync);
        if (result.segmentWarning) setFormError(result.segmentWarning);
        else if (syncNotice) setFormError(syncNotice);
        setShowSuccess(true);

        if (!result.segmentWarning && !syncNotice) {
            setTimeout(() => {
                onClose();
            }, 1500);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-4 border-b border-border/50 bg-muted/30">
                    <h3 className="font-semibold flex items-center gap-2">
                        <Clock className="h-4 w-4 text-primary" />
                        Log Time
                    </h3>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {showSuccess ? (
                    <div className="p-8 flex flex-col items-center justify-center text-center gap-3 animate-in fade-in slide-in-from-bottom-4">
                        <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center text-green-500 mb-2">
                            <CheckCircle2 className="h-6 w-6" />
                        </div>
                        <h4 className="text-lg font-semibold">Time Logged!</h4>
                        <p className="text-muted-foreground text-sm">
                            {formError || 'Your hours have been successfully recorded.'}
                        </p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="p-4 space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">Client</label>
                            <select
                                required
                                value={selectedClientId}
                                onChange={(e) => {
                                    setSelectedClientId(e.target.value);
                                    setSendOverride(undefined);
                                }}
                                className="w-full p-2 rounded-md bg-background border border-border focus:ring-2 focus:ring-primary/50 outline-none transition-all"
                            >
                                <option value="" disabled>Select a client...</option>
                                {clients.map(client => (
                                    <option key={client.id} value={client.id}>{client.clientName}</option>
                                ))}
                            </select>
                        </div>

                        {selectedClientId && (
                            <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                                <label className="text-sm font-medium text-muted-foreground">Task (Optional)</label>
                                <select
                                    value={selectedTaskId}
                                    onChange={(e) => setSelectedTaskId(e.target.value)}
                                    className="w-full p-2 rounded-md bg-background border border-border focus:ring-2 focus:ring-primary/50 outline-none transition-all"
                                >
                                    <option value="">General / No specific task</option>
                                    {clientTasks.map(task => (
                                        <option key={task.id} value={task.id}>{task.title}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label htmlFor="time-log-start" className="text-sm font-medium text-muted-foreground">Start time</label>
                                <input
                                    id="time-log-start"
                                    type="time"
                                    step={60}
                                    value={startTime}
                                    onChange={(e) => { setStartTime(e.target.value); setFormError(''); }}
                                    className="w-full px-3 py-2 rounded-md bg-background border border-border focus:ring-2 focus:ring-primary/50 outline-none transition-all"
                                />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="time-log-finish" className="text-sm font-medium text-muted-foreground">Finish time</label>
                                <input
                                    id="time-log-finish"
                                    type="time"
                                    step={60}
                                    value={finishTime}
                                    onChange={(e) => { setFinishTime(e.target.value); setFormError(''); }}
                                    className="w-full px-3 py-2 rounded-md bg-background border border-border focus:ring-2 focus:ring-primary/50 outline-none transition-all"
                                />
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground">Optional. Both times place this work on the planner. Leave them blank to record hours only.</p>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label htmlFor="time-log-date" className="text-sm font-medium text-muted-foreground">Date</label>
                                <div className="relative">
                                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <input
                                        id="time-log-date"
                                        type="date"
                                        required
                                        value={date}
                                        onChange={(e) => setDate(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 rounded-md bg-background border border-border focus:ring-2 focus:ring-primary/50 outline-none transition-all"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="time-log-hours" className="text-sm font-medium text-muted-foreground">Hours</label>
                                <div className="relative">
                                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <input
                                        id="time-log-hours"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        required
                                        readOnly={hoursLocked}
                                        placeholder="0.00"
                                        value={hoursValue}
                                        onChange={(e) => setHours(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 rounded-md bg-background border border-border focus:ring-2 focus:ring-primary/50 outline-none transition-all read-only:bg-muted/40"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">Description</label>
                            <textarea
                                required
                                rows={3}
                                placeholder="What did you work on?"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                className="w-full p-3 rounded-md bg-background border border-border focus:ring-2 focus:ring-primary/50 outline-none transition-all resize-none"
                            />
                        </div>

                        <div className="space-y-3">
                            <ReviewToggle
                                checked={billable}
                                label="Billable"
                                onChange={setBillable}
                            />
                            <ReviewToggle
                                checked={Boolean(selectedClientId) && countsTowardBudget}
                                disabled={!selectedClientId}
                                label="Counts toward SEO hours"
                                hint={selectedClientId
                                    ? "Adds this time to the client's monthly SEO-hour usage."
                                    : 'Internal work never consumes a client\u2019s SEO hours.'}
                                onChange={setCountsTowardBudget}
                            />
                            <ReviewToggle
                                checked={entry.syncToBasecamp}
                                disabled={!bcAvailable || checkingBasecamp}
                                label={checkingBasecamp ? 'Checking Basecamp\u2026' : 'Send to Basecamp'}
                                hint={basecampSendHint({
                                    clientId: selectedClientId,
                                    checking: checkingBasecamp,
                                    eligible: bcAvailable,
                                })}
                                onChange={setSendOverride}
                            />
                        </div>

                        {(placement.error || formError) && !showSuccess && (
                            <p className="text-sm text-destructive">{placement.error || formError}</p>
                        )}

                        <div className="pt-2">
                            <button
                                type="submit"
                                disabled={isSubmitting || Boolean(placement.error)}
                                className="w-full py-2 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isSubmitting ? (
                                    <>
                                        <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                        Saving...
                                    </>
                                ) : (
                                    'Log Time'
                                )}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
