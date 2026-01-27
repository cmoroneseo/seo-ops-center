import { DashboardData } from './types';

export interface AIInsight {
    summary: string;
    opportunities: string[];
    risks: string[];
}

/**
 * Simulates a call to Google Gemini or OpenAI to analyze SEO data.
 * In a real production app, this would be a server action calling the LLM API.
 */
export async function generateSEOAnalysis(data: DashboardData): Promise<AIInsight> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    const isPositive = data.kpi.impressionsChange > 0;

    return {
        summary: `Overall performance is ${isPositive ? 'trending upwards' : 'stabilizing'}. Total impressions have reached ${data.kpi.totalImpressions.toLocaleString()} with a ${data.kpi.impressionsChange}% change. The average position is holding steady at ${data.kpi.avgPosition}.`,
        opportunities: [
            `Keyword "${data.topKeywords[1].keyword}" has high volume (${data.topKeywords[1].volume}) but is on page 2. Optimize content to break into top 10.`,
            `Click-through rate (CTR) for "Personal Injury" pages is lower than industry average. Consider rewriting meta descriptions.`,
            `New content gap identified for "local seo services" based on competitor movement.`
        ],
        risks: [
            `Competitors are aggressively targeting "${data.topKeywords[0].keyword}". Monitor backlinks closely.`,
            `Mobile page speed scores have dropped slightly on the blog section.`
        ]
    };
}
