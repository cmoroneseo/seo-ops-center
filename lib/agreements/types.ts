export type AgreementMode = 'monthly' | 'custom';
export type AgreementKind = 'initial' | 'renewal' | 'amendment';
export type AgreementHoursMode = 'committed' | 'allowance' | 'estimate';

export interface AgreementService {
    sourceId?: string;
    title: string;
    type: 'Content' | 'Backlink' | 'GBP' | 'Other';
    subtype?: string;
    quantity: number;
    cadence: 'monthly' | 'one_time';
    countsTowardHours: boolean;
}

/** Accepted terms are immutable. Successors bound operational coverage, not the signed document. */
export interface ClientAgreement {
    id: string;
    organizationId: string;
    clientId: string;
    previousId: string | null;
    kind: AgreementKind;
    title: string;
    startsOn: string;
    endsOn: string | null;
    mode: AgreementMode;
    hours: number | null;
    hoursMode: AgreementHoursMode;
    proration: 'daily' | 'full_period';
    timezone: string;
    scope: string;
    services: AgreementService[];
    evidence: string | null;
    note: string | null;
    recordedAt: string;
    recordedBy: string;
    planSnapshot: Record<string, unknown> | null;
    cancelledAt?: string | null;
}

export interface AgreementInput {
    kind: AgreementKind;
    previousId: string | null;
    title: string;
    startsOn: string;
    endsOn: string | null;
    mode: AgreementMode;
    hours: number | null;
    hoursMode: AgreementHoursMode;
    proration: 'daily' | 'full_period';
    timezone: string;
    scope: string;
    services: AgreementService[];
    evidence: string | null;
    note: string | null;
    /** Only future effort transfers. The original promise and past time retain their origin. */
    fundedTaskIds: string[];
}

export interface AgreementSegment {
    agreement: ClientAgreement;
    startsOn: string;
    endsOn: string;
    budget: number | null;
}

export interface AgreementPeriod {
    month: string;
    segments: AgreementSegment[];
    monthlyBudget: number;
    mixed: boolean;
    uncoveredDays: number;
}

export interface AgreementHoursSummary {
    period: AgreementPeriod;
    rows: Array<{ agreement: ClientAgreement; logged: number; periodLogged: number; budget: number | null }>;
    unassigned: number;
}

export interface AgreementPreview {
    token: string;
    agreements: ClientAgreement[];
    openTasks: Array<{ id: string; title: string; status: string }>;
    affectedHours: number;
    affectedReports: number;
    commitmentCount: number;
}

export interface AgreementWorkFunding {taskId:string;agreementId:string;transitionId:string;effectiveOn:string;recordedAt:string}
