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
    clientFacing?: boolean;
    reportId?: string;
    reportStatus?: 'draft' | 'published';
    onEditText?: (blockId: string, patch: Record<string, unknown>) => void;
    roadmap?: ClientRoadmap | null;
    roadmapFromServer?: boolean;
}

interface ShareLinkRow {
    id: string;
    revokedAt: string | null;
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
    const staff = ctx.clientFacing !== true && editable && Boolean(ctx.reportId);
    const sharing = staff && ctx.reportStatus === 'published';
    const [shareUrl, setShareUrl] = useState('');
    const [copied, setCopied] = useState(false);
    const [creating, setCreating] = useState(false);
    const [shareError, setShareError] = useState('');
    const [links, setLinks] = useState<ShareLinkRow[]>([]);

    useEffect(() => {
        if (!sharing || !ctx.reportId) return;
        let cancelled = false;
        fetch(`/api/reports/${ctx.reportId}/roadmap-share`)
            .then(response => response.json())
            .then(body => {
                if (cancelled) return;
                if (body?.migrationRequired) {
                    setShareError('Roadmap links are not available yet.');
                    return;
                }
                if (Array.isArray(body?.links)) setLinks(body.links);
            })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [sharing, ctx.reportId]);

    async function copyLink(url: string) {
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setShareError('');
        } catch {
            setCopied(false);
            setShareError('Copy the link below.');
        }
    }

    async function createLink() {
        if (!ctx.reportId || creating) return;
        setCreating(true);
        setShareError('');
        setCopied(false);
        try {
            const response = await fetch(`/api/reports/${ctx.reportId}/roadmap-share`, { method: 'POST' });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                setShareError(typeof body.error === 'string' ? body.error : 'Could not create a link.');
                return;
            }
            const url = typeof body.url === 'string' ? body.url : '';
            setShareUrl(url);
            if (body.id) setLinks(current => [{ id: String(body.id), revokedAt: null }, ...current]);
            if (url) await copyLink(url);
        } catch {
            setShareError('Could not create a link.');
        } finally {
            setCreating(false);
        }
    }

    async function revokeLink(linkId: string) {
        if (!ctx.reportId) return;
        setShareError('');
        const response = await fetch(`/api/reports/${ctx.reportId}/roadmap-share?linkId=${encodeURIComponent(linkId)}`, { method: 'DELETE' });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            setShareError(typeof body.error === 'string' ? body.error : 'Could not turn off that link.');
            return;
        }
        setLinks(current => current.map(link => link.id === linkId ? { ...link, revokedAt: new Date().toISOString() } : link));
    }

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
            {staff ? (
                <div className="print-hidden mb-4 text-xs">
                    {sharing ? (
                        <>
                            <p className="mb-2 text-muted-foreground">Anyone with this link can see the live plan for this client. No login needed.</p>
                            <button
                                type="button"
                                onClick={createLink}
                                disabled={creating}
                                className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                            >
                                {creating ? 'Creating link…' : 'Share roadmap link'}
                            </button>
                            {shareUrl ? (
                                <p className="mt-2 break-all text-muted-foreground">
                                    {copied ? 'Link copied. ' : null}
                                    This is the only time this link is shown.{' '}
                                    <button type="button" onClick={() => copyLink(shareUrl)} className="underline">Copy link</button>
                                    <span className="mt-1 block">{shareUrl}</span>
                                </p>
                            ) : null}
                            {links.length > 0 ? (
                                <ul className="mt-2 space-y-1 text-muted-foreground">
                                    {links.map(link => (
                                        <li key={link.id} className="flex items-center gap-2">
                                            <span>{link.revokedAt ? 'Link turned off' : 'Link active'}</span>
                                            {!link.revokedAt ? (
                                                <button type="button" onClick={() => revokeLink(link.id)} className="underline">Turn off</button>
                                            ) : null}
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                        </>
                    ) : (
                        <p className="text-muted-foreground">Approve the report, or share it with the client, to create a link.</p>
                    )}
                    {shareError ? <p className="mt-2 text-red-600">{shareError}</p> : null}
                </div>
            ) : null}
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
