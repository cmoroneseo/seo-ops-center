'use client';

import { User, Bell, Shield, Users, Plus, Mail, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useOrganization } from '@/components/providers/organization-provider';
import { getOrganizationMembers, addMemberByEmail } from '@/lib/supabase/organizations';
import { User as UserType, OrganizationMember } from '@/lib/types';
import { cn } from '@/lib/utils';

interface MemberWithUser extends OrganizationMember {
    user: UserType;
}

export default function SettingsPage() {
    const { organization } = useOrganization();
    const [members, setMembers] = useState<MemberWithUser[]>([]);
    const [isInviteLoading, setIsInviteLoading] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteError, setInviteError] = useState<string | null>(null);
    const [inviteSuccess, setInviteSuccess] = useState(false);

    useEffect(() => {
        if (organization) {
            fetchMembers();
        }
    }, [organization]);

    const fetchMembers = async () => {
        if (!organization) return;
        const data = await getOrganizationMembers(organization.id);
        setMembers(data);
    };

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!organization || !inviteEmail.trim()) return;

        setIsInviteLoading(true);
        setInviteError(null);
        setInviteSuccess(false);

        const result = await addMemberByEmail(organization.id, inviteEmail.trim());

        if (result.success) {
            setInviteSuccess(true);
            setInviteEmail('');
            fetchMembers();
        } else {
            setInviteError(result.error || 'Failed to add member');
        }
        setIsInviteLoading(false);
    };

    return (
        <div className="space-y-8 max-w-4xl pb-12">
            <div>
                <h2 className="text-3xl font-bold tracking-tight neon-gradient-text">Settings</h2>
                <p className="text-muted-foreground">Manage your account, team, and preferences.</p>
            </div>

            <div className="grid gap-6">
                {/* Profile Section */}
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
                            <input
                                type="text"
                                placeholder="Your full name"
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Email</label>
                            <input
                                type="email"
                                placeholder="name@example.com"
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                                disabled
                            />
                        </div>
                    </div>
                </div>

                {/* Team Section */}
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
                        {/* Invite Form */}
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
                                {inviteSuccess && <p className="text-xs text-green-500 mt-1">Teammate added successfully!</p>}
                            </div>
                            <button
                                type="submit"
                                disabled={isInviteLoading}
                                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 h-10"
                            >
                                {isInviteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                Add Member
                            </button>
                        </form>

                        {/* Member List */}
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
                                        <div className="flex items-center gap-2">
                                            <span className={cn(
                                                "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                                member.role === 'owner' ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                                            )}>
                                                {member.role}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Notifications Section */}
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

                    <div className="space-y-4">
                        <div className="flex items-center justify-between text-sm">
                            <label className="font-medium">Email Summaries</label>
                            <input type="checkbox" defaultChecked className="h-4 w-4" />
                        </div>
                    </div>
                </div>

                {/* Security Section */}
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
        </div>
    );
}
