'use client';

import React, { useState } from 'react';
import { Video } from 'lucide-react';

export function VideoPreview({ src, poster, className }: { src: string | null; poster?: string | null; className?: string }) {
    const [failedSrc, setFailedSrc] = useState<string>();
    if (!src || failedSrc === src) return <div className="gbp-post-placeholder gbp-post-unavailable">
        <Video size={20} aria-hidden />
        <strong>Video unavailable</strong>
        {src && <a href={src} target="_blank" rel="noopener noreferrer">Open video</a>}
    </div>;
    return <video className={className} src={src} poster={poster ?? undefined} controls muted playsInline
        preload="metadata" aria-label="Post video" onError={() => setFailedSrc(src)} />;
}
