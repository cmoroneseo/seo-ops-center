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

/**
 * Checks if a feature is enabled for a given plan.
 */
export function isFeatureEnabled(planType: PlanType, feature: keyof PlanLimits['features']): boolean {
    return PLAN_CONFIGS[planType].features[feature];
}

/**
 * Checks if an organization can add more clients.
 */
export function canAddClient(planType: PlanType, currentClientCount: number): boolean {
    return currentClientCount < PLAN_CONFIGS[planType].maxClients;
}

/**
 * Checks if an organization can generate more AI reports.
 * If usage tracking is handled elsewhere, this returns the limit.
 */
export function getAIReportLimit(planType: PlanType): number | 'unlimited' {
    return PLAN_CONFIGS[planType].maxAIReportsPerMonth;
}
