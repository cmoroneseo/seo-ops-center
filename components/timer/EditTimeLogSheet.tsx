'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { X, Clock, CheckCircle2, StickyNote, ChevronDown, ChevronUp, Pencil, Check, Plus, Trash2 } from 'lucide-react';
import { TimeLog, SessionNote } from '@/lib/types';
import { updateTimeLog } from '@/lib/supabase/time-logs';
import { cn } from '@/lib/utils';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderNoteText(text: string) {
    const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
    return parts.map((part, i) => {
        const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (match) {
            return (
                <a key={i} href={match[2]} className="text-primary underline underline-offset-2 hover:opacity-80">
                    {match[1]}
                </a>
            );
        }
        return <span key={i}>{part}</span>;
    });
}

// ── Editable note row ─────────────────────────────────────────────────────────

function EditableNoteRow({
    note,
    onEdit,
    onDelete,
}: {
    note: SessionNote;
    onEdit: (text: string) => void;
    onDelete: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(note.text);
    const ref = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (editing) {
            ref.current?.focus();
            const l = draft.length;
            ref.current?.setSelectionRange(l, l);
        }
    }, [editing]);

    const confirm = () => {
        const t = draft.trim();
        if (t && t !== note.text) onEdit(t);
        else setDraft(note.text);
        setEditing(false);
    };

    const cancel = () => { setDraft(note.text); setEditing(false); };

    const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirm(); }
        if (e.key === 'Escape') cancel();
    };

    return (
        <div className="group flex items-start gap-2 py-2 border-b border-border/40 last:border-0">
            <div className="flex-1 min-w-0">
                {editing ? (
                    <textarea
                        ref={ref}
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={handleKey}
                        onBlur={confirm}
                        rows={2}
                        className="w-full bg-background border border-primary/50 rounded-lg px-2 py-1.5 text-xs text-foreground outline-none resize-none focus:ring-1 focus:ring-primary/30 leading-relaxed"
                    />
                ) : (
                    <p
                        className="text-xs text-foreground/80 leading-relaxed break-words cursor-text"
                        onDoubleClick={() => setEditing(true)}
                    >
                        {renderNoteText(note.text)}
                    </p>
                )}
                <span className="text-[10px] text-muted-foreground mt-0.5 block">
                    {new Date(note.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {!editing && (
                        <span className="ml-1.5 opacity-0 group-hover:opacity-60 transition-opacity">· double-click to edit</span>
                    )}
                </span>
            </div>

            <div className="flex flex-col gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                {editing ? (
                    <button onClick={confirm} className="text-green-500 hover:text-green-400 transition-colors">
                        <Check className="h-3 w-3" />
                    </button>
                ) : (
                    <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-foreground transition-colors">
                        <Pencil className="h-3 w-3" />
                    </button>
                )}
                <button onClick={onDelete} className="text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 className="h-3 w-3" />
                </button>
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

interface EditTimeLogSheetProps {
    log: TimeLog;
    onClose: () => void;
    onSaved: (updated: TimeLog) => void;
}

export function EditTimeLogSheet({ log, onClose, onSaved }: EditTimeLogSheetProps) {
    const [description, setDescription] = useState(log.description);
    const [hours, setHours] = useState(String(log.hours));
    const [billable, setBillable] = useState(log.billable);
    const [category, setCategory] = useState(log.category ?? '');
    const [date, setDate] = useState(log.date.slice(0, 10));
    const [notes, setNotes] = useState<SessionNote[]>(log.sessionNotes ?? []);
    const [showNotes, setShowNotes] = useState((log.sessionNotes?.length ?? 0) > 0);
    const [newNoteText, setNewNoteText] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!description.trim()) return;
        setIsSaving(true);

        const result = await updateTimeLog(log.id, {
            description: description.trim(),
            hours: parseFloat(hours) || log.hours,
            billable,
            category: category || undefined,
            date,
            sessionNotes: notes,
        });

        if (result.success) {
            setShowSuccess(true);
            setTimeout(() => {
                setShowSuccess(false);
                onSaved({
                    ...log,
                    description: description.trim(),
                    hours: parseFloat(hours) || log.hours,
                    billable,
                    category: category || undefined,
                    date,
                    sessionNotes: notes,
                });
            }, 900);
        }
        setIsSaving(false);
    };

    const addNote = () => {
        const text = newNoteText.trim();
        if (!text) return;
        setNotes(prev => [...prev, { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() }]);
        setNewNoteText('');
    };

    const editNote = (id: string, text: string) => {
        setNotes(prev => prev.map(n => n.id === id ? { ...n, text } : n));
    };

    const deleteNote = (id: string) => {
        setNotes(prev => prev.filter(n => n.id !== id));
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg mb-0 bg-card border border-border border-b-0 rounded-t-2xl shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Handle bar */}
                <div className="flex justify-center pt-3 pb-1">
                    <div className="w-10 h-1 rounded-full bg-border" />
                </div>

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
                    <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-primary" />
                        <span className="font-semibold text-sm">Edit Time Entry</span>
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                            {new Date(log.date.includes('T') ? log.date : log.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                    </div>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {showSuccess ? (
                    <div className="px-5 py-10 flex flex-col items-center gap-3 animate-in fade-in">
                        <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center text-green-500">
                            <CheckCircle2 className="h-6 w-6" />
                        </div>
                        <p className="font-semibold">Entry updated!</p>
                    </div>
                ) : (
                    <form onSubmit={handleSave} className="px-5 py-4 space-y-4 max-h-[80vh] overflow-y-auto">
                        {/* Client context */}
                        {log.clientName && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span className="bg-primary/10 text-primary font-medium px-2 py-0.5 rounded-full text-xs">
                                    {log.clientName}
                                </span>
                                {log.category && (
                                    <span className="text-xs text-muted-foreground">{log.category}</span>
                                )}
                            </div>
                        )}

                        {/* Description */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Description *</label>
                            <textarea
                                autoFocus
                                required
                                rows={2}
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                className="w-full p-2.5 rounded-lg bg-background border border-border text-sm focus:ring-2 focus:ring-primary/50 outline-none transition-all resize-none"
                            />
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                            {/* Hours */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-muted-foreground">Hours</label>
                                <input
                                    type="number"
                                    step="any"
                                    min="0"
                                    value={hours}
                                    onChange={e => setHours(e.target.value)}
                                    className="w-full p-2 rounded-lg bg-background border border-border text-sm focus:ring-2 focus:ring-primary/50 outline-none transition-all"
                                />
                            </div>

                            {/* Date */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-muted-foreground">Date</label>
                                <input
                                    type="date"
                                    value={date}
                                    onChange={e => setDate(e.target.value)}
                                    className="w-full p-2 rounded-lg bg-background border border-border text-sm focus:ring-2 focus:ring-primary/50 outline-none transition-all"
                                />
                            </div>

                            {/* Category */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-muted-foreground">Category</label>
                                <select
                                    value={category}
                                    onChange={e => setCategory(e.target.value)}
                                    className="w-full p-2 rounded-lg bg-background border border-border text-sm focus:ring-2 focus:ring-primary/50 outline-none transition-all"
                                >
                                    <option value="">General</option>
                                    <option value="Content">Content</option>
                                    <option value="Technical">Technical</option>
                                    <option value="Strategy">Strategy</option>
                                    <option value="Reporting">Reporting</option>
                                    <option value="Calls">Calls</option>
                                </select>
                            </div>
                        </div>

                        {/* Billable toggle */}
                        <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
                            <div
                                className={cn(
                                    'relative w-9 h-5 rounded-full transition-colors duration-200',
                                    billable ? 'bg-primary' : 'bg-muted-foreground/30'
                                )}
                                onClick={() => setBillable(b => !b)}
                            >
                                <span className={cn(
                                    'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
                                    billable ? 'translate-x-4' : 'translate-x-0'
                                )} />
                            </div>
                            <span className="text-muted-foreground">Billable</span>
                        </label>

                        {/* Session Notes */}
                        <div className="rounded-xl border border-border/60 overflow-hidden">
                            <button
                                type="button"
                                onClick={() => setShowNotes(p => !p)}
                                className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                            >
                                <span className="flex items-center gap-1.5">
                                    <StickyNote className="h-3 w-3" />
                                    Session Notes
                                    {notes.length > 0 && (
                                        <span className="px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold leading-none">
                                            {notes.length}
                                        </span>
                                    )}
                                </span>
                                {showNotes ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>

                            {showNotes && (
                                <div className="border-t border-border/40">
                                    {notes.length > 0 && (
                                        <div className="px-3 pt-1 pb-0 max-h-48 overflow-y-auto">
                                            {notes.map(n => (
                                                <EditableNoteRow
                                                    key={n.id}
                                                    note={n}
                                                    onEdit={text => editNote(n.id, text)}
                                                    onDelete={() => deleteNote(n.id)}
                                                />
                                            ))}
                                        </div>
                                    )}

                                    {/* Add new note inline */}
                                    <div className="px-3 py-2 border-t border-border/30 flex items-end gap-2">
                                        <textarea
                                            value={newNoteText}
                                            onChange={e => setNewNoteText(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(); }
                                            }}
                                            rows={1}
                                            placeholder="Add a note… ↵ to save"
                                            className="flex-1 bg-transparent text-xs p-1.5 outline-none resize-none placeholder:text-muted-foreground/50 leading-relaxed border border-border rounded-lg focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                                        />
                                        <button
                                            type="button"
                                            onClick={addNote}
                                            disabled={!newNoteText.trim()}
                                            className="mb-0.5 h-6 w-6 flex items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                                        >
                                            <Plus className="h-3 w-3" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-3 pt-1 pb-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isSaving || !description.trim()}
                                className="flex-[2] py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isSaving ? (
                                    <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                ) : 'Save Changes'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
