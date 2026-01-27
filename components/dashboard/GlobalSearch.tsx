'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, X, Briefcase, CheckSquare, FileText, Command } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { mockClients } from '@/lib/mock-data/workspace';

interface GlobalSearchProps {
    isOpen: boolean;
    onClose: () => void;
}

export function GlobalSearch({ isOpen, onClose }: GlobalSearchProps) {
    const [query, setQuery] = useState('');
    const router = useRouter();

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!isOpen) {
                    // This should ideally be handled by the parent state, 
                    // but for now we assume isOpen is synced.
                }
            }
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const results = query.length > 1 ? mockClients.filter(client =>
        client.clientName.toLowerCase().includes(query.toLowerCase()) ||
        client.accountManager.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 5) : [];

    const handleSelect = (clientId: string) => {
        router.push(`/workspace/${clientId}`);
        onClose();
        setQuery('');
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] bg-background/80 backdrop-blur-sm p-4">
            <div
                className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="relative flex items-center p-4 border-b border-border">
                    <Search className="h-5 w-5 text-muted-foreground" />
                    <input
                        autoFocus
                        type="text"
                        placeholder="Search clients, tasks, or reports... (Cmd+K)"
                        className="flex-1 bg-transparent border-none focus:ring-0 text-lg px-4"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    <div className="flex items-center gap-2">
                        <div className="hidden sm:flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground font-mono">
                            <Command className="h-3 w-3" />
                            <span>K</span>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1 hover:bg-muted rounded-md text-muted-foreground transition-colors"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <div className="max-h-[60vh] overflow-y-auto p-2">
                    {query.length > 1 ? (
                        <div className="space-y-4">
                            {results.length > 0 ? (
                                <div>
                                    <h3 className="px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Clients</h3>
                                    <div className="space-y-1">
                                        {results.map(client => (
                                            <button
                                                key={client.id}
                                                onClick={() => handleSelect(client.id)}
                                                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-primary/10 transition-colors text-left"
                                            >
                                                <div className="h-8 w-8 rounded bg-primary/20 flex items-center justify-center text-primary">
                                                    <Briefcase className="h-4 w-4" />
                                                </div>
                                                <div className="flex-1 overflow-hidden">
                                                    <p className="font-medium text-sm truncate">{client.clientName}</p>
                                                    <p className="text-xs text-muted-foreground truncate">{client.accountManager} • T{client.tier}</p>
                                                </div>
                                                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded border border-border text-muted-foreground">Jump to</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="py-12 text-center">
                                    <p className="text-muted-foreground">No matches found for "{query}"</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="p-4">
                            <h3 className="text-sm font-medium mb-4">Quick Links</h3>
                            <div className="grid grid-cols-2 gap-2">
                                <button className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/50 transition-colors text-left">
                                    <CheckSquare className="h-4 w-4 text-orange-500" />
                                    <span className="text-sm">My Tasks</span>
                                </button>
                                <button className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/50 transition-colors text-left">
                                    <FileText className="h-4 w-4 text-blue-500" />
                                    <span className="text-sm">Reports</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-3 border-t border-border bg-muted/30 flex items-center justify-between text-[10px] text-muted-foreground">
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1"><span className="bg-background px-1 rounded border border-border">↑↓</span> to navigate</span>
                        <span className="flex items-center gap-1"><span className="bg-background px-1 rounded border border-border">Enter</span> to select</span>
                    </div>
                    <span>Powered by SEO OPS AI</span>
                </div>
            </div>
        </div>
    );
}
