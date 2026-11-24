'use client';

import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import type { SeoChange } from '@/lib/change-log/types';
import { normalizeControlUrls } from '@/lib/change-log/validate';

export function ControlPagesField({ urls, onChange }: { urls: string[]; onChange: (urls: string[]) => void }) {
    const hint = useId();
    return (
        <label className="block text-sm">
            <span className="mb-1 block font-medium">Control page URLs (optional)</span>
            <textarea
                className="field min-h-16"
                aria-describedby={hint}
                placeholder="One https:// address per line"
                value={urls.join('\n')}
                onChange={event => onChange(event.target.value.split('\n'))}
            />
            <span id={hint} className="mt-1 block text-xs text-muted-foreground">
                Enter other pages on the same site, one URL per line. Leave blank to compare with the rest of the site.
            </span>
        </label>
    );
}

export function ControlPages({ change, wholeSite, onSave }: {
    change: SeoChange;
    wholeSite: boolean;
    onSave?: (urls: string[]) => Promise<void>;
}) {
    const [draft, setDraft] = useState<string[] | null>(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const selected = change.controlUrls ?? [];

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (!draft || !onSave || pending) return;
        const urls = normalizeControlUrls(draft, change.pages.map(page => page.url));
        if (typeof urls === 'string') {
            setError(urls);
            return;
        }
        setPending(true);
        setError(null);
        try {
            await onSave(urls);
            setDraft(null);
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Unable to save the control pages.');
        } finally {
            setPending(false);
        }
    }

    return (
        <section className="rounded-lg border border-border bg-card p-4" aria-label="Control pages">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Compared with {selected.length ? 'selected control pages' : 'the rest of the site'}</h3>
                {onSave && draft === null && (
                    <Button type="button" size="sm" variant="outline" className="change-log-no-print"
                        onClick={() => { setDraft(selected); setError(null); }}>
                        Edit control pages
                    </Button>
                )}
            </div>
            {selected.length > 0 ? (
                <ul className="mt-1 space-y-1 break-all text-sm text-muted-foreground">
                    {selected.map(url => <li key={url}>{url}</li>)}
                </ul>
            ) : (
                <>
                    <p className="mt-1 text-sm text-muted-foreground">
                        This comparison is approximate. Google Search Console counts impressions differently for the whole site and for individual pages.
                        {' '}Average position uses saved page data and excludes the test pages.
                    </p>
                    {wholeSite && <p className="mt-1 text-sm text-muted-foreground">Some checks use whole-site totals because the counts couldn&apos;t be subtracted reliably.</p>}
                </>
            )}
            {draft !== null && (
                <form className="change-log-no-print mt-3 space-y-2" onSubmit={submit}>
                    <fieldset disabled={pending} className="space-y-2">
                        <ControlPagesField urls={draft} onChange={setDraft} />
                        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
                        <div className="flex gap-2">
                            <Button type="submit" size="sm">{pending ? 'Saving…' : 'Save control pages'}</Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
                        </div>
                    </fieldset>
                </form>
            )}
        </section>
    );
}
