/**
 * Run with:  node --test lib/seo-ops-logic.test.ts
 * (Node >= 23 strips TypeScript types natively — no test framework needed.)
 *
 * Cases use real workbook rows where possible (Marathon Finishing = Campaign 7
 * blogs; retainer cadences like 2x/month).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBlogsPerMonth,
  parseCampaignBlogs,
  completeMonthsBetween,
  actualBlogsDueToDate,
  targetBlogCount,
  onTrackStatus,
  hoursUsageStatus,
  tierWeekWeights,
  allocatePlannedHours,
  hourBand,
  teamBonus,
  kpiBonusFromCounts,
  mapLegacyDeliverableStatus,
  clientSlug,
  proratedQuantity,
  fulfillmentStatus,
} from './seo-ops-logic.ts';

test('parseBlogsPerMonth: cadence ladder', () => {
  assert.equal(parseBlogsPerMonth('Campaign: 7 blogs'), 0);
  assert.equal(parseBlogsPerMonth('1x/month'), 1);
  assert.equal(parseBlogsPerMonth('2x/month'), 2);
  assert.equal(parseBlogsPerMonth('3x/month'), 3);
  assert.equal(parseBlogsPerMonth('4x/month'), 4);
  assert.equal(parseBlogsPerMonth('2x month'), 2);
  assert.equal(parseBlogsPerMonth('No blogs'), 0);
  assert.equal(parseBlogsPerMonth(''), 0);
  assert.equal(parseBlogsPerMonth(null), 0);
  assert.equal(parseBlogsPerMonth('Monthly blog'), 1);
});

test('parseCampaignBlogs', () => {
  assert.equal(parseCampaignBlogs('Campaign: 7 blogs'), 7);
  assert.equal(parseCampaignBlogs('2x/month'), null);
});

test('completeMonthsBetween: full calendar months only', () => {
  assert.equal(completeMonthsBetween('2025-01-15', '2025-04-15'), 3);
  assert.equal(completeMonthsBetween('2025-01-15', '2025-04-14'), 2);
  assert.equal(completeMonthsBetween('2025-04-15', '2025-01-15'), 0); // reversed
});

test('actualBlogsDueToDate & targetBlogCount', () => {
  const retainer = { engagementModel: 'Retainer' as const, blogsDuePerMonth: 2, launchDate: '2025-01-01' };
  assert.equal(actualBlogsDueToDate(retainer, '2025-04-01'), 6); // 3 months * 2
  assert.equal(targetBlogCount(retainer, '2025-04-01'), 8);      // (3+1) * 2

  const campaign = { engagementModel: 'Campaign' as const, blogsDuePerMonth: 0, campaignTotalBlogs: 7 };
  assert.equal(actualBlogsDueToDate(campaign, '2025-04-01'), 7);

  // launch override wins
  const override = { engagementModel: 'Retainer' as const, blogsDuePerMonth: 1, launchDate: '2024-01-01', launchDateOverride: '2025-01-01' };
  assert.equal(actualBlogsDueToDate(override, '2025-04-01'), 3);
});

test('onTrackStatus: campaign', () => {
  assert.equal(onTrackStatus({ engagementModel: 'Campaign', delivered: 7, due: 7, pastDue: 0 }).status, 'Campaign Complete');
  assert.equal(onTrackStatus({ engagementModel: 'Campaign', delivered: 3, due: 7, pastDue: 0 }).status, 'Campaign In Progress');
});

test('onTrackStatus: retainer ladder', () => {
  assert.equal(onTrackStatus({ engagementModel: 'Retainer', delivered: 5, due: 4, pastDue: 0 }).status, 'Ahead');
  assert.equal(onTrackStatus({ engagementModel: 'Retainer', delivered: 4, due: 4, pastDue: 0, hasInProgress: true }).status, 'On Schedule');
  assert.equal(onTrackStatus({ engagementModel: 'Retainer', delivered: 4, due: 4, pastDue: 0, hasUpcomingDueSoon: true }).status, 'Needs Attention');
  assert.equal(onTrackStatus({ engagementModel: 'Retainer', delivered: 4, due: 4, pastDue: 0 }).status, 'On Track');
  assert.equal(onTrackStatus({ engagementModel: 'Retainer', delivered: 3, due: 4, pastDue: 1 }).status, 'Needs Attention');
  const behind = onTrackStatus({ engagementModel: 'Retainer', delivered: 2, due: 4, pastDue: 2 });
  assert.equal(behind.status, 'Behind');
  assert.equal(behind.severity, 'critical');
});

test('hoursUsageStatus thresholds', () => {
  assert.equal(hoursUsageStatus(20, 18).status, 'Over');
  assert.equal(hoursUsageStatus(18, 18).status, 'On Target');
  assert.equal(hoursUsageStatus(15, 18).status, 'At Risk'); // .833
  assert.equal(hoursUsageStatus(5, 18).status, 'Under');
  assert.equal(hoursUsageStatus(5, 0).pct, null);
});

test('tierWeekWeights & allocatePlannedHours', () => {
  assert.deepEqual(tierWeekWeights(1), [0.25, 0.25, 0.25, 0.25]);
  assert.deepEqual(tierWeekWeights(2), [0.5, 0, 0.5, 0]);
  assert.deepEqual(tierWeekWeights(3), [0, 0, 0, 1]);
  assert.deepEqual(tierWeekWeights(1, 5), [0.25, 0.25, 0.25, 0.25, 0]);
  assert.deepEqual(allocatePlannedHours(18, 1), [4.5, 4.5, 4.5, 4.5]);
  assert.deepEqual(allocatePlannedHours(18, 2), [9, 0, 9, 0]);
  assert.deepEqual(allocatePlannedHours(18, 3), [0, 0, 0, 18]);
});

test('hourBand', () => {
  assert.equal(hourBand(18), 'Premium');
  assert.equal(hourBand(10), 'Standard');
  assert.equal(hourBand(5), 'Light');
  assert.equal(hourBand(2), 'Maintenance');
});

test('teamBonus cap & kpiBonusFromCounts', () => {
  assert.equal(teamBonus(153, 150), 300); // min(303, 300)
  assert.equal(teamBonus(100, 50), 150);
  assert.equal(kpiBonusFromCounts(3, 50), 150);
});

test('mapLegacyDeliverableStatus', () => {
  assert.equal(mapLegacyDeliverableStatus('Delivered', 'Approved'), 'Approved');
  assert.equal(mapLegacyDeliverableStatus('Delivered', ''), 'Published');
  assert.equal(mapLegacyDeliverableStatus('In Progress'), 'In Progress');
  assert.equal(mapLegacyDeliverableStatus('Not Started'), 'Pending');
  assert.equal(mapLegacyDeliverableStatus('', ''), 'Pending');
});

test('clientSlug matches workbook Client IDs', () => {
  assert.equal(clientSlug('Marathon Finishing'), 'marathonfinishing');
  assert.equal(clientSlug('Native Falls Campgrounds'), 'nativefallscampgrounds');
  assert.equal(clientSlug('Titan Tent & Event Rentals'), 'titantenteventrentals');
});

test('proratedQuantity: full month, mid-month start/end, no overlap', () => {
  // Full month coverage -> full quantity
  assert.equal(proratedQuantity({ quantityPerMonth: 2, startsOn: '2026-01-15' }, '2026-06'), 2);
  // Starts on the 20th of a 30-day month -> ceil(2 * 11/30) = 1
  assert.equal(proratedQuantity({ quantityPerMonth: 2, startsOn: '2026-06-20' }, '2026-06'), 1);
  // Ends mid-month -> ceil(4 * 10/30) = 2
  assert.equal(proratedQuantity({ quantityPerMonth: 4, startsOn: '2026-01-01', endsOn: '2026-06-10' }, '2026-06'), 2);
  // No overlap (starts after month / ended before month) -> 0
  assert.equal(proratedQuantity({ quantityPerMonth: 2, startsOn: '2026-07-01' }, '2026-06'), 0);
  assert.equal(proratedQuantity({ quantityPerMonth: 2, startsOn: '2026-01-01', endsOn: '2026-05-31' }, '2026-06'), 0);
  // Starts exactly on the 1st -> full quantity
  assert.equal(proratedQuantity({ quantityPerMonth: 3, startsOn: '2026-06-01' }, '2026-06'), 3);
});

test('fulfillmentStatus: lifecycle of a 2x/month client', () => {
  // Nothing promised -> trivially fulfilled
  assert.equal(fulfillmentStatus({ promised: 0, delivered: 0, inProgress: 0, overdue: 0, daysLeftInMonth: 20 }).status, 'Fulfilled');
  // All delivered
  assert.equal(fulfillmentStatus({ promised: 2, delivered: 2, inProgress: 0, overdue: 0, daysLeftInMonth: 5 }).status, 'Fulfilled');
  // Something past due -> Overdue (critical)
  const od = fulfillmentStatus({ promised: 2, delivered: 0, inProgress: 1, overdue: 1, daysLeftInMonth: 10 });
  assert.equal(od.status, 'Overdue');
  assert.equal(od.severity, 'critical');
  // Early in month, work remaining but nothing overdue -> On Pace
  assert.equal(fulfillmentStatus({ promised: 2, delivered: 0, inProgress: 0, overdue: 0, daysLeftInMonth: 25 }).status, 'On Pace');
  // Remaining covered by in-production work -> On Pace
  assert.equal(fulfillmentStatus({ promised: 2, delivered: 1, inProgress: 1, overdue: 0, daysLeftInMonth: 8 }).status, 'On Pace');
  // Late in month, work not started -> At Risk
  assert.equal(fulfillmentStatus({ promised: 2, delivered: 1, inProgress: 0, overdue: 0, daysLeftInMonth: 8 }).status, 'At Risk');
  // Final days, more remaining than in production -> Behind
  assert.equal(fulfillmentStatus({ promised: 2, delivered: 0, inProgress: 1, overdue: 0, daysLeftInMonth: 3 }).status, 'Behind');
});
