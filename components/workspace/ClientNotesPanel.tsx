'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { StickyNote, Plus, Pencil, Trash2, Check, X, AtSign } from 'lucide-react';
import { ClientProject, ClientNote } from '@/lib/types';
import { getClientNotes, createClientNote, updateClientNote, deleteClientNote } from '@/lib/supabase/client-notes';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { cn } from '@/lib/utils';

interface ClientNotesPanelProps {
    client: ClientProject;
}

interface TeamMember {
    id: string;
    name: string;
    initials: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function formatDateTime(dateStr: string): string {
    const date = new Date(dateStr);
    return (
        date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' · ' +
        date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    );
}

const AVATAR_COLORS = [
    'bg-primary/20 text-primary',
    'bg-blue-500/20 text-blue-500',
    'bg-emerald-500/20 text-emerald-500',
    'bg-orange-500/20 text-orange-500',
    'bg-purple-500/20 text-purple-500',
];
const authorColorMap = new Map<string, string>();
let colorIndex = 0;
function getAuthorColor(name: string): string {
    if (!authorColorMap.has(name)) {
        authorColorMap.set(name, AVATAR_COLORS[colorIndex % AVATAR_COLORS.length]);
        colorIndex++;
    }
    return authorColorMap.get(name)!;
}

/** Render plain text and highlight @mentions in primary color */
function renderContent(text: string) {
    const parts = text.split(/(@[\w]+(?:\s[\w]+)?)/g);
    return parts.map((part, i) =>
        part.startsWith('@')
            ? <span key={i} className="text-primary font-semibold">{part}</span>
            : <span key={i}>{part}</span>
    );
}

// ─── Mention Dropdown ─────────────────────────────────────────────────────────

interface MentionDropdownProps {
    members: TeamMember[];
    query: string;
    selectedIndex: number;
    onSelect: (member: TeamMember) => void;
}

function MentionDropdown({ members, query, selectedIndex, onSelect }: MentionDropdownProps) {
    const filtered = members.filter(m =>
        m.name.toLowerCase().includes(query.toLowerCase())
    );
    if (filtered.length === 0) return null;

    return (
        <div className="absolute z-50 bottom-full mb-1 left-0 right-0 bg-card border border-border rounded-lg shadow-xl overflow-hidden">
            <div className="px-3 py-1.5 border-b border-border/50">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1">
                    <AtSign className="h-3 w-3" /> Mention a team member
                </span>
            </div>
            {filtered.map((member, i) => (
                <button
                    key={member.id}
                    onMouseDown={e => { e.preventDefault(); onSelect(member); }}
                    className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors',
                        i === selectedIndex ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'
                    )}
                >
                    <div className={cn(
                        'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                        getAuthorColor(member.name)
                    )}>
                        {member.initials}
                    </div>
                    <span className="font-medium">{member.name}</span>
                </button>
            ))}
        </div>
    );
}

// ─── Mention-aware Textarea ────────────────────────────────────────────────────

interface MentionTextareaProps {
    value: string;
    onChange: (val: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
    members: TeamMember[];
    placeholder?: string;
    autoFocus?: boolean;
    borderClass?: string;
    rows?: number;
}

function MentionTextarea({
    value, onChange, onSubmit, onCancel,
    members, placeholder, autoFocus, borderClass, rows = 3
}: MentionTextareaProps) {
    const ref = useRef<HTMLTextAreaElement>(null);
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [mentionStart, setMentionStart] = useState(0);
    const [selectedIndex, setSelectedIndex] = useState(0);

    const filtered = mentionQuery !== null
        ? members.filter(m => m.name.toLowerCase().includes(mentionQuery.toLowerCase()))
        : [];

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const text = e.target.value;
        onChange(text);

        const cursor = e.target.selectionStart ?? 0;
        const before = text.slice(0, cursor);
        const match = before.match(/@([\w ]*)$/);
        if (match) {
            setMentionQuery(match[1]);
            setMentionStart(cursor - match[0].length);
            setSelectedIndex(0);
        } else {
            setMentionQuery(null);
        }
    };

