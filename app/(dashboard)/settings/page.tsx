'use client';

import { User, Bell, Shield, Users, Plus, Loader2, MessageSquarePlus, Bug, Lightbulb, MessageSquare, ExternalLink, ChevronDown } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { getOrganizationMembers, addMemberByEmail } from '@/lib/supabase/organizations';
import { createClient } from '@/lib/supabase/client';
import { User as UserType, OrganizationMember } from '@/lib/types';
import { cn } from '@/lib/utils';

interface MemberWithUser extends OrganizationMember {
    user: UserType;
}

interface FeedbackItem {
    id: string;
    submitted_by: string;
    type: 'bug' | 'feature' | 'general';
    severity: 'low' | 'medium' | 'blocking' | null;
    description: string;
    page: string;
    status: 'open' | 'reviewed' | 'planned' | 'done' | 'dismissed';
    screenshot_url: string | null;
    created_at: string;
}

const STATUS_OPTIONS = ['open', 'reviewed', 'planned', 'done', 'dismissed'] as const;

const STATUS_STYLES: Record<string, string> = {
    open: 'bg-red-500/10 text-red-500 border-red-500/20',
    reviewed: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    planned: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    done: 'bg-green-500/10 text-green-500 border-green-500/20',
    dismissed: 'bg-muted text-muted-foreground border-border',
};

const TYPE_ICON: Record<string, React.ReactNode> = {
    bug: <Bug className="h-3.5 w-3.5 text-red-500" />,
    feature: <Lightbulb className="h-3.5 w-3.5 text-amber-500" />,
    general: <MessageSquare className="h-3.5 w-3.5 text-blue-500" />,
};

const SEVERITY_STYLES: Record<string, string> = {
    low: 'text-muted-foreground',
    medium: 'text-amber-500',
    blocking: 'text-red-500 font-semibold',
};

type SettingsTab = 'general' | 'feedback';

