'use client';

import { useState } from 'react';
import { Globe2 } from 'lucide-react';
import { propertyFavicon } from '@/lib/google/property-branding';

export function PropertyLogo({ siteUrl, logoUrl }: { siteUrl: string; logoUrl?: string }) {
    const [failed, setFailed] = useState<string[]>([]);
    const src = [logoUrl, propertyFavicon(siteUrl)].find((url): url is string => !!url && !failed.includes(url));
    return <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-white p-1.5">
        {src ? (
            // Remote logos retain native browser loading/error handling; no server image proxy.
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" width={32} height={32} loading="lazy" decoding="async" referrerPolicy="no-referrer"
                className="h-8 w-8 object-contain" onError={() => setFailed(previous => [...previous, src])} />
        ) : <Globe2 className="h-6 w-6 text-slate-400" />}
    </span>;
}
