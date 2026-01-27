'use client';

import { useState } from 'react';
import { Upload, X, FileText, AlertCircle, Check, Loader2 } from 'lucide-react';
import { createClients } from '@/lib/supabase/clients';
import { useOrganization } from '@/components/providers/organization-provider';
import { HourType, ProjectStatus, Tier } from '@/lib/types';

interface CSVImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export function CSVImportModal({ isOpen, onClose, onSuccess }: CSVImportModalProps) {
    const { organization } = useOrganization();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [previewData, setPreviewData] = useState<any[]>([]);
    const [fileName, setFileName] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setFileName(file.name);
        setError(null);

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const text = event.target?.result as string;
                const rows = text.split('\n').filter(row => row.trim());
                if (rows.length < 2) throw new Error('CSV file is empty or missing content');

                const headers = rows[0].split(',').map(h => h.trim().toLowerCase());
                const dataRows = rows.slice(1).map(row => {
                    const values = row.split(',').map(v => v.trim());
                    const obj: any = {};
                    headers.forEach((h, i) => {
                        obj[h] = values[i];
                    });
                    return obj;
                });

                setPreviewData(dataRows);
            } catch (err: any) {
                setError(err.message);
                setPreviewData([]);
            }
        };
        reader.readAsText(file);
    };

    const handleImport = async () => {
        if (!organization || previewData.length === 0) return;

        setIsSubmitting(true);
        setError(null);

        try {
            const clientsToInsert = previewData.map(row => ({
                organizationId: organization.id,
                clientName: row.clientname || row.name || 'Unknown Client',
                launchDate: row.launchdate || new Date().toISOString().split('T')[0],
                seoHours: parseFloat(row.seohours || row.hours) || 0,
                hourType: (row.hourtype || 'Monthly') as HourType,
                blogsDuePerMonth: parseInt(row.blogspermonth || row.blogs) || 0,
                status: (row.status || 'Active') as ProjectStatus,
                tier: (parseInt(row.tier) || 1) as Tier
            }));

            const result = await createClients(clientsToInsert);
            if (result.success) {
                onSuccess();
                onClose();
            } else {
                throw new Error(result.error);
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-6 border-b border-border">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-primary/10">
                            <Upload className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">Bulk Import Clients</h2>
                            <p className="text-sm text-muted-foreground">Upload a CSV file to add multiple clients at once.</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6">
                    {!fileName ? (
                        <div className="border-2 border-dashed border-border rounded-xl p-12 text-center space-y-4 hover:border-primary/50 transition-colors cursor-pointer relative">
                            <input
                                type="file"
                                accept=".csv"
                                onChange={handleFileChange}
                                className="absolute inset-0 opacity-0 cursor-pointer"
                            />
                            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                                <FileText className="h-6 w-6 text-primary" />
                            </div>
                            <div>
                                <p className="font-medium text-foreground">Click to upload or drag & drop</p>
                                <p className="text-sm text-muted-foreground">CSV files only (Max 5MB)</p>
                            </div>
                            <div className="text-xs text-muted-foreground pt-4 border-t border-border">
                                <p className="font-medium mb-1 uppercase tracking-wider">Required Headers:</p>
                                <p>clientName, launchDate, seoHours, hourType, blogsPerMonth, status, tier</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between bg-muted/50 p-4 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <FileText className="h-5 w-5 text-primary" />
                                    <div>
                                        <p className="text-sm font-medium">{fileName}</p>
                                        <p className="text-xs text-muted-foreground">{previewData.length} clients detected</p>
                                    </div>
                                </div>
                                <button onClick={() => { setFileName(null); setPreviewData([]); }} className="text-xs text-destructive hover:underline">
                                    Remove
                                </button>
                            </div>

                            <div className="border border-border rounded-lg overflow-hidden">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-muted text-muted-foreground font-medium border-b border-border">
                                        <tr>
                                            <th className="px-4 py-2">Client Name</th>
                                            <th className="px-4 py-2">Hours</th>
                                            <th className="px-4 py-2">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/50">
                                        {previewData.slice(0, 5).map((row, i) => (
                                            <tr key={i}>
                                                <td className="px-4 py-2">{row.clientname || row.name || 'Unknown'}</td>
                                                <td className="px-4 py-2">{row.seohours || row.hours || '0'}</td>
                                                <td className="px-4 py-2">{row.status || 'Active'}</td>
                                            </tr>
                                        ))}
                                        {previewData.length > 5 && (
                                            <tr>
                                                <td colSpan={3} className="px-4 py-2 text-center text-muted-foreground bg-muted/20">
                                                    And {previewData.length - 5} more clients...
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/50 text-destructive rounded-lg text-sm">
                            <AlertCircle className="h-4 w-4" />
                            {error}
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-border flex justify-end gap-3 bg-muted/20">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium hover:bg-muted rounded-md transition-colors">
                        Cancel
                    </button>
                    <button
                        onClick={handleImport}
                        disabled={isSubmitting || previewData.length === 0}
                        className="flex items-center gap-2 rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all font-bold"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Importing...
                            </>
                        ) : (
                            <>
                                <Check className="h-4 w-4" />
                                Start Import
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
