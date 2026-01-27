import { Task } from '../types';

export const mockTasks: Task[] = [
    {
        id: '1',
        organizationId: 'org1',
        clientName: 'Sunrise Medical Center',
        title: 'Keyword Research for Homepage',
        description: 'Analyze top 10 competitors and identify high-volume keywords for medical services.',
        assignees: ['Jon Fish'],
        dueDate: '2026-01-24',
        priority: 'high',
        status: 'todo',
        tags: ['seo', 'research'],
        subtasks: [
            { id: 's1', title: 'Competitor identification', completed: true },
            { id: 's2', title: 'Volume analysis', completed: false }
        ]
    },
    {
        id: '2',
        organizationId: 'org1',
        clientName: 'Pacific Coast Realty',
        title: 'Fix Broken Links',
        description: 'Crawl the site and fix all 404 errors found in the latest report.',
        assignees: ['Arman', 'Andrew'],
        dueDate: '2026-01-25',
        priority: 'medium',
        status: 'todo',
        tags: ['tech-seo'],
        subtasks: []
    },
    {
        id: '3',
        organizationId: 'org1',
        clientName: 'Pacific Coast Realty',
        title: 'Optimize Meta Tags',
        assignees: ['Skylar'],
        dueDate: '2026-01-22',
        priority: 'high',
        status: 'in_progress',
        tags: ['on-page'],
        subtasks: []
    },
    {
        id: '4',
        organizationId: 'org1',
        clientName: 'Green Thumb Landscaping',
        title: 'Content Gap Analysis',
        assignees: ['Jon Fish'],
        dueDate: '2026-01-28',
        priority: 'low',
        status: 'review',
        tags: ['content'],
        subtasks: []
    },
    {
        id: '5',
        organizationId: 'org1',
        clientName: 'Sunrise Medical Center',
        title: 'Setup GSC',
        assignees: ['Admin'],
        dueDate: '2026-01-20',
        priority: 'high',
        status: 'done',
        tags: ['setup'],
        subtasks: []
    },
    {
        id: '6',
        organizationId: 'org1',
        clientName: 'Native Falls Campgrounds',
        title: 'Respond to Google reviews',
        assignees: ['Andrew'],
        dueDate: '2026-01-14',
        priority: 'high',
        status: 'todo',
        tags: ['gbp'],
        subtasks: []
    },
    {
        id: '7',
        organizationId: 'org1',
        clientName: 'Polar Express HVAC',
        title: 'Monthly SEO Report',
        assignees: ['Carlos'],
        dueDate: '2026-01-14',
        priority: 'medium',
        status: 'in_progress',
        tags: ['report'],
        subtasks: []
    },
    {
        id: '8',
        organizationId: 'org1',
        clientName: 'MPS Security',
        title: 'Technical Audit Review',
        assignees: ['Unassigned'],
        dueDate: '',
        priority: 'high',
        status: 'todo',
        tags: ['audit'],
        subtasks: []
    },
    {
        id: '9',
        organizationId: 'org1',
        clientName: 'Marketing Empire Group',
        title: 'Q2 Strategy Deck',
        assignees: ['Unassigned'],
        dueDate: '',
        priority: 'medium',
        status: 'todo',
        tags: ['strategy'],
        subtasks: []
    },
    {
        id: '10',
        organizationId: 'org1',
        clientName: 'Element Pool Designs',
        title: 'Image Optimization',
        assignees: ['Abel'],
        dueDate: '2026-01-16',
        priority: 'medium',
        status: 'in_progress',
        tags: ['web'],
        subtasks: []
    }
];
