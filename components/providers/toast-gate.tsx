'use client';

import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';

const ToastSuppressedContext = createContext(false);
const SetToastSuppressedContext = createContext<((suppressed: boolean) => void) | null>(null);

/**
 * One gate for toast rendering. The SEO Plan tab sets it; every other screen leaves it off.
 * There is no notification tray. Suppression only hides what would have been painted.
 */
export function ToastGateProvider({ children }: { children: ReactNode }) {
    const [suppressed, setSuppressed] = useState(false);
    return (
        <SetToastSuppressedContext.Provider value={setSuppressed}>
            <ToastSuppressedContext.Provider value={suppressed}>
                {children}
            </ToastSuppressedContext.Provider>
        </SetToastSuppressedContext.Provider>
    );
}

/** Call from the screen that owns the tab. `active` is true only on the SEO Plan tab. */
export function useSuppressPlanToasts(active: boolean) {
    const setSuppressed = useContext(SetToastSuppressedContext);
    useLayoutEffect(() => {
        if (!setSuppressed) return;
        setSuppressed(active);
        return () => setSuppressed(false);
    }, [active, setSuppressed]);
}

/** Renders nothing while the SEO Plan tab is suppressing toasts. */
export function ToastGate({ children }: { children: ReactNode }) {
    const suppressed = useContext(ToastSuppressedContext);
    if (suppressed) return null;
    return children;
}
