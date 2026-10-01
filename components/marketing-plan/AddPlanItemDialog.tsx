'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function AddPlanItemDialog({ open, onClose, onSelect }: {
    open: boolean; onClose: () => void;
    onSelect: (source: 'custom' | 'basecamp' | 'existing' | 'suggest') => void;
}) {
    return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}><DialogContent>
        <DialogHeader><DialogTitle>Add item</DialogTitle><DialogDescription>Choose how to add work to this client’s SEO Plan.</DialogDescription></DialogHeader>
        <div className="space-y-2">
            {([
                ['custom', 'Create custom item', 'Tailor the work to this client’s strategy.'],
                ['basecamp', 'Add from Basecamp', 'Link a client to-do already imported from Basecamp.'],
                ['existing', 'Add existing client task', 'Reuse a task without creating a duplicate.'],
                ['suggest', 'Suggest items', 'Review suggestions before adding them to the plan.'],
            ] as const).map(([source, title, description]) => <button key={source} onClick={() => { onClose(); onSelect(source); }} className="block w-full rounded-lg border border-border p-4 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs text-muted-foreground">{description}</span></button>)}
        </div>
    </DialogContent></Dialog>;
}
