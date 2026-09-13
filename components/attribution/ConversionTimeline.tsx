'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { AttributionConversion } from '@/lib/types';

interface ConversionTimelineProps {
    conversions: AttributionConversion[];
}

export function ConversionTimeline({ conversions }: ConversionTimelineProps) {
    if (conversions.length === 0) {
        return <p className="py-8 text-center text-sm text-muted-foreground">No conversions this period.</p>;
    }

    const byDay = new Map<string, { organic: number; ai: number; other: number }>();
    for (const conversion of conversions) {
        const day = conversion.createdAt.slice(0, 10);
        const counts = byDay.get(day) ?? { organic: 0, ai: 0, other: 0 };
        if (conversion.sourceCategory.startsWith('organic_')) counts.organic += 1;
        else if (conversion.sourceCategory.startsWith('ai_')) counts.ai += 1;
        else counts.other += 1;
        byDay.set(day, counts);
    }

    const data = Array.from(byDay, ([isoDate, counts]) => ({ isoDate, date: isoDate.slice(5), ...counts }))
        .sort((a, b) => a.isoDate.localeCompare(b.isoDate));

    return (
        <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                <XAxis dataKey="date" className="text-xs" />
                <YAxis allowDecimals={false} className="text-xs" />
                <Tooltip />
                <Bar dataKey="organic" stackId="sources" fill="#22c55e" name="Organic" />
                <Bar dataKey="ai" stackId="sources" fill="#a855f7" name="AI Search" />
                <Bar dataKey="other" stackId="sources" fill="#6b7280" name="Other" />
            </BarChart>
        </ResponsiveContainer>
    );
}
