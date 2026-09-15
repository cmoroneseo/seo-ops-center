'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';

import { getTopicalMapByClient } from '@/lib/supabase/topical-map';
import type { TopicalMap, TopicalMapRecord, TopicalMapSilo } from '@/lib/types';

const STAGES: { key: string; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    { key: 'search_demand', label: 'Search Demand' },
    { key: 'your_pages', label: 'Your Pages' },
    { key: 'architect', label: 'Architect' },
    { key: 'reconciliation', label: 'Reconciliation' },
    { key: 'complete', label: 'Complete' },
];

// The generate API route writes generation_metadata with snake_case keys
// (stages_completed) while lib/types.ts declares the field as camelCase
// (stagesCompleted), and the row mapper does a raw cast without converting
// keys. Read both spellings so this component works against what is
// actually stored today.
function stagesOf(map: TopicalMap | null): string[] {
    const meta = (map?.generationMetadata ?? {}) as Record<string, unknown>;
    const raw = (meta.stagesCompleted ?? meta.stages_completed) as string[] | undefined;
    return raw ?? [];
}

interface MapProgressCardProps {
    clientId: string;
    clientName: string;
    onComplete: (result: { map: TopicalMap; silos: TopicalMapSilo[]; records: TopicalMapRecord[] }) => void;
}

export function MapProgressCard({ clientId, clientName, onComplete }: MapProgressCardProps) {
    const [map, setMap] = useState<TopicalMap | null>(null);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const startedAtRef = useRef(Date.now());
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;

    useEffect(() => {
        let cancelled = false;

        const poll = async () => {
            const result = await getTopicalMapByClient(clientId);
            if (cancelled) return;
            setMap(result.map);
            setElapsedSeconds(Math.round((Date.now() - startedAtRef.current) / 1000));
            if (result.map && stagesOf(result.map).includes('complete')) {
                onCompleteRef.current({ map: result.map, silos: result.silos, records: result.records });
            }
        };

        void poll();
        const interval = setInterval(() => { void poll(); }, 5000);
        return () => { cancelled = true; clearInterval(interval); };
    }, [clientId]);

    const completedStages = stagesOf(map);
    const stuck = elapsedSeconds > 90 && !completedStages.includes('complete');

    return (
        <div role="status" aria-label="Generating topical map" className="flex flex-col items-center justify-center py-16">
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8">
                <h3 className="text-center text-lg font-semibold">Generating topical map for {clientName}</h3>
                <p className="mt-1 text-center text-sm text-muted-foreground">
                    This runs in the background — feel free to switch tabs and check back.
                </p>
                <ol className="mt-6 space-y-3">
                    {STAGES.map((stage, idx) => {
                        const done = completedStages.includes(stage.key);
                        const active = !done && idx === completedStages.length;
                        return (
                            <li key={stage.key} className="flex items-center gap-3 text-sm">
                                {done ? (
                                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                                ) : active ? (
                                    <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
                                ) : (
                                    <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" />
                                )}
                                <span className={done ? 'font-medium text-foreground' : active ? 'text-foreground' : 'text-muted-foreground'}>
                                    {stage.label}
                                </span>
                            </li>
                        );
                    })}
                </ol>
                {stuck && (
                    <p className="mt-6 text-xs text-amber-600">
                        This is taking longer than usual. It may still be running in the background — check back shortly, or refresh the page.
                    </p>
                )}
            </div>
        </div>
    );
}
