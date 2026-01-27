'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { ClientProject, HourType, ProjectStatus, Tier } from '@/lib/types';

import { useOrganization } from '@/components/providers/organization-provider';

interface AddClientModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

import { createClientProject } from '@/lib/supabase/clients';

export function AddClientModal({ isOpen, onClose, onSuccess }: AddClientModalProps) {
    const { organization } = useOrganization();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState({
        clientName: '',
        launchDate: '',
        seoHours: 0,
        hourType: 'Monthly' as HourType,
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

        const result = await createClientProject({
            organizationId: organization.id,
            ...formData,
        });

        setIsSubmitting(false);
        if (result.success) {
            onSuccess();
            onClose();
            // Reset form
            setFormData({
                clientName: '',
                launchDate: '',
                seoHours: 0,
                hourType: 'Monthly',
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
            <div className="bg-card border border-border w-full max-w-lg rounded-xl shadow-lg overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-border">
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
                            <label className="text-sm font-medium">SEO Hours</label>
                            <input
                                required
                                type="number"
                                className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                value={formData.seoHours}
                                onChange={e => setFormData({ ...formData, seoHours: Number(e.target.value) })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Hour Type</label>
                            <select
                                className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                value={formData.hourType}
                                onChange={e => setFormData({ ...formData, hourType: e.target.value as HourType })}
                            >
                                <option value="Monthly">Monthly</option>
                                <option value="Campaign">Campaign</option>
                                <option value="Hourly">Hourly</option>
                            </select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Deliverables</label>
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
                            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                        >
                            Add Client
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
