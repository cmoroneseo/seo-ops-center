export interface RobotsRule {
    directive: 'allow' | 'disallow';
    path: string;
}

export interface RobotsGroup {
    agents: string[];
    rules: RobotsRule[];
}

export interface ParsedRobots {
    groups: RobotsGroup[];
    sitemaps: string[];
}

export function parseRobots(input: string): ParsedRobots {
    const groups: RobotsGroup[] = [];
    const sitemaps: string[] = [];
    let current: RobotsGroup | undefined;
    let hasRules = false;

    for (const rawLine of input.split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, '').trim();
        if (!line) continue;
        const separator = line.indexOf(':');
        if (separator < 0) continue;
        const key = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim();
        if (key === 'sitemap') {
            if (value) sitemaps.push(value);
            continue;
        }
        if (key === 'user-agent') {
            if (!current || hasRules) {
                current = { agents: [], rules: [] };
                groups.push(current);
                hasRules = false;
            }
            if (value) current.agents.push(value.toLowerCase());
            continue;
        }
        if ((key === 'allow' || key === 'disallow') && current) {
            hasRules = true;
            if (value || key === 'allow') current.rules.push({ directive: key, path: value });
        }
    }
    return { groups, sitemaps: [...new Set(sitemaps)] };
}

function ruleMatches(path: string, pattern: string) {
    if (!pattern) return false;
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const end = escaped.endsWith('$');
    const source = end ? escaped.slice(0, -1) : escaped;
    return new RegExp(`^${source}${end ? '$' : ''}`).test(path);
}

export function robotsAllows(input: string, parsed: ParsedRobots, userAgent = 'SEO-Ops-Center-Crawler') {
    const agent = userAgent.toLowerCase();
    const exact = parsed.groups.filter(group => group.agents.some(value => value !== '*' && agent.includes(value)));
    const applicable = exact.length > 0 ? exact : parsed.groups.filter(group => group.agents.includes('*'));
    const path = `${new URL(input).pathname}${new URL(input).search}`;
    const matches = applicable.flatMap(group => group.rules).filter(rule => ruleMatches(path, rule.path));
    if (matches.length === 0) return true;
    matches.sort((a, b) => b.path.length - a.path.length || (a.directive === 'allow' ? -1 : 1));
    return matches[0].directive === 'allow';
}
