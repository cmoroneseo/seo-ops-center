import { MARKETING_PLAN_TEMPLATE_ITEMS } from '../marketing-plan-template';
import { ONBOARDING_CHECKLIST, titlesForTemplateKey } from './onboarding';

/**
 * Agency Basecamp onboarding lists use these wordings for the same work as
 * the SEO Plan checklist. Matching is exact after normalization, plus a
 * conservative overlap for titles that are the same sentence with a trailing
 * word ("recommendations" / "recommendations list").
 */
const BASECAMP_TITLE_ALIASES: Record<string, readonly string[]> = {
    'access.analytics': [
        'Connect Google Analytics and Search Console to website',
        'Connect Google Analytics and Search Console',
    ],
    'access.portal': [
        'Connect Search Console and Analytics to Client Portal',
    ],
    'tracking.consent': [
        'Set Up Empire Cookies',
    ],
    'tracking.rank': [
        'Add keywords to Position tracking',
    ],
    'strategy.roadmap': [
        'Create SEO Roadmap & Recommendations List',
        'Create SEO Roadmap and Recommendations List',
    ],
};

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'with', 'if', 'possible', 'up',
]);

const TOKEN_SYNONYMS: Record<string, string> = {
    position: 'rank',
};

export const ONBOARDING_IMPORT_HINT =
    'Import the onboarding list into All client tasks, then add it to the SEO Plan. New work pushes to the SEO Plan list.';

export const ONBOARDING_LIST_MISSING =
    'Choose the Onboarding list in Integrations. Import that list into All client tasks, then add it to the SEO Plan. New work pushes to the SEO Plan list.';

export const SEO_PLAN_MISSING =
    'Create the SEO Plan first. Then add the imported onboarding list to it.';

export const ONBOARDING_LIST_UNREADABLE =
    'The onboarding list could not be read from Basecamp. Try again in a moment.';

const SETUP_STEP = 'setup';

export interface OnboardingTaskRef {
    id: string;
    title: string;
    basecampTodoId?: number | null;
    sourceTodolistId?: string | null;
}

export interface OnboardingItemRef {
    id: string;
    title: string;
    stepKey: string;
    templateKey?: string | null;
    taskId?: string | null;
}

export interface TitleMatch {
    templateKey: string | null;
    stepKey: string;
}

export type OnboardingPlacement =
    | { action: 'link'; taskId: string; itemId: string; stepKey: string }
    | { action: 'create'; taskId: string; stepKey: string }
    | { action: 'skip'; taskId: string; reason: 'already-linked' | 'covered' };

interface CatalogEntry {
    templateKey: string | null;
    stepKey: string;
    tokens: string[];
}

let catalogCache: CatalogEntry[] | null = null;

export function contentTokens(title: string): string[] {
    const cleaned = title
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    if (!cleaned) return [];
    const tokens: string[] = [];
    for (const raw of cleaned.split(/\s+/)) {
        if (!raw || STOP_WORDS.has(raw)) continue;
        tokens.push(TOKEN_SYNONYMS[raw] ?? raw);
    }
    return tokens;
}

function tokenKey(tokens: string[]): string {
    return [...new Set(tokens)].join(' ');
}

function sameTokens(left: string, right: string): boolean {
    return tokenKey(contentTokens(left)) === tokenKey(contentTokens(right));
}

function subsetScore(taskTokens: string[], catalogTokens: string[]): number | null {
    const task = [...new Set(taskTokens)];
    const catalog = [...new Set(catalogTokens)];
    if (task.length === catalog.length && task.every(token => catalog.includes(token))) return 1;
    const small = task.length <= catalog.length ? task : catalog;
    const large = task.length <= catalog.length ? catalog : task;
    if (small.length < 3) return null;
    if (!small.every(token => large.includes(token))) return null;
    const ratio = small.length / large.length;
    return ratio >= 0.75 ? ratio : null;
}

function stepForTemplateKey(templateKey: string): string {
    return ONBOARDING_CHECKLIST.find(item => item.templateKey === templateKey)?.stepKey
        ?? MARKETING_PLAN_TEMPLATE_ITEMS.find(item => item.templateKey === templateKey)?.stepKey
        ?? SETUP_STEP;
}

