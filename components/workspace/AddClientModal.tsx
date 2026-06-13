'use client';

import { useEffect, useState } from 'react';
import { X, CheckCircle2 } from 'lucide-react';
import { ClientProject, EngagementModel, ProjectStatus, Tier } from '@/lib/types';
import { useOrganization } from '@/components/providers/organization-provider';
import { createClientProject } from '@/lib/supabase/clients';
import { createCommitment } from '@/lib/supabase/commitments';
import { getOrganizationMembers } from '@/lib/supabase/organizations';

interface AddClientModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    onImportFromBasecamp?: (clientId: string, organizationId: string) => void;
}

const BLANK_FORM = {
    clientName: '',
    launchDate: '',
    seoHours: 0,
    engagementModel: 'Retainer' as EngagementModel,
    startDate: '',
    endDate: '',
    campaignTotalBlogs: 0,
    deliverables: '',
    blogsDuePerMonth: 0,
    accountManagerId: '',
    status: 'Active' as ProjectStatus,
    tier: 1 as Tier,
};

export function AddClientModal({ isOpen, onClose, onSuccess, onImportFromBasecamp }: AddClientModalProps) {
    const { organization } = useOrganization();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [createdClient, setCreatedClient] = useState<{ id: string; name: string } | null>(null);
    const [members, setMembers] = useState<{ userId: string; name: string }[]>([]);
    const [formData, setFormData] = useState(BLANK_FORM);

    // Load org members for AM dropdown
    useEffect(() => {
        if (!isOpen || !organization) return;
        getOrganizationMembers(organization.id).then(ms =>
            setMembers(ms.map(m => ({ userId: m.userId, name: m.user.fullName || m.user.email })))
        );
    }, [isOpen, organization]);

    if (!isOpen) return null;

    const selectedMember = members.find(m => m.userId === formData.accountManagerId);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!organization) return;
        setIsSubmitting(true);

        const clientData: Partial<ClientProject> = {
            organizationId: organization.id,
            clientName: formData.clientName,
            launchDate: formData.launchDate,
            seoHours: formData.seoHours,
            engagementModel: formData.engagementModel,
            deliverables: formData.deliverables,
            blogsDuePerMonth: formData.blogsDuePerMonth,
            accountManager: selectedMember?.name || '',
            accountManagerId: formData.accountManagerId || undefined,
            status: formData.status,
            tier: formData.tier,
            activeDeliverables: [],
        };

        if (formData.engagementModel === 'Campaign') {
            clientData.campaignTotalBlogs = formData.campaignTotalBlogs || undefined;
            clientData.campaignConfig = {
                startDate: formData.startDate || formData.launchDate,
                endDate: formData.endDate,
                totalHours: formData.seoHours,
                hoursUsed: 0,
                monthlyBlogQuota: formData.blogsDuePerMonth,
                monthlyBacklinkQuota: 0,
            };
        } else {
            clientData.retainerConfig = {
                monthlyHours: formData.seoHours,
                hoursUsed: 0,
                recurringDeliverables: [],
            };
        }

        const result = await createClientProject(clientData);

        if (result.success && result.data) {
            const newClientId = result.data.id;
            const startsOn = formData.launchDate || new Date().toISOString().slice(0, 10);

            // Auto-create services based on the form data
            const serviceCreates: Promise<unknown>[] = [];

            if (formData.blogsDuePerMonth > 0) {
                serviceCreates.push(createCommitment({
                    organizationId: organization.id,
                    clientId: newClientId,
                    title: 'Blog Posts',
                    type: 'Content',
                    subtype: 'blog',
                    quantityPerMonth: formData.blogsDuePerMonth,
                    cadence: 'monthly',
                    engagementModel: formData.engagementModel,
                    startsOn,
                    totalQuantity: formData.engagementModel === 'Campaign' && formData.campaignTotalBlogs
                        ? formData.campaignTotalBlogs
                        : undefined,
                    isActive: true,
                    countsTowardHours: false,
                }));
            }

            if (formData.seoHours > 0) {
                serviceCreates.push(createCommitment({
                    organizationId: organization.id,
                    clientId: newClientId,
                    title: 'SEO Hours',
                    type: 'Other',
                    quantityPerMonth: formData.seoHours,
                    cadence: 'monthly',
                    engagementModel: formData.engagementModel,
                    startsOn,
                    totalQuantity: formData.engagementModel === 'Campaign' && formData.seoHours
                        ? formData.seoHours
                        : undefined,
                    isActive: true,
                    countsTowardHours: true,
                }));
            }

            await Promise.allSettled(serviceCreates);

            onSuccess();
            setFormData(BLANK_FORM);
            setIsSubmitting(false);

            if (onImportFromBasecamp) {
                setCreatedClient({ id: newClientId, name: formData.clientName });
            } else {
                onClose();
            }
        } else {
            setIsSubmitting(false);
            console.error('Failed to add client:', result.error);
            alert(`Error: ${result.error}`);
        }
    };

    function handleClose() {
        setCreatedClient(null);
        onClose();
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-card border border-border w-full max-w-lg rounded-xl shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
                    <h2 className="text-lg font-semibold">{createdClient ? 'Client Created' : 'Add New Client'}</h2>
                    <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Post-create Basecamp prompt */}
                {createdClient && organization && (
                    <div className="p-6 flex flex-col items-center text-center gap-4">
                        <CheckCircle2 className="h-12 w-12 text-green-500" />
                        <div>
                            <p className="text-base font-semibold">{createdClient.name} added successfully!</p>
                            <p className="text-sm text-muted-foreground mt-1">
                                Want to import tasks from their Basecamp project?
                            </p>
                        </div>
                        <div className="flex gap-3 mt-2">
                            <button
                                type="button"
                                onClick={() => {
                                    handleClose();
                                    onImportFromBasecamp!(createdClient.id, organization.id);
                                }}
                                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                            >
                                🏕️ Import from Basecamp
                            </button>
                            <button
                                type="button"
                                onClick={handleClose}
                                className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted/30 transition-colors"
                            >
                                Skip for now
                            </button>
                        </div>
                    </div>
                )}

                {!createdClient && (
                    <form onSubmit={handleSubmit} className="p-4 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Client Name</label>
                                <input
                                    required
                                    type="text"
                                    className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                    value={formData.clientName}
                                    onChange={e => setFormData({ ...formData, clientName: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Launch Date</label>
                                <input
                                    required
                                    type="date"
                                    className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                    value={formData.launchDate}
                                    onChange={e => setFormData({ ...formData, launchDate: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Engagement Model</label>
                                <select
                                    className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                    value={formData.engagementModel}
                                    onChange={e => setFormData({ ...formData, engagementModel: e.target.value as EngagementModel })}
                                >
                                    <option value="Retainer">Retainer (Monthly)</option>
                                    <option value="Campaign">Campaign (Fixed)</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">
                                    {formData.engagementModel === 'Campaign' ? 'Total Hours' : 'Monthly Hours'}
                                </label>
                                <input
                                    required
                                    type="number"
                                    min="0"
                                    className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                    value={formData.seoHours}
                                    onChange={e => setFormData({ ...formData, seoHours: Number(e.target.value) })}
                                />
                            </div>
                        </div>

                        {formData.engagementModel === 'Campaign' && (
                            <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 fade-in">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Start Date</label>
                                    <input
                                        required
                                        type="date"
                                        className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                        value={formData.startDate}
                                        onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">End Date</label>
                                    <input
                                        required
                                        type="date"
                                        className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                        value={formData.endDate}
                                        onChange={e => setFormData({ ...formData, endDate: e.target.value })}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Blogs / Month</label>
                                <input
                                    required
                                    type="number"
                                    min="0"
                                    className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                    value={formData.blogsDuePerMonth}
                                    onChange={e => setFormData({ ...formData, blogsDuePerMonth: Number(e.target.value) })}
                                />
                            </div>
                            {formData.engagementModel === 'Campaign' ? (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Total Blog Count</label>
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="e.g. 12"
                                        className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                        value={formData.campaignTotalBlogs || ''}
                                        onChange={e => setFormData({ ...formData, campaignTotalBlogs: Number(e.target.value) })}
                                    />
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Deliverables (Display Text)</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. 2x/month"
                                        className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                        value={formData.deliverables}
                                        onChange={e => setFormData({ ...formData, deliverables: e.target.value })}
                                    />
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Status</label>
                                <select
                                    className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                    value={formData.status}
                                    onChange={e => setFormData({ ...formData, status: e.target.value as ProjectStatus })}
                                >
                                    <option value="Active">Active</option>
                                    <option value="Paused">Paused</option>
                                    <option value="Cancelled">Cancelled</option>
                                    <option value="Onboarding">Onboarding</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Tier</label>
                                <select
                                    className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                    value={formData.tier}
                                    onChange={e => setFormData({ ...formData, tier: Number(e.target.value) as Tier })}
                                >
                                    <option value={1}>Tier 1</option>
                                    <option value={2}>Tier 2</option>
                                    <option value={3}>Tier 3</option>
                                </select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Account Manager</label>
                            <select
                                required
                                className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                value={formData.accountManagerId}
                                onChange={e => setFormData({ ...formData, accountManagerId: e.target.value })}
                            >
                                <option value="">Select account manager…</option>
                                {members.map(m => (
                                    <option key={m.userId} value={m.userId}>{m.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex justify-end gap-3 pt-4 border-t border-border mt-4">
                            <button
                                type="button"
                                onClick={handleClose}
                                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors flex items-center gap-2"
                            >
                                {isSubmitting ? (
                                    <>
                                        <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                        Saving...
                                    </>
                                ) : (
                                    'Add Client'
                                )}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
