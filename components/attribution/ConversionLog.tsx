'use client';

import type { AttributionConversion } from '@/lib/types';

const SOURCE_LABELS: Record<string, string> = {
    organic_google: 'Organic Google',
    organic_bing: 'Organic Bing',
    organic_other: 'Organic Other',
    ai_chatgpt: 'AI ChatGPT',
    ai_perplexity: 'AI Perplexity',
    ai_google_aio: 'AI Google AIO',
    social: 'Social',
    paid: 'Paid',
    direct: 'Direct',
    referral: 'Referral',
};

interface ConversionLogProps {
    conversions: AttributionConversion[];
}

export function ConversionLog({ conversions }: ConversionLogProps) {
    if (conversions.length === 0) {
        return <p className="py-8 text-center text-sm text-muted-foreground">No conversions recorded yet.</p>;
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-border/50 text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Date</th>
                        <th className="py-2 pr-4 font-medium">Page</th>
                        <th className="py-2 pr-4 font-medium">Source</th>
                        <th className="py-2 pr-4 font-medium">Likely Queries</th>
                        <th className="py-2 pr-4 font-medium">HDYHAU</th>
                        <th className="py-2 font-medium">Type</th>
                    </tr>
                </thead>
                <tbody>
                    {conversions.map(conversion => (
                        <tr key={conversion.id} className="border-b border-border/30 hover:bg-muted/30">
                            <td className="whitespace-nowrap py-2 pr-4">
                                {new Date(conversion.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </td>
                            <td className="max-w-[200px] truncate py-2 pr-4 font-mono text-xs" title={conversion.pageUrl}>
                                {conversion.pageUrl || '/'}
                            </td>
                            <td className="whitespace-nowrap py-2 pr-4">
                                {SOURCE_LABELS[conversion.sourceCategory] ?? conversion.sourceCategory}
                            </td>
                            <td className="max-w-[250px] py-2 pr-4 text-xs">
                                {conversion.likelyQueries.length > 0 ? conversion.likelyQueries.map((query, index) => (
                                    <span key={`${query.query}:${index}`}>
                                        {query.query}{' '}
                                        <span className="text-muted-foreground">({Math.round(query.confidence * 100)}%)</span>
                                        {index < conversion.likelyQueries.length - 1 ? ', ' : null}
                                    </span>
                                )) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="max-w-[240px] py-2 pr-4 text-xs">
                                {conversion.hdyhauResponse || <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="py-2 capitalize">{conversion.conversionType}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
