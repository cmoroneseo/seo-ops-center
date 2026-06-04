'use client';

import { useState, useEffect, useRef } from 'react';
import { Play, X } from 'lucide-react';
import { useTimer } from '@/components/providers/timer-provider';
import { ClientProject } from '@/lib/types';

interface QuickStartPopoverProps {
    clients: ClientProject[];
    onClose: () => void;
}

export function QuickStartPopover({ clients, onClose }: QuickStartPopoverProps) {
    const { start } = useTimer();
    const [clientId, setClientId] = useState('');
    const [taskId, setTaskId] = useState('');
    const ref = useRef<HTMLDivElement>(null);
    const selectRef = useRef<HTMLSelectElement>(null);

    const selectedClient = clients.find(c => c.id === clientId);
    const tasks = selectedClient?.tasks || [];

    useEffect(() => {
        selectRef.current?.focus();
    }, []);

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    // Close on outside click
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [onClose]);

    const handleStart = async () => {
        if (!clientId) return;
        const client = clients.find(c => c.id === clientId);
        const task = tasks.find(t => t.id === taskId);
        await start({
            clientId,
            clientName: client?.clientName ?? '',
            taskId: task?.id,
            taskTitle: task?.title,
        });
        onClose();
    };

    return (
        <div
            ref={ref}
            className="w-72 bg-popover border border-border rounded-xl shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-150 p-3 space-y-3"
        >
            <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Start Timer</span>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            <select
                ref={selectRef}
                value={clientId}
                onChange={e => { setClientId(e.target.value); setTaskId(''); }}
                className="w-full p-2 rounded-lg bg-background border border-border text-sm focus:ring-2 focus:ring-primary/50 outline-none transition-all"
            >
                <option value="" disabled>Select client...</option>
                {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.clientName}</option>
                ))}
            </select>

            {clientId && tasks.length > 0 && (
                <select
                    value={taskId}
                    onChange={e => setTaskId(e.target.value)}
                    className="w-full p-2 rounded-lg bg-background border border-border text-sm focus:ring-2 focus:ring-primary/50 outline-none transition-all animate-in fade-in slide-in-from-top-1"
                >
                    <option value="">No specific task</option>
                    {tasks.map(t => (
                        <option key={t.id} value={t.id}>{t.title}</option>
                    ))}
                </select>
            )}

            <button
                onClick={handleStart}
                disabled={!clientId}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-green-500 text-white text-sm font-medium hover:bg-green-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
                <Play className="h-3.5 w-3.5 fill-current" />
                Start Timer
            </button>
        </div>
    );
}
