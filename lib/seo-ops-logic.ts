/**
 * seo-ops-logic.ts
 * -----------------------------------------------------------------------------
 * Pure functions that replace the SEO Ops Command Center workbook's custom
 * formulas (the IP worth keeping). These are used to COMPUTE derived values on
 * read so nothing has to be stored and kept in sync by hand.
 *
 * Source formulas: "Client Overview" cols F/J/K/O, "Monthly SEO Summary" col F,
 * "TimeAllocation.js" tier weights, "VelocitySystem.js" hour bands, and the
 * "SEO Team Bonus Tracker". See docs/seo-ops-migration-spec.md.
 *
 * No I/O, no dependencies — trivially unit-testable (lib/seo-ops-logic.test.ts).
 */

export type EngagementModel = 'Retainer' | 'Campaign';
export type Severity = 'ok' | 'info' | 'warn' | 'critical';

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function toDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

/**
 * Complete calendar months between two dates — mirrors Sheets `DATEDIF(a,b,"M")`.
 * Counts only fully-elapsed months (the day-of-month must have been reached).
 */
export function completeMonthsBetween(from: Date | string, to: Date | string): number {
  const a = toDate(from);
  const b = toDate(to);
  if (b < a) return 0;
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  return Math.max(0, months);
}

// ---------------------------------------------------------------------------
// Deliverables cadence ("Deliverables" string -> blogs/month)
// ---------------------------------------------------------------------------

/**
 * Parse the free-text "Deliverables" cell into a recurring blogs-per-month
 * number. Replicates Client Overview col F's regex ladder.
 *   "3x/month" -> 3, "2x month" -> 2, "4x/month" -> 4, "Campaign: 7 blogs" -> 0
 *   (campaign isn't recurring), "No blogs"/"" -> 0, mentions "blog" -> 1.
 */
export function parseBlogsPerMonth(spec?: string | null): number {
  if (!spec) return 0;
  const s = spec.toString().trim().toLowerCase();
  if (s === '' || s.includes('no blogs')) return 0;
  if (/campaign:\s*\d+\s*blogs/.test(s)) return 0;
  const cadence = s.match(/(\d+)\s*x\s*\/?\s*month/);
  if (cadence) return Number(cadence[1]);
  if (s.includes('blog')) return 1;
  return 0;
}