function planCatalog(): CatalogEntry[] {
    if (catalogCache) return catalogCache;
    const entries: CatalogEntry[] = [];
    const seen = new Set<string>();
    const add = (title: string, stepKey: string, templateKey: string | null) => {
        const tokens = contentTokens(title);
        if (tokens.length === 0) return;
        const stamp = `${templateKey ?? ''}::${stepKey}::${tokenKey(tokens)}`;
        if (seen.has(stamp)) return;
        seen.add(stamp);
        entries.push({ templateKey, stepKey, tokens });
    };

    for (const item of ONBOARDING_CHECKLIST) {
        for (const title of titlesForTemplateKey(item.templateKey)) {
            add(title, item.stepKey, item.templateKey);
        }
    }
    for (const item of MARKETING_PLAN_TEMPLATE_ITEMS) {
        if (item.templateKey) add(item.title, stepForTemplateKey(item.templateKey), item.templateKey);
        else add(item.title, item.stepKey, null);
    }
    for (const [templateKey, titles] of Object.entries(BASECAMP_TITLE_ALIASES)) {
        for (const title of titles) add(title, stepForTemplateKey(templateKey), templateKey);
    }
    catalogCache = entries;
    return entries;
}

export function matchOnboardingTitle(title: string): TitleMatch | null {
    const tokens = contentTokens(title);
    if (tokens.length < 2) return null;
    const entries = planCatalog();
    const exact = entries.filter(entry => tokenKey(entry.tokens) === tokenKey(tokens));
    if (exact.length > 0) {
        const keyed = [...new Set(exact.map(entry => entry.templateKey).filter((key): key is string => !!key))];
        if (keyed.length === 1) {
            const hit = exact.find(entry => entry.templateKey === keyed[0])!;
            return { templateKey: hit.templateKey, stepKey: hit.stepKey };
        }
        if (keyed.length > 1) return null;
        const steps = [...new Set(exact.map(entry => entry.stepKey))];
        if (steps.length === 1) return { templateKey: null, stepKey: steps[0] };
        return null;
    }

    const scored = entries.flatMap(entry => {
        if (!entry.templateKey) return [];
        const score = subsetScore(tokens, entry.tokens);
        if (score === null || score >= 1) return [];
        return [{ entry, score }];
    });
    if (scored.length === 0) return null;
    const best = Math.max(...scored.map(row => row.score));
    const top = scored.filter(row => row.score === best);
    const keys = [...new Set(top.map(row => row.entry.templateKey))];
    if (keys.length !== 1 || !keys[0]) return null;
    return { templateKey: keys[0], stepKey: top[0].entry.stepKey };
}

function covers(item: OnboardingItemRef, templateKey: string): boolean {
    if (item.templateKey === templateKey) return true;
    if (titlesForTemplateKey(templateKey).some(title => sameTokens(title, item.title))) return true;
    return matchOnboardingTitle(item.title)?.templateKey === templateKey;
}

function pickItem(items: OnboardingItemRef[], taskTitle: string): OnboardingItemRef {
    return items.find(item => sameTokens(item.title, taskTitle)) ?? items[0];
}

