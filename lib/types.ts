export type PlanType = 'starter' | 'pro' | 'agency' | 'enterprise';

export interface Organization {
    id: string;
    name: string;
    slug: string;
    stripeCustomerId?: string;
    subscriptionStatus: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';
    planType: PlanType;
    isInternal?: boolean; // internal/comp org — bypasses plan limits & billing
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
    taskId?: string; // optional link to a task — advisory, not structural
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

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'approved' | 'blocked' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskCategory = 'content' | 'technical' | 'local' | 'links' | 'reporting' | 'admin';

export interface TaskStatusHistoryEntry {
    status: TaskStatus;
    at: string;  // ISO
    by?: string; // user ID
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
    clientId?: string;
    clientName?: string;
    title: string;
    description?: string;
    assigneeIds?: string[];   // multi-assignee (canonical new field)
    assignees?: string[];     // backward compat — display names or IDs
    dueDate?: string;
    startDate?: string;
    completedAt?: string;
    priority: TaskPriority;
    status: TaskStatus;
    category?: TaskCategory;
    tags: string[];
    subtasks: Subtask[];
    estimatedHours?: number;
    deliverableId?: string;
    parentTaskId?: string;
    sortOrder?: number;
    statusHistory?: TaskStatusHistoryEntry[];
    customFields?: Record<string, unknown>;
    watcherIds?: string[];
    createdBy?: string;
    templateId?: string;
    recurrence?: {
        freq: 'daily' | 'weekly' | 'monthly';
        dayOfMonth?: number;
        dayOfWeek?: number;
        endDate?: string;
    };
    // Basecamp sync (Phase 2 — populated after sync)
    basecampTodoId?: number;
    basecampProjectId?: number;
    lastSyncedAt?: string;
    // Timer state (computed from time_logs, not stored on task)
    isTimerRunning?: boolean;
    elapsedTime?: number;
}

export interface TaskComment {
    id: string;
    organizationId: string;
    taskId: string;
    authorId?: string;
    authorName?: string;
    body: string;
    mentions: string[];
    basecampCommentId?: number;
    createdAt: string;
    updatedAt: string;
}

export interface TaskTemplate {
    id: string;
    organizationId: string;
    name: string;
    description?: string;
    category?: TaskCategory;
    estimatedHours?: number;
    priority: TaskPriority;
    tags: string[];
    checklist: { title: string; required: boolean }[];
    recurrence?: Task['recurrence'];
    createdBy?: string;
    createdAt: string;
}

export interface ClientProject {
    id: string;
    organizationId: string;
    clientName: string;
    logoUrl?: string;
    launchDate: string;
    accountManager: string;
    status: ProjectStatus;
    tier: Tier;
    notes?: string;

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

export interface ClientNote {
    id: string;
    organizationId: string;
    clientId: string;
    content: string;
    authorName: string;
    createdAt: string;
    updatedAt: string;
}

export interface ClientAssignment {
    id: string;
    organizationId: string;
    clientId: string;
    assignedTo: string;       // display name
    assignedBy: string;       // display name
    assignedAt: string;       // ISO
    unassignedAt?: string;    // ISO — null means currently active
    notes?: string;           // optional reason for change
}

export type IntegrationService = 'ga4' | 'gsc' | 'gbp' | 'ahrefs';
export type IntegrationSyncStatus = 'active' | 'pending_setup' | 'error' | 'disconnected';

export interface ClientIntegration {
    id: string;
    organizationId: string;
    clientId: string;
    service: IntegrationService;
    // credentials are intentionally excluded from the client-side type —
    // the UI only needs status, not raw tokens
    connectedBy?: string;
    connectedAt: string;
    lastSyncedAt?: string;
    syncStatus: IntegrationSyncStatus;
    errorMessage?: string;
    // True when tokens exist but the property/location hasn't been selected yet
    needsPropertySetup?: boolean;
}

export interface ClientActivityEvent {
    id: string;
    organizationId: string;
    clientId: string;
    eventType: string;   // 'integration.connected' | 'integration.disconnected' | 'integration.reconfigured'
    actorId?: string;
    actorName?: string;
    metadata: Record<string, unknown>;
    occurredAt: string;
}

export interface SyncRun {
    id: string;
    organizationId: string;
    startedAt: string;
    finishedAt?: string;
    status: 'running' | 'completed' | 'partial' | 'failed';
    clientsSynced: number;
    clientsErrored: number;
    errorSummary: { clientId: string; service: string; message: string }[];
}

export type TimeLogStatus = 'in_progress' | 'logged' | 'needs_review';

export interface SessionNote {
    id: string;
    text: string;      // may contain [Label](/path) internal links
    createdAt: string; // ISO
}

export interface TimeLog {
    id: string;
    organizationId: string;
    clientId: string;
    clientName?: string;
    projectId?: string;
    taskId?: string;
    userId: string;
    date: string;
    hours: number;
    description: string;
    billable: boolean;
    status: TimeLogStatus;
    timerStartedAt?: string; // ISO — when the timer was last started/resumed
    elapsedSeconds: number;  // accumulated seconds (survives pause/resume)
    category?: string;
    sessionNotes: SessionNote[];
}
