'use client';

import { mockClients, mockMonthlyPlans } from '@/lib/mock-data/workspace';
import { cn } from '@/lib/utils';
import { ArrowLeft, Calendar, CheckCircle2, Clock, ExternalLink, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

interface ClientPortalPageProps {
    params: Promise<{
        id: string;
    }>;
}

export default async function ClientPortalPage({ params }: ClientPortalPageProps) {
    const { id } = await params;
    const client = mockClients.find(c => c.id === id);
    const plan = mockMonthlyPlans.find(p => p.clientId === id);

    if (!client) {
        notFound();
    }

    // Calculate total logged hours from plan (mock data)
    // In a real app, this would come from the time_logs table
    const totalLogged = plan?.totalLogged || 0;
    const totalPlanned = plan?.totalPlanned || client.seoHours;
    const percentUsed = Math.min((totalLogged / totalPlanned) * 100, 100);

    return (
        <div className="min-h-screen bg-background flex flex-col">
            {/* Header */}
            <header className="border-b border-border bg-card">
                <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/workspace" className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground">
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
                                {client.clientName.charAt(0)}
                            </div>
                            <div>
                                <h1 className="font-bold text-lg leading-tight">{client.clientName}</h1>
                                <p className="text-xs text-muted-foreground">Client Portal</p>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 text-xs font-medium text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            November 2025
                        </div>
                        <button className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground">
                            <ExternalLink className="h-5 w-5" />
                        </button>
                    </div>
                </div>
            </header>

            <main className="flex-1 container mx-auto px-4 py-8 space-y-8">
                {/* Overview Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Budget Card */}
                    <div className="col-span-1 md:col-span-2 bg-card border border-border rounded-xl p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="font-semibold flex items-center gap-2">
                                <Clock className="h-5 w-5 text-primary" />
                                Monthly Budget
                            </h2>
                            <span className="text-2xl font-bold">{totalLogged.toFixed(1)} <span className="text-muted-foreground text-sm font-normal">/ {totalPlanned} hrs</span></span>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-medium">Utilization</span>
                                <span className="text-muted-foreground">{percentUsed.toFixed(0)}%</span>
                            </div>
                            <div className="h-4 w-full bg-muted rounded-full overflow-hidden">
                                <div
                                    className={cn(
                                        "h-full rounded-full transition-all duration-1000",
                                        percentUsed > 100 ? "bg-red-500" : "bg-primary"
                                    )}
                                    style={{ width: `${percentUsed}%` }}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground pt-2">
                                {totalPlanned - totalLogged > 0
                                    ? `${(totalPlanned - totalLogged).toFixed(1)} hours remaining`
                                    : `${(totalLogged - totalPlanned).toFixed(1)} hours over budget`
                                }
                            </p>
                        </div>
                    </div>

                    {/* Status Card */}
                    <div className="bg-card border border-border rounded-xl p-6 shadow-sm flex flex-col justify-center items-center text-center space-y-4">
                        <div className={cn(
                            "w-16 h-16 rounded-full flex items-center justify-center",
                            client.status === 'Active' ? "bg-green-500/10 text-green-500" : "bg-yellow-500/10 text-yellow-500"
                        )}>
                            <CheckCircle2 className="h-8 w-8" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-lg">Project Status</h3>
                            <p className={cn(
                                "text-sm font-medium uppercase tracking-wider mt-1",
                                client.status === 'Active' ? "text-green-500" : "text-yellow-500"
                            )}>
                                {client.status}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Recent Activity / Work Log */}
                <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                    <div className="p-6 border-b border-border/50">
                        <h2 className="font-semibold flex items-center gap-2">
                            <LayoutDashboard className="h-5 w-5 text-primary" />
                            Recent Activity
                        </h2>
                    </div>
                    <div className="divide-y divide-border/50">
                        {/* Mock Work Logs */}
                        {[1, 2, 3].map((_, i) => (
                            <div key={i} className="p-4 hover:bg-muted/20 transition-colors flex items-start gap-4">
                                <div className="mt-1 w-2 h-2 rounded-full bg-primary" />
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <h4 className="font-medium text-sm">SEO Optimization & Content Update</h4>
                                        <span className="text-xs text-muted-foreground">Nov {10 - i}, 2025</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        Performed keyword research for new blog topics and updated meta tags for the homepage.
                                    </p>
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                                            Task
                                        </span>
                                        <span className="text-xs font-medium text-foreground">
                                            2.5 hrs
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="p-4 bg-muted/20 text-center">
                        <button className="text-sm text-primary hover:underline font-medium">
                            View Full History
                        </button>
                    </div>
                </div>
            </main>
        </div>
    );
}
