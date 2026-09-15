'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Map, Sparkles } from 'lucide-react';

import { getTopicalMapByClient } from '@/lib/supabase/topical-map';
import { MapGenerationWizard } from '@/components/topical-map/MapGenerationWizard';
import { MapProgressCard } from '@/components/topical-map/MapProgressCard';
import { TopicalMapHeader } from '@/components/topical-map/TopicalMapHeader';
import { SiloTabBar, type SiloFilters } from '@/components/topical-map/SiloTabBar';
import { SiloAccordion } from '@/components/topical-map/SiloAccordion';
import { RecordDetailPanel } from '@/components/topical-map/RecordDetailPanel';
import { ReconciliationSummary } from '@/components/topical-map/ReconciliationSummary';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import type { TopicalMap, TopicalMapRecord, TopicalMapSilo } from '@/lib/types';

interface LoadedMap {
    map: TopicalMap | null;
    silos: TopicalMapSilo[];
    records: TopicalMapRecord[];
}

// The generate API route writes generation_metadata with snake_case keys
// (stages_completed) while lib/types.ts declares the field as camelCase
// (stagesCompleted), and the row mapper in lib/supabase/topical-map.ts does
// a raw cast without converting keys. Read both spellings so this component
// works against what is actually stored today — see the same note in
// MapProgressCard.tsx.
function stagesOf(map: TopicalMap | null): string[] {
    const meta = (map?.generationMetadata ?? {}) as Record<string, unknown>;
    const raw = (meta.stagesCompleted ?? meta.stages_completed) as string[] | undefined;
    return raw ?? [];
}

interface TopicalMapTabProps {
    organizationId: string;
    clientId: string;
    clientName: string;
}

export function TopicalMapTab({ organizationId, clientId, clientName }: TopicalMapTabProps) {
    const { userId } = useCurrentMember();
    const [loading, setLoading] = useState(true);
    const [loaded, setLoaded] = useState<LoadedMap>({ map: null, silos: [], records: [] });
    const [wizardOpen, setWizardOpen] = useState(false);
    const [error, setError] = useState('');
    const [activeSiloId, setActiveSiloId] = useState<string | 'all'>('all');
    const [filters, setFilters] = useState<SiloFilters>({ action: 'all', pageType: 'all', status: 'all' });
    const [selectedRecord, setSelectedRecord] = useState<TopicalMapRecord | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);

    const load = useCallback(async () => {
        try {
            const result = await getTopicalMapByClient(clientId);
            setLoaded(result);
            setError('');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to load topical map');
        } finally {
            setLoading(false);
        }
    }, [clientId]);

    useEffect(() => { void load(); }, [load]);

    if (loading) {
        return (
            <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-border p-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading topical map…
            </div>
        );
    }

    const { map, silos, records } = loaded;
    const stages = stagesOf(map);
    const isGenerating = !!map && !stages.includes('complete');

    // Empty state — no map exists for this client yet.
    if (!map) {
        return (
            <section className="space-y-5" aria-label="Topical Map">
                <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
                    <Map className="mx-auto h-8 w-8 text-primary" />
                    <h3 className="mt-3 font-semibold">No topical map yet</h3>
                    <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
                        Generate an AI-drafted topical map for {clientName} — a silo-based content architecture built from
                        the brand profile, search demand, and existing pages.
                    </p>
                    <button
                        onClick={() => setWizardOpen(true)}
                        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                    >
                        <Sparkles className="h-4 w-4" />
                        Generate Topical Map
                    </button>
                    {error && (
                        <p className="mx-auto mt-4 flex max-w-xl items-center justify-center gap-2 text-xs text-red-500">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{error}
                        </p>
                    )}
                </div>

                {wizardOpen && (
                    <MapGenerationWizard
                        organizationId={organizationId}
                        clientId={clientId}
                        clientName={clientName}
                        onClose={() => setWizardOpen(false)}
                        onGenerated={() => {
                            setWizardOpen(false);
                            void load();
                        }}
                    />
                )}
            </section>
        );
    }

    // Generating state — map exists in draft with generation still in progress.
    if (isGenerating) {
        return (
            <MapProgressCard
                clientId={clientId}
                clientName={clientName}
                onComplete={() => { void load(); }}
            />
        );
    }

    // Ready state — full silo/record workspace.
    return <TopicalMapReady
        organizationId={organizationId}
        clientId={clientId}
        clientName={clientName}
        map={map}
        silos={silos}
        records={records}
        userId={userId}
        activeSiloId={activeSiloId}
        setActiveSiloId={setActiveSiloId}
        filters={filters}
        setFilters={setFilters}
        selectedRecord={selectedRecord}
        setSelectedRecord={setSelectedRecord}
        detailOpen={detailOpen}
        setDetailOpen={setDetailOpen}
        wizardOpen={wizardOpen}
        setWizardOpen={setWizardOpen}
        onReload={load}
        setLoaded={setLoaded}
    />;
}

