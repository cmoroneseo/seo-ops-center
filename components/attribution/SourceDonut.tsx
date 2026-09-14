'use client';

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

const SOURCE_COLORS: Record<string, string> = {
    organic_google: '#22c55e',
    organic_bing: '#3b82f6',
    organic_other: '#6366f1',
    ai_chatgpt: '#a855f7',
    ai_perplexity: '#8b5cf6',
    ai_google_aio: '#14b8a6',
    social: '#f59e0b',
    paid: '#ef4444',
    direct: '#6b7280',
    referral: '#ec4899',
};

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

interface SourceDonutProps {
    data: { sourceCategory: string; count: number }[];
}

export function SourceDonut({ data }: SourceDonutProps) {
    if (data.length === 0) {
        return <p className="py-8 text-center text-sm text-muted-foreground">No conversion data yet.</p>;
    }

    const chartData = data.map(item => ({
        name: SOURCE_LABELS[item.sourceCategory] ?? item.sourceCategory,
        value: item.count,
        color: SOURCE_COLORS[item.sourceCategory] ?? '#94a3b8',
    }));

    return (
        <ResponsiveContainer width="100%" height={280}>
            <PieChart>
                <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                >
                    {chartData.map(entry => <Cell key={entry.name} fill={entry.color} />)}
                </Pie>
                <Tooltip />
                <Legend />
            </PieChart>
        </ResponsiveContainer>
    );
}
