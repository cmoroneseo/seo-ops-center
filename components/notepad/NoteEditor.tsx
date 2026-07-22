'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import {
    ChevronLeft, MoreHorizontal, Pencil, CheckSquare, Archive,
    ArchiveRestore, Trash2, Bold, Italic, Strikethrough,
    List, ListOrdered, ListChecks, Quote, Link2, ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PersonalNote } from '@/lib/types';
import { updatePersonalNote, deletePersonalNote } from '@/lib/supabase/personal-notes';

interface NoteEditorProps {
    note: PersonalNote;
    onBack: () => void;
    onChanged: (note: PersonalNote) => void;
    onDeleted: (id: string) => void;
    onConvertToTask: (note: PersonalNote) => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function NoteEditor({ note, onBack, onChanged, onDeleted, onConvertToTask }: NoteEditorProps) {
    const [title, setTitle] = useState(note.title);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [menuOpen, setMenuOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const titleRef = useRef<HTMLInputElement>(null);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Latest unsaved payload — flushed on unmount so closing mid-debounce never loses text
    const pendingRef = useRef<{ title: string; contentHtml: string } | null>(null);

    const doSave = useCallback(async (payload: { title: string; contentHtml: string }) => {
        setSaveState('saving');
        const updated = await updatePersonalNote(note.id, payload);
        if (updated) {
            pendingRef.current = null;
            setSaveState('saved');
            onChanged(updated);
        } else {
            setSaveState('error');
        }
    }, [note.id, onChanged]);

    const scheduleSave = useCallback((payload: { title: string; contentHtml: string }) => {
        pendingRef.current = payload;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => doSave(payload), 800);
    }, [doSave]);

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({ link: { openOnClick: false } }),
            TaskList,
            TaskItem.configure({ nested: true }),
            Placeholder.configure({ placeholder: 'Write your note…' }),
        ],
        content: note.contentHtml || '',
        onUpdate: ({ editor: e }) => {
            scheduleSave({ title: titleRef.current?.value ?? title, contentHtml: e.getHTML() });
        },
    });

    // Flush pending save on unmount / back
    useEffect(() => {
        return () => {
            if (saveTimer.current) clearTimeout(saveTimer.current);
            if (pendingRef.current) {
                updatePersonalNote(note.id, pendingRef.current);
            }
        };
    }, [note.id]);

    // Close ⋯ menu on outside click
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (
                menuRef.current && !menuRef.current.contains(e.target as Node) &&
                menuButtonRef.current && !menuButtonRef.current.contains(e.target as Node)
            ) {
                setMenuOpen(false);
            }
        }
        if (menuOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [menuOpen]);

    function handleTitleChange(value: string) {
        setTitle(value);
        scheduleSave({ title: value, contentHtml: editor?.getHTML() ?? note.contentHtml });
    }

    async function handleArchiveToggle() {
        setMenuOpen(false);
        const updated = await updatePersonalNote(note.id, {
            archivedAt: note.archivedAt ? null : new Date().toISOString(),
        });
        if (updated) { onChanged(updated); onBack(); }
    }

    async function handleDelete() {
        const ok = await deletePersonalNote(note.id);
        if (ok) onDeleted(note.id);
    }

    if (!editor) return null;

    const tbBtn = (active: boolean) => cn(
        'rounded-md p-1.5 transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent/20',
    );
    const menuItem =
        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent/20 transition-colors';

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center gap-1 border-b border-border px-2 py-2">
                <button onClick={onBack} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/20" title="Back">
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <input
                    ref={titleRef}
                    value={title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    placeholder="Untitled"
                    className="min-w-0 flex-1 bg-transparent px-1 text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground"
                />
                <span className="shrink-0 px-1 text-[10px] text-muted-foreground">
                    {saveState === 'saving' && 'Saving…'}
                    {saveState === 'saved' && 'Saved'}
                    {saveState === 'error' && <span className="text-destructive">Couldn’t save — retrying</span>}
                </span>
                {note.taskId && (
                    <Link href="/tasks" className="shrink-0 rounded-md p-1.5 text-primary hover:bg-primary/10" title="View task">
                        <ExternalLink className="h-4 w-4" />
                    </Link>
                )}
                <div className="relative">
                    <button
                        ref={menuButtonRef}
                        onClick={() => setMenuOpen((v) => !v)}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/20"
                        title="Note actions"
                    >
                        <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {menuOpen && (
                        <div
                            ref={menuRef}
                            className="absolute right-0 top-full z-10 mt-1 w-48 rounded-xl border border-border bg-card p-1.5 shadow-xl shadow-black/10"
                        >
                            <button className={menuItem} onClick={() => { setMenuOpen(false); titleRef.current?.focus(); titleRef.current?.select(); }}>
                                <Pencil className="h-4 w-4 text-muted-foreground" /> Rename
                            </button>
                            <button className={menuItem} onClick={() => { setMenuOpen(false); onConvertToTask(note); }}>
                                <CheckSquare className="h-4 w-4 text-muted-foreground" /> Convert to task
                            </button>
                            <button className={menuItem} onClick={handleArchiveToggle}>
                                {note.archivedAt
                                    ? <><ArchiveRestore className="h-4 w-4 text-muted-foreground" /> Unarchive</>
                                    : <><Archive className="h-4 w-4 text-muted-foreground" /> Archive</>}
                            </button>
                            <button
                                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                                onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
                            >
                                <Trash2 className="h-4 w-4" /> Delete
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-0.5 border-b border-border px-2 py-1">
                <button className={tbBtn(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><Bold className="h-3.5 w-3.5" /></button>
                <button className={tbBtn(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><Italic className="h-3.5 w-3.5" /></button>
                <button className={tbBtn(editor.isActive('strike'))} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough"><Strikethrough className="h-3.5 w-3.5" /></button>
                <span className="mx-1 h-4 w-px bg-border" />
                <button className={tbBtn(editor.isActive('heading', { level: 1 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1"><span className="px-0.5 text-xs font-bold">H1</span></button>
                <button className={tbBtn(editor.isActive('heading', { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2"><span className="px-0.5 text-xs font-bold">H2</span></button>
                <button className={tbBtn(editor.isActive('heading', { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3"><span className="px-0.5 text-xs font-bold">H3</span></button>
                <span className="mx-1 h-4 w-px bg-border" />
                <button className={tbBtn(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list"><List className="h-3.5 w-3.5" /></button>
                <button className={tbBtn(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list"><ListOrdered className="h-3.5 w-3.5" /></button>
                <button className={tbBtn(editor.isActive('taskList'))} onClick={() => editor.chain().focus().toggleTaskList().run()} title="Checklist"><ListChecks className="h-3.5 w-3.5" /></button>
                <span className="mx-1 h-4 w-px bg-border" />
                <button className={tbBtn(editor.isActive('blockquote'))} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote"><Quote className="h-3.5 w-3.5" /></button>
                <button
                    className={tbBtn(editor.isActive('link'))}
                    onClick={() => {
                        if (editor.isActive('link')) { editor.chain().focus().unsetLink().run(); return; }
                        const url = window.prompt('Link URL');
                        if (url) editor.chain().focus().setLink({ href: url }).run();
                    }}
                    title="Link"
                >
                    <Link2 className="h-3.5 w-3.5" />
                </button>
            </div>

            {/* Body */}
            <div className="notepad-editor min-h-0 flex-1 cursor-text overflow-y-auto px-4 py-3" onClick={() => editor.chain().focus().run()}>
                <EditorContent editor={editor} className="h-full" />
            </div>

            {/* Delete confirm */}
            {confirmDelete && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 p-6">
                    <div className="w-full rounded-xl border border-border bg-card p-4 shadow-xl">
                        <p className="text-sm font-semibold text-foreground">Delete this note?</p>
                        <p className="mt-1 text-xs text-muted-foreground">This can’t be undone.</p>
                        <div className="mt-4 flex justify-end gap-2">
                            <button onClick={() => setConfirmDelete(false)} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/20">Cancel</button>
                            <button onClick={handleDelete} className="rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-white hover:bg-destructive/90">Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
