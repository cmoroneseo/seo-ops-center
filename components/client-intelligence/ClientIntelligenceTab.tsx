'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Building2, Check, Globe2, Megaphone, Save, Search, ShieldCheck, Sparkles, Target, Users2 } from 'lucide-react';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { ClientIntelligence } from '@/lib/types';
import { clientIntelligenceReadiness, getClientIntelligence, saveClientIntelligence } from '@/lib/supabase/client-intelligence';
import { cn } from '@/lib/utils';

const emptyProfile = (organizationId: string, clientId: string, clientName: string, website?: string): ClientIntelligence => ({
    id: '', organizationId, clientId, status: 'draft', version: 1,
    business: { name: clientName, website: website ?? '' }, offers: { items: [] }, audiences: { segments: [] }, markets: {}, seoContext: {}, brandConstraints: {},
    createdAt: '', updatedAt: '',
});

export function ClientIntelligenceTab({ organizationId, clientId, clientName, website }: { organizationId: string; clientId: string; clientName: string; website?: string }) {
    const member = useCurrentMember();
    const [saved, setSaved] = useState<ClientIntelligence | null>(null);
    const [draft, setDraft] = useState<ClientIntelligence>(() => emptyProfile(organizationId, clientId, clientName, website));
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<'draft' | 'publish' | null>(null);
    const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        setLoading(true);
        getClientIntelligence(clientId).then(profile => {
            setSaved(profile);
            setDraft(profile ?? emptyProfile(organizationId, clientId, clientName, website));
            setLoading(false);
        });
    }, [organizationId, clientId, clientName, website]);

    const readiness = useMemo(() => clientIntelligenceReadiness(draft), [draft]);

    async function save(publish: boolean) {
        setSaving(publish ? 'publish' : 'draft'); setMessage(null);
        const result = await saveClientIntelligence({
            organizationId, clientId, profile: saved,
            business: draft.business, offers: draft.offers, audiences: draft.audiences,
            markets: draft.markets, seoContext: draft.seoContext, brandConstraints: draft.brandConstraints,
            publish, updatedBy: member.userId || undefined,
        });
        setSaving(null);
        if (!result.success || !result.data) { setMessage({ kind: 'error', text: result.error ?? 'Unable to save Client Intelligence' }); return; }
        setSaved(result.data); setDraft(result.data);
        setMessage({ kind: 'success', text: publish ? `Version ${result.data.version} is ready for planning.` : 'Draft saved.' });
    }

    if (loading) return <div className="rounded-xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">Loading Client Intelligence…</div>;

    return <div className="space-y-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div><div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /><h2 className="text-xl font-semibold">Client Intelligence</h2></div><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Reusable business context that keeps content plans relevant, specific, and compliant.</p></div>
            <div className="flex flex-wrap items-center gap-2"><button onClick={() => void save(false)} disabled={!!saving} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted disabled:opacity-50"><Save className="h-4 w-4" />{saving === 'draft' ? 'Saving…' : 'Save draft'}</button><button onClick={() => void save(true)} disabled={!!saving || readiness < 25} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"><Check className="h-4 w-4" />{saving === 'publish' ? 'Publishing…' : saved?.status === 'ready' ? 'Publish new version' : 'Mark ready'}</button></div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="rounded-xl border border-border bg-card p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Profile readiness</p><p className="mt-0.5 text-xs text-muted-foreground">Complete the high-value context before using it in planning.</p></div><span className="text-2xl font-bold text-primary">{readiness}%</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${readiness}%` }} /></div></div>
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Profile metadata</p><div className="mt-2 flex items-center justify-between text-sm"><span>Status</span><span className={cn('rounded-full border px-2 py-0.5 text-xs font-semibold capitalize', saved?.status === 'ready' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300')}>{saved?.status ?? 'draft'}</span></div><div className="mt-2 flex items-center justify-between text-sm"><span className="text-muted-foreground">Version</span><span className="font-medium">{saved?.version ?? 1}</span></div><div className="mt-2 flex items-center justify-between text-sm"><span className="text-muted-foreground">Updated</span><span className="font-medium">{saved?.updatedAt ? new Date(saved.updatedAt).toLocaleDateString() : 'Not saved'}</span></div><div className="mt-2 flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">Editor</span><span className="truncate font-medium">{saved?.updatedBy ? (saved.updatedBy === member.userId ? member.displayName : 'Team member') : '—'}</span></div></div>
        </div>

        {message && <div role="status" className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', message.kind === 'success' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-destructive/25 bg-destructive/10 text-destructive')}>{message.kind === 'success' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}{message.text}</div>}

        <div className="grid gap-4 xl:grid-cols-2">
            <IntelligenceSection icon={Building2} title="Business" description="What the client does and why customers choose them.">
                <div className="grid gap-3 sm:grid-cols-2"><TextField label="Business name" value={draft.business.name ?? ''} onChange={value => setDraft({ ...draft, business: { ...draft.business, name: value } })} /><TextField label="Website" value={draft.business.website ?? ''} onChange={value => setDraft({ ...draft, business: { ...draft.business, website: value } })} placeholder="https://example.com" /></div>
                <TextArea label="Description" value={draft.business.description ?? ''} onChange={value => setDraft({ ...draft, business: { ...draft.business, description: value } })} placeholder="What the business does, for whom, and where…" />
                <div className="grid gap-3 sm:grid-cols-2"><TextField label="Business model" value={draft.business.businessModel ?? ''} onChange={value => setDraft({ ...draft, business: { ...draft.business, businessModel: value } })} placeholder="B2B services, ecommerce…" /><TextField label="Primary conversion" value={draft.business.primaryConversion ?? ''} onChange={value => setDraft({ ...draft, business: { ...draft.business, primaryConversion: value } })} placeholder="Book a consultation" /></div>
                <TextArea label="Differentiators" value={draft.business.differentiators ?? ''} onChange={value => setDraft({ ...draft, business: { ...draft.business, differentiators: value } })} placeholder="What makes the offer meaningfully different?" />
                <TextArea label="Proof points" value={draft.business.proofPoints ?? ''} onChange={value => setDraft({ ...draft, business: { ...draft.business, proofPoints: value } })} placeholder="Credentials, results, awards, guarantees…" />
            </IntelligenceSection>

            <IntelligenceSection icon={Target} title="Offers" description="Prioritize valuable services and explicitly exclude poor-fit work.">
                <ListField label="Products and services" values={draft.offers.items} onChange={items => setDraft({ ...draft, offers: { ...draft.offers, items } })} placeholder="One offer per line" />
                <TextArea label="Priority and high-margin offerings" value={draft.offers.priorities ?? ''} onChange={value => setDraft({ ...draft, offers: { ...draft.offers, priorities: value } })} placeholder="Note which offers matter most and why…" />
                <TextArea label="Exclusions" value={draft.offers.exclusions ?? ''} onChange={value => setDraft({ ...draft, offers: { ...draft.offers, exclusions: value } })} placeholder="Services, topics, or customer types to avoid…" />
            </IntelligenceSection>

            <IntelligenceSection icon={Users2} title="Audiences" description="Define the people, needs, objections, and buying stage behind the search.">
                <ListField label="Audience segments and buyer roles" values={draft.audiences.segments} onChange={segments => setDraft({ ...draft, audiences: { ...draft.audiences, segments } })} placeholder="One segment per line" />
                <TextArea label="Needs and objections" value={draft.audiences.needsObjections ?? ''} onChange={value => setDraft({ ...draft, audiences: { ...draft.audiences, needsObjections: value } })} placeholder="What outcomes do they need? What stops them buying?" />
                <TextField label="Funnel stage" value={draft.audiences.funnelStage ?? ''} onChange={value => setDraft({ ...draft, audiences: { ...draft.audiences, funnelStage: value } })} placeholder="Awareness, evaluation, decision…" />
            </IntelligenceSection>

            <IntelligenceSection icon={Globe2} title="Markets" description="The locations, languages, and scope the client can genuinely serve.">
                <TextArea label="Locations" value={draft.markets.locations ?? ''} onChange={value => setDraft({ ...draft, markets: { ...draft.markets, locations: value } })} placeholder="Cities, states, countries, or regions…" />
                <div className="grid gap-3 sm:grid-cols-2"><TextField label="Service area" value={draft.markets.serviceArea ?? ''} onChange={value => setDraft({ ...draft, markets: { ...draft.markets, serviceArea: value } })} /><TextField label="Language" value={draft.markets.language ?? ''} onChange={value => setDraft({ ...draft, markets: { ...draft.markets, language: value } })} placeholder="English" /></div>
                <TextField label="Market scope" value={draft.markets.scope ?? ''} onChange={value => setDraft({ ...draft, markets: { ...draft.markets, scope: value } })} placeholder="Local, regional, national…" />
            </IntelligenceSection>

            <IntelligenceSection icon={Search} title="SEO context" description="Connect business priorities to existing coverage and search competitors.">
                <TextArea label="Search competitors" value={draft.seoContext.competitors ?? ''} onChange={value => setDraft({ ...draft, seoContext: { ...draft.seoContext, competitors: value } })} placeholder="One domain or competitor per line…" />
                <TextArea label="Priority themes" value={draft.seoContext.priorityThemes ?? ''} onChange={value => setDraft({ ...draft, seoContext: { ...draft.seoContext, priorityThemes: value } })} placeholder="Strategic themes to grow…" />
                <TextArea label="Existing target pages" value={draft.seoContext.existingTargetPages ?? ''} onChange={value => setDraft({ ...draft, seoContext: { ...draft.seoContext, existingTargetPages: value } })} placeholder="Important URLs and their topics…" />
                <TextArea label="Target conversion paths" value={draft.seoContext.conversionPaths ?? ''} onChange={value => setDraft({ ...draft, seoContext: { ...draft.seoContext, conversionPaths: value } })} placeholder="How organic visitors should convert…" />
            </IntelligenceSection>

            <IntelligenceSection icon={ShieldCheck} title="Brand & compliance" description="Guardrails for accurate, on-brand opportunity recommendations.">
                <TextArea label="Preferred terminology" value={draft.brandConstraints.preferredTerminology ?? ''} onChange={value => setDraft({ ...draft, brandConstraints: { ...draft.brandConstraints, preferredTerminology: value } })} placeholder="Names and phrases the client uses…" />
                <TextArea label="Prohibited claims" value={draft.brandConstraints.prohibitedClaims ?? ''} onChange={value => setDraft({ ...draft, brandConstraints: { ...draft.brandConstraints, prohibitedClaims: value } })} placeholder="Claims, guarantees, or language to avoid…" />
                <TextArea label="Regulated topics" value={draft.brandConstraints.regulatedTopics ?? ''} onChange={value => setDraft({ ...draft, brandConstraints: { ...draft.brandConstraints, regulatedTopics: value } })} />
                <TextArea label="Tone summary" value={draft.brandConstraints.toneSummary ?? ''} onChange={value => setDraft({ ...draft, brandConstraints: { ...draft.brandConstraints, toneSummary: value } })} placeholder="Clear, expert, reassuring…" />
            </IntelligenceSection>
        </div>
    </div>;
}

function IntelligenceSection({ icon: Icon, title, description, children }: { icon: typeof Megaphone; title: string; description: string; children: React.ReactNode }) { return <section className="rounded-xl border border-border bg-card"><div className="flex gap-3 border-b border-border p-4"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></div><div><h3 className="font-semibold">{title}</h3><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div></div><div className="space-y-3 p-4">{children}</div></section>; }
function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) { return <label className="block text-xs font-semibold text-muted-foreground">{label}<input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" /></label>; }
function TextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) { return <label className="block text-xs font-semibold text-muted-foreground">{label}<textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3} className="mt-1.5 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" /></label>; }
function ListField({ label, values, onChange, placeholder }: { label: string; values: string[]; onChange: (values: string[]) => void; placeholder?: string }) { return <TextArea label={label} value={values.join('\n')} onChange={value => onChange(value.split('\n').map(item => item.trim()).filter(Boolean))} placeholder={placeholder} />; }
