export type OverviewSeverity = 'ok' | 'info' | 'warn' | 'critical';

export interface HealthScoreInput {
    overdueDeliverables: number;
    hoursSeverity: OverviewSeverity;
    blockedTasks: number;
    hasCampaignPlan: boolean;
}

export interface NextBestActionInput extends HealthScoreInput {
    hoursLogged: number;
    hoursBudget: number;
    openTasks: number;
    atRiskDeliverables: number;
}

export interface NextBestAction {
    priority: 'critical' | 'high' | 'medium' | 'low';
    label: string;
    detail: string;
}

function scorePenalty(value: number, perItem: number, max: number): number {
    return Math.min(value * perItem, max);
}

export function computeHealthScore(input: HealthScoreInput): number {
    const raw = 100
        - scorePenalty(input.overdueDeliverables, 20, 40)
        - (input.hoursSeverity === 'critical' ? 15 : 0)
        - scorePenalty(input.blockedTasks, 5, 15)
        - (input.hasCampaignPlan ? 0 : 10);

    return Math.max(0, Math.min(100, raw));
}

export function computeNextBestActions(input: NextBestActionInput): NextBestAction[] {
    const actions: NextBestAction[] = [];

    if (input.overdueDeliverables > 0) {
        actions.push({
            priority: 'critical',
            label: 'Clear overdue deliverables',
            detail: `${input.overdueDeliverables} deliverable${input.overdueDeliverables === 1 ? '' : 's'} past due`,
        });
    }

    if (input.hoursSeverity === 'critical') {
        actions.push({
            priority: 'high',
            label: 'Review monthly hours',
            detail: `${input.hoursLogged.toFixed(1)} of ${input.hoursBudget.toFixed(1)} hours used`,
        });
    } else if (input.hoursSeverity === 'ok' && input.hoursBudget > 0 && input.hoursLogged / input.hoursBudget < 0.5) {
        actions.push({
            priority: 'medium',
            label: 'Schedule planned work',
            detail: `${Math.round((input.hoursLogged / input.hoursBudget) * 100)}% of monthly hours logged`,
        });
    }

    if (input.blockedTasks > 0) {
        actions.push({
            priority: 'high',
            label: 'Unblock active tasks',
            detail: `${input.blockedTasks} blocked task${input.blockedTasks === 1 ? '' : 's'} need attention`,
        });
    }

    if (!input.hasCampaignPlan) {
        actions.push({
            priority: 'medium',
            label: 'Create campaign plan',
            detail: 'No active campaign plan is attached to this client',
        });
    }

    if (input.atRiskDeliverables > 0 && input.overdueDeliverables === 0) {
        actions.push({
            priority: 'medium',
            label: 'Start at-risk deliverables',
            detail: `${input.atRiskDeliverables} deliverable group${input.atRiskDeliverables === 1 ? '' : 's'} at risk`,
        });
    }

    if (actions.length === 0) {
        actions.push({
            priority: 'low',
            label: 'Keep current cadence',
            detail: input.openTasks > 0 ? `${input.openTasks} open task${input.openTasks === 1 ? '' : 's'} in progress` : 'No urgent action needed',
        });
    }

    const order: Record<NextBestAction['priority'], number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return actions.sort((a, b) => order[a.priority] - order[b.priority]);
}