/** Extract the fixed blog count from a "Campaign: N blogs" spec, else null. */
export function parseCampaignBlogs(spec?: string | null): number | null {
  if (!spec) return null;
  const m = spec.toString().toLowerCase().match(/campaign:\s*(\d+)\s*blogs/);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Blog progress (Client Overview cols J & K)
// ---------------------------------------------------------------------------

export interface ClientEngagement {
  engagementModel: EngagementModel;
  blogsDuePerMonth: number;
  launchDate?: Date | string | null;
  launchDateOverride?: Date | string | null;
  campaignTotalBlogs?: number | null;
  deliverablesSpec?: string | null;
}

function effectiveLaunch(c: ClientEngagement): Date | null {
  const raw = c.launchDateOverride ?? c.launchDate;
  return raw ? toDate(raw) : null;
}

/**
 * "Actual Blogs Due (To Date)" — Client Overview col K.
 * Campaign: the fixed campaign count. Retainer: cadence × complete months
 * since (effective) launch.
 */
export function actualBlogsDueToDate(c: ClientEngagement, today: Date | string = new Date()): number {
  if (c.engagementModel === 'Campaign') {
    return c.campaignTotalBlogs ?? parseCampaignBlogs(c.deliverablesSpec) ?? 0;
  }
  const launch = effectiveLaunch(c);
  if (!launch) return 0;
  return completeMonthsBetween(launch, today) * (c.blogsDuePerMonth || 0);
}

/**
 * "Target Blog Count" — Client Overview col J. For retainers this is the
 * to-date amount plus the current (in-progress) month: cadence × (months + 1).
 */
export function targetBlogCount(c: ClientEngagement, today: Date | string = new Date()): number {
  if (c.engagementModel === 'Campaign') {
    return c.campaignTotalBlogs ?? parseCampaignBlogs(c.deliverablesSpec) ?? 0;
  }
  const launch = effectiveLaunch(c);
  if (!launch) return 0;
  return (completeMonthsBetween(launch, today) + 1) * (c.blogsDuePerMonth || 0);
}

// ---------------------------------------------------------------------------
// On-Track status (Client Overview col O) — returns reasons, not emoji
// ---------------------------------------------------------------------------

export type OnTrackStatus =
  | 'Ahead'
  | 'On Track'
  | 'On Schedule'
  | 'Needs Attention'
  | 'Behind'
  | 'Campaign Complete'
  | 'Campaign In Progress';

export interface OnTrackInput {
  engagementModel: EngagementModel;
  delivered: number;          // blogs delivered this period
  due: number;                // blogs due to date (use actualBlogsDueToDate / target)
  pastDue: number;            // overdue blog count
  hasInProgress?: boolean;    // any deliverable currently In Progress
  hasUpcomingDueSoon?: boolean; // a Not-Started deliverable due within ~3 days
}

export interface StatusResult<T extends string> {
  status: T;
  severity: Severity;
  reason: string;
}

/**
 * Health of a client's blog delivery. Mirrors the nested-IF in col O but
 * returns a structured {status, severity, reason} the UI can explain.
 */
export function onTrackStatus(i: OnTrackInput): StatusResult<OnTrackStatus> {
  if (i.engagementModel === 'Campaign') {
    return i.delivered >= i.due
      ? { status: 'Campaign Complete', severity: 'ok', reason: `${i.delivered}/${i.due} campaign blogs delivered` }
      : { status: 'Campaign In Progress', severity: 'info', reason: `${i.delivered}/${i.due} campaign blogs delivered` };
  }
  if (i.delivered > i.due) {
    return { status: 'Ahead', severity: 'ok', reason: `${i.delivered} delivered vs ${i.due} due` };
  }
  if (i.pastDue === 0) {
    if (i.hasInProgress) {
      return { status: 'On Schedule', severity: 'info', reason: 'work in progress, nothing overdue' };
    }
    if (i.hasUpcomingDueSoon) {
      return { status: 'Needs Attention', severity: 'warn', reason: 'a deliverable is due soon and not started' };
    }
    return { status: 'On Track', severity: 'ok', reason: 'on schedule' };
  }
  if (i.pastDue === 1) {
    return { status: 'Needs Attention', severity: 'warn', reason: '1 blog past due' };
  }
  return { status: 'Behind', severity: 'critical', reason: `${i.pastDue} blogs past due` };
}

// ---------------------------------------------------------------------------
// Deliverable commitments — prorated monthly quantity + fulfillment status
// ---------------------------------------------------------------------------

export interface CommitmentWindow {
  quantityPerMonth: number;
  startsOn: Date | string;        // commitment effective start
  endsOn?: Date | string | null;  // null/undefined = open-ended
}

/**
 * Expected quantity for a commitment in a given 'YYYY-MM' month, prorated for
 * mid-month starts/ends: ceil(qty × activeDays / daysInMonth). A commitment
 * fully covering the month yields quantityPerMonth; one not overlapping it, 0.
 */
export function proratedQuantity(c: CommitmentWindow, month: string): number {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return 0;
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 0); // last day of month
  const daysInMonth = monthEnd.getDate();

  const starts = toDate(c.startsOn);
  const ends = c.endsOn ? toDate(c.endsOn) : null;
  if (starts > monthEnd || (ends && ends < monthStart)) return 0;

  const activeFrom = starts > monthStart ? starts : monthStart;
  const activeTo = ends && ends < monthEnd ? ends : monthEnd;
  const activeDays = activeTo.getDate() - activeFrom.getDate() + 1;
  if (activeDays >= daysInMonth) return c.quantityPerMonth;
  return Math.max(0, Math.ceil(c.quantityPerMonth * (activeDays / daysInMonth)));
}

export type FulfillmentStatus = 'Fulfilled' | 'On Pace' | 'At Risk' | 'Behind' | 'Overdue';

export interface FulfillmentInput {
  promised: number;       // prorated expected quantity this month
  delivered: number;      // Approved/Published count
  inProgress: number;     // In Progress/Review count
  overdue: number;        // past due_date and not delivered
  daysLeftInMonth: number;
}

/**
 * Health of a client+type's monthly fulfillment. Same {status, severity,
 * reason} shape as onTrackStatus so the UI badge components are shared.
 */
export function fulfillmentStatus(i: FulfillmentInput): StatusResult<FulfillmentStatus> {
  if (i.promised <= 0) {
    return { status: 'Fulfilled', severity: 'ok', reason: 'nothing promised this month' };
  }
  if (i.delivered >= i.promised) {
    return { status: 'Fulfilled', severity: 'ok', reason: `${i.delivered}/${i.promised} delivered` };
  }
  if (i.overdue > 0) {
    return { status: 'Overdue', severity: 'critical', reason: `${i.overdue} past due` };
  }
  const remaining = i.promised - i.delivered;
  if (i.daysLeftInMonth <= 5 && remaining > i.inProgress) {
    return { status: 'Behind', severity: 'critical', reason: `${remaining} remaining, ${i.daysLeftInMonth} days left` };
  }
  if (i.inProgress >= remaining) {
    return { status: 'On Pace', severity: 'info', reason: `${remaining} remaining, all in production` };
  }
  if (i.daysLeftInMonth <= 10) {
    return { status: 'At Risk', severity: 'warn', reason: `${remaining - i.inProgress} not started, ${i.daysLeftInMonth} days left` };
  }
  return { status: 'On Pace', severity: 'ok', reason: `${i.delivered}/${i.promised} delivered, ${i.daysLeftInMonth} days left` };
}

