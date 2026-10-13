'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { isVaultTypingTarget, moveVaultSelection } from '@/lib/vault/keyboard';
import { canAdministerVault, canProposeVault, formatVaultCount, vaultWriteLabel, type VaultRole } from '@/lib/vault/permissions';
import {
    VAULT_ENTRY_TYPES,
    VAULT_PURPOSES,
    VAULT_TYPE_LABEL,
    type VaultCounts,
    type VaultEntry,
    type VaultEntryDetail,
    type VaultEntryInput,
    type VaultListFilters,
    type VaultSuggestion,
} from '@/lib/vault/types';
import {
    archiveVaultEntry,
    getVaultEntry,
    getVaultList,
    getVaultSuggestions,
    resolveVaultSuggestion,
    saveVaultEntry,
    supersedeVaultEntry,
    updateVaultPin,
    VaultRequestError,
} from '@/lib/supabase/vault';
import { EntryComposer } from './EntryComposer';
import { EntryDrawer } from './EntryDrawer';
import { EntryList } from './EntryList';
import { InboxLite } from './InboxLite';
import { MyProposals } from './MyProposals';

const UNKNOWN_COUNTS: VaultCounts = { active: null, inbox: null };

function messageFrom(error: unknown): string {
    return error instanceof VaultRequestError ? error.message : 'Vault request failed';
}

