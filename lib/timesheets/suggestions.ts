import { TIMESHEET_ACTIVITIES } from './activities.ts';

/**
 * One-tap context from work already recorded.
 *
 * Activity inference is deliberately conservative: an unmatched title suggests
 * no activity rather than a plausible-but-wrong activity, which could change
 * whether the entry counts toward the client's SEO-hours budget.
 */

const MAX_SUGGESTIONS = 3;

/** Distinctive words per activity. Deliberately narrow to avoid false hits. */
const ACTIVITY_HINTS: Record<string, string[]> = {
    metadata_optimization: ['title tag', 'meta description', 'meta tag'],
    technical_audit: ['technical audit', 'technical seo audit', 'site audit'],
    blog_post: ['blog post', 'blog'],
    internal_linking: ['internal link'],
    schema_markup: ['schema'],
    gbp_monthly: ['gbp post', 'google business'],
    link_building: ['link building', 'outreach', 'backlink'],
    keyword_research: ['keyword research'],
    content_refresh: ['content refresh', 'refresh content'],
    monthly_reporting: ['monthly report', 'reporting'],
};

const KNOWN_KEYS = new Set(TIMESHEET_ACTIVITIES.map(activity => activity.key));

export interface CandidateTodo {
    title: string;
    /** yyyy-MM-dd */
    completedOn: string;
    /** The SEO PM task id, when the to-do is one we pushed. */
    taskId: string | null;
}

export interface Suggestion {
    title: string;
    taskId: string | null;
    activityKey: string | null;
}

function inferActivity(title: string): string | null {
    const haystack = title.toLowerCase();
    for (const [key, hints] of Object.entries(ACTIVITY_HINTS)) {
        if (!KNOWN_KEYS.has(key)) continue;
        if (hints.some(hint => haystack.includes(hint))) return key;
    }
    return null;
}

export function suggestionsFor(
    todos: CandidateTodo[],
    row: { date: string },
): Suggestion[] {
    return todos
        .filter(todo => todo.completedOn === row.date)
        .slice(0, MAX_SUGGESTIONS)
        .map(todo => ({
            title: todo.title,
            taskId: todo.taskId,
            activityKey: inferActivity(todo.title),
        }));
}
