'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type { Block } from '@/lib/reports/blocks';
import { parseGtmEventsSnapshot, parseGtmReportSettings, type GtmReportSettings } from '@/lib/reports/gtm-events';
import { GtmEventsReport } from './GtmEventsReport';
import type { ReportContext } from './ReportBlocks';

const EMPTY_SETTINGS: GtmReportSettings = {
    excludedLinkTexts: [],
    fallbackEventNames: [],
    outboundEventName: 'property_outbound_click',
    bookingEventName: 'booking_click',
    ticketEventName: 'buy_tickets_click',
};

function lines(value: string): string[] {
    return value.split('\n').map(line => line.trim()).filter(Boolean);
}

export function GtmEventsReportBlock({ block, ctx }: { block: Block; ctx: ReportContext }) {
    const snapshot = parseGtmEventsSnapshot(block.props.snapshot);
    const staff = ctx.clientFacing !== true && Boolean(ctx.onEditText);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [staffNote, setStaffNote] = useState(typeof block.props.staffNote === 'string' ? block.props.staffNote : '');
    const [settings, setSettings] = useState<GtmReportSettings>(EMPTY_SETTINGS);
    const [excluded, setExcluded] = useState('');
    const [fallback, setFallback] = useState('');
    const [saving, setSaving] = useState(false);
    const [shareUrl, setShareUrl] = useState('');
    const [links, setLinks] = useState<{ id: string; createdAt: string; revokedAt: string | null }[]>([]);

    useEffect(() => {
        if (!staff || !ctx.client?.id) return;
        let cancelled = false;
        fetch(`/api/clients/${ctx.client.id}/gtm-settings`)
            .then(response => response.json())
            .then(body => {
                if (cancelled) return;
                const parsed = parseGtmReportSettings(body.settings ?? {});
                if (!parsed.ok) return;
                setSettings(parsed.settings);
                setExcluded(parsed.settings.excludedLinkTexts.join('\n'));
                setFallback(parsed.settings.fallbackEventNames.join('\n'));
            })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [staff, ctx.client?.id]);

    useEffect(() => {
        if (!staff || ctx.reportStatus !== 'published') return;
        let cancelled = false;
        fetch(`/api/reports/${ctx.reportId}/gtm-share`)
            .then(response => response.json())
            .then(body => { if (!cancelled && Array.isArray(body.links)) setLinks(body.links); })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [staff, ctx.reportId, ctx.reportStatus]);

    async function createLink() {
        setError('');
        const response = await fetch(`/api/reports/${ctx.reportId}/gtm-share`, { method: 'POST' });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            setError(body.error || 'Could not create a public link.');
            return;
        }
        setShareUrl(typeof body.url === 'string' ? body.url : '');
        if (body.id) setLinks(current => [{ id: String(body.id), createdAt: new Date().toISOString(), revokedAt: null }, ...current]);
    }

    async function revokeLink(linkId: string) {
        const response = await fetch(`/api/reports/${ctx.reportId}/gtm-share?linkId=${encodeURIComponent(linkId)}`, { method: 'DELETE' });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            setError(body.error || 'Could not turn off that link.');
            return;
        }
        setLinks(current => current.map(link => link.id === linkId ? { ...link, revokedAt: new Date().toISOString() } : link));
    }

    async function refresh() {
        if (!ctx.onEditText) return;
        setLoading(true);
        setError('');
        try {
            const response = await fetch(`/api/reports/${ctx.reportId}/gtm-events`, { method: 'POST' });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'Could not load events.');
            const next = parseGtmEventsSnapshot(body.snapshot);
            if (!next) throw new Error('Could not load events.');
            const note = typeof body.staffNote === 'string' ? body.staffNote : '';
            setStaffNote(note);
            ctx.onEditText(block.id, { snapshot: next, staffNote: note });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not load events.');
        } finally {
            setLoading(false);
        }
    }

    async function saveSettings() {
        if (!ctx.client?.id) return;
        setSaving(true);
        setError('');
        const parsed = parseGtmReportSettings({
            ...settings,
            excludedLinkTexts: lines(excluded),
            fallbackEventNames: lines(fallback),
        });
        if (!parsed.ok) {
            setError(parsed.error);
            setSaving(false);
            return;
        }
        try {
            const response = await fetch(`/api/clients/${ctx.client.id}/gtm-settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(parsed.settings),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'Could not save settings.');
            setSettings(parsed.settings);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save settings.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div>
            {staff ? (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={refresh} disabled={loading || !ctx.client}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
                        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Load events
                    </button>
                    {ctx.reportStatus === 'published' ? (
                        <button type="button" onClick={createLink} className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted">
                            Create public link
                        </button>
                    ) : <span className="text-xs text-muted-foreground">Publish the report to create a public link.</span>}
                    {!ctx.client ? <span className="text-xs text-muted-foreground">Assign a client first.</span> : null}
                </div>
            ) : null}
            {staff && shareUrl ? <p className="mb-3 break-all text-xs">Public link, shown once: {shareUrl}</p> : null}
            {staff && links.length > 0 ? (
                <ul className="mb-3 space-y-1 text-xs text-muted-foreground">
                    {links.map(link => (
                        <li key={link.id} className="flex items-center gap-2">
                            <span>{link.revokedAt ? 'Link turned off' : 'Link active'}</span>
                            {!link.revokedAt ? <button type="button" onClick={() => revokeLink(link.id)} className="underline">Turn off</button> : null}
                        </li>
                    ))}
                </ul>
            ) : null}
            {staff && error ? <p className="mb-3 text-xs text-red-600">{error}</p> : null}
            {staff && staffNote ? <p className="mb-3 text-xs text-amber-700">{staffNote}</p> : null}
            {staff && block.props.settingsOpen ? (
                <div className="mb-4 space-y-3 rounded-lg border border-border p-3 text-sm">
                    <p className="text-xs text-muted-foreground">Link text to leave out of outbound, booking, ticket, and tag totals. Kentina uses “Allow cookies” and “Decline”. The saved event list is used only when Tag Manager is not connected. Analytics property 542058119 and container GTM-W8Q8SC6V are chosen on the Integrations tab, not here.</p>
                    <label className="block text-xs font-medium">Excluded link text
                        <textarea value={excluded} onChange={event => setExcluded(event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs" placeholder={'Allow cookies\nDecline'} />
                    </label>
                    <label className="block text-xs font-medium">Saved event names, if Tag Manager is not connected
                        <textarea value={fallback} onChange={event => setFallback(event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs" placeholder={'property_outbound_click\nbooking_click'} />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-3">
                        {([
                            ['outboundEventName', 'Outbound event'],
                            ['bookingEventName', 'Booking event'],
                            ['ticketEventName', 'Ticket event'],
                        ] as const).map(([key, label]) => (
                            <label key={key} className="block text-xs font-medium">{label}
                                <input value={settings[key]} onChange={event => setSettings(current => ({ ...current, [key]: event.target.value }))}
                                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs" />
                            </label>
                        ))}
                    </div>
                    <button type="button" onClick={saveSettings} disabled={saving}
                        className="rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground disabled:opacity-50">
                        {saving ? 'Saving…' : 'Save settings'}
                    </button>
                </div>
            ) : null}
            {snapshot ? <GtmEventsReport report={snapshot} /> : (
                <p className="text-sm text-muted-foreground">Load events to fill this report. The numbers freeze when the report is published.</p>
            )}
        </div>
    );
}
