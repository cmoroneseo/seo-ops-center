/**
 * Pull keyword ideas from the existing research routes and attach measured numbers only.
 */

import {
    ahrefsKeywordRows,
    ahrefsSourceFromStatus,
    buildKeywordRows,
    ideaKeywordRows,
    type KeywordRow,
    type MetricSource,
} from './keyword-metrics';

export interface KeywordSuggestionResult {
    rows: KeywordRow[];
    ahrefs: MetricSource;
    searchConsole: MetricSource;
    notice: string | null;
    truncated: boolean;
}

const RIVAL_LIMIT = 5;

async function readJson(response: Response): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

export async function loadKeywordSuggestions(
    input: {
        clientId: string;
        brandName: string;
        businessDescription: string;
        focusTopics: readonly string[];
        rivals: readonly string[];
        saved: readonly string[];
        selectionTouched: boolean;
    },
    fetchImpl: typeof fetch = fetch,
): Promise<KeywordSuggestionResult> {
    const clientId = encodeURIComponent(input.clientId);
    const [domainResponse, ideasResponse, positionsResponse] = await Promise.all([
        fetchImpl(`/api/campaign/keyword-research?clientId=${clientId}&mode=domain`),
        fetchImpl('/api/campaign/suggest-keywords', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: input.clientId,
                clientName: input.brandName,
                industry: input.businessDescription,
                services: input.focusTopics,
                locations: [],
                rivals: input.rivals,
                focusTopics: input.focusTopics,
            }),
        }),
        fetchImpl(`/api/topical-map/keyword-positions?clientId=${clientId}`),
    ]);

    const ahrefs = ahrefsSourceFromStatus(domainResponse.status);
    const site = domainResponse.ok ? ahrefsKeywordRows(await readJson(domainResponse)) : [];
    const rivalsToAsk = ahrefs === 'connected' ? input.rivals.filter(rival => rival.trim()).slice(0, RIVAL_LIMIT) : [];
    const rivalBodies = await Promise.all(rivalsToAsk.map(async rival => {
        const response = await fetchImpl(`/api/campaign/keyword-research?clientId=${clientId}&mode=competitor&competitor=${encodeURIComponent(rival.trim())}`);
        return response.ok ? ahrefsKeywordRows(await readJson(response)) : [];
    }));

    let searchConsole: MetricSource = 'failed';
    let positions: { query: string; position: number }[] = [];
    if (positionsResponse.ok) {
        const body = await readJson(positionsResponse) as { connected?: unknown; positions?: unknown } | null;
        searchConsole = body?.connected === true ? 'connected' : 'missing';
        positions = Array.isArray(body?.positions)
            ? body.positions.flatMap(entry => {
                if (!entry || typeof entry !== 'object') return [];
                const query = (entry as { query?: unknown }).query;
                const position = (entry as { position?: unknown }).position;
                if (typeof query !== 'string' || typeof position !== 'number') return [];
                return [{ query, position }];
            })
            : [];
    }

    const ideas = ideasResponse.ok ? ideaKeywordRows(await readJson(ideasResponse)) : [];
    const built = buildKeywordRows({
        site,
        rivals: rivalBodies.flat(),
        ideas,
        positions,
        saved: input.saved,
        selectionTouched: input.selectionTouched,
        ahrefs,
        searchConsole,
    });

    const notices: string[] = [];
    if (!ideasResponse.ok) notices.push('Keyword ideas could not be loaded. You can still add your own.');
    if (ahrefs === 'failed') notices.push('Monthly searches could not be loaded.');
    if (searchConsole === 'failed') notices.push('Your current position could not be loaded.');
    if (input.rivals.filter(rival => rival.trim()).length > RIVAL_LIMIT) {
        notices.push('Suggestions use the first 5 competitors.');
    }
    if (built.truncated) notices.push('Showing the first 40 keywords. Add your own if one is missing.');

    return {
        rows: built.rows,
        ahrefs,
        searchConsole,
        notice: notices.length > 0 ? notices.join(' ') : null,
        truncated: built.truncated,
    };
}
