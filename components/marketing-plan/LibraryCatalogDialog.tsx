'use client';

import { useMemo, useState } from 'react';
import { MARKETING_PLAN_STEPS, MARKETING_PLAN_TEMPLATE_ITEMS } from '@/lib/marketing-plan-template';
import { catalogAddBlocked } from '@/lib/seo-plan/onboarding';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function LibraryCatalogDialog({
    open,
    existing,
    onClose,
    onAdd,
}: {
    open: boolean;
    existing: Array<{ templateKey?: string | null; title: string }>;
    onClose: () => void;
    onAdd: (title: string) => Promise<void>;
}) {
    const [query, setQuery] = useState('');
    const [busyTitle, setBusyTitle] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const needle = query.trim().toLowerCase();
    const groups = useMemo(() => MARKETING_PLAN_STEPS.map(step => ({
        ...step,
        items: MARKETING_PLAN_TEMPLATE_ITEMS.filter(item => item.stepKey === step.key && (
            !needle || item.title.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle)
        )),
    })).filter(group => group.items.length > 0), [needle]);

    return (
        <Dialog open={open} onOpenChange={value => { if (!value && !busyTitle) { setQuery(''); setError(null); onClose(); } }}>
            <DialogContent className="max-h-[85dvh] overflow-hidden sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Add from library</DialogTitle>
                    <DialogDescription>Add one piece of work. The rest of the library stays here.</DialogDescription>
                </DialogHeader>
                <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Search the library"
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                />
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <div className="max-h-[50dvh] space-y-4 overflow-y-auto pr-1">
                    {groups.length === 0 && <p className="py-6 text-sm text-muted-foreground">No matching library items.</p>}
                    {groups.map(group => (
                        <section key={group.key}>
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.name}</h4>
                            <ul className="space-y-1">
                                {group.items.map(item => {
                                    const blocked = catalogAddBlocked(existing, { templateKey: item.templateKey, title: item.title });
                                    return (
                                        <li key={item.title}>
                                            <button
                                                type="button"
                                                disabled={blocked || busyTitle !== null}
                                                onClick={() => {
                                                    setBusyTitle(item.title);
                                                    setError(null);
                                                    void onAdd(item.title).then(() => {
                                                        setQuery('');
                                                        onClose();
                                                    }).catch(cause => {
                                                        setError(cause instanceof Error ? cause.message : 'Could not add that item.');
                                                    }).finally(() => setBusyTitle(null));
                                                }}
                                                className="block w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                <span className="block font-medium">{item.title}</span>
                                                <span className="mt-0.5 block text-xs text-muted-foreground">{blocked ? 'Already on this plan' : item.description}</span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}
