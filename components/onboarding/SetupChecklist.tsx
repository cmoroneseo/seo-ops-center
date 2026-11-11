'use client';

import { useEffect, useState } from 'react';
import { campaignWorkspaceEnabled } from '@/lib/campaign-workspace/flag';
import {
    SETUP_LOAD_FAILED,
    deriveSetupChecklist,
    generationStages,
    searchConsoleConnectedFromIntegration,
    setupChecklistPanel,
    setupChecklistStorageKey,
    topicMapBuiltFrom,
    type SetupChecklistFacts,
    type SetupChecklistPanel,
    type SetupStepView,
} from '@/lib/onboarding/setup-checklist';
import { listCampaignInitiatives } from '@/lib/supabase/campaign-initiatives';
import { getMarketingPlan } from '@/lib/supabase/marketing-plans';
import { getClientProfile, getTopicalMapByClient } from '@/lib/supabase/topical-map';
import type { ClientIntegration } from '@/lib/types';

export function SetupChecklistView({
    steps,
    panel,
    onDismiss,
}: {
    steps: SetupStepView[];
    panel: SetupChecklistPanel;
    onDismiss: () => void;
}) {
    if (panel === 'hidden') return null;
    return (
        <section aria-label="Client setup" className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold">Set up this client</h2>
                    {panel === 'list' && (
                        <p className="mt-1 text-sm text-muted-foreground">
                            Finish these steps. This list hides itself when they are all done.
                        </p>
                    )}
                </div>
                <button type="button" onClick={onDismiss} className="text-sm text-muted-foreground hover:text-foreground">
                    Hide
                </button>
            </div>
            {panel === 'loading' && <p className="mt-4 text-sm text-muted-foreground">Checking what is left to set up…</p>}
            {panel === 'unavailable' && <p className="mt-4 text-sm text-muted-foreground">{SETUP_LOAD_FAILED}</p>}
            {panel === 'list' && (
                <ol className="mt-2 divide-y divide-border">
                    {steps.map((step, index) => (
                        <li key={step.id} className="flex items-center justify-between gap-3 py-3">
                            <a href={step.href} className="text-sm font-medium hover:text-primary">
                                {index + 1}. {step.label}
                            </a>
                            <span className="text-xs text-muted-foreground">
                                {step.done === true ? 'Done' : step.done === false ? 'Not done' : '—'}
                            </span>
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
            steps={steps}
            panel={panel}
            onDismiss={() => {
                window.localStorage.setItem(setupChecklistStorageKey(clientId), '1');
                setDismissed(true);
            }}
        />
    );
}
