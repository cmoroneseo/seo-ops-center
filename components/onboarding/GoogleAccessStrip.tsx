import { Check, ChevronRight } from 'lucide-react';
import {
    GOOGLE_ACCESS_SERVICES,
    googleAccessHref,
    type GoogleAccess,
    type GoogleAccessService,
    type GoogleAccessState,
} from '@/lib/onboarding/google-access';

const SERVICES: Record<GoogleAccessService, { short: string; name: string }> = {
    gsc: { short: 'GSC', name: 'Google Search Console' },
    ga4: { short: 'GA4', name: 'Google Analytics (GA4)' },
    gtm: { short: 'GTM', name: 'Google Tag Manager' },
};

const LABELS: Record<GoogleAccessState, string> = {
    'not-connected': 'Not connected',
    pick: 'Pick property',
    connected: 'Connected',
    'needs-reconnect': 'Needs reconnect',
};

export function GoogleAccessStrip({ clientId, access }: {
    clientId: string;
    access: GoogleAccess | null | undefined;
}) {
    return (
        <section aria-labelledby="google-access-title" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-card px-4 py-2 text-card-foreground">
            <h2 id="google-access-title" className="text-sm font-semibold">Google access</h2>
            {access ? (
                <ul className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {GOOGLE_ACCESS_SERVICES.map(service => {
                        const state = access[service];
                        const label = service === 'gtm' && state === 'pick' ? 'Pick container' : LABELS[state];
                        const { short, name } = SERVICES[service];
                        return (
                            <li key={service}>
                                <a
                                    href={googleAccessHref(clientId, service)}
                                    aria-label={`${short} ${label}. Open ${name} settings`}
                                    className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs hover:bg-secondary focus-visible:outline-[3px] focus-visible:outline-offset-4 focus-visible:outline-ring max-sm:min-h-11"
                                >
                                    <span className="font-semibold">{short}</span>
                                    {state === 'connected' && <Check aria-hidden="true" className="size-3 text-emerald-700 dark:text-emerald-400" />}
                                    <span className={state === 'needs-reconnect' ? 'text-red-700 dark:text-destructive' : 'text-muted-foreground'}>{label}</span>
                                    <ChevronRight aria-hidden="true" className="size-3 text-muted-foreground" />
                                </a>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <p role="status" className="text-xs text-muted-foreground">
                    {access === undefined ? 'Loading connection status…' : 'Couldn’t load connection status. Refresh to try again.'}
                </p>
            )}
        </section>
    );
}
