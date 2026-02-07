'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { ClientProject, EngagementModel, ProjectStatus, Tier } from '@/lib/types';
import { useOrganization } from '@/components/providers/organization-provider';
import { createClientProject } from '@/lib/supabase/clients';

interface AddClientModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export function AddClientModal({ isOpen, onClose, onSuccess }: AddClientModalProps) {
    const { organization } = useOrganization();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState({
        clientName: '',
        launchDate: '',
        seoHours: 0,
        engagementModel: 'Retainer' as EngagementModel,
        startDate: '', // For Campaign
        endDate: '', // For Campaign
        deliverables: '',
        blogsDuePerMonth: 0,
        accountManager: '',
        status: 'Active' as ProjectStatus,
        tier: 1 as Tier,
    });

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!organization) return;
        setIsSubmitting(true);

        // Construct the client object based on the engagement model
        const clientData: Partial<ClientProject> = {
            organizationId: organization.id,
            clientName: formData.clientName,
            launchDate: formData.launchDate,
            seoHours: formData.seoHours,
            engagementModel: formData.engagementModel,
            deliverables: formData.deliverables,
            blogsDuePerMonth: formData.blogsDuePerMonth,
            accountManager: formData.accountManager,
            status: formData.status,
            tier: formData.tier,
            activeDeliverables: [] // Initialize empty
        };

        if (formData.engagementModel === 'Campaign') {
            clientData.campaignConfig = {
                startDate: formData.startDate || formData.launchDate,
                endDate: formData.endDate,
                totalHours: formData.seoHours,
                hoursUsed: 0,
                monthlyBlogQuota: formData.blogsDuePerMonth,
                monthlyBacklinkQuota: 0 // Default for now
            };
        } else {
            clientData.retainerConfig = {
                monthlyHours: formData.seoHours,
                hoursUsed: 0,
                recurringDeliverables: [] // Default for now
            };
        }

        const result = await createClientProject(clientData);

        setIsSubmitting(false);
        if (result.success) {
            onSuccess();
            onClose();
            // Reset form
            setFormData({
                clientName: '',
                launchDate: '',
                seoHours: 0,
                engagementModel: 'Retainer',
                startDate: '',
                endDate: '',
                deliverables: '',
                blogsDuePerMonth: 0,
                accountManager: '',
                status: 'Active',
                tier: 1
            });
        } else {
            console.error('Failed to add client:', result.error);
            alert(`Error: ${result.error}`);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-card border border-border w-full max-w-lg rounded-xl shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
                    <h2 className="text-lg font-semibold">Add New Client</h2>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X className="h-5 w-5" />
                    </button>
                </div>

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

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Deliverables (Display Text)</label>
                        <input
                            required
                            type="text"
                            placeholder="e.g. 2x/month"
                            className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                            value={formData.deliverables}
                            onChange={e => setFormData({ ...formData, deliverables: e.target.value })}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Blogs / Month</label>
                            <input
                                required
                                type="number"
                                className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                value={formData.blogsDuePerMonth}
                                onChange={e => setFormData({ ...formData, blogsDuePerMonth: Number(e.target.value) })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Account Manager</label>
                            <input
                                required
                                type="text"
                                className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                value={formData.accountManager}
                                onChange={e => setFormData({ ...formData, accountManager: e.target.value })}
                            />
                        </div>
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

                    <div className="flex justify-end gap-3 pt-4 border-t border-border mt-4">
                        <button
                            type="button"
                            onClick={onClose}
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
            </div>
        </div>
    );
}
