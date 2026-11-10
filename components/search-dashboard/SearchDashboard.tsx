'use client';

import { useEffect, useRef, useState } from 'react';
import { keywordTrackingEnabled } from '@/lib/keyword-tracking/flag';
import { loadSearchDashboard, type DashboardData } from '@/lib/search-dashboard/load';
import {
    bingChartSeries,
    defaultSearchSource,
    gaChartSeries,
    gaKpis,
    gscChartSeries,
    gscKpis,
    visibleSources,
    type BingToggles,
    type GaToggles,
    type GscToggles,
    type SearchSource,
} from '@/lib/search-dashboard/model';
import { SearchDashboardView } from './SearchDashboardView';

const EMPTY_TOGGLES: GscToggles = { clicks: true, impressions: true, position: false };
const EMPTY_GA: GaToggles = { sessions: false, keyEvents: true };
const EMPTY_BING: BingToggles = { clicks: true, impressions: true };

export function SearchDashboard({
    organizationId,
    clientId,
    clientName,
    onConnections,
    windowDays = 28,
    embedded = false,
}: {
    organizationId: string;
    clientId: string;
    clientName: string;
    onConnections: () => void;
    /** 7, 28, or 90. Any other value keeps the 28-day read. */
    windowDays?: number;
    /** Drop the page title when a parent tab already names this view. */
    embedded?: boolean;
}) {
    const picked = useRef(false);
    const [source, setSource] = useState<SearchSource | null>(null);
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<DashboardData | null>(null);
    const [gscToggles, setGscToggles] = useState<GscToggles>(EMPTY_TOGGLES);
    const [gaToggles, setGaToggles] = useState<GaToggles>(EMPTY_GA);
    const [bingToggles, setBingToggles] = useState<BingToggles>(EMPTY_BING);
    const [section, setSection] = useState<'queries' | 'pages'>('queries');

    useEffect(() => {
        picked.current = false;
        setSource(null);
    }, [organizationId, clientId]);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        loadSearchDashboard({ organizationId, clientId, signal: controller.signal, windowDays })
            .then(result => {
                if (controller.signal.aborted) return;
                setData(result);
                setLoading(false);
                if (!picked.current) {
                    setSource(defaultSearchSource({
                        gsc: result.gscConnected,
                        ga: result.gaConnected,
                        bing: result.bing.enabled,
                    }));
                }
            })
            .catch(reason => {
                if (controller.signal.aborted) return;
                setData(null);
                setLoading(false);
                console.error(reason instanceof Error ? reason.message : 'Unable to load Search.');
            });
        return () => controller.abort();
    }, [organizationId, clientId, windowDays]);

    const bingEnabled = data?.bing.enabled === true;
    const sources = visibleSources(bingEnabled);
    const gscSeries = gscChartSeries(gscToggles);
    const gaSeries = gaChartSeries(gaToggles);
    const bingSeries = bingChartSeries(bingToggles);

    return (
        <SearchDashboardView
            clientName={clientName}
            clientId={clientId}
            organizationId={organizationId}
            sources={sources}
            source={source}
            onSource={next => {
                picked.current = true;
                setSource(next);
                setSection('queries');
            }}
            windowLabel={data?.windowLabel ?? `Last ${windowDays === 7 || windowDays === 90 ? windowDays : 28} days`}
            loading={loading}
            showTrack={keywordTrackingEnabled()}
            gscConnected={data?.gscConnected === true}
            gscError={data?.gscError ?? ''}
            gscKpis={gscKpis(data?.gscCurrent ?? { clicks: null, impressions: null, ctr: null, position: null }, data?.gscPrior ?? null, windowDays === 7 || windowDays === 90 ? windowDays : 28)}
            gscPoints={data?.gscPoints ?? []}
            gscSeries={gscSeries}
            gscToggles={gscToggles}
            onGscToggle={key => setGscToggles(current => ({ ...current, [key]: !current[key] }))}
            queries={data?.queries ?? []}
            pages={data?.pages ?? []}
            section={section}
            onSection={setSection}
            tableError={data?.tableError ?? ''}
            hiddenQueries={data?.hiddenQueries ?? 0}
            hiddenPages={data?.hiddenPages ?? 0}
            gaConnected={data?.gaConnected === true}
            gaError={data?.gaError ?? ''}
            gaKpis={gaKpis(data?.gaCurrent ?? null)}
            gaPoints={data?.gaPoints ?? []}
            gaSeries={gaSeries}
            gaToggles={gaToggles}
            onGaToggle={key => setGaToggles(current => ({ ...current, [key]: !current[key] }))}
            bingEnabled={bingEnabled}
            bing={data?.bingView ?? null}
            bingToggles={bingToggles}
            onBingToggle={key => setBingToggles(current => ({ ...current, [key]: !current[key] }))}
            bingSeries={bingSeries}
            onConnections={onConnections}
            embedded={embedded}
        />
    );
}
