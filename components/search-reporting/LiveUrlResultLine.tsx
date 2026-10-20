'use client';

import { urlResultCopy, type UrlResultReadout } from '@/lib/search-reporting/url-results';

export function LiveUrlResultLine({
    result,
    layout = 'line',
}: {
    result?: UrlResultReadout | null;
    layout?: 'line' | 'column';
}) {
    const copy = urlResultCopy(result);
    if (!copy || !result || result.kind === 'hidden') return null;
    if (result.kind === 'not_indexed') {
        return <p className="text-xs text-muted-foreground" data-live-result="not_indexed">Not indexed yet</p>;
    }
    if (layout === 'column') {
        const position = result.position == null ? '—' : result.position.toFixed(1);
        return (
            <div className="text-xs text-muted-foreground" data-live-result="measured">
                <p className="tabular-nums text-foreground">{result.clicks.toLocaleString('en-US')} clicks</p>
                <p className="tabular-nums">{result.impressions.toLocaleString('en-US')} impr · pos {position}</p>
                {result.queries.length > 0 && <p className="truncate">{result.queries.map(query => query.query).join(', ')}</p>}
                {result.comparison && <p>{result.comparison.label}</p>}
            </div>
        );
    }
    return <p className="mt-0.5 text-xs text-muted-foreground" data-live-result="measured">{copy}</p>;
}
