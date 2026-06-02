import { PlanType } from "./types";

export interface PlanLimits {
    maxClients: number;
    maxUsers: number;
    maxAIReportsPerMonth: number | 'unlimited';
    features: {
        timeTracking: boolean;
        clientPortal: boolean;
        whiteLabeling: boolean;
        apiAccess: boolean;
    };
}

export const PLAN_CONFIGS: Record<PlanType, PlanLimits> = {
    starter: {
        maxClients: 3,
        maxUsers: 1,
        maxAIReportsPerMonth: 0,
        features: {
            timeTracking: false,
            clientPortal: false,
            whiteLabeling: false,
            apiAccess: false,
        }
    },
    pro: {
        maxClients: 15,
        maxUsers: 5,
        maxAIReportsPerMonth: 20,
        features: {
            timeTracking: true,
            clientPortal: true,
            whiteLabeling: false,
            apiAccess: false,
        }
    },
    agency: {
        maxClients: 50,
        maxUsers: 1000, // Effectively unlimited
        maxAIReportsPerMonth: 'unlimited',
        features: {
            timeTracking: true,
            clientPortal: true,
            whiteLabeling: true,
            apiAccess: false,
        }
    },
    enterprise: {
        maxClients: 10000,
        maxUsers: 10000,
        maxAIReportsPerMonth: 'unlimited',
        features: {
            timeTracking: true,
            clientPortal: true,
            whiteLabeling: true,
            apiAccess: true,
        }
    }
};

// Internal/comp orgs (organizations.is_internal — e.g. Marketing Empire Group)
// bypass every plan limit. This is the single place that decision lives.
const UNLIMITED: PlanLimits = {
    maxClients: Infinity,
    maxUsers: Infinity,
    maxAIReportsPerMonth: 'unlimited',
    features: { timeTracking: true, clientPortal: true, whiteLabeling: true, apiAccess: true },
};

/**
 * The limits actually in force for an org: the plan's limits, unless the org is
 * internal (then everything is unlimited). Prefer this over PLAN_CONFIGS directly.
 */
export function getEffectiveLimits(planType: PlanType, isInternal = false): PlanLimits {
    return isInternal ? UNLIMITED : PLAN_CONFIGS[planType];
}

/**
 * Checks if a feature is enabled for a given plan (internal orgs: always on).
 */
export function isFeatureEnabled(
    planType: PlanType,
    feature: keyof PlanLimits['features'],
    isInternal = false,
): boolean {
    return getEffectiveLimits(planType, isInternal).features[feature];
}

/**
 * Checks if an organization can add more clients (internal orgs: always true).
 */
export function canAddClient(planType: PlanType, currentClientCount: number, isInternal = false): boolean {
    return currentClientCount < getEffectiveLimits(planType, isInternal).maxClients;
}

/**
 * Checks if an organization can generate more AI reports.
 * If usage tracking is handled elsewhere, this returns the limit.
 */
export function getAIReportLimit(planType: PlanType, isInternal = false): number | 'unlimited' {
    return getEffectiveLimits(planType, isInternal).maxAIReportsPerMonth;
}