// ---------------------------------------------------------------------------
// Hours usage status (Monthly SEO Summary col F)
// ---------------------------------------------------------------------------

export type HoursStatus = 'Over' | 'On Target' | 'At Risk' | 'Under';

export interface HoursStatusResult extends StatusResult<HoursStatus> {
  pct: number | null; // logged / allotted (null if no budget)
}

/** logged vs monthly allotted hours -> Over / On Target / At Risk / Under. */
export function hoursUsageStatus(logged: number, allotted: number): HoursStatusResult {
  if (!allotted || allotted <= 0) {
    return { status: 'Under', severity: 'ok', reason: 'no budget set', pct: null };
  }
  const pct = logged / allotted;
  if (pct > 1) return { status: 'Over', severity: 'critical', reason: `${Math.round(pct * 100)}% of budget used`, pct };
  if (pct === 1) return { status: 'On Target', severity: 'ok', reason: 'exactly on budget', pct };
  if (pct >= 0.8) return { status: 'At Risk', severity: 'warn', reason: `${Math.round(pct * 100)}% of budget used`, pct };
  return { status: 'Under', severity: 'ok', reason: `${Math.round(pct * 100)}% of budget used`, pct };
}

// ---------------------------------------------------------------------------
// Tier -> weekly hour allocation (TimeAllocation.js / MonthlyHourPlanner.js)
// ---------------------------------------------------------------------------

/**
 * Per-tier week weights used to pre-fill planner "Planned" cells. Returns
 * `numWeeks` weights summing to 1.
 *   Tier 1: evenly spread.  Tier 2: front/mid-loaded.  Tier 3: end-loaded.
 */
export function tierWeekWeights(tier: number, numWeeks: 4 | 5 = 4): number[] {
  const base4: Record<number, number[]> = {
    1: [0.25, 0.25, 0.25, 0.25],
    2: [0.5, 0, 0.5, 0],
    3: [0, 0, 0, 1],
  };
  const w = base4[tier] ?? [0, 0, 0, 1];
  return numWeeks === 5 ? [...w, 0] : w;
}

/** Distribute monthly hours across weeks per tier (rounded to 2 dp). */
export function allocatePlannedHours(monthlyHours: number, tier: number, numWeeks: 4 | 5 = 4): number[] {
  return tierWeekWeights(tier, numWeeks).map((w) => Math.round(monthlyHours * w * 100) / 100);
}

// ---------------------------------------------------------------------------
// Hour bands (VelocitySystem.js) — reference for the deferred auto-scheduler
// ---------------------------------------------------------------------------

export type HourBand = 'Premium' | 'Standard' | 'Light' | 'Maintenance';

/** Classify a monthly hour budget into a touch-frequency band. */
export function hourBand(hours: number): HourBand {
  if (hours >= 16) return 'Premium';
  if (hours >= 8) return 'Standard';
  if (hours >= 4) return 'Light';
  return 'Maintenance';
}

// ---------------------------------------------------------------------------
// Team bonus (SEO Team Bonus Tracker)
// ---------------------------------------------------------------------------

/** Total monthly bonus = min(base + kpi, cap). Mirrors the sheet's MIN(...,300). */
export function teamBonus(baseFromHours: number, kpiBonus: number, cap = 300): number {
  return Math.min((baseFromHours || 0) + (kpiBonus || 0), cap);
}

/**
 * KPI bonus from counts. The sheet awarded $50 per ranking-group-of-3 plus $50
 * per other KPI; generalized here as `perUnit` × total units.
 */
export function kpiBonusFromCounts(units: number, perUnit = 50): number {
  return Math.max(0, Math.floor(units)) * perUnit;
}

// ---------------------------------------------------------------------------
// Legacy status mapping (import only)
// ---------------------------------------------------------------------------

export type DeliverableStatus = 'Pending' | 'In Progress' | 'Review' | 'Approved' | 'Published';

/**
 * Map the workbook's Deliverables Tracker status (col G) + "Delivered On" text
 * (col I, e.g. "Approved") onto the app's lifecycle. Import-time only.
 */
export function mapLegacyDeliverableStatus(sheetStatus?: string | null, deliveredOn?: string | null): DeliverableStatus {
  const s = (sheetStatus ?? '').toString().trim().toLowerCase();
  const d = (deliveredOn ?? '').toString().trim().toLowerCase();
  if (s === 'in progress') return 'In Progress';
  if (s === 'not started' || s === '') return 'Pending';
  if (s === 'delivered') {
    if (d.includes('approved')) return 'Approved';
    return 'Published';
  }
  if (s === 'review') return 'Review';
  if (s === 'approved') return 'Approved';
  if (s === 'published') return 'Published';
  return 'Pending';
}

/** Normalize a client name to the workbook's Client ID slug (col R). Import key. */
export function clientSlug(name: string): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
