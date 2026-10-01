import { MARKETING_PLAN_STEPS, MARKETING_PLAN_TEMPLATE_ITEMS } from './marketing-plan-template';

export interface ClientSetupScope {
    version: 1;
    mode: 'monthly' | 'custom';
    hoursMode: 'committed' | 'allowance';
    contentPieces: number;
    gbp: boolean;
    gbpUsesSeoHours: boolean;
    listings: boolean;
    onboardingBudget: 'separate' | 'first_month';
    targetDate?: string;
}
export interface ClientSetupInput {
    requestId: string;
    organizationId: string;
    name: string;
    website: string;
    accountManagerId: string;
    onboardingDate: string;
    launchDate: string;
    seoHours: number;
    scope: ClientSetupScope;
    template: 'foundation' | 'blank';
    customItems: string[];
}
export function localDate(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validateClientSetup(input: ClientSetupInput, today = localDate()): string | null {
    if (!input.name.trim()) return 'Enter a client name.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.onboardingDate) || input.onboardingDate > today) return 'Choose an onboarding date on or before today.';
    if (input.launchDate && (input.launchDate < input.onboardingDate || input.launchDate > today)) return 'Launched Date must be between Onboarding Date and today.';
    if (!Number.isFinite(input.seoHours) || input.seoHours < 0 || input.seoHours > 9999) return 'SEO hours must be between 0 and 9,999.';
    if (!Number.isInteger(input.scope.contentPieces) || input.scope.contentPieces < 0 || input.scope.contentPieces > 999) return 'Content pieces must be a whole number between 0 and 999.';
    if (input.scope.targetDate && input.scope.targetDate < input.onboardingDate) return 'Target completion must follow Onboarding Date.';
    if (input.website) {
        try { const url = new URL(input.website); if (!['https:', 'http:'].includes(url.protocol) || !url.hostname.includes('.')) return 'Enter a valid website URL.'; }
        catch { return 'Enter a full website URL, such as https://example.com.'; }
    }
    if (input.scope.mode === 'monthly' && !input.seoHours && !input.scope.contentPieces && !input.scope.gbp && !input.scope.listings) return 'Choose at least one service.';
    return null;
}
export function setupPlanItems(input: ClientSetupInput) {
    const foundation = input.template === 'foundation' ? MARKETING_PLAN_TEMPLATE_ITEMS.map(item => ({ ...item, included: false, phase: 'backlog', custom: false })) : [];
    const selected = [
        { title: 'Prepare SEO strategy and roadmap', stepKey: 'setup' },
        ...(input.scope.gbp ? [{ title: 'Complete initial GBP optimization', stepKey: 'local' }] : []),
        ...(input.scope.listings ? [{ title: 'Activate directory listings and verify business information', stepKey: 'local' }] : []),
        ...input.customItems.filter(title => title.trim()).map(title => ({ title: title.trim(), stepKey: 'setup' })),
    ].map(item => ({ ...item, description: '', priority: 'medium', included: true, phase: 'onboarding', custom: true }));
    return [...foundation, ...selected];
}
export { MARKETING_PLAN_STEPS };

/** Recording dates stay unchanged; only the monthly budget allocation moves. */
export function setupBudgetMonth(date: string, launchDate: string | null | undefined, onboardingDate: string | null | undefined, scope: ClientSetupScope | null | undefined): string | null {
    if (!scope || !onboardingDate || date < onboardingDate) return date.slice(0, 7);
    if (!launchDate || date < launchDate) return scope.onboardingBudget === 'first_month' && launchDate ? launchDate.slice(0, 7) : null;
    return date.slice(0, 7);
}

export interface SetupHoursStatus {
    status: string;
    severity: 'ok' | 'info' | 'warn' | 'critical';
    reason: string;
    pct: number | null;
}
/** New setup agreements distinguish promised effort from optional capacity. */
export function setupHoursStatus(scope: ClientSetupScope, status: string, launchDate: string | undefined, logged: number, budget: number, month: string, today = localDate()): SetupHoursStatus {
    if (status !== 'Active' || !launchDate || month < launchDate.slice(0, 7)) return { status: status === 'Onboarding' || status === 'Active' ? 'Planned' : status, severity: 'ok', reason: 'Recurring hours begin after confirmed launch while the client is active.', pct: null };
    if (scope.mode === 'custom' || budget <= 0) return { status: 'Tracked', severity: 'ok', reason: 'Custom work is scoped in the SEO Plan.', pct: null };
    const pct = logged / budget;
    if (logged > budget) return { status: 'Over', severity: 'critical', reason: `${(logged - budget).toFixed(2)}h over budget`, pct };
    if (scope.hoursMode === 'allowance') return { status: 'Within allowance', severity: 'ok', reason: `${(budget - logged).toFixed(2)}h available; unused hours are not a shortfall.`, pct };
    if (logged >= budget) return { status: 'Met', severity: 'ok', reason: 'Monthly hours commitment met.', pct };
    const [year, monthIndex] = month.split('-').map(Number);
    const lastDay = new Date(year, monthIndex, 0).getDate();
    const end = `${month}-${String(lastDay).padStart(2, '0')}`;
    const outstanding = `${(budget - logged).toFixed(2)}h remaining against the monthly commitment.`;
    if (today > end) return { status: 'Shortfall', severity: 'critical', reason: outstanding, pct };
    if (today >= `${month}-${String(Math.max(1, lastDay - 6)).padStart(2, '0')}`) return { status: 'At risk', severity: 'warn', reason: outstanding, pct };
    return { status: 'In progress', severity: 'ok', reason: outstanding, pct };
}
