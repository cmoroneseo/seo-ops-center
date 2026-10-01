import { ClientProject } from '@/lib/types';

/** The agreement stays visible in the existing overview, without another setup page. */
export function ClientSetupScopeCard({ client }: { client: ClientProject }) {
    const scope = client.setupScope;
    if (!scope) return null;
    const services = [
        { label: scope.mode === 'monthly' ? scope.hoursMode === 'committed' ? 'SEO commitment' : 'SEO allowance' : 'SEO estimate', value: `${client.seoHours}h${scope.mode === 'monthly' ? ' / month' : ' total'}` },
        ...(scope.mode === 'monthly' && scope.contentPieces > 0 ? [{ label: 'Content', value: `${scope.contentPieces} pieces / month · Delivered` }] : []),
        ...(scope.gbp ? [{ label: 'Google Business Profile', value: 'Optimization + Management' }] : []),
        ...(scope.listings ? [{ label: 'Directory Listings', value: 'One-time activation + managed listings' }] : []),
    ];
    return <section className="mb-6 rounded-xl border bg-card p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Service scope</h2><span className="text-xs text-muted-foreground">{client.status === 'Onboarding' ? 'Planned · recurring services start at launch' : scope.mode === 'monthly' ? 'Monthly engagement' : 'Custom engagement'}</span></div><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{services.map(service => <div key={service.label}><dt className="text-xs text-muted-foreground">{service.label}</dt><dd className="mt-1 text-sm font-medium">{service.value}</dd></div>)}</dl><p className="mt-4 border-t pt-3 text-xs text-muted-foreground">Onboarding: {client.onboardingDate} · {scope.onboardingBudget === 'separate' ? 'Preparation tracked separately from monthly hours' : 'Budget-counting preparation allocated to first launched month'}</p></section>;
}
