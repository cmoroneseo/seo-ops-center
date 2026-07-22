'use client';

import { useCallback, useEffect, useState } from 'react';
import { NotebookPen, X } from 'lucide-react';
import { PersonalNote } from '@/lib/types';
import { listPersonalNotes, createPersonalNote } from '@/lib/supabase/personal-notes';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { NoteList } from './NoteList';
import { NoteEditor } from './NoteEditor';
import { ConvertToTaskModal } from './ConvertToTaskModal';

export function NotepadPanel() {
    const { organization } = useOrganization();
    const { userId } = useCurrentMember();
    const [isOpen, setIsOpen] = useState(false);
    const [notes, setNotes] = useState<PersonalNote[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showArchived, setShowArchived] = useState(false);
    const [activeNote, setActiveNote] = useState<PersonalNote | null>(null);
    const [convertNote, setConvertNote] = useState<PersonalNote | null>(null);

    const refresh = useCallback(async (archived: boolean) => {
        if (!organization || !userId) return;
        setIsLoading(true);
        const data = await listPersonalNotes({ organizationId: organization.id, userId, archived });
        setNotes(data);
        setIsLoading(false);
    }, [organization, userId]);

    // Open on notepad:open event
    useEffect(() => {
        function handleOpen() { setIsOpen(true); }
        window.addEventListener('notepad:open', handleOpen);
        return () => window.removeEventListener('notepad:open', handleOpen);
    }, []);

    // Load notes when opened / archived toggled
    useEffect(() => {
        if (isOpen) refresh(showArchived);
    }, [isOpen, showArchived, refresh]);

    async function handleCreateNote() {
        if (!organization || !userId) return;
        const title = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        const note = await createPersonalNote({ organizationId: organization.id, userId, title });
        if (note) {
            setNotes((prev) => [note, ...prev]);
            setActiveNote(note);
        }
    }

    function handleChanged(updated: PersonalNote) {
        setActiveNote((prev) => (prev && prev.id === updated.id ? updated : prev));
        setNotes((prev) => {
            const rest = prev.filter((n) => n.id !== updated.id);
            // Archived/unarchived notes leave the current list view
            const inView = showArchived ? !!updated.archivedAt : !updated.archivedAt;
            return inView ? [updated, ...rest] : rest;
        });
    }

    function handleDeleted(id: string) {
        setNotes((prev) => prev.filter((n) => n.id !== id));
        setActiveNote(null);
    }

    if (!isOpen) return null;

    return (
        <div className="fixed right-4 top-16 z-[150] hidden h-[470px] w-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/20 md:flex">
            {/* Panel header */}
            <div className="relative flex items-center gap-2 border-b border-border bg-primary/5 px-3 py-2.5">
                <NotebookPen className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold text-foreground">Notepad</p>
                <button
                    onClick={() => { setActiveNote(null); setIsOpen(false); }}
                    className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-accent/20"
                    title="Close"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* Body — relative so editor's delete-confirm + convert modal can overlay */}
            <div className="relative min-h-0 flex-1">
                {activeNote ? (
                    <NoteEditor
                        key={activeNote.id}
                        note={activeNote}
                        onBack={() => { setActiveNote(null); refresh(showArchived); }}
                        onChanged={handleChanged}
                        onDeleted={handleDeleted}
                        onConvertToTask={(n) => setConvertNote(n)}
                    />
                ) : (
                    <NoteList
                        notes={notes}
                        isLoading={isLoading}
                        showArchived={showArchived}
                        onToggleArchived={() => setShowArchived((v) => !v)}
                        onOpenNote={(n) => setActiveNote(n)}
                        onCreateNote={handleCreateNote}
                    />
                )}
                {convertNote && (
                    <ConvertToTaskModal
                        note={convertNote}
                        onClose={() => setConvertNote(null)}
                        onConverted={(updated) => { setConvertNote(null); handleChanged(updated); }}
                    />
                )}
            </div>
        </div>
    );
}
