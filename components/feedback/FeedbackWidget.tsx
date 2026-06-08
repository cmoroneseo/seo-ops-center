'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageSquarePlus, X, Bug, Lightbulb, MessageSquare, Loader2, Check } from 'lucide-react';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useOrganization } from '@/components/providers/organization-provider';
import { cn } from '@/lib/utils';

type FeedbackType = 'bug' | 'feature' | 'general';
type Severity = 'low' | 'medium' | 'blocking';

const TYPES: { key: FeedbackType; label: string; icon: React.ReactNode; color: string }[] = [
    { key: 'bug', label: 'Bug', icon: <Bug className="h-4 w-4" />, color: 'text-red-500 bg-red-500/10 border-red-500/20' },
    { key: 'feature', label: 'Feature Request', icon: <Lightbulb className="h-4 w-4" />, color: 'text-amber-500 bg-amber-500/10 border-amber-500/20' },
    { key: 'general', label: 'General', icon: <MessageSquare className="h-4 w-4" />, color: 'text-blue-500 bg-blue-500/10 border-blue-500/20' },
];

const SEVERITIES: { key: Severity; label: string }[] = [
    { key: 'low', label: 'Low' },
    { key: 'medium', label: 'Medium' },
    { key: 'blocking', label: 'Blocking 🚨' },
];

export function FeedbackWidget() {
    const { displayName } = useCurrentMember();
    const { organization } = useOrganization();
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [type, setType] = useState<FeedbackType>('bug');
    const [severity, setSeverity] = useState<Severity>('medium');
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const handleOpen = () => {
        setSubmitted(false);
        setDescription('');
        setType('bug');
        setSeverity('medium');
        setOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!description.trim() || !organization) return;
        setSubmitting(true);

        const supabase = createClient();
        if (supabase) {
            await supabase.from('feedback').insert({
                organization_id: organization.id,
                submitted_by: displayName || 'Unknown',
                type,
                severity: type === 'bug' ? severity : null,
                description: description.trim(),
                page: pathname,
                status: 'open',
            });
        }

        setSubmitting(false);
        setSubmitted(true);
        setTimeout(() => setOpen(false), 1800);
    };

    return (
        <div ref={panelRef} className="fixed bottom-6 left-6 z-50">
            {/* Panel */}
            {open && (
                <div className="absolute bottom-14 left-0 w-80 bg-card border border-border rounded-2xl shadow-2xl animate-in slide-in-from-bottom-3 fade-in duration-200 overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/20">
                        <div className="flex items-center gap-2">
                            <MessageSquarePlus className="h-4 w-4 text-primary" />
                            <span className="text-sm font-semibold">Send Feedback</span>
                        </div>
                        <button onClick={() => setOpen(false)} className="p-1 hover:bg-muted rounded-md transition-colors">
                            <X className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                    </div>

                    {submitted ? (
                        <div className="flex flex-col items-center justify-center py-10 px-4 gap-3">
                            <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                                <Check className="h-5 w-5 text-green-500" />
                            </div>
                            <p className="text-sm font-medium">Thanks for the feedback!</p>
                            <p className="text-xs text-muted-foreground text-center">It's been logged and will be reviewed.</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="p-4 space-y-4">
                            {/* Type selector */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Type</label>
                                <div className="flex gap-2">
                                    {TYPES.map(t => (
                                        <button
                                            key={t.key}
                                            type="button"
                                            onClick={() => setType(t.key)}
                                            className={cn(
                                                'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-medium transition-all',
                                                type === t.key ? t.color : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                            )}
                                        >
                                            {t.icon}
                                            {t.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Severity — only for bugs */}
                            {type === 'bug' && (
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Severity</label>
                                    <div className="flex gap-2">
                                        {SEVERITIES.map(s => (
                                            <button
                                                key={s.key}
                                                type="button"
                                                onClick={() => setSeverity(s.key)}
                                                className={cn(
                                                    'flex-1 py-1.5 rounded-lg border text-xs font-medium transition-all',
                                                    severity === s.key
                                                        ? s.key === 'blocking' ? 'bg-red-500/10 text-red-500 border-red-500/30'
                                                            : s.key === 'medium' ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                                                                : 'bg-muted text-foreground border-border'
                                                        : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                                )}
                                            >
                                                {s.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Description */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                    {type === 'bug' ? 'What happened?' : type === 'feature' ? 'Describe the feature' : 'Your feedback'}
                                </label>
                                <textarea
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    placeholder={
                                        type === 'bug' ? 'e.g. Hours log showed wrong total after saving...'
                                            : type === 'feature' ? 'e.g. Would love to export the activity feed as PDF...'
                                                : 'e.g. The dashboard feels a bit slow on mobile...'
                                    }
                                    rows={4}
                                    required
                                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none placeholder:text-muted-foreground/50"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    Page: <span className="font-mono">{pathname}</span>
                                </p>
                            </div>

                            <button
                                type="submit"
                                disabled={submitting || !description.trim()}
                                className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                            >
                                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
                                Submit Feedback
                            </button>
                        </form>
                    )}
                </div>
            )}

            {/* Floating button */}
            <button
                onClick={handleOpen}
                className={cn(
                    'w-11 h-11 rounded-full flex items-center justify-center shadow-lg transition-all duration-200',
                    open
                        ? 'bg-muted border border-border text-muted-foreground'
                        : 'bg-card border border-border text-muted-foreground hover:text-primary hover:border-primary/40 hover:shadow-primary/10'
                )}
                title="Send feedback"
            >
                <MessageSquarePlus className="h-4.5 w-4.5 h-[18px] w-[18px]" />
            </button>
        </div>
    );
}
