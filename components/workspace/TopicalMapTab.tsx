'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Map, Sparkles } from 'lucide-react';

import { getTopicalMapByClient } from '@/lib/supabase/topical-map';
import { MapGenerationWizard } from '@/components/topical-map/MapGenerationWizard';
import { MapProgressCard } from '@/components/topical-map/MapProgressCard';
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
    const [loading, setLoading] = useState(true);
    const [loaded, setLoaded] = useState<LoadedMap>({ map: null, silos: [], records: [] });
    const [wizardOpen, setWizardOpen] = useState(false);
    const [error, setError] = useState('');

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

    // Ready state — placeholder until Task 7 adds the full map workspace.
    return (
        <section className="space-y-5" aria-label="Topical Map">
            <div className="rounded-2xl border border-border bg-card p-8">
                <div className="flex items-center gap-2 text-primary">
                    <Map className="h-5 w-5" />
                    <h3 className="text-lg font-semibold text-foreground">Map ready</h3>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                    {map.title} — {silos.length} silo{silos.length === 1 ? '' : 's'}, {records.length} record{records.length === 1 ? '' : 's'}.
                </p>
                {map.architectureSummary && (
                    <p className="mt-3 text-sm text-muted-foreground">{map.architectureSummary}</p>
                )}
                <p className="mt-4 text-xs text-muted-foreground">
                    The full silo/record workspace is not built yet — this is a placeholder confirming generation completed.
                </p>
            </div>
        </section>
    );
}