    const insertMention = useCallback((member: TeamMember) => {
        const cursor = ref.current?.selectionStart ?? 0;
        const before = value.slice(0, mentionStart);
        const after = value.slice(cursor);
        const newVal = `${before}@${member.name} ${after}`;
        onChange(newVal);
        setMentionQuery(null);

        // restore focus + move cursor after insertion
        setTimeout(() => {
            if (ref.current) {
                const pos = before.length + member.name.length + 2;
                ref.current.focus();
                ref.current.setSelectionRange(pos, pos);
            }
        }, 0);
    }, [value, mentionStart, onChange]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (mentionQuery !== null && filtered.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filtered.length - 1)); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); return; }
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); insertMention(filtered[selectedIndex]); return; }
            if (e.key === 'Escape') { setMentionQuery(null); return; }
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { onSubmit(); return; }
        if (e.key === 'Escape' && mentionQuery === null) { onCancel(); }
    };

    return (
        <div className="relative">
            {mentionQuery !== null && (
                <MentionDropdown
                    members={members}
                    query={mentionQuery}
                    selectedIndex={selectedIndex}
                    onSelect={insertMention}
                />
            )}
            <textarea
                ref={ref}
                autoFocus={autoFocus}
                rows={rows}
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className={cn(
                    'w-full px-3 py-2.5 text-sm rounded-lg bg-background border outline-none focus:ring-1 focus:ring-primary resize-none leading-relaxed',
                    borderClass ?? 'border-border'
                )}
            />
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ClientNotesPanel({ client }: ClientNotesPanelProps) {
    const { organization } = useOrganization();
    const { displayName } = useCurrentMember();
    const [notes, setNotes] = useState<ClientNote[]>([]);
    const [loading, setLoading] = useState(true);
    const [members, setMembers] = useState<TeamMember[]>([]);
    const [adding, setAdding] = useState(false);
    const [newContent, setNewContent] = useState('');
    const [authorName, setAuthorName] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');
    const [saving, setSaving] = useState(false);

    // Auto-fill author name from session once loaded
    useEffect(() => {
        if (displayName) setAuthorName(displayName);
    }, [displayName]);

    useEffect(() => {
        getClientNotes(client.id).then(data => {
            setNotes(data);
            setLoading(false);
        });
    }, [client.id]);

    useEffect(() => {
        if (!organization) return;
        getOrganizationMembers(organization.id).then(orgMembers => {
            const list: TeamMember[] = orgMembers
                .map(m => {
                    const name = m.user.fullName || m.user.email.split('@')[0];
                    return { id: m.userId, name, initials: getInitials(name) };
                })
                .filter(m => m.name.length > 0);
            setMembers(list);
        });
    }, [organization?.id]);

    const handleAdd = async () => {
        if (!newContent.trim() || !organization) return;
        setSaving(true);
        const result = await createClientNote({
            organizationId: organization.id,
            clientId: client.id,
            content: newContent.trim(),
            authorName: authorName.trim() || 'Team',
        });
        if (result.success && result.data) {
            setNotes(prev => [result.data!, ...prev]);
            setNewContent('');
            setAdding(false);
        }
        setSaving(false);
    };

    const handleEdit = async (id: string) => {
        if (!editContent.trim()) return;
        setSaving(true);
        const result = await updateClientNote(id, editContent.trim());
        if (result.success) {
            setNotes(prev => prev.map(n =>
                n.id === id ? { ...n, content: editContent.trim(), updatedAt: new Date().toISOString() } : n
            ));
            setEditingId(null);
        }
        setSaving(false);
    };

    const handleDelete = async (id: string) => {
        const result = await deleteClientNote(id);
        if (result.success) setNotes(prev => prev.filter(n => n.id !== id));
    };

    return (
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-muted/20">
                <div className="flex items-center gap-2">
                    <StickyNote className="h-4 w-4 text-primary" />
                    <h3 className="text-lg font-semibold">Client Notes</h3>
                    {notes.length > 0 && (
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
                            {notes.length}
                        </span>
                    )}
                </div>
                <button
                    onClick={() => { setAdding(true); setEditingId(null); }}
                    className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors font-medium"
                >
                    <Plus className="h-4 w-4" />
                    Add Note
                </button>
            </div>

            {/* Add Note Form */}
            {adding && (
                <div className="px-6 py-4 border-b border-border/50 bg-muted/10 space-y-3">
                    <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${getAuthorColor(authorName || 'Y')}`}>
                            {getInitials(authorName || 'Y')}
                        </div>
                        <input
                            type="text"
                            value={authorName}
                            onChange={e => setAuthorName(e.target.value)}
                            placeholder="Your name"
                            className="text-sm bg-transparent border-none outline-none text-foreground font-semibold w-36 placeholder:text-muted-foreground"
                        />
                    </div>
                    <MentionTextarea
                        value={newContent}
                        onChange={setNewContent}
                        onSubmit={handleAdd}
                        onCancel={() => { setAdding(false); setNewContent(''); }}
                        members={members}
                        placeholder="Type @ to mention a teammate, or just write your note..."
                        autoFocus
                        rows={3}
                    />
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                            @ to mention · ⌘+Enter to save · Esc to cancel
                        </span>
                        <div className="flex gap-2">
                            <button
                                onClick={() => { setAdding(false); setNewContent(''); }}
                                className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAdd}
                                disabled={!newContent.trim() || saving}
                                className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                            >
                                {saving ? 'Saving...' : 'Save Note'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Notes List */}
            <div className="divide-y divide-border/50">
                {loading ? (
                    <div className="px-6 py-8 text-center text-sm text-muted-foreground">Loading notes...</div>
                ) : notes.length === 0 && !adding ? (
                    <div className="px-6 py-10 text-center">
                        <StickyNote className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">No notes yet</p>
                        <p className="text-xs text-muted-foreground/50 mt-1">
                            Add strategy context, client preferences, or key follow-ups
                        </p>
                    </div>
                ) : (
                    notes.map(note => (
                        <div key={note.id} className="px-6 py-4 group hover:bg-muted/10 transition-colors">
                            <div className="flex items-start gap-3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${getAuthorColor(note.authorName)}`}>
                                    {getInitials(note.authorName)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2 mb-1.5">
                                        <div className="min-w-0">
                                            <span className="text-sm font-semibold">{note.authorName}</span>
                                            <span className="text-xs text-muted-foreground ml-2">
                                                {formatDateTime(note.createdAt)}
                                            </span>
                                            {note.updatedAt !== note.createdAt && (
                                                <span className="text-xs text-muted-foreground/50 ml-1 italic">(edited)</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                            <button
                                                onClick={() => {
                                                    setEditingId(note.id);
                                                    setEditContent(note.content);
                                                    setAdding(false);
                                                }}
                                                className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                                title="Edit note"
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(note.id)}
                                                className="p-1.5 rounded-md hover:bg-red-500/10 transition-colors text-muted-foreground hover:text-red-500"
                                                title="Delete note"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </div>

                                    {editingId === note.id ? (
                                        <div className="space-y-2 mt-1">
                                            <MentionTextarea
                                                value={editContent}
                                                onChange={setEditContent}
                                                onSubmit={() => handleEdit(note.id)}
                                                onCancel={() => setEditingId(null)}
                                                members={members}
                                                placeholder="Edit note... Type @ to mention"
                                                autoFocus
                                                rows={3}
                                                borderClass="border-primary"
                                            />
                                            <div className="flex gap-2 justify-end">
                                                <button
                                                    onClick={() => setEditingId(null)}
                                                    className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-muted transition-colors flex items-center gap-1"
                                                >
                                                    <X className="h-3 w-3" /> Cancel
                                                </button>
                                                <button
                                                    onClick={() => handleEdit(note.id)}
                                                    disabled={saving}
                                                    className="text-xs px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1 disabled:opacity-50"
                                                >
                                                    <Check className="h-3 w-3" /> Save
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                                            {renderContent(note.content)}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