export function VaultPage({ clientId, clientName }: { clientId: string; clientName: string }) {
    const { role, isLoading } = useCurrentMember();
    const vaultRole: VaultRole = role;
    const searchRef = useRef<HTMLInputElement>(null);
    const listRequest = useRef(0);
    const [filters, setFilters] = useState<VaultListFilters>({ status: 'active' });
    const [query, setQuery] = useState('');
    const [entries, setEntries] = useState<VaultEntry[] | null>(null);
    const [counts, setCounts] = useState<VaultCounts>(UNKNOWN_COUNTS);
    const [listError, setListError] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [detail, setDetail] = useState<VaultEntryDetail | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [composerOpen, setComposerOpen] = useState(false);
    const [composerMode, setComposerMode] = useState<'create' | 'propose' | 'supersede'>('create');
    const [composerError, setComposerError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [inbox, setInbox] = useState<VaultSuggestion[] | null>(null);
    const [mine, setMine] = useState<VaultSuggestion[] | null>(null);
    const [inboxLoaded, setInboxLoaded] = useState(false);
    const [mineLoaded, setMineLoaded] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const admin = !isLoading && canAdministerVault(vaultRole);
    const member = !isLoading && canProposeVault(vaultRole) && !admin;
    const writeLabel = isLoading ? null : vaultWriteLabel(vaultRole);

    const loadList = useCallback(async (nextFilters: VaultListFilters) => {
        const requestId = ++listRequest.current;
        setListError(null);
        setCounts(UNKNOWN_COUNTS);
        try {
            const result = await getVaultList(clientId, nextFilters);
            if (requestId !== listRequest.current) return;
            setEntries(result.entries);
            setCounts(result.counts);
            setActiveIndex(0);
        } catch (error) {
            if (requestId !== listRequest.current) return;
            setListError(messageFrom(error));
        }
    }, [clientId]);

    const loadSuggestions = useCallback(async () => {
        if (admin) {
            setInboxLoaded(false);
            try {
                const result = await getVaultSuggestions(clientId, 'inbox');
                setInbox(result.suggestions);
                setInboxLoaded(true);
            } catch {
                setInbox(null);
                setInboxLoaded(true);
            }
        }
        if (admin || member) {
            setMineLoaded(false);
            try {
                const result = await getVaultSuggestions(clientId, 'mine');
                setMine(result.suggestions);
                setMineLoaded(true);
            } catch {
                setMine(null);
                setMineLoaded(true);
            }
        }
    }, [admin, member, clientId]);

    useEffect(() => {
        const handle = window.setTimeout(() => { void loadList({ ...filters, query }); }, 180);
        return () => window.clearTimeout(handle);
    }, [filters, query, loadList]);

    useEffect(() => { void loadSuggestions(); }, [loadSuggestions]);

    useEffect(() => {
        const openComposer = () => {
            const params = new URLSearchParams(window.location.search);
            if (params.get('compose') === '1' && writeLabel) {
                setComposerMode(admin ? 'create' : 'propose');
                setComposerError(null);
                setComposerOpen(true);
            }
        };
        openComposer();
        window.addEventListener('vault:navigate', openComposer);
        return () => window.removeEventListener('vault:navigate', openComposer);
    }, [writeLabel, admin]);

    const openEntry = useCallback(async (entryId: string) => {
        setDetailOpen(true);
        setDetailLoading(true);
        setDetailError(null);
        try {
            setDetail(await getVaultEntry(clientId, entryId));
        } catch (error) {
            setDetail(null);
            setDetailError(messageFrom(error));
        } finally {
            setDetailLoading(false);
        }
    }, [clientId]);

    const refreshAll = useCallback(async () => {
        await Promise.all([loadList({ ...filters, query }), loadSuggestions()]);
    }, [filters, query, loadList, loadSuggestions]);

    const filtered = Boolean(query || filters.type || filters.purpose || filters.pinned || (filters.status && filters.status !== 'active'));
    const trulyEmpty = counts.active === 0 && !filtered;
    const composerInitial = useMemo(() => {
        if (composerMode !== 'supersede' || !detail) return null;
        const entry = detail.entry;
        return {
            entryType: entry.entryType,
            title: entry.title,
            body: entry.body,
            ruleKind: entry.ruleKind,
            enforcement: entry.enforcement,
            ruleDetails: entry.ruleDetails,
            contactDetails: entry.contactDetails,
            appliesTo: entry.appliesTo,
            effectiveOn: entry.effectiveOn,
            reviewOn: entry.reviewOn,
            pinned: entry.pinned,
            quote: detail.sources[0]?.quote ?? '',
            sourceKind: detail.sources[0]?.sourceKind === 'member_proposal' ? 'other' : detail.sources[0]?.sourceKind ?? null,
            sourceRef: detail.sources[0]?.sourceRef ?? '',
        } satisfies VaultEntryInput;
    }, [composerMode, detail]);

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const target = event.target;
        if (target instanceof Element && target.closest('[role="dialog"]')) return;
        const typing = isVaultTypingTarget(event.target);
        if ((event.key === 'n' || event.key === 'p') && !typing && writeLabel) {
            event.preventDefault();
            setComposerMode(admin ? 'create' : 'propose');
            setComposerError(null);
            setComposerOpen(true);
            return;
        }
        const next = moveVaultSelection(activeIndex, entries?.length ?? 0, event.key, typing);
        if (next == null) return;
        event.preventDefault();
        if (next === 'search') searchRef.current?.focus();
        else if (next === 'close') setDetailOpen(false);
        else if (next === 'open' && entries?.[activeIndex]) void openEntry(entries[activeIndex].id);
        else if (typeof next === 'number') setActiveIndex(next);
    };

    return (
        <div className="space-y-4 outline-none" tabIndex={-1} onKeyDown={onKeyDown}>
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h2 className="text-lg font-semibold tracking-tight">Context Vault</h2>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">What {clientName} has decided. Rules record block or warn, and nothing is enforced yet.</p>
                    <p className="mt-2 text-sm">
                        <span className="text-muted-foreground">Active </span>
                        <span className="font-semibold tabular-nums">{formatVaultCount(counts.active)}</span>
                        {admin && <>
                            <span className="mx-2 text-muted-foreground">·</span>
                            <span className="text-muted-foreground">To review </span>
                            <span className="font-semibold tabular-nums">{formatVaultCount(counts.inbox)}</span>
                        </>}
                    </p>
                </div>
                {writeLabel && <Button type="button" onClick={() => { setComposerMode(admin ? 'create' : 'propose'); setComposerError(null); setComposerOpen(true); }}>{writeLabel}</Button>}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                    <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
                    <Input ref={searchRef} value={query} onChange={event => { setQuery(event.target.value); setEntries(null); setCounts(UNKNOWN_COUNTS); }} placeholder="Search the vault" aria-label="Search the vault" className="pl-9" />
                </div>
                <label className="text-sm text-muted-foreground">
                    <span className="sr-only">Type</span>
                    <select value={filters.type ?? ''} onChange={event => { setEntries(null); setCounts(UNKNOWN_COUNTS); setFilters(current => ({ ...current, type: (event.target.value || null) as VaultListFilters['type'] })); }} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label="Filter by type">
                        <option value="">All types</option>
                        {VAULT_ENTRY_TYPES.map(type => <option key={type} value={type}>{VAULT_TYPE_LABEL[type]}</option>)}
                    </select>
                </label>
                <label className="text-sm text-muted-foreground">
                    <span className="sr-only">Status</span>
                    <select value={filters.status ?? 'active'} onChange={event => { setEntries(null); setCounts(UNKNOWN_COUNTS); setFilters(current => ({ ...current, status: event.target.value as VaultListFilters['status'] })); }} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label="Filter by status">
                        <option value="active">Active</option>
                        <option value="superseded">Superseded</option>
                        <option value="archived">Archived</option>
                        <option value="all">All statuses</option>
                    </select>
                </label>
                <label className="text-sm text-muted-foreground">
                    <span className="sr-only">Purpose</span>
                    <select value={filters.purpose ?? ''} onChange={event => { setEntries(null); setCounts(UNKNOWN_COUNTS); setFilters(current => ({ ...current, purpose: event.target.value || null })); }} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label="Filter by purpose">
                        <option value="">Any purpose</option>
                        {VAULT_PURPOSES.map(purpose => <option key={purpose.id} value={purpose.id}>{purpose.label}</option>)}
                    </select>
                </label>
                <Button type="button" variant={filters.pinned ? 'secondary' : 'outline'} onClick={() => { setEntries(null); setCounts(UNKNOWN_COUNTS); setFilters(current => ({ ...current, pinned: current.pinned ? null : true })); }}>Pinned</Button>
            </div>
            {listError && <p className="text-sm text-destructive" role="alert">{listError}</p>}

            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <EntryList
                    entries={entries}
                    activeIndex={activeIndex}
                    role={vaultRole}
                    filtered={filtered && !trulyEmpty}
                    onActive={setActiveIndex}
                    onCreate={() => { setComposerMode(admin ? 'create' : 'propose'); setComposerOpen(true); }}
                    onSelect={entry => { setActiveIndex(entries?.findIndex(item => item.id === entry.id) ?? 0); void openEntry(entry.id); }}
                />
                <div className="space-y-4">
                    {admin && <InboxLite suggestions={inbox} loaded={inboxLoaded} busyId={busyId} onAccept={id => void runSuggestion(id, 'accept')} onDismiss={(id, reason) => void runSuggestion(id, 'dismiss', reason)} />}
                    {(admin || member) && <MyProposals suggestions={mine} loaded={mineLoaded} busyId={busyId} onWithdraw={id => void runSuggestion(id, 'withdraw')} />}
                    {!admin && !member && !isLoading && (
                        <p className="rounded-xl border border-border bg-card px-4 py-5 text-sm text-muted-foreground">You can read the vault. Saving and proposals stay with the SEO department and account managers.</p>
                    )}
                </div>
            </div>
            <p className="text-[11px] text-muted-foreground">↑↓ or j/k navigate · Enter opens · Esc closes · / searches{writeLabel ? ` · ${admin ? 'n saves' : 'n proposes'}` : ''}</p>

            <EntryDrawer
                open={detailOpen}
                detail={detail}
                loading={detailLoading}
                role={vaultRole}
                error={detailError}
                busy={submitting}
                onClose={() => setDetailOpen(false)}
                onSelectVersion={entryId => void openEntry(entryId)}
                onSupersede={() => { setComposerMode('supersede'); setComposerError(null); setComposerOpen(true); }}
                onArchive={() => void runArchive()}
                onPin={pinned => void runPin({ pinned })}
                onReview={reviewOn => void runPin({ reviewOn })}
            />
            <EntryComposer
                open={composerOpen}
                mode={composerMode}
                role={vaultRole}
                initial={composerInitial}
                submitting={submitting}
                serverError={composerError}
                onClose={() => setComposerOpen(false)}
                onSubmit={input => void runSave(input)}
            />
        </div>
    );

    async function runSave(input: VaultEntryInput) {
        setSubmitting(true);
        setComposerError(null);
        try {
            if (composerMode === 'supersede' && detail) {
                const created = await supersedeVaultEntry(clientId, detail.entry.id, input);
                setComposerOpen(false);
                await refreshAll();
                await openEntry(created.id);
            } else {
                await saveVaultEntry(clientId, composerMode === 'propose' ? 'propose' : 'create', input);
                setComposerOpen(false);
                await refreshAll();
            }
        } catch (error) {
            setComposerError(messageFrom(error));
        } finally {
            setSubmitting(false);
        }
    }

    async function runArchive() {
        if (!detail) return;
        setSubmitting(true);
        setDetailError(null);
        try {
            await archiveVaultEntry(clientId, detail.entry.id);
            await refreshAll();
            await openEntry(detail.entry.id);
        } catch (error) {
            setDetailError(messageFrom(error));
        } finally {
            setSubmitting(false);
        }
    }

    async function runPin(patch: { pinned?: boolean; reviewOn?: string | null }) {
        if (!detail) return;
        setSubmitting(true);
        setDetailError(null);
        try {
            await updateVaultPin(clientId, detail.entry.id, patch);
            await refreshAll();
            await openEntry(detail.entry.id);
        } catch (error) {
            setDetailError(messageFrom(error));
        } finally {
            setSubmitting(false);
        }
    }

    async function runSuggestion(id: string, action: 'accept' | 'dismiss' | 'withdraw', reason?: string) {
        setBusyId(id);
        try {
            const result = await resolveVaultSuggestion(clientId, id, action, reason);
            await refreshAll();
            if (action === 'accept') await openEntry(result.id);
        } catch (error) {
            setListError(messageFrom(error));
        } finally {
            setBusyId(null);
        }
    }
}
