'use client';

import React, { useEffect, useRef, useState } from 'react';

export function PhotoGallery({ sources, alt = 'Draft post photo' }: {
    sources: readonly (string | null)[];
    alt?: string;
}) {
    const multiple = sources.length > 1;
    return (
        <div className={multiple ? 'grid min-w-0 grid-cols-2 gap-2' : 'min-w-0'} role={multiple ? 'group' : undefined} aria-label={multiple ? 'Post photos' : undefined}>
            {sources.map((src, index) => (
                <figure key={`${index}:${src}`} className="m-0 min-w-0">
                    <Photo src={src} alt={multiple ? `${alt} ${index + 1} of ${sources.length}` : alt} multiple={multiple} />
                    {multiple && <figcaption className="px-2 py-1 text-xs">Photo {index + 1}</figcaption>}
                </figure>
            ))}
        </div>
    );
}

function Photo({ src, alt, multiple }: {
    src: string | null;
    alt: string;
    multiple: boolean;
}) {
    const [failed, setFailed] = useState(false);
    const image = useRef<HTMLImageElement>(null);
    useEffect(() => {
        if (image.current?.complete && !image.current.naturalWidth) setFailed(true);
    }, []);
    // The browser loads private signed URLs and external thumbnails directly.
    // eslint-disable-next-line @next/next/no-img-element
    const picture = src && !failed && <img ref={image} src={src} alt={alt} referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)}
        className={multiple ? 'block aspect-[4/3] w-full rounded-lg object-cover' : 'block h-auto w-full rounded-lg'} />;
    const link = src && <a href={src} target="_blank" rel="noopener noreferrer" aria-label={`Open ${alt.toLowerCase()}`}
        className={failed ? 'inline-block p-2 text-sm font-medium underline' : 'block h-full focus-visible:outline-2 focus-visible:-outline-offset-2'}>
        {failed ? 'Open photo' : picture}
    </a>;
    return (
        <div className="overflow-hidden rounded-lg border border-slate-200">
            {!src ? <p className="p-2 text-sm">Photo unavailable</p> : (failed || multiple) ? link : picture}
        </div>
    );
}