export function planOnboardingAdditions(input: {
    tasks: OnboardingTaskRef[];
    items: OnboardingItemRef[];
    onboardingTodolistId: string;
    onboardingTodoIds: Iterable<number>;
    stepKeys: readonly string[];
    onlyTaskIds?: ReadonlySet<string>;
    onlyBasecampTodoIds?: ReadonlySet<number>;
}): OnboardingPlacement[] {
    const live = new Set(input.onboardingTodoIds);
    const steps = new Set(input.stepKeys);
    const setup = steps.has(SETUP_STEP) ? SETUP_STEP : (input.stepKeys[0] ?? SETUP_STEP);
    const linkedTaskIds = new Set(input.items.flatMap(item => item.taskId ? [item.taskId] : []));
    const reserved = new Set<string>();
    const placements: OnboardingPlacement[] = [];

    for (const task of input.tasks) {
        const todoId = task.basecampTodoId;
        if (!todoId) continue;
        if (input.onlyTaskIds && !input.onlyTaskIds.has(task.id)) continue;
        if (input.onlyBasecampTodoIds && !input.onlyBasecampTodoIds.has(todoId)) continue;
        const stamped = !!input.onboardingTodolistId
            && task.sourceTodolistId === input.onboardingTodolistId;
        if (!live.has(todoId) && !stamped) continue;

        if (linkedTaskIds.has(task.id)) {
            placements.push({ action: 'skip', taskId: task.id, reason: 'already-linked' });
            continue;
        }

        const match = matchOnboardingTitle(task.title);
        const stepKey = match && steps.has(match.stepKey) ? match.stepKey : setup;
        if (match?.templateKey) {
            const covering = input.items.filter(item => covers(item, match.templateKey!));
            const free = covering.filter(item => !item.taskId && !reserved.has(item.id));
            if (free.length > 0) {
                const item = pickItem(free, task.title);
                reserved.add(item.id);
                placements.push({ action: 'link', taskId: task.id, itemId: item.id, stepKey: item.stepKey });
                continue;
            }
            if (covering.length > 0) {
                placements.push({ action: 'skip', taskId: task.id, reason: 'covered' });
                continue;
            }
        } else if (match) {
            const sameTitle = input.items.filter(item => sameTokens(item.title, task.title));
            const free = sameTitle.filter(item => !item.taskId && !reserved.has(item.id));
            if (free.length > 0) {
                reserved.add(free[0].id);
                placements.push({ action: 'link', taskId: task.id, itemId: free[0].id, stepKey: free[0].stepKey });
                continue;
            }
            if (sameTitle.length > 0) {
                placements.push({ action: 'skip', taskId: task.id, reason: 'covered' });
                continue;
            }
        }

        placements.push({ action: 'create', taskId: task.id, stepKey });
    }

    return placements;
}

export interface OnboardingApplyCounts {
    linked: number;
    created: number;
    skipped: number;
    failed: number;
}

export async function applyOnboardingPlacements(
    placements: OnboardingPlacement[],
    io: {
        link(itemId: string, taskId: string): Promise<void>;
        create(taskId: string, stepKey: string): Promise<string>;
        setPhase(itemId: string): Promise<void>;
    },
): Promise<OnboardingApplyCounts> {
    const counts: OnboardingApplyCounts = { linked: 0, created: 0, skipped: 0, failed: 0 };
    for (const placement of placements) {
        try {
            if (placement.action === 'skip') {
                counts.skipped += 1;
                continue;
            }
            if (placement.action === 'link') {
                await io.link(placement.itemId, placement.taskId);
                counts.linked += 1;
                continue;
            }
            const itemId = await io.create(placement.taskId, placement.stepKey);
            await io.setPhase(itemId);
            counts.created += 1;
        } catch {
            counts.failed += 1;
        }
    }
    return counts;
}

export function summarizeOnboardingAdd(candidateCount: number, counts: OnboardingApplyCounts): string {
    if (candidateCount === 0) {
        return 'No imported onboarding to-dos are waiting. Import the onboarding list into All client tasks, then add it here. New work pushes to the SEO Plan list.';
    }
    if (counts.failed > 0 && counts.linked + counts.created === 0) {
        return 'Those onboarding to-dos could not be added to the SEO Plan. Try again.';
    }
    if (counts.linked + counts.created === 0) {
        return 'Those onboarding to-dos are already on the SEO Plan.';
    }
    const parts: string[] = [];
    if (counts.linked > 0) {
        parts.push(`${counts.linked} linked onto the matching checklist ${counts.linked === 1 ? 'row' : 'rows'}`);
    }
    if (counts.created > 0) {
        parts.push(`${counts.created} added as ${counts.created === 1 ? 'a new checklist row' : 'new checklist rows'}`);
    }
    let summary = `Added onboarding to the SEO Plan: ${parts.join(', ')}.`;
    if (counts.skipped > 0) {
        summary += ` ${counts.skipped} already on the plan ${counts.skipped === 1 ? 'was' : 'were'} left as-is.`;
    }
    if (counts.failed > 0) {
        summary += ` ${counts.failed} could not be added.`;
    }
    return summary;
}
