import { ClientProject, MonthlyPlan } from '../types';

export const mockClients: ClientProject[] = [
    {
        id: '1',
        organizationId: 'org-1',
        clientName: 'Native Falls Campgrounds',
        launchDate: '2025-01-15',
        accountManager: 'Carlos',
        status: 'Active',
        tier: 1,
        engagementModel: 'Campaign',
        campaignConfig: {
            startDate: '2025-01-15',
            endDate: '2025-07-15',
            totalHours: 60,
            hoursUsed: 22,
            monthlyBlogQuota: 1,
            monthlyBacklinkQuota: 2
        },
        seoHours: 60, // Derived/Legacy
        deliverables: '1x/month', // Legacy
        blogsDuePerMonth: 1, // Legacy
        blogProgress: {
            target: 6,
            dueToDate: 1,
            delivered: 1,
            pastDue: 0,
            isOnTrack: true
        },
        approvals: {
            pendingCount: 2,
            items: [
                { id: 'a1', title: 'January Content Calendar', sentDate: '2025-01-10', type: 'Brief' },
                { id: 'a2', title: 'Homepage Meta Tags', sentDate: '2025-01-12', type: 'Other' }
            ]
        },
        tasks: [
            { id: 't1', organizationId: 'org-1', title: 'Keyword Research', assignees: ['Carlos'], dueDate: '2025-01-20', priority: 'high', status: 'in_progress', tags: ['seo'], subtasks: [] },
            { id: 't2', organizationId: 'org-1', title: 'Competitor Analysis', assignees: ['Sarah'], dueDate: '2025-01-22', priority: 'medium', status: 'todo', tags: ['research'], subtasks: [] }
        ],
        activeDeliverables: [
            { id: 'd1', clientId: '1', title: 'Jan Blog: Top Hiking Trails', type: 'Content', status: 'In Progress', dueDate: '2025-01-25', countsTowardsHours: false },
            { id: 'd2', clientId: '1', title: 'Guest Post: Outdoor Life', type: 'Backlink', status: 'Pending', dueDate: '2025-01-28', countsTowardsHours: false }
        ]
    },
    {
        id: '2',
        organizationId: 'org-1',
        clientName: 'Polar Express HVAC',
        launchDate: '2024-07-01',
        accountManager: 'Carlos',
        status: 'Active',
        tier: 1,
        engagementModel: 'Retainer',
        retainerConfig: {
            monthlyHours: 13,
            hoursUsed: 10.5,
            recurringDeliverables: [
                { type: 'Content', count: 2 },
                { type: 'GBP', count: 1 }
            ]
        },
        seoHours: 13,
        deliverables: '2x/month',
        blogsDuePerMonth: 2,
        blogProgress: {
            target: 34,
            dueToDate: 32,
            delivered: 32,
            pastDue: 0,
            isOnTrack: true
        },
        approvals: {
            pendingCount: 0,
            items: []
        },
        tasks: [
            { id: 't3', organizationId: 'org-1', title: 'Monthly Report', assignees: ['Carlos'], dueDate: '2025-02-01', priority: 'medium', status: 'todo', tags: ['reporting'], subtasks: [] }
        ],
        activeDeliverables: [
            { id: 'd3', clientId: '2', title: 'Feb Blog: HVAC Maintenance', type: 'Content', status: 'Pending', dueDate: '2025-02-10', countsTowardsHours: false },
            { id: 'd4', clientId: '2', title: 'GBP Weekly Post', type: 'GBP', status: 'Approved', dueDate: '2025-02-05', countsTowardsHours: true }
        ]
    },
    {
        id: '3',
        organizationId: 'org-1',
        clientName: 'MPS Security',
        launchDate: '2025-01-07',
        accountManager: 'Carlos',
        status: 'Active',
        tier: 1,
        engagementModel: 'Campaign',
        campaignConfig: {
            startDate: '2025-01-07',
            endDate: '2025-07-07',
            totalHours: 55,
            hoursUsed: 12,
            monthlyBlogQuota: 0,
            monthlyBacklinkQuota: 4
        },
        seoHours: 55,
        deliverables: 'No blogs',
        blogsDuePerMonth: 0,
        blogProgress: {
            target: 0,
            dueToDate: 0,
            delivered: 0,
            pastDue: 0,
            isOnTrack: true
        },
        approvals: {
            pendingCount: 1,
            items: [
                { id: 'a3', title: 'Technical Audit Review', sentDate: '2025-01-08', type: 'Audit' }
            ]
        },
        tasks: [],
        activeDeliverables: [
            { id: 'd5', clientId: '3', title: 'Security Industry Outreach', type: 'Backlink', status: 'In Progress', dueDate: '2025-01-30', countsTowardsHours: true }
        ]
    },
    {
        id: '4',
        organizationId: 'org-1',
        clientName: 'Marketing Empire Group',
        launchDate: '2025-05-15',
        accountManager: 'Carlos',
        status: 'Active',
        tier: 1,
        engagementModel: 'Retainer',
        retainerConfig: {
            monthlyHours: 15,
            hoursUsed: 5,
            recurringDeliverables: [
                { type: 'Content', count: 4 }
            ]
        },
        seoHours: 15,
        deliverables: '4x/month',
        blogsDuePerMonth: 4,
        blogProgress: {
            target: 28,
            dueToDate: 24,
            delivered: 12,
            pastDue: 12,
            isOnTrack: false
        },
        approvals: {
            pendingCount: 3,
            items: [
                { id: 'a4', title: 'Blog: 5 SEO Tips', sentDate: '2025-05-20', type: 'Blog' },
                { id: 'a5', title: 'Blog: Why SEO Matters', sentDate: '2025-05-22', type: 'Blog' },
                { id: 'a6', title: 'Q2 Strategy Deck', sentDate: '2025-05-25', type: 'Other' }
            ]
        },
        tasks: [
            { id: 't4', organizationId: 'org-1', title: 'Fix 404 Errors', assignees: ['Dev Team'], dueDate: '2025-05-28', priority: 'high', status: 'todo', tags: ['tech'], subtasks: [] },
            { id: 't5', organizationId: 'org-1', title: 'Update GMB Listing', assignees: ['Carlos'], dueDate: '2025-05-30', priority: 'low', status: 'done', tags: ['gmb'], subtasks: [] }
        ],
        activeDeliverables: []
    },
    {
        id: '5',
        organizationId: 'org-1',
        clientName: 'Welkin HVAC',
        launchDate: '2024-05-03',
        accountManager: 'Abel',
        status: 'Cancelled',
        tier: 2,
        engagementModel: 'Retainer',
        retainerConfig: {
            monthlyHours: 5,
            hoursUsed: 0,
            recurringDeliverables: [{ type: 'Content', count: 1 }]
        },
        seoHours: 5,
        deliverables: '1x/month',
        blogsDuePerMonth: 1,
        blogProgress: {
            target: 12,
            dueToDate: 11,
            delivered: 7,
            pastDue: 4,
            isOnTrack: false
        },
        approvals: {
            pendingCount: 0,
            items: []
        },
        tasks: [],
        activeDeliverables: []
    },
    {
        id: '6',
        organizationId: 'org-1',
        clientName: 'Element Pool Designs',
        launchDate: '2025-01-17',
        accountManager: 'Abel',
        status: 'Active',
        tier: 1,
        engagementModel: 'Retainer',
        retainerConfig: {
            monthlyHours: 15,
            hoursUsed: 8,
            recurringDeliverables: [{ type: 'Content', count: 2 }]
        },
        seoHours: 15,
        deliverables: '2x/month',
        blogsDuePerMonth: 2,
        blogProgress: {
            target: 22,
            dueToDate: 20,
            delivered: 18,
            pastDue: 2,
            isOnTrack: false
        },
        approvals: {
            pendingCount: 1,
            items: [
                { id: 'a7', title: 'Pool Design Trends Blog', sentDate: '2025-01-20', type: 'Blog' }
            ]
        },
        tasks: [
            { id: 't6', organizationId: 'org-1', title: 'Image Optimization', assignees: ['Abel'], dueDate: '2025-01-25', priority: 'medium', status: 'in_progress', tags: ['web'], subtasks: [] }
        ],
        activeDeliverables: []
    },
    {
        id: '7',
        organizationId: 'org-1',
        clientName: 'Top Notch Auto',
        launchDate: '2022-10-18',
        accountManager: 'Carlos',
        status: 'Active',
        tier: 2,
        engagementModel: 'Retainer',
        retainerConfig: {
            monthlyHours: 10,
            hoursUsed: 2,
            recurringDeliverables: []
        },
        seoHours: 10,
        deliverables: 'No blogs',
        blogsDuePerMonth: 0,
        blogProgress: {
            target: 0,
            dueToDate: 0,
            delivered: 0,
            pastDue: 0,
            isOnTrack: true
        },
        approvals: {
            pendingCount: 0,
            items: []
        },
        tasks: [],
        activeDeliverables: []
    },
    {
        id: '8',
        organizationId: 'org-1',
        clientName: 'Rick Pools',
        launchDate: '2025-09-11',
        accountManager: 'Carlos',
        status: 'Active',
        tier: 3,
        engagementModel: 'Campaign',
        campaignConfig: {
            startDate: '2025-09-11',
            endDate: '2026-03-11',
            totalHours: 40,
            hoursUsed: 0,
            monthlyBlogQuota: 0,
            monthlyBacklinkQuota: 0
        },
        seoHours: 40,
        deliverables: 'No blogs',
        blogsDuePerMonth: 0,
        blogProgress: {
            target: 0,
            dueToDate: 0,
            delivered: 0,
            pastDue: 0,
            isOnTrack: true
        },
        approvals: {
            pendingCount: 0,
            items: []
        },
        tasks: [],
        activeDeliverables: []
    }
];