interface TopicalMapReadyProps {
    organizationId: string;
    clientId: string;
    clientName: string;
    map: TopicalMap;
    silos: TopicalMapSilo[];
    records: TopicalMapRecord[];
    userId?: string;
    activeSiloId: string | 'all';
    setActiveSiloId: (id: string | 'all') => void;
    filters: SiloFilters;
    setFilters: (f: SiloFilters) => void;
    selectedRecord: TopicalMapRecord | null;
    setSelectedRecord: (r: TopicalMapRecord | null) => void;
    detailOpen: boolean;
    setDetailOpen: (open: boolean) => void;
    wizardOpen: boolean;
    setWizardOpen: (open: boolean) => void;
    onReload: () => Promise<void>;
    setLoaded: (l: LoadedMap) => void;
}

function TopicalMapReady({
    organizationId, clientId, clientName, map, silos, records, userId,
    activeSiloId, setActiveSiloId, filters, setFilters,
    selectedRecord, setSelectedRecord, detailOpen, setDetailOpen,
    wizardOpen, setWizardOpen, onReload, setLoaded,
}: TopicalMapReadyProps) {
    const filteredRecords = useMemo(() => {
        const matched = records.filter(r => {
            if (activeSiloId !== 'all' && r.siloId !== activeSiloId) return false;
            if (filters.action !== 'all' && r.action !== filters.action) return false;
            if (filters.pageType !== 'all' && r.pageType !== filters.pageType) return false;
            if (filters.status !== 'all' && r.status !== filters.status) return false;
            return true;
        });

        // A child record can pass the filter while its parent doesn't — e.g. filtering
        // by status=approved keeps an approved child under a still-pending parent. The
        // accordion only renders children under a surviving top-level parent, so an
        // orphaned child would silently vanish. Add the missing parent back (unfiltered)
        // so it still provides context; it is not itself subject to the active filters.
        const matchedIds = new Set(matched.map(r => r.id));
        const restoredParents: TopicalMapRecord[] = [];
        for (const r of matched) {
            if (r.parentRecordId && !matchedIds.has(r.parentRecordId)) {
                const parent = records.find(rec => rec.id === r.parentRecordId);
                if (parent && !matchedIds.has(parent.id)) {
                    matchedIds.add(parent.id);
                    restoredParents.push(parent);
                }
            }
        }

        return restoredParents.length > 0 ? [...matched, ...restoredParents] : matched;
    }, [records, activeSiloId, filters]);

    const visibleSilos = useMemo(
        () => silos.filter(s => filteredRecords.some(r => r.siloId === s.id)),
        [silos, filteredRecords],
    );

    const handleSelectRecord = (record: TopicalMapRecord) => {
        setSelectedRecord(record);
        setDetailOpen(true);
    };

    const handleRecordUpdated = (updated: TopicalMapRecord) => {
        setSelectedRecord(updated);
        setLoaded({
            map,
            silos,
            records: records.map(r => (r.id === updated.id ? updated : r)),
        });
    };

    return (
        <section className="space-y-5" aria-label="Topical Map">
            <TopicalMapHeader
                map={map}
                records={records}
                onEditProfile={() => setWizardOpen(true)}
                onRegenerate={() => setWizardOpen(true)}
            />

            <SiloTabBar
                silos={silos}
                records={records}
                activeSiloId={activeSiloId}
                onSelectSilo={setActiveSiloId}
                filters={filters}
                onFiltersChange={setFilters}
            />

            <div className="space-y-3">
                {visibleSilos.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
                        No records match the current filters.
                    </div>
                )}
                {visibleSilos.map(silo => (
                    <SiloAccordion
                        key={silo.id}
                        silo={silo}
                        records={filteredRecords}
                        onSelectRecord={handleSelectRecord}
                    />
                ))}
            </div>

            <ReconciliationSummary records={records} />

            <RecordDetailPanel
                record={selectedRecord}
                silos={silos}
                isOpen={detailOpen}
                onClose={() => setDetailOpen(false)}
                onUpdated={handleRecordUpdated}
                organizationId={organizationId}
                clientId={clientId}
                userId={userId}
            />

            {wizardOpen && (
                <MapGenerationWizard
                    organizationId={organizationId}
                    clientId={clientId}
                    clientName={clientName}
                    onClose={() => setWizardOpen(false)}
                    onGenerated={() => {
                        setWizardOpen(false);
                        void onReload();
                    }}
                />
            )}
        </section>
    );
}
