'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { canAdministerVault, type VaultRole } from '@/lib/vault/permissions';
import { emptyVaultInput, validateVaultInput } from '@/lib/vault/validate';
import {
    VAULT_COMPOSER_SOURCE_KINDS,
    VAULT_ENTRY_TYPES,
    VAULT_PURPOSES,
    VAULT_RULE_KINDS,
    VAULT_SOURCE_LABEL,
    VAULT_TYPE_LABEL,
    VAULT_RULE_KIND_LABEL,
    type VaultEntryInput,
} from '@/lib/vault/types';

export function EntryComposer({
    open,
    mode,
    role,
    initial,
    submitting,
    serverError,
    onClose,
    onSubmit,
}: {
    open: boolean;
    mode: 'create' | 'propose' | 'supersede';
    role: VaultRole;
    initial?: VaultEntryInput | null;
    submitting: boolean;
    serverError: string | null;
    onClose: () => void;
    onSubmit: (input: VaultEntryInput) => void;
}) {
    const [draft, setDraft] = useState<VaultEntryInput>(emptyVaultInput());
    const [error, setError] = useState<string | null>(null);
    const admin = canAdministerVault(role);
    const title = mode === 'supersede' ? 'Supersede this version' : mode === 'propose' ? 'Propose to vault' : 'Save to vault';

    useEffect(() => {
        if (!open) return;
        setDraft(initial ?? emptyVaultInput());
        setError(null);
    }, [open, initial]);

    const update = (patch: Partial<VaultEntryInput>) => setDraft(current => ({ ...current, ...patch }));

    return (
        <Dialog open={open} onOpenChange={next => { if (!next) onClose(); }}>
            <DialogContent className="max-h-[min(720px,calc(100vh-2rem))] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        {mode === 'propose'
                            ? 'An admin reviews this before it is saved. Both of you are credited if it is accepted.'
                            : 'This becomes the active version. Earlier versions stay in the history.'}
                    </DialogDescription>
                </DialogHeader>
                <form className="space-y-4" onSubmit={event => {
                    event.preventDefault();
                    const invalid = validateVaultInput(draft);
                    if (invalid) { setError(invalid); return; }
                    setError(null);
                    onSubmit(draft);
                }}>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="vault-type">Type</Label>
                            <select id="vault-type" value={draft.entryType} onChange={event => update({ entryType: event.target.value as VaultEntryInput['entryType'], ruleKind: null, enforcement: null, contactDetails: null })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                                {VAULT_ENTRY_TYPES.map(type => <option key={type} value={type}>{VAULT_TYPE_LABEL[type]}</option>)}
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="vault-effective">Effective date</Label>
                            <Input id="vault-effective" type="date" value={draft.effectiveOn} onChange={event => update({ effectiveOn: event.target.value })} required />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="vault-title">Title</Label>
                        <Input id="vault-title" value={draft.title} onChange={event => update({ title: event.target.value })} maxLength={180} required />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="vault-body">What should the team remember?</Label>
                        <textarea id="vault-body" value={draft.body} onChange={event => update({ body: event.target.value })} rows={4} className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" required />
                    </div>
                    {draft.entryType === 'rule' && (
                        <fieldset className="space-y-3 rounded-lg border border-border p-3">
                            <legend className="px-1 text-sm font-medium">Rule</legend>
                            <p className="text-xs text-muted-foreground">Block and warn are stored only. Nothing is enforced yet.</p>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label htmlFor="vault-rule-kind">Kind</Label>
                                    <select id="vault-rule-kind" value={draft.ruleKind ?? ''} onChange={event => update({ ruleKind: event.target.value as VaultEntryInput['ruleKind'] })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                                        <option value="">Select</option>
                                        {VAULT_RULE_KINDS.map(kind => <option key={kind} value={kind}>{VAULT_RULE_KIND_LABEL[kind]}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="vault-enforcement">If this were enforced</Label>
                                    <select id="vault-enforcement" value={draft.enforcement ?? ''} onChange={event => update({ enforcement: event.target.value as VaultEntryInput['enforcement'] })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                                        <option value="">Select</option>
                                        <option value="block">Block</option>
                                        <option value="warn">Warn</option>
                                    </select>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="vault-statement">Statement</Label>
                                <Input id="vault-statement" value={draft.ruleDetails?.statement ?? ''} onChange={event => update({ ruleDetails: { ...draft.ruleDetails, statement: event.target.value } })} />
                            </div>
                        </fieldset>
                    )}
                    {draft.entryType === 'contact' && (
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="vault-contact-name">Name</Label>
                                <Input id="vault-contact-name" value={draft.contactDetails?.name ?? ''} onChange={event => update({ contactDetails: { ...draft.contactDetails, name: event.target.value } })} />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="vault-contact-role">Role</Label>
                                <Input id="vault-contact-role" value={draft.contactDetails?.role ?? ''} onChange={event => update({ contactDetails: { ...draft.contactDetails, name: draft.contactDetails?.name ?? '', role: event.target.value } })} />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="vault-contact-email">Email</Label>
                                <Input id="vault-contact-email" type="email" value={draft.contactDetails?.email ?? ''} onChange={event => update({ contactDetails: { ...draft.contactDetails, name: draft.contactDetails?.name ?? '', email: event.target.value } })} />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="vault-contact-phone">Phone</Label>
                                <Input id="vault-contact-phone" value={draft.contactDetails?.phone ?? ''} onChange={event => update({ contactDetails: { ...draft.contactDetails, name: draft.contactDetails?.name ?? '', phone: event.target.value } })} />
                            </div>
                        </div>
                    )}
                    <fieldset>
                        <legend className="mb-2 text-sm font-medium">Applies to</legend>
                        <div className="flex flex-wrap gap-2">
                            {VAULT_PURPOSES.map(purpose => {
                                const selected = draft.appliesTo?.includes(purpose.id) ?? false;
                                return (
                                    <button key={purpose.id} type="button" aria-pressed={selected} onClick={() => update({ appliesTo: selected ? (draft.appliesTo ?? []).filter(item => item !== purpose.id) : [...(draft.appliesTo ?? []), purpose.id] })} className={selected ? 'rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary' : 'rounded-full border border-border px-3 py-1 text-xs text-muted-foreground'}>
                                        {purpose.label}
                                    </button>
                                );
                            })}
                        </div>
                    </fieldset>
                    <div className="space-y-1.5">
                        <Label htmlFor="vault-review">Review date, optional</Label>
                        <Input id="vault-review" type="date" value={draft.reviewOn ?? ''} onChange={event => update({ reviewOn: event.target.value || null })} />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="vault-quote">Client quote, copied verbatim</Label>
                        <textarea id="vault-quote" value={draft.quote ?? ''} onChange={event => update({ quote: event.target.value })} rows={3} className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" />
                    </div>
                    {(draft.quote ?? '').trim() !== '' && (
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="vault-source">Source</Label>
                                <select id="vault-source" value={draft.sourceKind ?? ''} onChange={event => update({ sourceKind: event.target.value as VaultEntryInput['sourceKind'] })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                                    <option value="">Select</option>
                                    {VAULT_COMPOSER_SOURCE_KINDS.map(kind => <option key={kind} value={kind}>{VAULT_SOURCE_LABEL[kind]}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="vault-ref">Reference</Label>
                                <Input id="vault-ref" value={draft.sourceRef ?? ''} onChange={event => update({ sourceRef: event.target.value })} />
                            </div>
                        </div>
                    )}
                    {admin && mode !== 'propose' && (
                        <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={draft.pinned === true} onChange={event => update({ pinned: event.target.checked })} />
                            Pin this version
                        </label>
                    )}
                    {(error || serverError) && <p className="text-sm text-destructive" role="alert">{error || serverError}</p>}
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                        <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : title}</Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
