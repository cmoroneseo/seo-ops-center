'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    getAttributionSite,
    getConversions,
    getEventCountsBySource,
    getLandingPagePerformance,
} from '@/lib/supabase/attribution';
import type { AttributionConversion, AttributionSite, ClientProject } from '@/lib/types';
import { countSeoConversions } from '@/lib/attribution/source-classifier';

import { AttributionSetup } from './AttributionSetup';
import { ConversionLog } from './ConversionLog';
import { ConversionTimeline } from './ConversionTimeline';
import { LandingPagePerformance } from './LandingPagePerformance';
import { RoiCard } from './RoiCard';
import { SourceDonut } from './SourceDonut';

interface AttributionTabProps {
    organizationId: string;
    clientId: string;
    client: ClientProject;
    onClientUpdated?: (client: ClientProject) => void;
}

type SourceCount = { sourceCategory: string; count: number };
type PagePerformance = { landingPage: string; count: number; topQuery: string; organicPct: number };

export function AttributionTab({ organizationId, clientId, client, onClientUpdated }: AttributionTabProps) {
    const [site, setSite] = useState<AttributionSite | null>();
    const [conversions, setConversions] = useState<AttributionConversion[]>([]);
    const [sourceCounts, setSourceCounts] = useState<SourceCount[]>([]);
    const [pagePerformance, setPagePerformance] = useState<PagePerformance[]>([]);
    const [avgDealValue, setAvgDealValue] = useState(client.avgDealValue);
    const [loadingDashboard, setLoadingDashboard] = useState(true);
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);
    const [showSettings, setShowSettings] = useState(false);

    const month = new Date().toISOString().slice(0, 7);

    useEffect(() => {
        setAvgDealValue(client.avgDealValue);
    }, [client.avgDealValue, clientId]);

    const handleClientUpdated = (updated: ClientProject) => {
        setAvgDealValue(updated.avgDealValue);
        onClientUpdated?.(updated);
    };

    useEffect(() => {
        let active = true;
        setSite(undefined);
        setError('');
        getAttributionSite(clientId)
            .then(result => {
                if (active) setSite(result);
            })
            .catch(reason => {
                if (!active) return;
                setError(reason instanceof Error ? reason.message : 'Unable to load attribution setup.');
                setSite(null);
            });
        return () => { active = false; };
    }, [clientId, revision]);

    useEffect(() => {
        if (!site?.verifiedAt) return;
        let active = true;
        setLoadingDashboard(true);
        setError('');
        Promise.all([
            getConversions(clientId, { month }),
            getEventCountsBySource(clientId, month),
            getLandingPagePerformance(clientId, month),
        ]).then(([loadedConversions, loadedSources, loadedPages]) => {
            if (!active) return;
            setConversions(loadedConversions);
            setSourceCounts(loadedSources);
            setPagePerformance(loadedPages);
        }).catch(reason => {
            if (active) setError(reason instanceof Error ? reason.message : 'Unable to load attribution reporting.');
        }).finally(() => {
            if (active) setLoadingDashboard(false);
        });
        return () => { active = false; };
    }, [site, clientId, month, revision]);

    if (site === undefined) {
        return (
            <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-border p-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading attribution…
            </div>
        );
    }

    if (site === null && error) {
        return (
            <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <div>
                        <p className="font-medium">Attribution setup needs attention</p>
                        <p className="mt-1 text-muted-foreground">{error}</p>
                    </div>
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => setRevision(value => value + 1)}>
                    Try again
                </Button>
            </div>
        );
    }

    if (!site || !site.verifiedAt) {
        return (
            <AttributionSetup
                organizationId={organizationId}
                client={client}
                site={site}
                onSiteCreated={setSite}
                onClientUpdated={handleClientUpdated}
            />
        );
    }

    if (loadingDashboard) {
        return (
            <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-border p-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading attribution reporting…
            </div>
        );
    }

    if (error) {
        return (
            <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <div>
                        <p className="font-medium">Attribution reporting needs attention</p>
                        <p className="mt-1 text-muted-foreground">{error}</p>
                    </div>
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => setRevision(value => value + 1)}>
                    Try again
                </Button>
            </div>
        );
    }

    const seoConversions = countSeoConversions(sourceCounts);
    const monthlyRetainer = (client.seoHours ?? 0) * 150;

    return (
        <section className="space-y-6" aria-label="Attribution dashboard">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-semibold">Attribution</h2>
                    <p className="mt-1 text-sm text-muted-foreground">First-party conversion reporting for the current month.</p>
                </div>
                <Button type="button" variant="outline" onClick={() => setShowSettings(value => !value)} aria-expanded={showSettings}>
                    <Settings2 />
                    {showSettings ? 'Hide Setup' : 'Attribution Setup'}
                </Button>
            </header>

            {showSettings ? (
                <AttributionSetup
                    organizationId={organizationId}
                    client={client}
                    site={site}
                    onSiteCreated={setSite}
                    onClientUpdated={handleClientUpdated}
                />
            ) : null}

            <RoiCard conversions={seoConversions} avgDealValue={avgDealValue} monthlyRetainer={monthlyRetainer} />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-border/50 bg-card p-4">
                    <h3 className="mb-3 text-sm font-semibold">Source Breakdown</h3>
                    <SourceDonut data={sourceCounts} />
                </div>
                <div className="rounded-xl border border-border/50 bg-card p-4">
                    <h3 className="mb-3 text-sm font-semibold">Conversion Timeline</h3>
                    <ConversionTimeline conversions={conversions} />
                </div>
            </div>

            <div className="rounded-xl border border-border/50 bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold">Conversion Log</h3>
                <ConversionLog conversions={conversions} />
            </div>

            <div className="rounded-xl border border-border/50 bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold">Landing Page Performance</h3>
                <LandingPagePerformance pages={pagePerformance} />
            </div>
        </section>
    );
}
