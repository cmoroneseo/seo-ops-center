'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react';
import { useOrganization } from '@/components/providers/organization-provider';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { createClientWithSetup } from '@/lib/supabase/client-setup';
import { localDate, type ClientSetupInput, type ClientSetupScope } from '@/lib/client-setup';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AddClientModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    onImportFromBasecamp?: (clientId: string, organizationId: string) => void;
}
const initialScope: ClientSetupScope = { version: 1, mode: 'monthly', hoursMode: 'committed', contentPieces: 0, gbp: false, gbpUsesSeoHours: false, listings: false, onboardingBudget: 'separate' };
const control = 'h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-60';
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
    return <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">{label}{children}{hint && <span className="text-xs font-normal leading-relaxed text-muted-foreground">{hint}</span>}</label>;
}
function Selection({ checked, onChange, title, description, badge }: { checked: boolean; onChange: (value: boolean) => void; title: string; description?: string; badge?: string }) {
    return <label className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-4 transition-colors hover:bg-muted/40', checked ? 'border-primary/30 bg-primary/[0.035]' : 'border-border bg-background')}>
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="peer absolute inset-0 cursor-pointer opacity-0" /><span className={cn('flex h-5 w-5 items-center justify-center rounded-md border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2', checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 bg-background')}>{checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}</span></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{title}</span>{description && <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{description}</span>}</span>
        {badge && <span className="hidden rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground sm:block">{badge}</span>}
    </label>;
}
export function AddClientModal({ isOpen, onClose, onSuccess, onImportFromBasecamp }: AddClientModalProps) {
    const { organization } = useOrganization();
    const router = useRouter();
    const [step, setStep] = useState<'choose' | 'configure'>('choose');
    const [scope, setScope] = useState<ClientSetupScope>({ ...initialScope });
    const [name, setName] = useState('');
    const [website, setWebsite] = useState('');
    const [manager, setManager] = useState('');
    const [onboardingDate, setOnboardingDate] = useState(localDate());
    const [launchDate, setLaunchDate] = useState('');
    const [hours, setHours] = useState(0);
    const [template, setTemplate] = useState<'foundation' | 'blank'>('foundation');
    const [items, setItems] = useState<string[]>([]);
    const [itemTitle, setItemTitle] = useState('');
    const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [createdId, setCreatedId] = useState<string | null>(null);
    const [requestId, setRequestId] = useState('');
    useEffect(() => {
        if (!isOpen || !organization) return;
        let cancelled = false;
        setMembers([]);
        getOrganizationMembers(organization.id).then(ms => { if (!cancelled) setMembers(ms.map(m => ({ id: m.userId, name: m.user.fullName || m.user.email }))); }).catch(() => { if (!cancelled) setError('Account managers could not be loaded. You can assign one later.'); });
        return () => { cancelled = true; };
    }, [isOpen, organization]);
    useEffect(() => {
        if (!isOpen) return;
        setRequestId(crypto.randomUUID()); setCreatedId(null); setStep('choose'); setScope({ ...initialScope }); setName(''); setWebsite(''); setManager(''); setOnboardingDate(localDate()); setLaunchDate(''); setHours(0); setItems([]); setItemTitle(''); setTemplate('foundation'); setError('');
    }, [isOpen, organization?.id]);
    function updateScope(patch: Partial<ClientSetupScope>) { setScope(value => ({ ...value, ...patch })); }
    const monthly = scope.mode === 'monthly';
    function choose(mode: ClientSetupScope['mode']) { updateScope({ mode }); }
    async function save(e: React.FormEvent) {
        e.preventDefault(); if (!organization || busy) return;
        setBusy(true); setError('');
        const input: ClientSetupInput = { requestId, organizationId: organization.id, name, website, accountManagerId: manager, onboardingDate, launchDate, seoHours: hours, scope: monthly ? { ...scope, targetDate: undefined } : { ...scope, contentPieces: 0, gbp: false, gbpUsesSeoHours: false, listings: false, hoursMode: 'committed' }, template, customItems: items };
        try {
            const result = await createClientWithSetup(input);
            if (!result.id) { setError(result.error || 'Could not save setup. Your draft is still here.'); return; }
            setCreatedId(result.id); onSuccess();
        } catch { setError('Connection interrupted. Retry to finish saving this client.'); }
        finally { setBusy(false); }
    }
    function openClient() { if (!createdId) return; onClose(); router.push(`/workspace/${createdId}${monthly ? '' : '?tab=campaign'}`); }
    const choices = <div role="group" aria-label="Engagement" className="grid grid-cols-2 gap-3">{(['monthly', 'custom'] as const).map(mode => <button key={mode} type="button" aria-pressed={scope.mode === mode} onClick={() => choose(mode)} className={cn('rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', scope.mode === mode ? 'border-primary bg-primary/[0.035]' : 'border-border hover:bg-muted/40')}><span className="flex items-center justify-between text-sm font-semibold">{mode === 'monthly' ? 'Monthly' : 'Custom'}{scope.mode === mode && <CheckCircle2 className="h-4 w-4 text-primary" />}</span><span className="mt-1 block text-xs text-muted-foreground">{mode === 'monthly' ? 'Ongoing SEO & content' : 'Scoped plan & tasks'}</span></button>)}</div>;
    return <Dialog open={isOpen} onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-5xl" onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onInteractOutside={e => e.preventDefault()}>
        <header className="shrink-0 border-b px-6 py-5 sm:px-8"><DialogTitle className="text-xl font-semibold tracking-tight">{createdId ? 'Client setup complete' : 'New client setup'}</DialogTitle><DialogDescription className="mt-1.5">{createdId ? 'Your client and scope have been saved.' : 'Start with the engagement, then configure the work.'}</DialogDescription></header>
        {createdId ? <><div className="overflow-y-auto px-8 py-10 text-center"><CheckCircle2 className="mx-auto mb-4 h-10 w-10 text-primary" /><h3 className="text-xl font-semibold">{name} is ready</h3><p className="mt-2 text-sm text-muted-foreground">Status: Onboarding. Prepare the strategy and roadmap in the client workspace.</p><p className="mt-2 text-sm text-muted-foreground">Confirm launch after the strategy meeting to begin recurring services.</p></div><footer className="flex flex-wrap justify-end gap-3 border-t px-6 py-5">{onImportFromBasecamp && organization && <Button variant="outline" onClick={() => { onClose(); onImportFromBasecamp(createdId, organization.id); }}>Import from Basecamp</Button>}<Button onClick={openClient}>Open {monthly ? 'client' : 'SEO Plan'}<ArrowRight className="h-4 w-4" /></Button></footer></> : step === 'choose' ? <><div className="p-6 sm:p-8"><p className="mb-4 text-sm font-medium text-muted-foreground">Choose an engagement</p>{choices}</div><footer className="flex justify-end gap-3 border-t px-6 py-5"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => setStep('configure')}>Continue<ArrowRight className="h-4 w-4" /></Button></footer></> : <form onSubmit={save} className="flex min-h-0 flex-1 flex-col"><div className="min-h-0 flex-1 overflow-y-auto"><fieldset disabled={busy} className="min-w-0"><div className="grid items-start gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_260px]"><div className="min-w-0 space-y-7">{choices}
        <section className="space-y-4"><h3 className="text-sm font-semibold text-muted-foreground">Client details</h3><div className="grid gap-4 sm:grid-cols-2"><Field label="Client name *"><input required maxLength={200} autoFocus className={control} value={name} onChange={e => setName(e.target.value)} /></Field><Field label="Website" hint="Optional · https://example.com"><input type="url" className={control} value={website} onChange={e => setWebsite(e.target.value)} /></Field><Field label="Account manager"><select className={control} value={manager} onChange={e => setManager(e.target.value)}><option value="">Assign later</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field><Field label="Onboarding Date *"><input type="date" required max={localDate()} className={control} value={onboardingDate} onChange={e => setOnboardingDate(e.target.value)} /></Field><Field label="Launched Date" hint="Optional · actual strategy meeting date. Activate the client when ready."><input type="date" min={onboardingDate} max={localDate()} className={control} value={launchDate} onChange={e => setLaunchDate(e.target.value)} /></Field></div></section>
        <section className="space-y-4 border-t pt-6"><h3 className="text-sm font-semibold text-muted-foreground">{monthly ? 'Monthly service scope' : 'Custom plan & tasks'}</h3>{monthly ? <><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-3"><Field label="SEO hours / month *"><input required type="number" min={0} max={9999} step="0.25" className={control} value={hours} onChange={e => setHours(Number(e.target.value))} /></Field><Selection checked={scope.hoursMode === 'allowance'} onChange={value => updateScope({ hoursMode: value ? 'allowance' : 'committed' })} title="Treat as a monthly allowance" description="Unused hours don’t count as a delivery shortfall." /></div><Field label="Content pieces / month *" hint="Mixed content quota. Delivered counts toward fulfillment."><input required type="number" min={0} max={999} step={1} className={control} value={scope.contentPieces} onChange={e => updateScope({ contentPieces: Number(e.target.value) })} /></Field><Field label="Service cadence"><input className={control} value="Monthly" readOnly /></Field></div><Selection checked={scope.gbp} onChange={value => updateScope({ gbp: value })} title="Google Business Profile management" description="Initial optimization + ongoing management as needed." badge="Additional service" />{scope.gbp && <Selection checked={scope.gbpUsesSeoHours} onChange={value => updateScope({ gbpUsesSeoHours: value })} title="Management uses SEO hours" description="Actual management work counts toward the SEO budget." />}<Selection checked={scope.listings} onChange={value => updateScope({ listings: value })} title="Directory Listings" description="One-time activation + managed listings." badge="Additional service" /></> : <><Field label="SEO plan"><select className={control} value={template} onChange={e => setTemplate(e.target.value as typeof template)}><option value="foundation">Foundational SEO plan</option><option value="blank">Blank plan</option></select></Field><p className="text-xs leading-relaxed text-muted-foreground">Foundation items remain available to tailor in SEO Plan. Select only the work that supports your strategy.</p><div className="grid gap-4 sm:grid-cols-2"><Field label="Total estimated SEO hours"><input type="number" min={0} max={9999} step="0.25" className={control} value={hours} onChange={e => setHours(Number(e.target.value))} /></Field><Field label="Target completion"><input type="date" min={onboardingDate} className={control} value={scope.targetDate || ''} onChange={e => updateScope({ targetDate: e.target.value || undefined })} /></Field></div><Field label="Custom plan items"><span className="flex gap-2"><input className={control} maxLength={500} placeholder="Add a specific outcome or task" value={itemTitle} onChange={e => setItemTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (itemTitle.trim()) { setItems([...items, itemTitle.trim()]); setItemTitle(''); } } }} /><Button type="button" variant="outline" aria-label="Add custom item" disabled={!itemTitle.trim() || items.length >= 100} onClick={() => { setItems([...items, itemTitle.trim()]); setItemTitle(''); }}><Plus className="h-4 w-4" /></Button></span></Field>{items.map((title, index) => <div key={index} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"><span>{title}</span><Button type="button" variant="ghost" size="icon" aria-label={`Remove ${title}`} onClick={() => setItems(items.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></div>)}<p className="text-xs text-muted-foreground">Add from Basecamp after creating the client, using the existing import flow.</p></>}
        </section>
        <details className="group rounded-xl border"><summary className="flex cursor-pointer items-center justify-between gap-4 p-4 text-sm font-semibold">Onboarding effort<span className="text-xs font-normal text-muted-foreground">{scope.onboardingBudget === 'separate' ? 'Separate from monthly hours' : 'Included in first month'}</span></summary><div className="space-y-2 border-t p-4">{(['separate', 'first_month'] as const).map(value => <button type="button" key={value} aria-pressed={scope.onboardingBudget === value} onClick={() => updateScope({ onboardingBudget: value })} className={cn('flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left text-sm', scope.onboardingBudget === value ? 'border-primary/30 bg-primary/[0.035]' : 'border-border')}><span>{value === 'separate' ? 'Separate from monthly hours' : 'Included in first month'}</span>{scope.onboardingBudget === value && <Check className="h-4 w-4 text-primary" />}</button>)}<p className="pt-1 text-xs leading-relaxed text-muted-foreground">Log preparation now. Recurring targets begin when launch is confirmed.</p></div></details>
        </div><aside className="rounded-2xl bg-muted/40 p-5 lg:sticky lg:top-0"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Setup preview</p><span className="mt-4 inline-block rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">{monthly ? 'Monthly' : 'Custom'}</span><p className="mt-5 text-3xl font-semibold tracking-tight">{hours}h</p><p className="mt-1 text-xs text-muted-foreground">{monthly ? scope.hoursMode === 'committed' ? 'Hours/month committed' : 'Monthly allowance' : 'Total estimated hours'}</p><dl className="mt-6 space-y-3 text-xs">{[[monthly ? 'Content' : 'Plan', monthly ? `${scope.contentPieces} / month` : template === 'foundation' ? 'Foundational SEO' : 'Blank'], ['GBP', monthly && scope.gbp ? 'Optimization + Management' : 'Not included'], ['Listings', monthly && scope.listings ? 'Setup + management' : 'Not included'], ['Status', 'Onboarding']].map(([label, value]) => <div key={label} className="flex justify-between gap-3 border-b pb-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl><p className="mt-5 text-xs leading-relaxed text-muted-foreground">Scope saved as planned. Continue with strategy and roadmap in the existing workspace.</p></aside></div></fieldset></div>
        {error && <p role="alert" className="shrink-0 px-6 pb-4 text-sm text-destructive">{error}</p>}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-background px-6 py-5 sm:px-8"><span className="text-xs text-muted-foreground">Client details and scope saved together</span><div className="flex max-w-full flex-wrap gap-3"><Button type="button" variant="outline" disabled={busy} onClick={() => setStep('choose')}>Back</Button><Button type="submit" disabled={busy || !organization}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : <>Create client & save scope<ArrowRight className="h-4 w-4" /></>}</Button></div></footer>
    </form>}</DialogContent></Dialog>;
}
