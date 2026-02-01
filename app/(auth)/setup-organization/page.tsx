'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useOrganization } from '@/components/providers/organization-provider';
import { useRouter } from 'next/navigation';
import { ArrowRight, Building2 } from 'lucide-react';

export default function SetupOrganizationPage() {
    const [name, setName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [shouldSeedDemo, setShouldSeedDemo] = useState(true);
    const { organization, isLoading: isOrgLoading, setOrganization } = useOrganization();
    const router = useRouter();
    const supabase = createClient();

    // Import seeding utility
    const { seedOrganization } = require('@/lib/supabase/seed-demo');

    // Redirect if already has organization
    useEffect(() => {
        if (!isOrgLoading && organization) {
            router.push('/dashboard');
        }
    }, [organization, isOrgLoading, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!supabase) return;

        setIsLoading(true);
        setError(null);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('User not found');

            const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

            // 1. Create Organization
            const { data: org, error: orgError } = await supabase
                .from('organizations')
                .insert([{ name, slug }])
                .select()
                .single();

            if (orgError) throw orgError;

            // 2. Create Membership (Owner)
            const { error: memError } = await supabase
                .from('organization_members')
                .insert([{
                    organization_id: org.id,
                    user_id: user.id,
                    role: 'owner'
                }]);

            if (memError) throw memError;

            // 3. Seed Demo Data if requested
            if (shouldSeedDemo) {
                await seedOrganization(org.id);
            }

            // 4. Update local state and redirect
            setOrganization({
                id: org.id,
                name: org.name,
                slug: org.slug,
                subscriptionStatus: org.subscription_status,
                planType: org.plan_type || 'starter',
                createdAt: org.created_at
            });

            router.push('/');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
            <div className="w-full max-w-md space-y-8">
                <div className="text-center">
                    <div className="flex justify-center mb-4">
                        <div className="p-3 rounded-full bg-primary/10">
                            <Building2 className="h-8 w-8 text-primary" />
                        </div>
                    </div>
                    <h1 className="text-4xl font-bold tracking-tight neon-gradient-text mb-2">Welcome to SEO OPS</h1>
                    <p className="text-muted-foreground">Give your agency a name to get started</p>
                </div>

                <div className="rounded-xl border border-border bg-card p-8 shadow-lg backdrop-blur-sm">
                    {error && (
                        <div className="mb-4 bg-red-500/10 border border-red-500/50 text-red-500 p-3 rounded-md text-sm">
                            {error}
                        </div>
                    )}
                    <form className="space-y-6" onSubmit={handleSubmit}>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium leading-none" htmlFor="name">
                                    Agency Name
                                </label>
                                <input
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                    id="name"
                                    placeholder="Blue Horizon SEO"
                                    type="text"
                                    required
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                />
                            </div>

                            <div className="flex items-start space-x-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
                                <input
                                    type="checkbox"
                                    id="seedDemo"
                                    checked={shouldSeedDemo}
                                    onChange={(e) => setShouldSeedDemo(e.target.checked)}
                                    className="h-4 w-4 mt-1 rounded border-primary text-primary focus:ring-primary"
                                />
                                <div className="space-y-1">
                                    <label htmlFor="seedDemo" className="text-sm font-semibold leading-none cursor-pointer">
                                        Populate with Demo Data
                                    </label>
                                    <p className="text-xs text-muted-foreground">
                                        Instantly activate your dashboard with 3 sample clients and performance metrics. Best for exploring features.
                                    </p>
                                </div>
                            </div>
                        </div>
                        <button
                            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            type="submit"
                            disabled={isLoading}
                        >
                            {isLoading ? 'Setting up...' : 'Start Managing'} <ArrowRight className="ml-2 h-4 w-4" />
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
