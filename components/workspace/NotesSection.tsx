'use client';

import { useState } from 'react';
import { Send, User } from 'lucide-react';

interface Note {
    id: string;
    content: string;
    author: string;
    createdAt: Date;
    type: 'note' | 'update' | 'alert';
}

export function NotesSection() {
    const [notes, setNotes] = useState<Note[]>([
        {
            id: '1',
            content: 'Client requested we focus on the "Commercial Roofing" pages for next month\'s content.',
            author: 'Carlos',
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2), // 2 days ago
            type: 'note'
        },
        {
            id: '2',
            content: 'Technical audit completed. Found 15 broken links and 3 missing H1s.',
            author: 'Abel',
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5), // 5 days ago
            type: 'update'
        }
    ]);
    const [newNote, setNewNote] = useState('');

    const handleAddNote = () => {
        if (!newNote.trim()) return;

        const note: Note = {
            id: Math.random().toString(36).substr(2, 9),
            content: newNote,
            author: 'Me', // In real app, get from auth context
            createdAt: new Date(),
            type: 'note'
        };

        setNotes([note, ...notes]);
        setNewNote('');
    };

    return (
        <div className="flex flex-col h-[500px]">
            {/* Input Area */}
            <div className="flex gap-3 mb-6">
                <div className="flex-1 relative">
                    <textarea
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder="Add an internal note..."
                        className="w-full min-h-[80px] p-3 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none text-sm"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleAddNote();
                            }
                        }}
                    />
                    <div className="absolute bottom-2 right-2 text-xs text-muted-foreground">
                        Press Enter to send
                    </div>
                </div>
                <button
                    onClick={handleAddNote}
                    disabled={!newNote.trim()}
                    className="h-[80px] w-16 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    <Send className="h-5 w-5" />
                </button>
            </div>

            {/* Notes Feed */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                {notes.map((note) => (
                    <div key={note.id} className="flex gap-3 group">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 border border-border">
                            <User className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-foreground">{note.author}</span>
                                <span className="text-xs text-muted-foreground">
                                    {note.createdAt.toLocaleDateString()} at {note.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/30 border border-border/50 text-sm text-foreground/90 group-hover:bg-muted/50 transition-colors">
                                {note.content}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
