'use client';

import { useState } from 'react';
import { Pin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { canAdministerVault, type VaultRole } from '@/lib/vault/permissions';
import { VAULT_RULE_KIND_LABEL, VAULT_SOURCE_LABEL, VAULT_TYPE_LABEL, type VaultEntryDetail } from '@/lib/vault/types';
import { VAULT_PURPOSES } from '@/lib/vault/types';
import { VAULT_TYPE_CLASS, formatVaultDate } from './format';
import { HistoryTimeline } from './HistoryTimeline';
import { cn } from '@/lib/utils';

function purposeLabel(id: string): string {
    return VAULT_PURPOSES.find(purpose => purpose.id === id)?.label ?? id;
}

export function EntryDrawer({
    open,
    detail,
    loading,
    role,
    error,
    busy,
    onClose,
    onSelectVersion,
    onSupersede,
    onArchive,
    onPin,
    onReview,
}: {
    open: boolean;
    detail: VaultEntryDetail | null;
    loading: boolean;
    role: VaultRole;
    error: string | null;
    busy: boolean;
    onClose: () => void;
    onSelectVersion: (entryId: string) => void;
    onSupersede: () => void;
    onArchive: () => void;
    onPin: (pinned: boolean) => void;
    onReview: (reviewOn: string | null) => void;
}) {
    const [confirmArchive, setConfirmArchive] = useState(false);
    const [reviewOn, setReviewOn] = useState('');
    const entry = detail?.entry ?? null;
    const admin = canAdministerVault(role) && entry?.status === 'active';

    return (
        <Dialog open={open} onOpenChange={next => { if (!next) { setConfirmArchive(false); onClose(); } }}>
            <DialogContent className="top-0 right-0 left-auto h-full max-h-none w-full max-w-xl translate-x-0 translate-y-0 overflow-y-auto rounded-none sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{entry?.title ?? (loading ? 'Loading vault entry' : 'Vault entry')}</DialogTitle>
                    <DialogDescription>
                        {entry ? `${VAULT_TYPE_LABEL[entry.entryType]} · version ${entry.versionNo}` : '—'}
                    </DialogDescription>
                </DialogHeader>
                {loading && <div className="h-40 animate-pulse rounded-lg bg-muted/50" />}
                {!loading && error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                {entry && detail && (
                    <div className="space-y-6">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', VAULT_TYPE_CLASS[entry.entryType])}>{VAULT_TYPE_LABEL[entry.entryType]}</span>
                            <span className="text-xs capitalize text-muted-foreground">{entry.status}</span>
                            {entry.pinned && <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"><Pin className="h-3 w-3" /> Pinned</span>}
                        </div>
                        <p className="whitespace-pre-wrap text-sm leading-6">{entry.body}</p>
                        <dl className="grid grid-cols-2 gap-3 text-sm">
                            <div><dt className="text-xs text-muted-foreground">Effective</dt><dd>{formatVaultDate(entry.effectiveOn)}</dd></div>
                            <div><dt className="text-xs text-muted-foreground">Review</dt><dd>{formatVaultDate(entry.reviewOn)}</dd></div>
                            <div><dt className="text-xs text-muted-foreground">Saved by</dt><dd>{entry.authorName || '—'}</dd></div>
                            <div><dt className="text-xs text-muted-foreground">Proposed by</dt><dd>{entry.proposedByName || '—'}</dd></div>
                        </dl>
                        {entry.entryType === 'rule' && (
                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                                <p className="font-medium">{entry.ruleKind ? VAULT_RULE_KIND_LABEL[entry.ruleKind] : 'Rule'} · {entry.enforcement === 'block' ? 'Block' : entry.enforcement === 'warn' ? 'Warn' : '—'}</p>
                                {entry.ruleDetails?.statement && <p className="mt-1">{entry.ruleDetails.statement}</p>}
                                <p className="mt-2 text-xs text-muted-foreground">Recorded only. Nothing is blocked or warned automatically.</p>
                            </div>
                        )}
                        {entry.contactDetails && (
                            <div className="text-sm">
                                <p className="font-medium">{entry.contactDetails.name}</p>
                                <p className="text-muted-foreground">{[entry.contactDetails.role, entry.contactDetails.email, entry.contactDetails.phone].filter(Boolean).join(' · ') || '—'}</p>
                            </div>
                        )}
                        {entry.appliesTo.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {entry.appliesTo.map(purpose => <span key={purpose} className="rounded-full border border-border px-2 py-0.5 text-xs">{purposeLabel(purpose)}</span>)}
                            </div>
                        )}
                        <section>
                            <h3 className="text-sm font-semibold">Sources</h3>
                            {detail.sources.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No client quote is attached.</p> : (
                                <ul className="mt-2 space-y-2">
                                    {detail.sources.map(source => (
                                        <li key={source.id} className="rounded-lg border border-border p-3">
                                            <blockquote className="whitespace-pre-wrap text-sm">&ldquo;{source.quote}&rdquo;</blockquote>
                                            <p className="mt-2 text-xs text-muted-foreground">{VAULT_SOURCE_LABEL[source.sourceKind]}{source.sourceRef ? ` · ${source.sourceRef}` : ''}</p>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                        <section>
                            <h3 className="mb-2 text-sm font-semibold">History</h3>
                            <HistoryTimeline history={detail.history} currentId={entry.id} onSelect={onSelectVersion} />
                        </section>
                        {admin && (
                            <div className="space-y-3 border-t border-border pt-4">
                                <div className="flex flex-wrap gap-2">
                                    <Button type="button" onClick={onSupersede} disabled={busy}>Supersede</Button>
                                    <Button type="button" variant="outline" onClick={() => onPin(!entry.pinned)} disabled={busy}>{entry.pinned ? 'Unpin' : 'Pin'}</Button>
                                    <Button type="button" variant="outline" onClick={() => setConfirmArchive(true)} disabled={busy}>Archive</Button>
                                </div>
                                <form className="flex items-end gap-2" onSubmit={event => { event.preventDefault(); onReview(reviewOn || null); }}>
                                    <label className="flex-1 text-xs text-muted-foreground">
                                        Review date
                                        <Input type="date" value={reviewOn || entry.reviewOn || ''} onChange={event => setReviewOn(event.target.value)} className="mt-1" />
                                    </label>
                                    <Button type="submit" variant="secondary" disabled={busy}>Save date</Button>
                                </form>
                                {confirmArchive && (
                                    <div className="rounded-lg border border-border p-3">
                                        <p className="text-sm">Archive this version? It leaves the active vault and stays in the history.</p>
                                        <div className="mt-3 flex gap-2">
                                            <Button type="button" variant="destructive" disabled={busy} onClick={onArchive}>Archive</Button>
                                            <Button type="button" variant="outline" onClick={() => setConfirmArchive(false)}>Cancel</Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
