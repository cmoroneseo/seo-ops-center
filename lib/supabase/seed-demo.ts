import { createClient } from './client';

export async function seedOrganization(organizationId: string) {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };

    try {
        // 1. Seed Clients
        const { data: clients, error: clientsError } = await supabase
            .from('clients')
            .insert([
                { organization_id: organizationId, name: 'EcoStream Energy', domain: 'ecostream.io', status: 'active' },
                { organization_id: organizationId, name: 'Luxe Real Estate', domain: 'luxehomes.com', status: 'active' },
                { organization_id: organizationId, name: 'PetPalace', domain: 'petpalace.shop', status: 'active' }
            ])
            .select();

        if (clientsError) throw clientsError;

        // 2. Seed Projects (One per client)
        const projectsData = clients.map((client: any) => ({
            organization_id: organizationId,
            client_id: client.id,
            name: `${client.name} SEO Main`,
            settings: { target_region: 'US', language: 'en' }
        }));

        const { data: projects, error: projectsError } = await supabase
            .from('projects')
            .insert(projectsData)
            .select();

        if (projectsError) throw projectsError;

        // 3. Seed Tasks
        const tasksData: any[] = [];
        projects.forEach((project: any) => {
            tasksData.push(
                {
                    organization_id: organizationId,
                    project_id: project.id,
                    title: 'Keyword Research & Mapping',
                    status: 'done',
                    due_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
                },
                {
                    organization_id: organizationId,
                    project_id: project.id,
                    title: 'On-Page Optimization',
                    status: 'in_progress',
                    due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
                },
                {
                    organization_id: organizationId,
                    project_id: project.id,
                    title: 'Monthly Performance Report',
                    status: 'todo',
                    due_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
                }
            );
        });

        const { error: tasksError } = await supabase
            .from('tasks')
            .insert(tasksData);

        if (tasksError) throw tasksError;

        // 4. Seed Monthly Plans
        const month = new Date().toISOString().slice(0, 7); // YYYY-MM
        const plansData = clients.map((client: any) => ({
            organization_id: organizationId,
            client_id: client.id,
            month,
            weeks: [
                { title: 'Week 1', tasks: ['Technical Audit', 'GA4 Check'] },
                { title: 'Week 2', tasks: ['Link Building', 'Blog 1'] },
                { title: 'Week 3', tasks: ['On-page Refinements'] },
                { title: 'Week 4', tasks: ['Reporting'] }
            ]
        }));

        const { error: plansError } = await supabase
            .from('monthly_plans')
            .insert(plansData);

        if (plansError) throw plansError;

        return { success: true };
    } catch (err: any) {
        console.error('Seeding error:', err);
        return { success: false, error: err.message };
    }
}
