'use client';

import React from 'react';

interface RoiCardProps {
    conversions: number;
    avgDealValue: number | undefined;
}

const currency = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
});

export function RoiCard({ conversions, avgDealValue }: RoiCardProps) {
    if (!avgDealValue || conversions === 0) {
        return (
            <div className="rounded-xl border border-border/50 bg-card p-5">
                <p className="text-sm text-muted-foreground">
                    {!avgDealValue
                        ? 'Set an average deal value in Attribution Setup to see estimated pipeline calculations.'
                        : 'No organic or AI search conversions this month yet.'}
                </p>
            </div>
        );
    }

    const pipeline = conversions * avgDealValue;
    return (
        <div className="space-y-1 rounded-xl border border-border/50 bg-card p-5">
            <div className="text-sm text-muted-foreground">Estimated Attributed Pipeline</div>
            <div className="text-2xl font-bold">
                <span className="text-primary">{conversions} SEO/AI conversion events</span> ×{' '}
                {currency.format(avgDealValue)} avg ={' '}
                <span className="text-emerald-500">{currency.format(pipeline)}</span>
            </div>
            <p className="text-xs text-muted-foreground">Directional estimate from browser-recorded form submissions and phone-link clicks; not realized revenue or financial ROI.</p>
        </div>
    );
}
