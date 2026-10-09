/**
 * Scott Cole September fixture. The numbers match the approved client-report mock.
 * It is a frozen snapshot, not a live query.
 */

import { clientReportFromSnapshot, forAudience, type ClientReportModel } from './render-model';

const REPORT = '11111111-1111-4111-8111-111111111111';

export function scottColeSnapshot(): Record<string, unknown> {
    const days = Array.from({ length: 30 }, (_, index) => ({
        date: `2026-09-${String(index + 1).padStart(2, '0')}`,
        present: true,
        isIncomplete: false,
        clicks: index === 0 ? 65 : 0,
        impressions: index === 0 ? 37906 : 0,
    }));
    return {
        schemaVersion: 1,
        reportId: REPORT,
        organizationId: '22222222-2222-4222-8222-222222222222',
        clientId: '33333333-3333-4333-8333-333333333333',
        reportMonth: '2026-09',
        title: 'Scott Cole Plumbing — September 2026',
        capturedAt: '2026-10-08T00:03:00.000Z',
        reason: 'approval',
        correctionNote: null,
        copy: { executiveSummary: '', recommendations: '', whatWeDid: null },
        metrics: [{
            source: 'gsc',
            metricMonth: '2026-09',
            data: { organic_clicks: 65, impressions: 37906 },
            provenance: null,
            sourceType: 'auto',
            updatedAt: '2026-10-08T00:03:00.000Z',
        }],
        gscSeries: days,
        ledgerRows: [],
        receipts: [],
        portal: {},
        clientReport: {
            clientName: 'Scott Cole Plumbing',
            agencyName: 'Marketing Empire Group',
            property: 'sc-domain:scottcoleplumbing.com',
            gbpConnected: false,
            gscConnected: true,
            gbpLinkShown: 4909,
            gbpLinkClicks: 25,
            comparablePrior: false,
            final: true,
            partialMonths: ['2026-08'],
            domainRating: 18,
            cities: [
                {
                    name: 'Eastvale',
                    mapTop3: 58,
                    mapPhrases: 67,
                    websitePage1: 40,
                    websitePhrases: 109,
                    mapSentence: 'In the top 3 map results for 58 of 67 Eastvale phrases. Your strongest area.',
                    websiteSentence: 'On page 1 for 40 of 109 phrases.',
                },
                {
                    name: 'Chino',
                    mapTop3: 42,
                    mapPhrases: 55,
                    websitePage1: 54,
                    websitePhrases: 122,
                    mapSentence: 'In the top 3 map results for 42 of 55 Chino phrases.',
                    websiteSentence: 'On page 1 for 54 of 122 phrases, a bit under half. Room to grow.',
                },
                {
                    name: 'Corona',
                    mapTop3: 8,
                    mapPhrases: 20,
                    websitePage1: 81,
                    websitePhrases: 143,
                    mapSentence: 'In the top 3 map results for 8 of 20 Corona phrases.',
                    websiteSentence: 'On page 1 for 81 of 143 phrases. In Corona the website does most of the work.',
                },
            ],
            nextItems: [
                {
                    audience: 'am',
                    label: 'Chino and Corona pages',
                    sentence: "Both sit at the bottom of page 1 or top of page 2. That's where small fixes pay off most.",
                },
                {
                    audience: 'am',
                    label: 'Business Profile',
                    sentence: "Once you give us access, we'll add calls and directions to this report.",
                },
                {
                    audience: 'client',
                    label: 'Extend Search history to 16 months',
                    sentence: 'Extend Search history to 16 months so comparisons start sooner.',
                },
            ],
        },
    };
}

export function scottColeReport(audience: 'client' | 'staff' = 'client'): ClientReportModel {
    const model = clientReportFromSnapshot(scottColeSnapshot(), {
        reports: [{ month: '2026-09', reportId: REPORT }],
    });
    if (!model) throw new Error('Scott Cole fixture did not render');
    return forAudience(model, audience);
}
