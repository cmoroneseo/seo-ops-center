import { DashboardData, SEODataPoint, KeywordRanking } from './types';
import { subDays, format } from 'date-fns';

export const generateMockData = (): DashboardData => {
    // Generate last 30 days of traffic data
    const trafficHistory: SEODataPoint[] = Array.from({ length: 30 }).map((_, i) => {
        const date = subDays(new Date(), 29 - i);
        return {
            date: format(date, 'MMM dd'),
            impressions: Math.floor(Math.random() * 5000) + 2000,
            clicks: Math.floor(Math.random() * 300) + 100,
            position: Math.floor(Math.random() * 5) + 10,
        };
    });

    const topKeywords: KeywordRanking[] = [
        { keyword: 'seo agency software', position: 3, previousPosition: 5, volume: 1200, difficulty: 65 },
        { keyword: 'marketing dashboard', position: 8, previousPosition: 12, volume: 4500, difficulty: 80 },
        { keyword: 'client reporting tools', position: 2, previousPosition: 2, volume: 800, difficulty: 45 },
        { keyword: 'white label seo', position: 15, previousPosition: 18, volume: 2200, difficulty: 70 },
        { keyword: 'rank tracker', position: 5, previousPosition: 4, volume: 12000, difficulty: 90 },
    ];

    return {
        kpi: {
            totalImpressions: 85432,
            totalClicks: 6512,
            avgPosition: 14.2,
            activeKeywords: 1240,
            impressionsChange: 8.5,
            clicksChange: 12.3,
            positionChange: -0.5, // Negative is good for position
            keywordsChange: 24,
        },
        trafficHistory,
        topKeywords,
    };
};
