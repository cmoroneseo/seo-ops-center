'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { activeClientId } from '@/lib/workspace/client-list-nav';
import {
    RECENT_CLIENTS_KEY,
    SELECTED_CLIENT_KEY,
    parseIdList,
    rememberClientId,
} from '@/lib/nav/recent-clients';
import { AGENCY_HOME_HREF, STAFF_NAV_EVENT } from '@/lib/nav/staff-shell';

const SELECTION_EVENT = 'seo-ops:selected-client';

function readStorage(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key: string, value: string | null) {
    try {
        if (value == null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
    } catch {
        /* Private windows can reject storage. The in-memory value still updates. */
    }
}

function publishSelection() {
    window.dispatchEvent(new Event(SELECTION_EVENT));
}

/** URL client wins. Otherwise the last client the person picked, so agency pages keep a selection. */
export function useSelectedClient() {
    const pathname = usePathname() || '/';
    const searchParams = useSearchParams();
    const router = useRouter();
    const fromRouter = searchParams.toString();
    const [override, setOverride] = useState<string | null>(null);
    const [storedId, setStoredId] = useState<string | null>(null);
    const [recentIds, setRecentIds] = useState<string[]>([]);

    useEffect(() => {
        setOverride(null);
    }, [pathname, fromRouter]);

    useEffect(() => {
        const read = () => setOverride(window.location.search.replace(/^\?/, ''));
        window.addEventListener('popstate', read);
        window.addEventListener(STAFF_NAV_EVENT, read);
        return () => {
            window.removeEventListener('popstate', read);
            window.removeEventListener(STAFF_NAV_EVENT, read);
        };
    }, []);

    useEffect(() => {
        const sync = () => {
            setStoredId(readStorage(SELECTED_CLIENT_KEY));
            setRecentIds(parseIdList(readStorage(RECENT_CLIENTS_KEY)));
        };
        sync();
        window.addEventListener(SELECTION_EVENT, sync);
        return () => window.removeEventListener(SELECTION_EVENT, sync);
    }, []);

    const search = override ?? fromRouter;
    const urlId = activeClientId(pathname, new URLSearchParams(search).get('client'));

    useEffect(() => {
        if (!urlId) return;
        setStoredId(urlId);
        writeStorage(SELECTED_CLIENT_KEY, urlId);
        setRecentIds(current => {
            const next = rememberClientId(current, urlId);
            writeStorage(RECENT_CLIENTS_KEY, JSON.stringify(next));
            return next;
        });
        publishSelection();
    }, [urlId]);

    function clear() {
        setStoredId(null);
        writeStorage(SELECTED_CLIENT_KEY, null);
        publishSelection();
        router.push(AGENCY_HOME_HREF);
    }

    return {
        clientId: urlId ?? storedId,
        recentIds,
        pathname,
        search,
        clear,
    };
}
