'use client';

import { useState, useRef } from 'react';
import { Upload, X, ImageIcon, Loader2 } from 'lucide-react';
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
                setUploadError(`Upload failed: ${error.message}. Make sure the "campaign-screenshots" storage bucket exists in Supabase.`);
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
                <label className="text-xs font-medium text-muted-foreground">{label}</label>
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
                    onChange={(e) => e.target.files && handleUpload(e.target.files)}
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
                    className="border-2 border-dashed border-border/50 rounded-lg p-6 text-center cursor-pointer hover:border-primary/30 transition-colors"
                >
                    <ImageIcon className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">Drop screenshots here or click to upload</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">Ahrefs, PageSpeed Insights, Screaming Frog, etc.</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    {screenshots.map((s, i) => (
                        <div key={i} className="group relative rounded-lg border border-border/50 overflow-hidden bg-muted/20">
                            <img
                                src={s.url}
                                alt={s.caption}
                                className="w-full h-40 object-cover object-top"
                            />
                            <button
                                onClick={() => handleDelete(i)}
                                className="absolute top-2 right-2 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <X className="h-3 w-3" />
                            </button>
                            {editingCaption === i ? (
                                <input
                                    type="text"
                                    value={s.caption}
                                    onChange={(e) => handleCaptionChange(i, e.target.value)}
                                    onBlur={() => setEditingCaption(null)}
                                    onKeyDown={(e) => e.key === 'Enter' && setEditingCaption(null)}
                                    autoFocus
                                    className="w-full px-2 py-1.5 text-xs bg-transparent border-t border-border/50 outline-none focus:border-primary"
                                />
                            ) : (
                                <div
                                    onClick={() => setEditingCaption(i)}
                                    className={cn(
                                        'px-2 py-1.5 text-xs border-t border-border/50 cursor-text',
                                        s.caption ? 'text-foreground' : 'text-muted-foreground italic',
                                    )}
                                >
                                    {s.caption || 'Add caption…'}
                                </div>
                            )}
                        </div>
                    ))}
                    <div
                        onClick={() => fileRef.current?.click()}
                        className="flex items-center justify-center rounded-lg border-2 border-dashed border-border/50 h-40 cursor-pointer hover:border-primary/30 transition-colors"
                    >
                        <div className="text-center">
                            <Upload className="h-5 w-5 text-muted-foreground/40 mx-auto mb-1" />
                            <span className="text-[10px] text-muted-foreground">Add more</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
