import { PanelSkeleton } from '@/components/seo-plan/PanelSkeleton';

/**
 * Shown the instant a client link is clicked. The client segment's server
 * layout reads the session before the page can render; without this boundary
 * Next keeps the previous page — the client list — on screen until that finishes.
 */
export default function LoadingClientWorkspace() {
    return (
        <div className="space-y-6" aria-busy="true">
            <div className="flex flex-col space-y-4" aria-hidden="true">
                <div className="h-5 w-40 animate-pulse rounded bg-muted" />
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-muted" />
                        <div className="space-y-2">
                            <div className="h-9 w-64 max-w-full animate-pulse rounded bg-muted" />
                            <div className="h-4 w-80 max-w-full animate-pulse rounded bg-muted" />
                        </div>
                    </div>
                    <div className="flex items-center gap-3 pr-2">
                        <div className="h-8 w-24 animate-pulse rounded-full bg-muted" />
                        <div className="h-8 w-28 animate-pulse rounded-lg bg-muted" />
                    </div>
                </div>
            </div>
            <div className="flex h-10 items-center gap-3 border-b border-border/50" aria-hidden="true">
                {Array.from({ length: 6 }, (_, index) => (
                    <span key={index} className="h-4 w-16 animate-pulse rounded bg-muted" />
                ))}
            </div>
            <PanelSkeleton label="Loading client" />
        </div>
    );
}
