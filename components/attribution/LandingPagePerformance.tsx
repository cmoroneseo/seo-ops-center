'use client';

interface PageRow {
    landingPage: string;
    count: number;
    topQuery: string;
    organicPct: number;
}

interface LandingPagePerformanceProps {
    pages: PageRow[];
}

export function LandingPagePerformance({ pages }: LandingPagePerformanceProps) {
    if (pages.length === 0) {
        return <p className="py-4 text-center text-sm text-muted-foreground">No landing page data yet.</p>;
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-border/50 text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Page</th>
                        <th className="py-2 pr-4 font-medium">Conversions</th>
                        <th className="py-2 pr-4 font-medium">Top Query</th>
                        <th className="py-2 font-medium">Organic %</th>
                    </tr>
                </thead>
                <tbody>
                    {pages.map(page => (
                        <tr key={page.landingPage} className="border-b border-border/30 hover:bg-muted/30">
                            <td className="max-w-[200px] truncate py-2 pr-4 font-mono text-xs" title={page.landingPage}>
                                {page.landingPage}
                            </td>
                            <td className="py-2 pr-4 font-semibold">{page.count}</td>
                            <td className="py-2 pr-4 text-xs">{page.topQuery || '—'}</td>
                            <td className="py-2">
                                <span className={page.organicPct >= 50 ? 'text-emerald-500' : 'text-muted-foreground'}>
                                    {page.organicPct}%
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
