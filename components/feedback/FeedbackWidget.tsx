'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageSquarePlus, X, Bug, Lightbulb, MessageSquare, Loader2, Check, ImagePlus, XCircle } from 'lucide-react';
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
    const [screenshot, setScreenshot] = useState<File | null>(null);
    const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
        setScreenshot(null);
        setScreenshotPreview(null);
        setOpen(true);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            alert('Screenshot must be under 5MB');
            return;
        }
        setScreenshot(file);
        const reader = new FileReader();
        reader.onload = (ev) => setScreenshotPreview(ev.target?.result as string);
        reader.readAsDataURL(file);
    };

    const clearScreenshot = () => {
        setScreenshot(null);
        setScreenshotPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!description.trim() || !organization) return;
        setSubmitting(true);

        const supabase = createClient();
        if (!supabase) { setSubmitting(false); return; }

        let screenshotUrl: string | null = null;

        // Upload screenshot if provided
        if (screenshot) {
            const ext = screenshot.name.split('.').pop();
            const path = `feedback/${organization.id}/${Date.now()}.${ext}`;
            const { error: uploadError } = await supabase.storage
                .from('feedback-screenshots')
                .upload(path, screenshot, { upsert: false });

            if (!uploadError) {
                const { data: urlData } = supabase.storage
                    .from('feedback-screenshots')
                    .getPublicUrl(path);
                screenshotUrl = urlData?.publicUrl ?? null;
            }
        }

        await supabase.from('feedback').insert({
            organization_id: organization.id,
            submitted_by: displayName || 'Unknown',
            type,
            severity: type === 'bug' ? severity : null,
            description: description.trim(),
            page: pathname,
            status: 'open',
            screenshot_url: screenshotUrl,
        });

        setSubmitting(false);
        setSubmitted(true);
        setTimeout(() => setOpen(false), 1800);
    };

    return (
        <div ref={panelRef} className="fixed bottom-[10.5rem] right-4 lg:bottom-[88px] lg:right-6 z-50">
            {/* Panel */}
            {open && (
                <div className="absolute bottom-14 right-0 w-80 bg-card border border-border rounded-2xl shadow-2xl animate-in slide-in-from-bottom-3 fade-in duration-200 overflow-hidden">
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
                                    rows={3}
                                    required
                                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none placeholder:text-muted-foreground/50"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    Page: <span className="font-mono">{pathname}</span>
                                </p>
                            </div>

                            {/* Screenshot upload */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                    Screenshot <span className="normal-case font-normal">(optional)</span>
                                </label>

                                {screenshotPreview ? (
                                    <div className="relative rounded-lg overflow-hidden border border-border">
                                        <img
                                            src={screenshotPreview}
                                            alt="Screenshot preview"
                                            className="w-full max-h-32 object-cover"
                                        />
                                        <button
                                            type="button"
                                            onClick={clearScreenshot}
                                            className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-0.5 hover:bg-black/80 transition-colors"
                                        >
                                            <XCircle className="h-4 w-4 text-white" />
                                        </button>
                                        <div className="px-2 py-1 bg-muted/80 text-[10px] text-muted-foreground truncate">
                                            {screenshot?.name}
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-muted/30 transition-all"
                                    >
                                        <ImagePlus className="h-4 w-4" />
                                        Attach a screenshot
                                    </button>
                                )}

                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handleFileChange}
                                    className="hidden"
                                />
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
                <MessageSquarePlus className="h-[18px] w-[18px]" />
            </button>
        </div>
    );
}
