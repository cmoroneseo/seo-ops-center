import { createClient } from './client';
import { DashboardData, SEODataPoint, KeywordRanking, KPIMetrics } from '../types';
import { generateMockData } from '../mock-service';

export async function getDashboardData(organizationId: string): Promise<DashboardData | null> {
    const supabase = createClient();
    if (!supabase) {
        console.log('Supabase client not initialized, falling back to mock data');
        return generateMockData();
    }

    try {
        const { data: metrics, error } = await supabase
            .from('metrics')
            .select('*')
            .eq('organization_id', organizationId)
            .order('date', { ascending: true });

        if (error) throw error;

        // If no metrics found, fallback to mock data for consistent experience
        if (!metrics || metrics.length === 0) {
            console.log('No metrics found in DB, falling back to mock data');
            return generateMockData();
        }

        // Transform metrics into DashboardData format
        const trafficHistory: SEODataPoint[] = (metrics || []).map(m => ({
            date: m.date,
            impressions: (m.data as any).impressions || 0,
            clicks: (m.data as any).clicks || 0,
            position: (m.data as any).position || 0,
        }));

        // Placeholder for Top Keywords (could be a separate table or part of metrics)
        const topKeywords: KeywordRanking[] = [
            { keyword: 'seo agency software', position: 3, previousPosition: 5, volume: 1200, difficulty: 65 },
        ];

        const kpi: KPIMetrics = {
            totalImpressions: trafficHistory.reduce((acc, curr) => acc + curr.impressions, 0),
            totalClicks: trafficHistory.reduce((acc, curr) => acc + curr.clicks, 0),
            avgPosition: trafficHistory.length > 0
                ? trafficHistory.reduce((acc, curr) => acc + curr.position, 0) / trafficHistory.length
                : 0,
            activeKeywords: topKeywords.length,
            impressionsChange: 10,
            clicksChange: 5,
            positionChange: -0.2,
            keywordsChange: 2,
        };

        return {
            kpi,
            trafficHistory,
            topKeywords,
        };
    } catch (err) {
        console.error('Error fetching dashboard data, falling back to mock data:', err);
        return generateMockData();
    }
}
