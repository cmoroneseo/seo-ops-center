'use client';

import { useState, useRef } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

interface Screenshot {
    url: string;
    caption: string;
    addedAt: string;
}

interface ScreenshotUploadProps {
    screenshots: Screenshot[];
    onUpdate: (screenshots: Screenshot[]) => void;
    label?: string;
}

export function ScreenshotUpload({ screenshots, onUpdate, label = 'Screenshots' }: ScreenshotUploadProps) {
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [editingCaption, setEditingCaption] = useState<number | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const handleUpload = async (files: FileList) => {
        const supabase = createClient();
        if (!supabase) {
            setUploadError('Supabase not available');
            return;
        }
        setUploading(true);
        setUploadError('');

        const newScreenshots = [...screenshots];

        for (const file of Array.from(files)) {
            if (!file.type.startsWith('image/')) continue;
            const ext = file.name.split('.').pop() ?? 'png';
            const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

            const { error } = await supabase.storage
                .from('campaign-screenshots')
                .upload(path, file, { contentType: file.type, upsert: true });

            if (error) {
                console.error('Upload error:', error);
                setUploadError(`Upload failed: ${error.message}`);
                continue;
            }

            const { data: urlData } = supabase.storage
                .from('campaign-screenshots')
                .getPublicUrl(path);

            newScreenshots.push({
                url: urlData.publicUrl,
                caption: file.name.replace(/\.[^.]+$/, ''),
                addedAt: new Date().toISOString(),
            });
        }

        if (newScreenshots.length > screenshots.length) {
            onUpdate(newScreenshots);
        }
        setUploading(false);
    };

    const handleDelete = (index: number) => {
        onUpdate(screenshots.filter((_, i) => i !== index));
    };

    const handleCaptionChange = (index: number, caption: string) => {
        const updated = screenshots.map((s, i) => i === index ? { ...s, caption } : s);
        onUpdate(updated);
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</label>
                <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
                >
                    {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                    {uploading ? 'Uploading…' : 'Upload'}
                </button>
                <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                        if (e.target.files) handleUpload(e.target.files);
                        e.target.value = '';
                    }}
                />
            </div>

            {uploadError && (
                <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                    {uploadError}
                </div>
            )}

            {screenshots.length === 0 ? (
                <div
                    onClick={() => fileRef.current?.click()}
                    className="border border-dashed border-border/60 rounded-lg p-8 text-center cursor-pointer hover:border-primary/30 hover:bg-muted/10 transition-colors"
                >
                    <Upload className="h-5 w-5 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">Upload Ahrefs, PageSpeed, or audit screenshots</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {screenshots.map((s, i) => (
                        <div key={i} className="group relative rounded-lg border border-border/30 overflow-hidden bg-black/5">
                            <img
                                src={s.url}
                                alt={s.caption}
                                className="w-full max-h-[400px] object-contain bg-black/5"
                            />
                            <button
                                onClick={() => handleDelete(i)}
                                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/90"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                            {editingCaption === i ? (
                                <input
                                    type="text"
                                    value={s.caption}
                                    onChange={(e) => handleCaptionChange(i, e.target.value)}
                                    onBlur={() => setEditingCaption(null)}
                                    onKeyDown={(e) => e.key === 'Enter' && setEditingCaption(null)}
                                    autoFocus
                                    className="w-full px-3 py-2 text-xs bg-card border-t border-border/30 outline-none focus:border-primary"
                                />
                            ) : (
                                <div
                                    onClick={() => setEditingCaption(i)}
                                    className={cn(
                                        'px-3 py-2 text-xs border-t border-border/30 cursor-text bg-card',
                                        s.caption ? 'text-foreground' : 'text-muted-foreground italic',
                                    )}
                                >
                                    {s.caption || 'Click to add caption…'}
                                </div>
                            )}
                        </div>
                    ))}
                    <button
                        onClick={() => fileRef.current?.click()}
                        className="w-full py-2 text-xs text-muted-foreground hover:text-primary border border-dashed border-border/40 rounded-lg hover:border-primary/30 transition-colors"
                    >
                        + Add more screenshots
                    </button>
                </div>
            )}
        </div>
    );
}
