'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { X, StickyNote, Link2, Pencil, Check } from 'lucide-react';
import { useTimer } from '@/components/providers/timer-provider';
import { SessionNote } from '@/lib/types';
import { ClientProject } from '@/lib/types';
import { cn } from '@/lib/utils';

// ── Link rendering ────────────────────────────────────────────────────────────
// Parses [Label](/path) markdown-style links and renders them as <a> tags.
function renderNoteText(text: string) {
    const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
    return parts.map((part, i) => {
        const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (match) {
            return (
                <a
                    key={i}
                    href={match[2]}
                    className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
                    onClick={e => e.stopPropagation()}
                >
                    {match[1]}
                </a>
            );
        }
        return <span key={i}>{part}</span>;
    });
}

function formatNoteTime(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Mention dropdown ──────────────────────────────────────────────────────────
interface MentionDropdownProps {
    query: string;
    clients: ClientProject[];
    onSelect: (client: ClientProject) => void;
    anchorRef: React.RefObject<HTMLTextAreaElement | null>;
}

function MentionDropdown({ query, clients, onSelect, anchorRef }: MentionDropdownProps) {
    const filtered = clients
        .filter(c => c.clientName.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 6);

    if (filtered.length === 0) return null;

    return (
        <div className="absolute bottom-full left-0 mb-1 w-56 bg-popover border border-border rounded-xl shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-1 duration-100">
            {filtered.map(c => (
                <button
                    key={c.id}
                    onMouseDown={e => { e.preventDefault(); onSelect(c); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                >
                    <span className="h-5 w-5 rounded-md bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
                        {c.clientName[0]}
                    </span>
                    <span className="truncate">{c.clientName}</span>
                </button>
            ))}
        </div>
    );
}

// ── Note row ──────────────────────────────────────────────────────────────────
function NoteRow({ note, onDelete, onEdit }: {
    note: SessionNote;
    onDelete: () => void;
    onEdit: (newText: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(note.text);
    const editRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (editing) {
            editRef.current?.focus();
            // Place cursor at end
            const len = draft.length;
            editRef.current?.setSelectionRange(len, len);
        }
    }, [editing]);

    const confirm = () => {
        const trimmed = draft.trim();
        if (trimmed && trimmed !== note.text) onEdit(trimmed);
        else setDraft(note.text); // revert if empty or unchanged
        setEditing(false);
    };

    const cancel = () => {
        setDraft(note.text);
        setEditing(false);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirm(); }
        if (e.key === 'Escape') cancel();
    };

    return (
        <div className="group flex items-start gap-2 py-2 border-b border-border/40 last:border-0">
            <div className="flex-1 min-w-0">
                {editing ? (
                    <textarea
                        ref={editRef}
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onBlur={confirm}
                        rows={2}
                        className="w-full bg-background border border-primary/50 rounded-lg px-2 py-1.5 text-xs text-foreground outline-none resize-none focus:ring-1 focus:ring-primary/30 leading-relaxed"
                    />
                ) : (
                    <p
                        className="text-xs text-foreground leading-relaxed break-words cursor-text"
                        onDoubleClick={() => setEditing(true)}
                    >
                        {renderNoteText(note.text)}
                    </p>
                )}
                <span className="text-[10px] text-muted-foreground mt-0.5 block">
                    {formatNoteTime(note.createdAt)}
                    {!editing && <span className="ml-1.5 opacity-0 group-hover:opacity-60 transition-opacity">· double-click to edit</span>}
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
                    <X className="h-3 w-3" />
                </button>
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────
interface TimerNotesProps {
    clients: ClientProject[];
    notes: SessionNote[];
}

export function TimerNotes({ clients, notes }: TimerNotesProps) {
    const { addNote, editNote, deleteNote } = useTimer();
    const [input, setInput] = useState('');
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const listEndRef = useRef<HTMLDivElement>(null);

    // Scroll to bottom when new note added
    useEffect(() => {
        listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [notes.length]);

    const handleInput = (value: string) => {
        setInput(value);
        // Detect @ mention — find last @ and extract the query after it
        const atIndex = value.lastIndexOf('@');
        if (atIndex !== -1 && atIndex === value.length - 1 - (value.length - 1 - atIndex)) {
            const afterAt = value.slice(atIndex + 1);
            // Only show dropdown if there's no space after @
            if (!afterAt.includes(' ')) {
                setMentionQuery(afterAt);
                return;
            }
        }
        setMentionQuery(null);
    };

    const handleSelectMention = (client: ClientProject) => {
        const atIndex = input.lastIndexOf('@');
        const before = input.slice(0, atIndex);
        const link = `[${client.clientName}](/workspace/${client.id})`;
        setInput(before + link + ' ');
        setMentionQuery(null);
        textareaRef.current?.focus();
    };

    const submitNote = async () => {
        if (!input.trim()) return;
        await addNote(input);
        setInput('');
        setMentionQuery(null);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitNote();
        }
        if (e.key === 'Escape') setMentionQuery(null);
    };

    return (
        <div className="flex flex-col gap-0">
            {/* Notes list */}
            {notes.length > 0 ? (
                <div className="max-h-40 overflow-y-auto px-4 pt-1 pb-0 custom-scrollbar">
                    {notes.map(note => (
                        <NoteRow
                            key={note.id}
                            note={note}
                            onEdit={newText => editNote(note.id, newText)}
                            onDelete={() => deleteNote(note.id)}
                        />
                    ))}
                    <div ref={listEndRef} />
                </div>
            ) : (
                <div className="px-4 pt-2 pb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StickyNote className="h-3 w-3" />
                    <span>No notes yet. Type below to capture context.</span>
                </div>
            )}

            {/* Input */}
            <div className="relative px-3 pb-3 pt-2">
                {mentionQuery !== null && (
                    <MentionDropdown
                        query={mentionQuery}
                        clients={clients}
                        onSelect={handleSelectMention}
                        anchorRef={textareaRef}
                    />
                )}
                <div className="flex items-end gap-1.5 rounded-xl border border-border bg-background focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={e => handleInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        rows={2}
                        placeholder="Add a note… @ to link a client  ↵ to save"
                        className="flex-1 bg-transparent text-xs p-2.5 outline-none resize-none placeholder:text-muted-foreground/60 leading-relaxed"
                    />
                    <button
                        onClick={submitNote}
                        disabled={!input.trim()}
                        className="mb-2 mr-2 h-6 w-6 flex items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                    >
                        <Link2 className="h-3 w-3 rotate-0" />
                    </button>
                </div>
                <p className="text-[10px] text-muted-foreground/50 mt-1 pl-1">
                    Enter to save · Shift+Enter for new line · @ to mention a client
                </p>
            </div>
        </div>
    );
}
