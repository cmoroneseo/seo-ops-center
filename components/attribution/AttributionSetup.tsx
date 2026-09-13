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

interface AttributionSetupProps {
    organizationId: string;
    client: ClientProject;
    site: AttributionSite | null;
    onSiteCreated: (site: AttributionSite) => void;
    onClientUpdated: (client: ClientProject) => void;
}

const productionOrigin = 'https://seo-ops-center.vercel.app';

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
    const [verifying, setVerifying] = useState(false);
    const verified = Boolean(site?.verifiedAt);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        setScriptOrigin(window.location.origin);
    }, []);

    useEffect(() => {
        setAvgDealValue(client.avgDealValue != null ? String(client.avgDealValue) : '');
    }, [client.avgDealValue]);

    const siteId = site?.id ?? '(create site first)';
    const scriptSnippet = `<script defer src="${scriptOrigin}/api/attribution/s.js" data-site="${siteId}"></script>`;
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

    return (
        <section className="space-y-5 rounded-xl border border-border/50 bg-card p-5 md:p-6" aria-labelledby="attribution-setup-title">
            <div>
                <h2 id="attribution-setup-title" className="text-lg font-semibold">Attribution Setup</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Connect {client.clientName}&apos;s website to begin collecting first-party conversion data.
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
                        <p className="text-xs text-muted-foreground">Used to estimate pipeline ROI from organic conversions.</p>
                    </div>
                </>
            ) : null}
        </section>
    );
}
