'use client';

import { useState, useRef, useCallback } from 'react';
import { X, Upload, Loader2, Check, Trash2 } from 'lucide-react';
import { ClientProject, ProjectStatus } from '@/lib/types';
import { updateClientProject } from '@/lib/supabase/clients';
import { createClient } from '@/lib/supabase/client';
import { createCommitment, getCommitments } from '@/lib/supabase/commitments';
import { useOrganization } from '@/components/providers/organization-provider';
import { cn } from '@/lib/utils';

interface Props {
    client: ClientProject;
    onClose: () => void;
    onSaved: (updated: ClientProject) => void;
}

function ClientAvatar({ name, logoUrl, size = 'lg' }: { name: string; logoUrl?: string; size?: 'sm' | 'lg' }) {
    const initials = name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const dim = size === 'lg' ? 'w-16 h-16 text-xl' : 'w-8 h-8 text-xs';
    if (logoUrl) {
        return (
            <img
                src={logoUrl}
                alt={name}
                className={cn('rounded-full object-cover shrink-0', dim)}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
        );
    }
    return (
        <div className={cn('rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary shrink-0', dim)}>
            {initials}
        </div>
    );
}

export { ClientAvatar };

export function EditClientPanel({ client, onClose, onSaved }: Props) {
    const { organization } = useOrganization();
    const [name, setName] = useState(client.clientName);
    const [logoUrl, setLogoUrl] = useState(client.logoUrl ?? '');
    const [logoPreview, setLogoPreview] = useState(client.logoUrl ?? '');
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const [logoError, setLogoError] = useState('');
    const [seoHours, setSeoHours] = useState(String(client.seoHours || ''));
    const [blogsPerMonth, setBlogsPerMonth] = useState(String(client.blogsDuePerMonth || ''));
    const [status, setStatus] = useState<ProjectStatus>(client.status);
    const [launchDate, setLaunchDate] = useState(client.launchDate ?? '');
    const [amendmentNote, setAmendmentNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');
    const [dragging, setDragging] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const uploadLogo = useCallback(async (file: File) => {
        setLogoError('');
        if (file.size > 1_048_576) {
            setLogoError('File must be under 1 MB.');
            return;
        }
        if (!file.type.startsWith('image/')) {
            setLogoError('Please upload an image file (JPG, PNG, WebP).');
            return;
        }

        setUploadingLogo(true);
        const supabase = createClient();
        if (!supabase) { setLogoError('Storage unavailable.'); setUploadingLogo(false); return; }

        // Show local preview immediately
        const localUrl = URL.createObjectURL(file);
        setLogoPreview(localUrl);

        const ext = file.name.split('.').pop() ?? 'jpg';
        const path = `${client.id}/logo.${ext}`;

        const { error: uploadError } = await supabase.storage
            .from('client-logos')
            .upload(path, file, { upsert: true, contentType: file.type });

        if (uploadError) {
            setLogoError(uploadError.message);
            setLogoPreview(logoUrl); // revert preview
            setUploadingLogo(false);
            return;
        }

        const { data } = supabase.storage.from('client-logos').getPublicUrl(path);
        // Bust the cache so the browser re-fetches the new image
        const publicUrl = `${data.publicUrl}?t=${Date.now()}`;
        setLogoUrl(publicUrl);
        setLogoPreview(publicUrl);
        setUploadingLogo(false);
    }, [client.id, logoUrl]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) uploadLogo(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) uploadLogo(file);
    };

    const removeLogo = () => {
        setLogoUrl('');
        setLogoPreview('');
        setLogoError('');
        if (fileRef.current) fileRef.current.value = '';
    };

    const handleSave = async () => {
        if (!name.trim()) { setError('Client name is required.'); return; }
        if (status !== 'Onboarding' && !launchDate) { setError('Launch date is required for active clients.'); return; }
        setSaving(true);
        setError('');

        const newSeoHours = parseFloat(seoHours) || 0;
        const newBlogs = parseInt(blogsPerMonth) || 0;
        const hoursChanged = newSeoHours !== client.seoHours;
        const blogsChanged = newBlogs !== client.blogsDuePerMonth;
        const activating = client.status === 'Onboarding' && status === 'Active';

        const result = await updateClientProject(client.id, {
            ...client,
            clientName: name.trim(),
            logoUrl: logoUrl || undefined,
            seoHours: newSeoHours,
            blogsDuePerMonth: newBlogs,
            status,
            launchDate: launchDate || undefined,
        });
        setSaving(false);
        if (!result.success || !result.data) {
            setError(result.error ?? 'Save failed.');
            return;
        }

        // When transitioning from Onboarding → Active, auto-create service rows
        // if none exist yet, using the hours/blogs already on the client record.
        if (activating && organization && launchDate) {
            const existing = await getCommitments(organization.id, { clientId: client.id });
            if (existing.length === 0) {
                const startsOn = launchDate;
                const creates: Promise<unknown>[] = [];
                if (newBlogs > 0) {
                    creates.push(createCommitment({
                        organizationId: organization.id,
                        clientId: client.id,
                        title: 'Blog Posts',
                        type: 'Content',
                        subtype: 'blog',
                        quantityPerMonth: newBlogs,
                        cadence: 'monthly',
                        engagementModel: client.engagementModel,
                        startsOn,
                        isActive: true,
                        countsTowardHours: false,
                    }));
                }
                if (newSeoHours > 0) {
                    creates.push(createCommitment({
                        organizationId: organization.id,
                        clientId: client.id,
                        title: 'SEO Hours',
                        type: 'Other',
                        quantityPerMonth: newSeoHours,
                        cadence: 'monthly',
                        engagementModel: client.engagementModel,
                        startsOn,
                        isActive: true,
                        countsTowardHours: true,
                    }));
                }
                await Promise.allSettled(creates);
            }
        }

        // Log retainer amendment if hours/blogs changed or a note was provided
        if (organization && (hoursChanged || blogsChanged || amendmentNote.trim())) {
            const supabase = createClient();
            const actorName = supabase
                ? await supabase.auth.getUser().then((r: Awaited<ReturnType<typeof supabase.auth.getUser>>) => r.data.user?.user_metadata?.full_name ?? r.data.user?.email ?? undefined)
                : undefined;
            await fetch(`/api/clients/${client.id}/amend`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organizationId: organization.id,
                    oldSeoHours: client.seoHours,
                    newSeoHours,
                    oldBlogsPerMonth: client.blogsDuePerMonth,
                    newBlogsPerMonth: newBlogs,
                    note: amendmentNote.trim() || null,
                    actorName,
                }),
            });
        }

        setSaved(true);
        setTimeout(() => {
            onSaved(result.data!);
            onClose();
        }, 600);
    };

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Panel */}
            <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm bg-card border-l border-border shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
                    <h2 className="text-base font-semibold">Edit Client</h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">

                    {/* Logo upload */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium">Client Logo</label>

                        <div className="flex items-center gap-4">
                            {/* Preview */}
                            <div className="relative">
                                {logoPreview ? (
                                    <img
                                        src={logoPreview}
                                        alt={name}
                                        className="w-16 h-16 rounded-full object-cover border border-border"
                                    />
                                ) : (
                                    <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center text-xl font-bold text-primary border border-border/50">
                                        {name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'}
                                    </div>
                                )}
                                {uploadingLogo && (
                                    <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                                        <Loader2 className="h-4 w-4 text-white animate-spin" />
                                    </div>
                                )}
                            </div>

                            {/* Drop zone */}
                            <div className="flex-1 space-y-2">
                                <div
                                    onClick={() => fileRef.current?.click()}
                                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                                    onDragLeave={() => setDragging(false)}
                                    onDrop={handleDrop}
                                    className={cn(
                                        'border-2 border-dashed rounded-lg px-3 py-3 text-center cursor-pointer transition-all',
                                        dragging
                                            ? 'border-primary bg-primary/5'
                                            : 'border-border/60 hover:border-primary/50 hover:bg-muted/30',
                                    )}
                                >
                                    <Upload className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
                                    <p className="text-xs text-muted-foreground">
                                        <span className="text-primary font-medium">Click to upload</span> or drag & drop
                                    </p>
                                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">PNG, JPG, WebP · Max 1 MB</p>
                                </div>
                                {logoPreview && (
                                    <button
                                        onClick={removeLogo}
                                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-500 transition-colors"
                                    >
                                        <Trash2 className="h-3 w-3" /> Remove logo
                                    </button>
                                )}
                            </div>
                        </div>

                        {logoError && (
                            <p className="text-xs text-red-500">{logoError}</p>
                        )}

                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            className="hidden"
                            onChange={handleFileChange}
                        />
                    </div>

                    {/* Client name */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Client Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                    </div>

                    {/* Hours & Deliverables */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium">Hours &amp; Deliverables</label>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label className="text-xs text-muted-foreground">Monthly SEO Hours</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={seoHours}
                                    onChange={e => setSeoHours(e.target.value)}
                                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs text-muted-foreground">Blogs / Month</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={blogsPerMonth}
                                    onChange={e => setBlogsPerMonth(e.target.value)}
                                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Status & Launch Date */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium">Status &amp; Launch</label>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label className="text-xs text-muted-foreground">Status</label>
                                <select
                                    value={status}
                                    onChange={e => setStatus(e.target.value as ProjectStatus)}
                                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                                >
                                    <option value="Onboarding">Onboarding</option>
                                    <option value="Active">Active</option>
                                    <option value="Paused">Paused</option>
                                    <option value="Cancelled">Cancelled</option>
                                </select>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs text-muted-foreground">
                                    {status === 'Onboarding' ? 'Expected Launch (optional)' : 'Launch Date'}
                                </label>
                                <input
                                    type="date"
                                    value={launchDate}
                                    onChange={e => setLaunchDate(e.target.value)}
                                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                                />
                            </div>
                        </div>
                        {status === 'Active' && client.status === 'Onboarding' && (
                            <p className="text-xs text-primary bg-primary/10 rounded-md px-3 py-2">
                                Activating this client will auto-create their services and start deliverable tracking from the launch date.
                            </p>
                        )}
                    </div>

                    {/* Amendment note */}
                    <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">Amendment Note <span className="opacity-50">(optional — what changed and why)</span></label>
                        <textarea
                            value={amendmentNote}
                            onChange={e => setAmendmentNote(e.target.value)}
                            placeholder="e.g. Replaced organic social with +3.5 SEO hrs + LinkedIn automation"
                            rows={2}
                            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                        />
                    </div>

                    {error && (
                        <p className="text-sm text-red-500">{error}</p>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-border/50 flex items-center justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || uploadingLogo || saved}
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60"
                    >
                        {saved ? (
                            <><Check className="h-3.5 w-3.5" /> Saved!</>
                        ) : saving ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                        ) : (
                            'Save Changes'
                        )}
                    </button>
                </div>
            </div>
        </>
    );
}
