'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Clipboard, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createAttributionSite, updateAttributionSite, verifyAttributionSite } from '@/lib/supabase/attribution';
import { normalizeDomain } from '@/lib/attribution/domain';
import { updateClientProject } from '@/lib/supabase/clients';
import type { AttributionSite, ClientProject } from '@/lib/types';
import { buildTrackingSnippet, trackingScriptOrigin } from '@/lib/attribution/install';

interface AttributionSetupProps {
    organizationId: string;
    client: ClientProject;
    site: AttributionSite | null;
    onSiteCreated: (site: AttributionSite) => void;
    onClientUpdated: (client: ClientProject) => void;
}

const productionOrigin = trackingScriptOrigin('https://seo-ops-center.vercel.app');

export function AttributionSetup({
    organizationId,
    client,
    site,
    onSiteCreated,
    onClientUpdated,
}: AttributionSetupProps) {
    const [domain, setDomain] = useState(site?.domain ?? client.domain ?? '');
    const [avgDealValue, setAvgDealValue] = useState(
        client.avgDealValue != null ? String(client.avgDealValue) : '',
    );
    const [scriptOrigin, setScriptOrigin] = useState(productionOrigin);
    const [savingDomain, setSavingDomain] = useState(false);
    const [savingDealValue, setSavingDealValue] = useState(false);
    const [savingTracking, setSavingTracking] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const verified = Boolean(site?.verifiedAt);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        setScriptOrigin(trackingScriptOrigin(window.location.origin));
    }, []);

    useEffect(() => {
        setAvgDealValue(client.avgDealValue != null ? String(client.avgDealValue) : '');
    }, [client.avgDealValue]);

    const siteId = site?.id ?? '(create site first)';
    const trackTelClicks = site?.scriptConfig.track_tel_clicks ?? true;
    const scriptSnippet = buildTrackingSnippet(scriptOrigin, siteId, trackTelClicks);
    const normalizedDomain = normalizeDomain(domain);
    const domainChanged = Boolean(site && normalizedDomain !== site.domain);

    const handleDomainSave = async () => {
        if (!normalizedDomain) return;
        setSavingDomain(true);
        setError('');
        setSuccess('');
        try {
            const saved = site
                ? await updateAttributionSite(site.id, { domain: normalizedDomain })
                : await createAttributionSite({
                    organizationId,
                    clientId: client.id,
                    domain: normalizedDomain,
                });
            setDomain(saved.domain);
            onSiteCreated(saved);
            setSuccess(site ? 'Website domain updated.' : 'Attribution site created. Add the script, then verify the installation.');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to save the attribution site.');
        } finally {
            setSavingDomain(false);
        }
    };

    const handleCopy = async () => {
        setError('');
        try {
            await navigator.clipboard.writeText(scriptSnippet);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch {
            setError('Unable to copy the tracking script. Select and copy it manually.');
        }
    };

    const handleVerify = async () => {
        if (!site) return;
        setVerifying(true);
        setError('');
        setSuccess('');
        try {
            const updated = await verifyAttributionSite(site.id);
            onSiteCreated(updated);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to verify the installation.');
        } finally {
            setVerifying(false);
        }
    };

    const handleDealValueSave = async () => {
        const value = Number(avgDealValue);
        if (!Number.isFinite(value) || value <= 0) {
            setError('Average deal value must be greater than zero.');
            return;
        }
        setSavingDealValue(true);
        setError('');
        setSuccess('');
        try {
            const result = await updateClientProject(client.id, { avgDealValue: value });
            if (!result.success || !result.data) throw new Error(result.error || 'Unable to save average deal value.');
            onClientUpdated(result.data);
            setSuccess('Average deal value saved.');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to save average deal value.');
        } finally {
            setSavingDealValue(false);
        }
    };

    const handleTrackingUpdate = async (params: { trackTelClicks?: boolean; isActive?: boolean }) => {
        if (!site) return;
        setSavingTracking(true);
        setError('');
        setSuccess('');
        try {
            const saved = await updateAttributionSite(site.id, {
                isActive: params.isActive,
                scriptConfig: params.trackTelClicks === undefined ? undefined : {
                    ...site.scriptConfig,
                    track_tel_clicks: params.trackTelClicks,
                },
            });
            onSiteCreated(saved);
            setSuccess(params.isActive === undefined ? 'Tracking options saved.' : params.isActive ? 'Collection resumed.' : 'Collection paused.');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to update tracking settings.');
        } finally {
            setSavingTracking(false);
        }
    };

    return (
        <section className="space-y-5 rounded-xl border border-border/50 bg-card p-5 md:p-6" aria-labelledby="attribution-setup-title">
            <div>
                <h2 id="attribution-setup-title" className="text-lg font-semibold">Attribution Setup</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Connect {client.clientName}&apos;s website to begin collecting browser-recorded conversion activity.
                </p>
            </div>

            {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
            {success ? <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-600 dark:text-emerald-400">{success}</p> : null}

            <div className="space-y-2">
                <Label htmlFor="attribution-domain">Website Domain</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                        id="attribution-domain"
                        type="text"
                        value={domain}
                        onChange={event => setDomain(event.target.value)}
                        placeholder="www.clientsite.com"
                        autoCapitalize="none"
                        autoCorrect="off"
                        aria-invalid={Boolean(domain.trim() && !normalizedDomain)}
                    />
                    {!site || domainChanged ? (
                        <Button type="button" onClick={() => void handleDomainSave()} disabled={savingDomain || !normalizedDomain}>
                            {savingDomain ? <Loader2 className="animate-spin" /> : null}
                            {savingDomain ? 'Saving…' : site ? 'Save Domain' : 'Create Site'}
                        </Button>
                    ) : null}
                </div>
                {domain.trim() && !normalizedDomain ? <p className="text-xs text-destructive">Enter a valid website domain, such as example.com.</p> : null}
            </div>

            {site ? (
                <>
                    <div className="space-y-2">
                        <Label htmlFor="attribution-script">Tracking Script</Label>
                        <div className="relative">
                            <pre id="attribution-script" className="overflow-x-auto rounded-md bg-muted p-3 pr-20 text-xs">{scriptSnippet}</pre>
                            <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()} className="absolute right-2 top-2">
                                <Clipboard />
                                {copied ? 'Copied!' : 'Copy'}
                            </Button>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <Button type="button" variant="outline" size="sm" onClick={() => void handleVerify()} disabled={verifying || domainChanged}>
                            {verifying ? <Loader2 className="animate-spin" /> : null}
                            {verifying ? 'Checking…' : 'Verify Installation'}
                        </Button>
                        {verified ? (
                            <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="h-4 w-4" /> Verified
                            </span>
                        ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">Open your website after installing the script. Verification confirms that a tracking event reached this workspace.</p>

                    <div className="space-y-3 rounded-lg border border-border/50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-medium">Collection status</p>
                                <p className="text-xs text-muted-foreground">Pause collection without removing the installed script.</p>
                            </div>
                            <Button type="button" variant="outline" size="sm" disabled={savingTracking} onClick={() => void handleTrackingUpdate({ isActive: !site.isActive })}>
                                {site.isActive ? 'Pause Collection' : 'Resume Collection'}
                            </Button>
                        </div>
                        <label className="flex items-start gap-3 text-sm">
                            <input
                                type="checkbox"
                                checked={trackTelClicks}
                                disabled={savingTracking}
                                onChange={event => void handleTrackingUpdate({ trackTelClicks: event.target.checked })}
                                className="mt-0.5 h-4 w-4 rounded border-border"
                            />
                            <span>
                                Track phone-link clicks
                                <span className="block text-xs text-muted-foreground">Records clicks on links beginning with tel:. These are interaction events, not confirmed calls.</span>
                            </span>
                        </label>
                    </div>

                    <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                        <p className="font-medium text-foreground">Content Security Policy</p>
                        <p>Add <code className="font-mono">{scriptOrigin}</code> to both your site&apos;s <code className="font-mono">script-src</code> and <code className="font-mono">connect-src</code> directives.</p>
                    </div>

                    <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                        <p className="font-medium text-foreground">Privacy and consent</p>
                        <p>Document this tracking in the client&apos;s privacy notice. Where consent is required, configure the consent manager to load this script only after the visitor opts in.</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="attribution-deal-value">Average Deal Value ($)</Label>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <Input
                                id="attribution-deal-value"
                                type="number"
                                min="1"
                                step="1"
                                value={avgDealValue}
                                onChange={event => setAvgDealValue(event.target.value)}
                                placeholder="e.g. 4500"
                                className="sm:w-48"
                            />
                            <Button type="button" variant="outline" onClick={() => void handleDealValueSave()} disabled={savingDealValue || !avgDealValue}>
                                {savingDealValue ? <Loader2 className="animate-spin" /> : null}
                                {savingDealValue ? 'Saving…' : 'Save Value'}
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">Used to estimate attributed pipeline potential from SEO and AI conversion events.</p>
                    </div>
                </>
            ) : null}
        </section>
    );
}
