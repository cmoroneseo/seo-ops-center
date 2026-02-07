export type PlanType = 'starter' | 'pro' | 'agency' | 'enterprise';

export interface Organization {
    id: string;
    name: string;
    slug: string;
    stripeCustomerId?: string;
    subscriptionStatus: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';
    planType: PlanType;
    createdAt: string;
}

export interface OrganizationMember {
    id: string;
    organizationId: string;
    userId: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
    createdAt: string;
    organization?: Organization;
}

export interface User {
    id: string;
    email: string;
    fullName?: string;
    avatarUrl?: string;
    systemRole: 'admin' | 'user';
}

export interface SEODataPoint {
    date: string;
    impressions: number;
    clicks: number;
    position: number;
}

export interface KeywordRanking {
    keyword: string;
    position: number;
    previousPosition: number;
    volume: number;
    difficulty: number;
}

export interface KPIMetrics {
    totalImpressions: number;
    totalClicks: number;
    avgPosition: number;
    activeKeywords: number;
    impressionsChange: number;
    clicksChange: number;
    positionChange: number;
    keywordsChange: number;
}

export interface DashboardData {
    kpi: KPIMetrics;
    trafficHistory: SEODataPoint[];
    topKeywords: KeywordRanking[];
}

export type ProjectStatus = 'Active' | 'Paused' | 'Cancelled' | 'Onboarding';
export type EngagementModel = 'Campaign' | 'Retainer';
export type Tier = 1 | 2 | 3;

export type DeliverableType = 'Content' | 'Backlink' | 'GBP' | 'Other';
export type DeliverableStatus = 'Pending' | 'In Progress' | 'Review' | 'Approved' | 'Published';

export interface Deliverable {
    id: string;
    clientId: string;
    title: string;
    type: DeliverableType;
    status: DeliverableStatus;
    dueDate: string;
    completedDate?: string;
    countsTowardsHours: boolean;
    assignee?: string;
    link?: string;
}

export interface CampaignConfig {
    startDate: string;
    endDate: string;
    totalHours: number;
    hoursUsed: number;
    monthlyBlogQuota: number;
    monthlyBacklinkQuota: number;
}

export interface RetainerConfig {
    monthlyHours: number;
    hoursUsed: number;
    categoryAllocation?: {
        technical: number;
        content: number;
        local: number;
        strategy: number;
    };
    recurringDeliverables: {
        type: DeliverableType;
        count: number;
    }[];
}

export interface ApprovalItem {
    id: string;
    title: string;
    sentDate: string;
    type: 'Blog' | 'Brief' | 'Audit' | 'Other';
}

export interface Subtask {
    id: string;
    title: string;
    completed: boolean;
}

export interface Task {
    id: string;
    organizationId: string;
    projectId?: string;
    clientName?: string;
    title: string;
    description?: string;
    assignees: string[]; // Array of User IDs
    dueDate: string;
    priority: 'low' | 'medium' | 'high';
    status: 'todo' | 'in_progress' | 'review' | 'done';
    tags: string[];
    subtasks: Subtask[];
    isTimerRunning?: boolean;
    startTime?: string; // ISO string
    elapsedTime?: number; // in seconds
}

export interface ClientProject {
    id: string;
    organizationId: string;
    clientName: string;
    launchDate: string;
    accountManager: string;
    status: ProjectStatus;
    tier: Tier;

    // Engagement Model
    engagementModel: EngagementModel;
    campaignConfig?: CampaignConfig;
    retainerConfig?: RetainerConfig;

    // Legacy/Derived fields (keeping some for compatibility or UI display)
    seoHours: number; // derived from config
    deliverables: string; // display string
    blogsDuePerMonth: number; // derived from config

    blogProgress: {
        target: number;
        dueToDate: number;
        delivered: number;
        pastDue: number;
        override?: number;
        isOnTrack: boolean;
    };
    approvals: {
        pendingCount: number;
        items: ApprovalItem[];
    };
    tasks: Task[];
    activeDeliverables: Deliverable[];
}

export interface WeeklyPlan {
    weekNumber: number; // 1-5
    label: string; // e.g., "Nov 3-Nov 7"
    planned: number;
    logged: number;
    variance: number;
}

export interface MonthlyPlan {
    id: string;
    clientId: string;
    month: string; // "YYYY-MM"
    totalPlanned: number;
    totalLogged: number;
    totalVariance: number;
    weeks: WeeklyPlan[];
    notes?: string;
}

export interface TimeLog {
    id: string;
    organizationId: string;
    clientId: string;
    projectId?: string;
    taskId?: string;
    userId: string;
    date: string;
    hours: number;
    description: string;
    billable: boolean;
}
