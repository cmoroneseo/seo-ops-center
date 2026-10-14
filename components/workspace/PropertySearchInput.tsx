'use client';

import { Search } from 'lucide-react';

/** Search field shared by the Search Console and GA4 property pickers. */
export function PropertySearchInput({
    value,
    onChange,
    placeholder,
    autoFocus = false,
}: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    autoFocus?: boolean;
}) {
    return (
        <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input
                aria-label="Search properties"
                placeholder={placeholder}
                value={value}
                autoFocus={autoFocus}
                onChange={event => onChange(event.target.value)}
                className="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2.5 text-base sm:text-sm focus-visible:outline-2 focus-visible:outline-ring"
            />
        </div>
    );
}
