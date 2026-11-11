'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { exampleBoard, exampleConfounders, EXAMPLE_BASELINE_NOTE, EXAMPLE_NOTE, EXAMPLE_TODAY, ecoworkzH1Input } from '@/lib/change-log/fixture';
import type { ChartMarker } from '@/lib/change-log/chart';
import type { Confounder, ImpactModel, SeoChange, TimelineItem } from '@/lib/change-log/types';
import type { ChangeInput } from '@/lib/change-log/validate';

import { ChangeLogView, type ChangeLogMode } from './ChangeLogView';

export function ChangeLogTab({
    clientId,
    clientName,
    example,
    changeId,
    view,
    screen,
}: {
    clientId: string;
    clientName: string;
    example: boolean;
    changeId: string | null;
    view: string | null;
    screen: string | null;
}) {
    const router = useRouter();
    const [items, setItems] = useState<TimelineItem[]>(() => example ? exampleBoard().items : []);
    const [setup, setSetup] = useState<'ready' | 'missing' | 'loading'>(example ? 'ready' : 'loading');
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const [detail, setDetail] = useState<{
        change: SeoChange;
        impact: ImpactModel;
        confounders: Confounder[];
        baselineNote: string | null;
        pageMarkers?: ChartMarker[];
    } | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [canEdit, setCanEdit] = useState(true);

    function go(next: { change?: string | null; view?: string | null; example?: boolean; screen?: string | null }) {
        const params = new URLSearchParams();
        params.set('tab', 'changes');
        if (next.example ?? example) params.set('example', '1');
        if (next.change) params.set('change', next.change);
        if (next.view) params.set('view', next.view);
        if (next.screen) params.set('screen', next.screen);
        router.replace(`/workspace/${encodeURIComponent(clientId)}?${params.toString()}`);
    }

    useEffect(() => {
        if (example) {
            setItems(exampleBoard().items);
            setSetup('ready');
            return;
        }
        const controller = new AbortController();
        setSetup('loading');
        fetch(`/api/clients/${encodeURIComponent(clientId)}/changes`, { signal: controller.signal })
            .then(async response => {
                const body = await response.json().catch(() => null);
                if (!response.ok) throw new Error(body?.error || 'Unable to load the change log.');
                setItems(Array.isArray(body?.items) ? body.items : []);
                setSetup(body?.setup === 'missing' ? 'missing' : 'ready');
                if (typeof body?.canEdit === 'boolean') setCanEdit(body.canEdit);
            })
            .catch(loadError => {
                if (controller.signal.aborted) return;
                setError(loadError instanceof Error ? loadError.message : 'Unable to load the change log.');
                setSetup('ready');
            });
        return () => controller.abort();
    }, [clientId, example]);

    useEffect(() => {
        if (!changeId) {
            setDetail(null);
            return;
        }
        if (example) {
            const next = exampleBoard();
            const change = next.changes.find(item => item.id === changeId) ?? null;
            const impact = change ? next.impacts[change.id] : null;
            setDetail(change && impact ? {
                change,
                impact,
                confounders: exampleConfounders(next, change.id),
                baselineNote: EXAMPLE_BASELINE_NOTE,
            } : null);
            return;
        }
        const controller = new AbortController();
        fetch(`/api/clients/${encodeURIComponent(clientId)}/changes/${encodeURIComponent(changeId)}`, { signal: controller.signal })
            .then(async response => {
                const body = await response.json().catch(() => null);
                if (!response.ok) throw new Error(body?.error || 'Unable to load this change.');
                if (!body?.change || !body?.impact) {
                    setDetail(null);
                    return;
                }
                setDetail({
                    change: body.change,
                    impact: body.impact,
                    confounders: Array.isArray(body.confounders) ? body.confounders : [],
                    baselineNote: typeof body.baselineNote === 'string' ? body.baselineNote : null,
                    pageMarkers: Array.isArray(body.pageMarkers) ? body.pageMarkers : [],
                });
                if (typeof body.canEdit === 'boolean') setCanEdit(body.canEdit);
            })
            .catch(loadError => {
                if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : 'Unable to load this change.');
            });
        return () => controller.abort();
    }, [changeId, clientId, example]);

    let mode: ChangeLogMode = 'list';
    if (screen === 'loading') mode = 'loading';
    else if (screen === 'empty') mode = 'empty';
    else if (view === 'new' && canEdit) mode = 'form';
    else if (changeId) mode = 'detail';
    else if (!example && setup === 'loading') mode = 'loading';
    else if (!example && setup === 'missing') mode = 'setup';
    else if (!example && items.length === 0 && !error) mode = 'empty';

    async function submit(input: ChangeInput) {
        if (!canEdit) return;
        if (example) {
            setNotice('Example only. Nothing was saved.');
            go({ view: null, change: 'example-ecoworkz-h1' });
            return;
        }
        setPending(true);
        setError(null);
        try {
            const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/changes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) throw new Error(body?.error || 'Unable to save the change.');
            setNotice(body?.baselineNote || 'Saved.');
            go({ view: null, change: body.id });
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Unable to save the change.');
        } finally {
            setPending(false);
        }
    }

    async function remove() {
        if (!canEdit || !changeId || example) return;
        const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/changes/${encodeURIComponent(changeId)}`, { method: 'DELETE' });
        if (!response.ok) {
            setError('Unable to remove the change.');
            return;
        }
        go({ change: null });
    }

    return (
        <div className="space-y-3">
            {(error || notice) && (
                <p className={`rounded-md px-3 py-2 text-sm ${error ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-border bg-card'}`}>
                    {error || notice}
                </p>
            )}
            <ChangeLogView
                clientName={example ? `${clientName} · example` : clientName}
                mode={mode}
                example={example}
                exampleNote={example ? EXAMPLE_NOTE : undefined}
                items={items}
                detail={detail}
                formInitial={example ? ecoworkzH1Input() : undefined}
                pending={pending}
                onLog={() => go({ view: 'new', change: null })}
                onOpen={id => go({ change: id, view: null })}
                onBack={() => go({ change: null, view: null })}
                onSubmit={submit}
                onRemove={remove}
                onExample={() => go({ example: true })}
                today={example ? EXAMPLE_TODAY : undefined}
                canEdit={canEdit}
            />
        </div>
    );
}
