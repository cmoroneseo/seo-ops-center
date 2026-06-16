'use client';

import Link from 'next/link';
import { Grid3X3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DeliverableType, FulfillmentCell } from '@/lib/types';
import { fulfillmentStatus } from '@/lib/seo-ops-logic';
import { severityBadgeClass } from './deliverable-ui';

const TYPES: DeliverableType[] = ['Content', 'Backlink', 'GBP', 'Other'];

interface MatrixClient {
    id: string;
    name: string;
    accountManager?: string;
}

interface FulfillmentMatrixProps {
    clients: MatrixClient[];
    cells: FulfillmentCell[];
    daysLeftInMonth: number;
    onCellClick: (clientId: string, type: DeliverableType) => void;
}

export function FulfillmentMatrix({ clients, cells, daysLeftInMonth, onCellClick }: FulfillmentMatrixProps) {
    const cellFor = (clientId: string, type: DeliverableType) =>
        cells.find((c) => c.clientId === clientId && c.type === type);

    // Only show columns that have any promised/generated work
    const activeTypes = TYPES.filter((t) => cells.some((c) => c.type === t && (c.promised > 0 || c.generated > 0)));
    const columns = activeTypes.length > 0 ? activeTypes : ['Content' as DeliverableType];

    // Clients with anything promised or generated first, alphabetical within
    const rows = clients
        .map((cl) => ({
            client: cl,
            hasWork: cells.some((c) => c.clientId === cl.id && (c.promised > 0 || c.generated > 0)),
        }))
        .sort((a, b) => Number(b.hasWork) - Number(a.hasWork) || a.client.name.localeCompare(b.client.name));

    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border bg-muted/30">
                <h3 className="font-semibold flex items-center gap-2">
                    <Grid3X3 className="h-4 w-4 text-primary" />
                    Fulfillment Matrix
                </h3>
            </div>
            {/* Mobile: stacked cards (table side-scroll is unusable on a phone) */}
            <div className="md:hidden divide-y divide-border/50">
                {rows.length === 0 && (
                    <div className="text-center py-10 text-muted-foreground text-sm">No active clients</div>
                )}
                {rows.map(({ client, hasWork }) => {
                    const clientCells = columns
                        .map((t) => ({ t, cell: cellFor(client.id, t) }))
                        .filter(({ cell }) => cell && (cell.promised > 0 || cell.generated > 0));
                    if (!hasWork || clientCells.length === 0) return null;
                    return (
                        <div key={client.id} className="p-4">
                            <Link href={`/workspace/${client.id}`} className="font-medium hover:text-primary transition-colors">
                                {client.name}
                            </Link>
                            {client.accountManager && (
                                <span className="block text-[10px] text-muted-foreground mb-2">{client.accountManager}</span>
                            )}
                            <div className="flex flex-wrap gap-2 mt-2">
                                {clientCells.map(({ t, cell }) => {
                                    const c = cell!;
                                    const pace = fulfillmentStatus({
                                        promised: c.promised, delivered: c.delivered,
                                        inProgress: c.inProgress, overdue: c.overdue, daysLeftInMonth,
                                    });
                                    const promisedShown = c.promised || c.generated;
                                    return (
                                        <button
                                            key={t}
                                            onClick={() => onCellClick(client.id, t)}
                                            className={cn(
                                                'inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-sm font-bold border active:scale-95 transition-transform',
                                                severityBadgeClass(pace.severity),
                                            )}
                                        >
                                            <span className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{t}</span>
                                            {c.delivered}/{promisedShown}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Desktop: full matrix table */}
            <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                        <tr>
                            <th className="text-left px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Client</th>
                            {columns.map((t) => (
                                <th key={t} className="text-center px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                        {rows.map(({ client, hasWork }) => (
                            <tr key={client.id} className={cn('hover:bg-muted/20 transition-colors', !hasWork && 'opacity-50')}>
                                <td className="px-4 py-2.5">
                                    <Link href={`/workspace/${client.id}`} className="font-medium hover:text-primary transition-colors">
                                        {client.name}
                                    </Link>
                                    {client.accountManager && (
                                        <span className="block text-[10px] text-muted-foreground">{client.accountManager}</span>
                                    )}
                                </td>
                                {columns.map((t) => {
                                    const cell = cellFor(client.id, t);
                                    if (!cell || (cell.promised === 0 && cell.generated === 0)) {
                                        return <td key={t} className="text-center px-3 py-2.5 text-muted-foreground/40">—</td>;
                                    }
                                    const pace = fulfillmentStatus({
                                        promised: cell.promised,
                                        delivered: cell.delivered,
                                        inProgress: cell.inProgress,
                                        overdue: cell.overdue,
                                        daysLeftInMonth,
                                    });
                                    const promisedShown = cell.promised || cell.generated;
                                    return (
                                        <td key={t} className="text-center px-3 py-2.5">
                                            <button
                                                onClick={() => onCellClick(client.id, t)}
                                                title={`${pace.status} — ${pace.reason}${cell.generated > cell.promised && cell.promised > 0 ? ` (${cell.generated} generated / ${cell.promised} promised)` : ''}`}
                                                className={cn(
                                                    'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border transition-transform hover:scale-105',
                                                    severityBadgeClass(pace.severity),
                                                )}
                                            >
                                                {cell.delivered}/{promisedShown}
                                            </button>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={columns.length + 1} className="text-center py-10 text-muted-foreground text-sm">
                                    No active clients
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
