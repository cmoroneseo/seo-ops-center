/**
 * Keyword ideas for the topic map wizard, with where the site ranks from Google Search Console.
 * Search demand for the map comes from Search Console, so no keyword tool is asked for monthly searches.
 */

import {
    buildKeywordRows,
    ideaKeywords,
    type KeywordRow,
    type MetricSource,
} from './keyword-metrics';

export interface KeywordSuggestionResult {
    rows: KeywordRow[];
    searchConsole: MetricSource;
    notice: string | null;
    truncated: boolean;
}

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
    const [ideasResponse, positionsResponse] = await Promise.all([
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

    const ideas = ideasResponse.ok ? ideaKeywords(await readJson(ideasResponse)) : [];
    const built = buildKeywordRows({
        ideas,
        positions,
        saved: input.saved,
        selectionTouched: input.selectionTouched,
        searchConsole,
    });

    const notices: string[] = [];
    if (!ideasResponse.ok) notices.push('Keyword ideas could not be loaded. You can still add your own.');
    if (searchConsole === 'failed') notices.push('Your current position could not be loaded.');
    if (built.truncated) notices.push('Showing the first 40 keywords. Add your own if one is missing.');

    return {
        rows: built.rows,
        searchConsole,
        notice: notices.length > 0 ? notices.join(' ') : null,
        truncated: built.truncated,
    };
}
