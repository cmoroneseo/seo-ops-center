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
export type DeliverableSubtype = 'blog' | 'service_page' | 'city_page' | 'landing_page' | 'link_building' | 'gbp_management' | 'technical_seo' | string;
export type CommitmentCadence = 'monthly' | 'quarterly' | 'one_time';

export interface DeliverableStatusHistoryEntry {
    status: DeliverableStatus;
    at: string;
    by?: string;
}

export interface Deliverable {
    id: string;
    organizationId?: string;
    clientId: string;
    title: string;
    type: DeliverableType;
    subtype?: DeliverableSubtype;
    status: DeliverableStatus;
    month?: string; // YYYY-MM
    dueDate?: string | null;
    completedDate?: string;
    deliveredOn?: string;
    countsTowardsHours: boolean;
    assignee?: string;    // legacy display name field
    assigneeId?: string;  // FK to users
    link?: string;
    publishedUrl?: string;
    wordCount?: number;
    commitmentId?: string;
    generatedBy?: 'manual' | 'cron' | 'import';
    sequenceInMonth?: number;
    notes?: string;
    statusHistory?: DeliverableStatusHistoryEntry[];
    createdAt?: string;
    updatedAt?: string;
}

export type CommitmentEngagementModel = 'Retainer' | 'Campaign';

export interface DeliverableCommitment {
    id: string;
    organizationId: string;
    clientId: string;
    type: DeliverableType;
    subtype?: DeliverableSubtype;
    title: string;
    quantityPerMonth: number;
    cadence: CommitmentCadence;
    engagementModel: CommitmentEngagementModel;
    totalQuantity?: number;
    startsOn: string;
    endsOn?: string;
    isActive: boolean;
    defaultAssigneeId?: string;
    dueDay?: number;
    countsTowardHours: boolean;
    taskTemplateId?: string;
    generateTasks: boolean;
    notes?: string;
    customFields?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

export interface FulfillmentCell {
    clientId: string;
    type: DeliverableType;
    promised: number;
    generated: number;
    delivered: number;
    inProgress: number;
    overdue: number;
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

export type TaskCategory = 'content' | 'technical' | 'local' | 'links' | 'strategy' | 'admin' | string;
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'approved' | 'blocked';

export interface TaskStatusHistoryEntry {
    status: TaskStatus;
    at: string;
    by?: string;
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
    title?: string;
    description?: string;
    category?: TaskCategory;
    priority?: TaskPriority;
    estimatedHours?: number;
    tags: string[];
    defaultAssigneeIds?: string[];
    checklist: { title: string; required: boolean }[];
    recurrence?: Task['recurrence'];
    createdBy?: string;
    createdAt: string;
    updatedAt?: string;
}

export interface Task {
    id: string;
    organizationId: string;
    projectId?: string;
    clientId?: string;
    clientName?: string;
    title: string;
    description?: string;
    assignees: string[];    // legacy display array
    assigneeIds?: string[]; // FK array to users
    dueDate?: string | null;
    startDate?: string;
    completedAt?: string;
    priority: TaskPriority;
    status: TaskStatus;
    category?: TaskCategory;
    tags: string[];
    subtasks: Subtask[];
    deliverableId?: string;
    parentTaskId?: string;
    estimatedHours?: number;
    sortOrder?: number;
    statusHistory?: TaskStatusHistoryEntry[];
    customFields?: Record<string, unknown>;
    watcherIds?: string[];
    templateId?: string;
    recurrence?: {
        freq: 'daily' | 'weekly' | 'monthly';
        interval?: number;
        dayOfWeek?: number;
        dayOfMonth?: number;
        endDate?: string;
    };
    basecampTodoId?: number;
    basecampProjectId?: number;
    basecampTodolistId?: number;
    lastSyncedAt?: string;
    isTimerRunning?: boolean;
    startTime?: string;
    elapsedTime?: number;
    createdAt?: string;
    updatedAt?: string;
    createdBy?: string;
}

export interface ClientProject {
    id: string;
    organizationId: string;
    clientName: string;
    logoUrl?: string;
    launchDate?: string;
    accountManager: string;
    accountManagerId?: string;
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
    campaignTotalBlogs?: number;

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

/**
 * Canonical activity event types. Convention: `{domain}.{action}`.
 * Add new types here so the feed, filters, and API allowlist stay in sync.
 */
export type ActivityEventType =
    // Integrations
    | 'integration.connected'
    | 'integration.disconnected'
    | 'integration.reconfigured'
    | 'integration.tasks_imported'
    // Contract / retainer
    | 'retainer.amended'
    // Tasks
    | 'task.created'
    | 'task.completed'
    | 'task.assigned'
    | 'task.status_changed'
    // Deliverables
    | 'deliverable.created'
    | 'deliverable.status_changed'
    | 'deliverable.published'
    // Client lifecycle
    | 'client.created'
    | 'client.status_changed'
    | 'client.tier_changed';

export interface ClientActivityEvent {
    id: string;
    organizationId: string;
    clientId: string;
    eventType: ActivityEventType;
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
