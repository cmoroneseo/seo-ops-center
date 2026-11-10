'use client';

import { useEffect, useState } from 'react';
import type { Block } from '@/lib/reports/blocks';
import type { ClientProject } from '@/lib/types';
import { RoadmapReportView } from './RoadmapReportView';
import {
    ROADMAP_COPY,
    presentRoadmap,
    readRoadmapBlockOptions,
    roadmapHasClientDescriptions,
    type ClientRoadmap,
    type RoadmapStageId,
} from '@/lib/reports/roadmap';

interface RoadmapBlockContext {
    client: ClientProject | null;
    onEditText?: (blockId: string, patch: Record<string, unknown>) => void;
    roadmap?: ClientRoadmap | null;
    roadmapFromServer?: boolean;
}

type Load =
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; roadmap: ClientRoadmap };

export function RoadmapReportBlock({ block, ctx }: { block: Block; ctx: RoadmapBlockContext }) {
    const server = ctx.roadmapFromServer === true;
    const [load, setLoad] = useState<Load>(() => {
        if (!server) return { status: 'loading' };
        return ctx.roadmap ? { status: 'ready', roadmap: ctx.roadmap } : { status: 'error' };
    });
    const clientId = ctx.client?.id ?? null;

    useEffect(() => {
        if (!server) return;
        setLoad(ctx.roadmap ? { status: 'ready', roadmap: ctx.roadmap } : { status: 'error' });
    }, [server, ctx.roadmap]);

    useEffect(() => {
        if (server || !clientId) return;
        let cancelled = false;
        setLoad({ status: 'loading' });
        (async () => {
            const response = await fetch(`/api/reports/roadmap/${encodeURIComponent(clientId)}`, {
                cache: 'no-store',
            });
            const body = await response.json().catch(() => null) as { roadmap?: ClientRoadmap } | null;
            if (!response.ok || !body?.roadmap) throw new Error('unavailable');
            if (!cancelled) setLoad({ status: 'ready', roadmap: body.roadmap });
        })().catch(() => {
            if (!cancelled) setLoad({ status: 'error' });
        });
        return () => { cancelled = true; };
    }, [server, clientId]);

    const options = readRoadmapBlockOptions(block.props);
    const editable = Boolean(ctx.onEditText);

    if (server && !ctx.roadmap) return null;
    if (!server && !ctx.client) return <p className="text-sm italic" style={{ color: '#9ca3af' }}>{ROADMAP_COPY.chooseClient}</p>;
    if (load.status === 'loading') return <p className="text-sm italic" style={{ color: '#9ca3af' }}>{ROADMAP_COPY.loading}</p>;
    if (load.status === 'error') return <p className="text-sm italic" style={{ color: '#9ca3af' }}>{ROADMAP_COPY.error}</p>;

    const shown = presentRoadmap(load.roadmap, options);
    const canDescribe = roadmapHasClientDescriptions(load.roadmap);

    function toggleStage(id: RoadmapStageId) {
        const hidden = new Set(options.hiddenStages);
        if (hidden.has(id)) hidden.delete(id);
        else hidden.add(id);
        ctx.onEditText?.(block.id, { hiddenStages: [...hidden] });
    }

    return (
        <div>
            {editable && block.props.settingsOpen ? (
                <fieldset data-roadmap-editor className="print-hidden mb-4 space-y-3 rounded-lg border border-border p-3 text-sm">
                    <legend className="px-1 text-xs font-medium">{ROADMAP_COPY.stagesToShow}</legend>
                    {load.roadmap.stages.map(stage => (
                        <label key={stage.id} className="flex items-center gap-2 text-xs">
                            <input
                                type="checkbox"
                                checked={!options.hiddenStages.includes(stage.id)}
                                onChange={() => toggleStage(stage.id)}
                            />
                            {stage.title}
                        </label>
                    ))}
                    {canDescribe ? (
                        <label className="flex items-center gap-2 text-xs">
                            <input
                                type="checkbox"
                                checked={options.showTaskDescriptions}
                                onChange={() => ctx.onEditText?.(block.id, { showTaskDescriptions: !options.showTaskDescriptions })}
                            />
                            {ROADMAP_COPY.showDescriptions}
                        </label>
                    ) : null}
                    <p className="text-xs text-muted-foreground">{ROADMAP_COPY.descriptionsHelp}</p>
                </fieldset>
            ) : null}
            <RoadmapReportView roadmap={shown} />
        </div>
    );
}
