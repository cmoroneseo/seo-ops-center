import { mockClients } from '@/lib/mock-data/workspace';
import { notFound } from 'next/navigation';
import { ArrowLeft, Calendar, Clock, Globe, MoreVertical, Shield } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { NotesSection } from '@/components/workspace/NotesSection';
import { isClientAtRisk } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

// In a real app, this would be a server component fetching data
// For now we'll use the mock data
export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const client = mockClients.find(c => c.id === id);

    if (!client) {
        notFound();
    }

    const atRisk = isClientAtRisk(client);

    return (
        <div className="h-full flex flex-col space-y-6">
            {/* Header Section */}
            <div className="flex flex-col space-y-4">
                <Link
                    href="/workspace"
                    className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Workspace
                </Link>

                {atRisk && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center gap-3 text-red-500">
                        <AlertTriangle className="h-5 w-5" />
                        <div>
                            <div className="font-semibold">At Risk: Falling Behind Schedule</div>
                            <div className="text-sm text-red-500/80">This client is significantly behind on monthly deliverables. Immediate action required.</div>
                        </div>
                    </div>
                )}

                <div className="flex items-start justify-between">
                    <div className="space-y-1">
                        <h1 className="text-3xl font-bold tracking-tight neon-gradient-text">{client.clientName}</h1>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                                <Globe className="h-4 w-4" />
                                <span>example.com</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <Calendar className="h-4 w-4" />
                                <span>Launched {new Date(client.launchDate).toLocaleDateString()}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <Shield className="h-4 w-4" />
                                <span>Tier {client.tier}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className={cn(
                            "px-3 py-1 rounded-full text-sm font-medium border",
                            client.status === 'Active' ? "bg-green-500/10 text-green-500 border-green-500/20" :
                                client.status === 'Cancelled' ? "bg-red-500/10 text-red-500 border-red-500/20" :
                                    "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
                        )}>
                            {client.status}
                        </div>
                        <button className="p-2 hover:bg-muted rounded-md transition-colors">
                            <MoreVertical className="h-5 w-5 text-muted-foreground" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl border border-border/50 bg-card">
                    <div className="text-sm text-muted-foreground mb-1">SEO Hours</div>
                    <div className="text-2xl font-bold flex items-baseline gap-2">
                        {client.seoHours}
                        <span className="text-xs font-normal text-muted-foreground">{client.hourType}</span>
                    </div>
                </div>
                <div className="p-4 rounded-xl border border-border/50 bg-card">
                    <div className="text-sm text-muted-foreground mb-1">Blogs Due</div>
                    <div className="text-2xl font-bold">{client.blogsDuePerMonth} <span className="text-sm font-normal text-muted-foreground">/mo</span></div>
                </div>
                <div className="p-4 rounded-xl border border-border/50 bg-card">
                    <div className="text-sm text-muted-foreground mb-1">Account Manager</div>
                    <div className="flex items-center gap-2 mt-1">
                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                            {client.accountManager.charAt(0)}
                        </div>
                        <span className="font-medium">{client.accountManager}</span>
                    </div>
                </div>
                <div className="p-4 rounded-xl border border-border/50 bg-card">
                    <div className="text-sm text-muted-foreground mb-1">Deliverables</div>
                    <div className="text-lg font-medium">{client.deliverables}</div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Left Column: Notes & Activity */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="rounded-xl border border-border/50 bg-card p-6">
                        <h3 className="text-lg font-semibold mb-4">Internal Notes</h3>
                        <NotesSection />
                    </div>
                </div>

                {/* Right Column: Tasks & Approvals */}
                <div className="space-y-6">
                    <div className="rounded-xl border border-border/50 bg-card p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold">Pending Approvals</h3>
                            {client.approvals.pendingCount > 0 && (
                                <span className="bg-orange-500/10 text-orange-500 text-xs font-medium px-2 py-0.5 rounded-full">
                                    {client.approvals.pendingCount}
                                </span>
                            )}
                        </div>
                        <div className="space-y-3">
                            {client.approvals.items.length > 0 ? (
                                client.approvals.items.map((item) => (
                                    <div key={item.id} className="p-3 rounded-lg bg-muted/30 border border-border/50 text-sm hover:bg-muted/50 transition-colors cursor-pointer">
                                        <div className="flex items-center justify-between">
                                            <div className="font-medium">{item.title}</div>
                                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground border border-border px-1.5 rounded">
                                                {item.type}
                                            </span>
                                        </div>
                                        <div className="text-muted-foreground text-xs mt-1 flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            Sent {new Date(item.sentDate).toLocaleDateString()}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-sm text-muted-foreground italic text-center py-4">
                                    No pending approvals
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