export const mockMonthlyPlans: MonthlyPlan[] = [
    {
        id: 'mp-1',
        clientId: '1', // Native Falls
        month: '2025-11',
        totalPlanned: 22,
        totalLogged: 0,
        totalVariance: 22,
        weeks: [
            { weekNumber: 1, label: 'Nov 3-7', planned: 5.5, logged: 0, variance: 5.5 },
            { weekNumber: 2, label: 'Nov 10-14', planned: 5.5, logged: 0, variance: 5.5 },
            { weekNumber: 3, label: 'Nov 17-21', planned: 5.5, logged: 0, variance: 5.5 },
            { weekNumber: 4, label: 'Nov 24-28', planned: 5.5, logged: 0, variance: 5.5 },
            { weekNumber: 5, label: 'Dec 1-5', planned: 0, logged: 0, variance: 0 }
        ]
    },
    {
        id: 'mp-2',
        clientId: '2', // Polar Express
        month: '2025-11',
        totalPlanned: 27.12,
        totalLogged: 0,
        totalVariance: 27.12,
        weeks: [
            { weekNumber: 1, label: 'Nov 3-7', planned: 6.78, logged: 0, variance: 6.78 },
            { weekNumber: 2, label: 'Nov 10-14', planned: 6.78, logged: 0, variance: 6.78 },
            { weekNumber: 3, label: 'Nov 17-21', planned: 6.78, logged: 0, variance: 6.78 },
            { weekNumber: 4, label: 'Nov 24-28', planned: 6.78, logged: 0, variance: 6.78 },
            { weekNumber: 5, label: 'Dec 1-5', planned: 0, logged: 0, variance: 0 }
        ]
    },
    {
        id: 'mp-3',
        clientId: '3', // MPS Security
        month: '2025-11',
        totalPlanned: 19.52,
        totalLogged: 1.5,
        totalVariance: 18.02,
        weeks: [
            { weekNumber: 1, label: 'Nov 3-7', planned: 4.88, logged: 1.5, variance: 3.38 },
            { weekNumber: 2, label: 'Nov 10-14', planned: 4.88, logged: 0, variance: 4.88 },
            { weekNumber: 3, label: 'Nov 17-21', planned: 4.88, logged: 0, variance: 4.88 },
            { weekNumber: 4, label: 'Nov 24-28', planned: 4.88, logged: 0, variance: 4.88 },
            { weekNumber: 5, label: 'Dec 1-5', planned: 0, logged: 0, variance: 0 }
        ]
    }
];