export default function SettingsPage() {
    const { organization } = useOrganization();
    const { displayName, isOwner } = useCurrentMember();
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');
    const [members, setMembers] = useState<MemberWithUser[]>([]);
    const [isInviteLoading, setIsInviteLoading] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteError, setInviteError] = useState<string | null>(null);
    const [inviteSuccess, setInviteSuccess] = useState(false);

    // Feedback state
    const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
    const [feedbackLoading, setFeedbackLoading] = useState(false);
    const [typeFilter, setTypeFilter] = useState<'all' | 'bug' | 'feature' | 'general'>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | string>('open');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    useEffect(() => {
        if (organization) fetchMembers();
    }, [organization]);

    useEffect(() => {
        if (organization && isOwner && activeTab === 'feedback') fetchFeedback();
    }, [organization, isOwner, activeTab]);

    const fetchMembers = async () => {
        if (!organization) return;
        const data = await getOrganizationMembers(organization.id);
        setMembers(data);
    };

    const fetchFeedback = async () => {
        if (!organization) return;
        setFeedbackLoading(true);
        const supabase = createClient();
        if (!supabase) { setFeedbackLoading(false); return; }
        const { data } = await supabase
            .from('feedback')
            .select('*')
            .eq('organization_id', organization.id)
            .order('created_at', { ascending: false });
        setFeedback((data as FeedbackItem[]) ?? []);
        setFeedbackLoading(false);
    };

    const updateStatus = async (id: string, status: string) => {
        setUpdatingId(id);
        const supabase = createClient();
        if (supabase) {
            await supabase.from('feedback').update({ status }).eq('id', id);
            setFeedback(prev => prev.map(f => f.id === id ? { ...f, status: status as FeedbackItem['status'] } : f));
        }
        setUpdatingId(null);
    };

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!organization || !inviteEmail.trim()) return;
        setIsInviteLoading(true);
        setInviteError(null);
        setInviteSuccess(false);
        try {
            const res = await fetch('/api/invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: inviteEmail.trim(),
                    organizationId: organization.id,
                    organizationName: organization.name,
                    invitedByName: displayName,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to send invite');
            setInviteSuccess(true);
            setInviteEmail('');
            fetchMembers();
        } catch (err: any) {
            setInviteError(err.message || 'Failed to send invite');
        }
        setIsInviteLoading(false);
    };

    const filteredFeedback = feedback.filter(f => {
        const matchesType = typeFilter === 'all' || f.type === typeFilter;
        const matchesStatus = statusFilter === 'all' || f.status === statusFilter;
        return matchesType && matchesStatus;
    });

    const openCount = feedback.filter(f => f.status === 'open').length;

    return (
        <div className="space-y-8 max-w-4xl pb-12">
            <div>
                <h2 className="text-3xl font-bold tracking-tight neon-gradient-text">Settings</h2>
                <p className="text-muted-foreground">Manage your account, team, and preferences.</p>
            </div>

            {/* Tabs — feedback only visible to owners */}
            <div className="flex gap-1 bg-muted/30 p-1 rounded-lg border border-border/50 w-fit">
                <button
                    onClick={() => setActiveTab('general')}
                    className={cn(
                        'px-4 py-1.5 text-sm font-medium rounded-md transition-all',
                        activeTab === 'general' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    General
                </button>
                {isOwner && (
                    <button
                        onClick={() => setActiveTab('feedback')}
                        className={cn(
                            'flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-all',
                            activeTab === 'feedback' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                        )}
                    >
                        Feedback
                        {openCount > 0 && (
                            <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                                {openCount}
                            </span>
                        )}
                    </button>
                )}
            </div>

            {/* ── General Tab ── */}
            {activeTab === 'general' && (
                <div className="grid gap-6">
                    {/* Profile */}
                    <div className="rounded-xl border border-border bg-card p-6">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <User className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                                <h3 className="text-lg font-medium">Profile Information</h3>
                                <p className="text-sm text-muted-foreground">Update your personal details.</p>
                            </div>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Full Name</label>
                                <input type="text" placeholder="Your full name" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Email</label>
                                <input type="email" placeholder="name@example.com" disabled className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50" />
                            </div>
                        </div>
                    </div>

                    {/* Team */}
                    <div className="rounded-xl border border-border bg-card p-6">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                                <Users className="h-5 w-5 text-blue-500" />
                            </div>
                            <div>
                                <h3 className="text-lg font-medium">Team Management</h3>
                                <p className="text-sm text-muted-foreground">Manage who has access to this organization.</p>
                            </div>
                        </div>
                        <div className="space-y-6">
                            {isOwner && (
                                <form onSubmit={handleInvite} className="flex gap-2">
                                    <div className="flex-1">
                                        <input
                                            type="email"
                                            placeholder="teammate@example.com"
                                            value={inviteEmail}
                                            onChange={(e) => setInviteEmail(e.target.value)}
                                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                            required
                                        />
                                        {inviteError && <p className="text-xs text-red-500 mt-1">{inviteError}</p>}
                                        {inviteSuccess && <p className="text-xs text-green-500 mt-1">✓ Invitation sent!</p>}
                                    </div>
                                    <button type="submit" disabled={isInviteLoading} className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 h-10">
                                        {isInviteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                        Add Member
                                    </button>
                                </form>
                            )}
                            <div className="divide-y divide-border/50 border rounded-md">
                                {members.length === 0 ? (
                                    <div className="p-4 text-center text-sm text-muted-foreground">No members found.</div>
                                ) : (
                                    members.map((member) => (
                                        <div key={member.id} className="p-4 flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="h-8 w-8 rounded-full bg-accent/50 flex items-center justify-center text-xs font-bold">
                                                    {(member.user.fullName || member.user.email).charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium">{member.user.fullName || 'User'}</p>
                                                    <p className="text-xs text-muted-foreground">{member.user.email}</p>
                                                </div>
                                            </div>
                                            <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider", member.role === 'owner' ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                                                {member.role}
                                            </span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Notifications */}
                    <div className="rounded-xl border border-border bg-card p-6">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="h-10 w-10 rounded-full bg-accent/10 flex items-center justify-center">
                                <Bell className="h-5 w-5 text-accent" />
                            </div>
                            <div>
                                <h3 className="text-lg font-medium">Notifications</h3>
                                <p className="text-sm text-muted-foreground">Configure how you receive alerts.</p>
                            </div>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <label className="font-medium">Email Summaries</label>
                            <input type="checkbox" defaultChecked className="h-4 w-4" />
                        </div>
                    </div>

                    {/* Security */}
                    <div className="rounded-xl border border-border bg-card p-6">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                                <Shield className="h-5 w-5 text-green-500" />
                            </div>
                            <div>
                                <h3 className="text-lg font-medium">Security</h3>
                                <p className="text-sm text-muted-foreground">Manage your password and access.</p>
                            </div>
                        </div>
                        <button className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent transition-colors">
                            Change Password
                        </button>
                    </div>
                </div>
            )}

            {/* ── Feedback Tab (owner only) ── */}
            {activeTab === 'feedback' && isOwner && (
                <div className="space-y-4">
                    {/* Filters */}
                    <div className="flex items-center gap-3 flex-wrap">
                        {/* Type filter */}
                        <div className="flex gap-1 bg-muted/30 p-1 rounded-lg border border-border/50">
                            {(['all', 'bug', 'feature', 'general'] as const).map(t => (
                                <button
                                    key={t}
                                    onClick={() => setTypeFilter(t)}
                                    className={cn(
                                        'flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all capitalize',
                                        typeFilter === t ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                                    )}
                                >
                                    {t !== 'all' && TYPE_ICON[t]}
                                    {t === 'all' ? 'All Types' : t === 'feature' ? 'Feature' : t.charAt(0).toUpperCase() + t.slice(1)}
                                </button>
                            ))}
                        </div>

                        {/* Status filter */}
                        <div className="flex gap-1 bg-muted/30 p-1 rounded-lg border border-border/50">
                            {(['all', 'open', 'reviewed', 'planned', 'done', 'dismissed'] as const).map(s => (
                                <button
                                    key={s}
                                    onClick={() => setStatusFilter(s)}
                                    className={cn(
                                        'px-3 py-1 text-xs font-medium rounded-md transition-all capitalize',
                                        statusFilter === s ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                                    )}
                                >
                                    {s === 'all' ? 'All Status' : s}
                                </button>
                            ))}
                        </div>

                        <button onClick={fetchFeedback} className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors">
                            Refresh
                        </button>
                    </div>

                    {/* List */}
                    {feedbackLoading ? (
                        <div className="py-16 text-center text-sm text-muted-foreground">Loading feedback...</div>
                    ) : filteredFeedback.length === 0 ? (
                        <div className="py-16 text-center rounded-xl border border-border bg-card">
                            <MessageSquarePlus className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                            <p className="text-sm text-muted-foreground">No feedback yet</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {filteredFeedback.map(item => (
                                <div key={item.id} className="rounded-xl border border-border bg-card overflow-hidden">
                                    {/* Row */}
                                    <div
                                        className="flex items-start gap-3 p-4 cursor-pointer hover:bg-muted/20 transition-colors"
                                        onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                                    >
                                        {/* Type icon */}
                                        <div className="mt-0.5 shrink-0">{TYPE_ICON[item.type]}</div>

                                        {/* Main content */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                                <span className="text-sm font-medium capitalize">{item.type === 'feature' ? 'Feature Request' : item.type}</span>
                                                {item.severity && (
                                                    <span className={cn('text-xs', SEVERITY_STYLES[item.severity])}>
                                                        {item.severity === 'blocking' ? '🚨 Blocking' : item.severity.charAt(0).toUpperCase() + item.severity.slice(1)}
                                                    </span>
                                                )}
                                                <span className="text-xs text-muted-foreground">· {item.submitted_by}</span>
                                                <span className="text-xs text-muted-foreground">· {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                                {item.screenshot_url && (
                                                    <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">📎 screenshot</span>
                                                )}
                                            </div>
                                            <p className={cn('text-sm text-muted-foreground', expandedId !== item.id && 'truncate')}>
                                                {item.description}
                                            </p>
                                            {expandedId !== item.id && (
                                                <p className="text-[10px] text-muted-foreground/60 mt-1 font-mono">{item.page}</p>
                                            )}
                                        </div>

                                        {/* Status badge + chevron */}
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className={cn('text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border capitalize', STATUS_STYLES[item.status])}>
                                                {item.status}
                                            </span>
                                            <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', expandedId === item.id && 'rotate-180')} />
                                        </div>
                                    </div>

                                    {/* Expanded detail */}
                                    {expandedId === item.id && (
                                        <div className="px-4 pb-4 pt-0 border-t border-border/50 space-y-4">
                                            <div className="pt-3 space-y-1">
                                                <p className="text-xs text-muted-foreground font-medium">Description</p>
                                                <p className="text-sm leading-relaxed">{item.description}</p>
                                            </div>

                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <span>Page:</span>
                                                <span className="font-mono">{item.page}</span>
                                            </div>

                                            {/* Screenshot */}
                                            {item.screenshot_url && (
                                                <div className="space-y-1.5">
                                                    <p className="text-xs text-muted-foreground font-medium">Screenshot</p>
                                                    <div className="relative rounded-lg overflow-hidden border border-border max-w-sm">
                                                        <img src={item.screenshot_url} alt="Feedback screenshot" className="w-full object-cover" />
                                                        <a
                                                            href={item.screenshot_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 rounded-md p-1.5 transition-colors"
                                                            onClick={e => e.stopPropagation()}
                                                        >
                                                            <ExternalLink className="h-3.5 w-3.5 text-white" />
                                                        </a>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Status controls */}
                                            <div className="space-y-1.5">
                                                <p className="text-xs text-muted-foreground font-medium">Update Status</p>
                                                <div className="flex gap-2 flex-wrap">
                                                    {STATUS_OPTIONS.map(s => (
                                                        <button
                                                            key={s}
                                                            onClick={() => updateStatus(item.id, s)}
                                                            disabled={item.status === s || updatingId === item.id}
                                                            className={cn(
                                                                'px-3 py-1 rounded-lg border text-xs font-medium transition-all capitalize disabled:opacity-40',
                                                                item.status === s ? STATUS_STYLES[s] : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                                            )}
                                                        >
                                                            {updatingId === item.id && item.status !== s ? <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> : null}
                                                            {s}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
