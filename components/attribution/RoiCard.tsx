'use client';

interface RoiCardProps {
    conversions: number;
    avgDealValue: number | undefined;
    monthlyRetainer: number;
}

const currency = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
});

export function RoiCard({ conversions, avgDealValue, monthlyRetainer }: RoiCardProps) {
    if (!avgDealValue || conversions === 0) {
        return (
            <div className="rounded-xl border border-border/50 bg-card p-5">
                <p className="text-sm text-muted-foreground">
                    {!avgDealValue
                        ? 'Set an average deal value in Attribution Setup to see ROI calculations.'
                        : 'No conversions this month yet.'}
                </p>
            </div>
        );
    }

    const pipeline = conversions * avgDealValue;
    const roi = monthlyRetainer > 0 ? Math.round((pipeline / monthlyRetainer) * 10) / 10 : 0;

    return (
        <div className="space-y-1 rounded-xl border border-border/50 bg-card p-5">
            <div className="text-sm text-muted-foreground">Estimated Pipeline</div>
            <div className="text-2xl font-bold">
                SEO drove <span className="text-primary">{conversions} leads</span> ×{' '}
                {currency.format(avgDealValue)} avg ={' '}
                <span className="text-emerald-500">{currency.format(pipeline)}</span>
            </div>
            {monthlyRetainer > 0 ? (
                <div className="text-sm text-muted-foreground">
                    Retainer: {currency.format(monthlyRetainer)} →{' '}
                    <span className="font-semibold text-emerald-500">{roi}x ROI</span>
                </div>
            ) : null}
        </div>
    );
}
