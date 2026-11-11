'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, Circle, Lock } from 'lucide-react';
import { campaignWorkspaceEnabled } from '@/lib/campaign-workspace/flag';
import {
    SETUP_LOAD_FAILED,
    deriveSetupChecklist,
    generationStages,
    searchConsoleConnectedFromIntegration,
    setupChecklistPanel,
    setupChecklistRows,
    setupChecklistStorageKey,
    setupProgress,
    topicMapBuiltFrom,
    type SetupChecklistFacts,
    type SetupChecklistPanel,
    type SetupRow,
    type SetupStepView,
} from '@/lib/onboarding/setup-checklist';
import { cn } from '@/lib/utils';
import { listCampaignInitiatives } from '@/lib/supabase/campaign-initiatives';
import { getMarketingPlan } from '@/lib/supabase/marketing-plans';
import { getClientProfile, getTopicalMapByClient } from '@/lib/supabase/topical-map';
import type { ClientIntegration } from '@/lib/types';

const FOCUS = 'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#ec4899]';
const SECONDARY_BUTTON = cn(
    'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-[#d4d4d8] bg-white px-[11px] text-[12.5px] font-semibold text-[#18181b] hover:bg-[#fafafa]',
    FOCUS,
);

function StepDot({ row, number }: { row: SetupRow; number: number }) {
    if (row.state === 'done') {
        return (
            <span aria-hidden="true" className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full border-2 border-[#15803d] bg-[#15803d] text-white">
                <Check className="h-[15px] w-[15px]" strokeWidth={3} />
            </span>
        );
    }
    return (
        <span
            aria-hidden="true"
            className={cn(
                'grid h-[30px] w-[30px] flex-none place-items-center rounded-full border-2 text-[12.5px] font-bold',
                row.state === 'next' ? 'border-[#18181b] bg-[#18181b] text-white' : 'border-[#d4d4d8] bg-white text-[#52525b]',
            )}
        >
            {number}
        </span>
    );
}

function StepActions({ row }: { row: SetupRow }) {
    switch (row.state) {
        case 'done':
            return (
                <>
                    <span className="inline-flex items-center gap-[5px] whitespace-nowrap text-[13px] font-bold text-[#15803d]">
                        <CheckCircle2 className="h-[15px] w-[15px]" aria-hidden="true" />Done
                    </span>
                    <a
                        href={row.href}
                        aria-label={`Edit ${row.label}`}
                        className={cn('inline-flex h-8 items-center rounded-lg px-[11px] text-[12.5px] font-semibold text-[#52525b] hover:text-[#18181b]', FOCUS)}
                    >
                        Edit
                    </a>
                </>
            );
        case 'next':
            return (
                <>
                    <span className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-full border border-[#fbcfe8] bg-white px-[10px] py-[3px] text-[13px] font-bold text-[#be185d]">
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />Next up
                    </span>
                    <a
                        href={row.href}
                        className={cn(
                            'inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-[#18181b] bg-[#18181b] px-[18px] text-sm font-semibold text-white hover:bg-[#27272a]',
                            FOCUS,
                        )}
                    >
                        {row.action}<ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </a>
                </>
            );
        case 'locked':
            return (
                <span className="inline-flex items-center gap-[5px] whitespace-nowrap text-[13px] font-semibold text-[#52525b]">
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />Not started · {row.lockedReason}
                </span>
            );
        case 'unknown':
            return (
                <>
                    <span className="whitespace-nowrap text-[13px] font-semibold text-[#52525b]">Couldn&apos;t check</span>
                    <a href={row.href} className={SECONDARY_BUTTON}>{row.action}</a>
                </>
            );
        case 'todo':
            return (
                <>
                    <span className="inline-flex items-center gap-[5px] whitespace-nowrap text-[13px] font-semibold text-[#52525b]">
                        <Circle className="h-3.5 w-3.5" aria-hidden="true" />Not started
                    </span>
                    <a href={row.href} className={SECONDARY_BUTTON}>{row.action}</a>
                </>
            );
    }
}

export function SetupChecklistView({
    clientName,
    steps,
    panel,
    onDismiss,
}: {
    clientName: string;
    steps: SetupStepView[];
    panel: SetupChecklistPanel;
    onDismiss: () => void;
}) {
    if (panel === 'hidden') return null;
    const rows = setupChecklistRows(steps);
    const progress = setupProgress(steps);
    const name = clientName.trim() || 'this client';
    return (
        <section aria-labelledby="setup-checklist-title" className="mb-4 overflow-hidden rounded-xl border border-[#e4e4e7] bg-white text-[#18181b]">
            <div className="flex flex-wrap items-center gap-5 border-b border-[#e4e4e7] px-[22px] py-[18px]">
                <div className="min-w-0">
                    <h2 id="setup-checklist-title" className="text-[17px] font-bold">Finish setting up {name}</h2>
                    <p className="mt-0.5 text-[13px] text-[#52525b]">This checklist stays at the top of the Overview until every step is done.</p>
                </div>
                <div className="ml-auto flex items-center gap-3">
                    {panel === 'list' && (
                        <div className="w-[260px]">
                            <div className="mb-[7px] flex justify-between text-[13px]">
                                <b className="font-bold">{progress.done} of {progress.total} done</b>
                                <span className="text-[#52525b]">{progress.left} to go</span>
                            </div>
                            <div
                                role="progressbar"
                                aria-label="Setup progress"
                                aria-valuemin={0}
                                aria-valuemax={progress.total}
                                aria-valuenow={progress.done}
                                className="h-2 overflow-hidden rounded-full bg-[#e4e4e7]"
                            >
                                <span className="block h-full rounded-full bg-[#db2777]" style={{ width: `${progress.percent}%` }} />
                            </div>
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={onDismiss}
                        className={cn('inline-flex h-8 items-center rounded-lg px-[11px] text-[12.5px] font-semibold text-[#52525b] hover:text-[#18181b]', FOCUS)}
                    >
                        Hide
                    </button>
                </div>
            </div>
            {panel === 'loading' && <p className="px-[22px] py-4 text-[13px] text-[#52525b]">Checking what is left to set up…</p>}
            {panel === 'unavailable' && <p role="alert" className="px-[22px] py-4 text-[13px] text-[#52525b]">{SETUP_LOAD_FAILED}</p>}
            {panel === 'list' && (
                <ol>
                    {rows.map((row, index) => (
                        <li
                            key={row.id}
                            data-state={row.state}
                            aria-current={row.state === 'next' ? 'step' : undefined}
                            className={cn(
                                'relative flex min-h-[68px] flex-wrap items-center gap-4 border-b border-[#f0f0f2] px-[22px] py-[14px] last:border-b-0',
                                row.state === 'next' && 'bg-[#fdf2f8]',
                            )}
                        >
                            {row.state === 'next' && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-[#db2777]" />}
                            <StepDot row={row} number={index + 1} />
                            <div className="min-w-0 flex-1">
                                <b className={cn('block text-[14.5px]', row.state === 'done' ? 'font-semibold text-[#52525b]' : 'font-bold')}>{row.label}</b>
                                <span className="text-[13px] text-[#52525b]">{row.description}</span>
                            </div>
                            <div className="flex min-w-[250px] items-center justify-end gap-3">
                                <StepActions row={row} />
                            </div>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}

async function loadFacts(clientId: string, organizationId: string, clientName: string): Promise<SetupChecklistFacts> {
    const [profileResult, mapResult, planResult, initiativeResult, integrationResult] = await Promise.all([
        getClientProfile(clientId).then(profile => ({ profile, failed: false })).catch(() => ({ profile: null, failed: true })),
        getTopicalMapByClient(clientId).then(loaded => ({ loaded, failed: false })).catch(() => ({ loaded: null, failed: true })),
        getMarketingPlan(clientId).then(plan => plan?.items?.length ?? 0).catch(() => null),
        listCampaignInitiatives(clientId).then(result => result.unavailable ? null : result.initiatives.length).catch(() => null),
        fetch(`/api/integrations/status?clientId=${encodeURIComponent(clientId)}&orgId=${encodeURIComponent(organizationId)}`, { credentials: 'same-origin' })
            .then(async response => response.ok ? response.json() as Promise<{ integrations?: ClientIntegration[] }> : null)
            .catch(() => null),
    ]);

    const gsc = integrationResult
        ? (integrationResult.integrations ?? []).find(row => row.service === 'gsc') ?? null
        : 'unknown';

    return {
        clientName,
        brandName: profileResult.failed ? null : profileResult.profile?.brandName ?? '',
        businessDescription: profileResult.failed ? null : profileResult.profile?.businessDescription ?? '',
        competitors: profileResult.failed ? null : profileResult.profile?.rivals ?? [],
        keywords: profileResult.failed ? null : profileResult.profile?.keywords ?? [],
        searchConsoleConnected: searchConsoleConnectedFromIntegration(gsc === 'unknown' ? 'unknown' : gsc),
        topicMapBuilt: mapResult.failed || !mapResult.loaded
            ? null
            : topicMapBuiltFrom(mapResult.loaded.map
                ? { status: 'present', stages: generationStages(mapResult.loaded.map.generationMetadata), recordCount: mapResult.loaded.records.length }
                : { status: 'missing' }),
        marketingPlanItemCount: planResult,
        initiativeCount: initiativeResult,
    };
}

export function SetupChecklist({
    clientId,
    organizationId,
    clientName,
}: {
    clientId: string;
    organizationId: string;
    clientName: string;
}) {
    const [dismissed, setDismissed] = useState<boolean | null>(null);
    const [status, setStatus] = useState<'loading' | 'failed' | 'ready'>('loading');
    const [steps, setSteps] = useState<SetupStepView[]>([]);

    useEffect(() => {
        setDismissed(window.localStorage.getItem(setupChecklistStorageKey(clientId)) === '1');
    }, [clientId]);

    useEffect(() => {
        if (dismissed !== false) return;
        let cancelled = false;
        setStatus('loading');
        loadFacts(clientId, organizationId, clientName).then(facts => {
            if (cancelled) return;
            setSteps(deriveSetupChecklist(facts, { clientId, campaignWorkspace: campaignWorkspaceEnabled() }));
            setStatus('ready');
        }).catch(() => {
            if (!cancelled) setStatus('failed');
        });
        return () => { cancelled = true; };
    }, [dismissed, clientId, organizationId, clientName]);

    if (dismissed == null) return null;
    const panel = setupChecklistPanel({ status: dismissed ? 'ready' : status, steps, dismissed });
    if (panel === 'hidden') return null;

    return (
        <SetupChecklistView
            clientName={clientName}
            steps={steps}
            panel={panel}
            onDismiss={() => {
                window.localStorage.setItem(setupChecklistStorageKey(clientId), '1');
                setDismissed(true);
            }}
        />
    );
}
