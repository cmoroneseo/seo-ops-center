'use client';

import { ClientProject, Task } from '@/lib/types';
import { cn } from '@/lib/utils';
import { X, Clock, Calendar, FileText, CheckCircle2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { createTimeLog, getClientTimesheetSyncEnabled } from '@/lib/supabase/time-logs';
import { createClient } from '@/lib/supabase/client';

interface TimeLogModalProps {
    isOpen: boolean;
    onClose: () => void;
    clients: ClientProject[];
    initialClientId?: string;
    organizationId?: string;
}

export function TimeLogModal({ isOpen, onClose, clients, initialClientId, organizationId }: TimeLogModalProps) {
    const [selectedClientId, setSelectedClientId] = useState(initialClientId || '');
    const [selectedTaskId, setSelectedTaskId] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [hours, setHours] = useState('');
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const [bcAvailable, setBcAvailable] = useState(false);
    const [sendToBasecamp, setSendToBasecamp] = useState(true);

    useEffect(() => {
        if (isOpen) {
            setSelectedClientId(initialClientId || '');
            setSelectedTaskId('');
            setHours('');
            setDescription('');
            setShowSuccess(false);
            setSendToBasecamp(true);
        }
    }, [isOpen, initialClientId]);

    // Only offer "Send to Basecamp" when the selected client has timesheet sync enabled
    useEffect(() => {
        if (!selectedClientId) { setBcAvailable(false); return; }
        getClientTimesheetSyncEnabled(selectedClientId).then(setBcAvailable);
    }, [selectedClientId]);

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

        await createTimeLog({
            organizationId: organizationId ?? 'org-1',
            clientId: selectedClientId,
            taskId: selectedTaskId || undefined,
            userId: userId ?? 'mock-user-1',
            date,
            hours: parseFloat(hours),
            description,
            billable: true,
        }, { syncToBasecamp: bcAvailable && sendToBasecamp });

        setIsSubmitting(false);
        setShowSuccess(true);

        setTimeout(() => {
            onClose();
        }, 1500);
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
                        <p className="text-muted-foreground text-sm">Your hours have been successfully recorded.</p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="p-4 space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">Client</label>
                            <select
                                required
                                value={selectedClientId}
                                onChange={(e) => setSelectedClientId(e.target.value)}
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
                                <label className="text-sm font-medium text-muted-foreground">Date</label>
                                <div className="relative">
                                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <input
                                        type="date"
                                        required
                                        value={date}
                                        onChange={(e) => setDate(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 rounded-md bg-background border border-border focus:ring-2 focus:ring-primary/50 outline-none transition-all"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-muted-foreground">Hours</label>
                                <div className="relative">
                                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <input
                                        type="number"
                                        step="0.25"
                                        min="0"
                                        required
                                        placeholder="0.00"
                                        value={hours}
                                        onChange={(e) => setHours(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 rounded-md bg-background border border-border focus:ring-2 focus:ring-primary/50 outline-none transition-all"
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

                        {/* Send to Basecamp toggle — only when this client syncs its timesheet */}
                        {bcAvailable && (
                            <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
                                <div
                                    className={cn(
                                        'relative w-9 h-5 rounded-full transition-colors duration-200',
                                        sendToBasecamp ? 'bg-primary' : 'bg-muted-foreground/30'
                                    )}
                                    onClick={() => setSendToBasecamp(b => !b)}
                                >
                                    <span className={cn(
                                        'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
                                        sendToBasecamp ? 'translate-x-4' : 'translate-x-0'
                                    )} />
                                </div>
                                <span className="text-muted-foreground">
                                    Send to Basecamp
                                    <span className="text-xs text-muted-foreground/60 ml-1.5">adds to the client's project timesheet</span>
                                </span>
                            </label>
                        )}

                        <div className="pt-2">
                            <button
                                type="submit"
                                disabled={isSubmitting}
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
