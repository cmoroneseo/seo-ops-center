'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { RenderBlock, type ReportContext } from '@/components/reports/ReportBlocks';
import { resolveBlocks, type Block, type ReportSectionsField } from '@/lib/reports/blocks';
import { monthLabel } from '@/lib/reports/sections';
import type { ClientProject, MarketingPlan } from '@/lib/types';

export function PortalReportView({
    reportId,
    title,
    reportMonth,
    executiveSummary,
    recommendations,
    sections,
    clientName,
    logoUrl,
    metrics,
    history,
    planSnapshot,
}: {
    reportId: string;
    title: string;
    reportMonth: string;
    executiveSummary: string;
    recommendations: string;
    sections: ReportSectionsField;
    clientName: string;
    logoUrl?: string;
    metrics: ReportContext['metrics'];
    history: ReportContext['history'];
    planSnapshot: { plan: MarketingPlan } | null;
}) {
    const blocks = useMemo(() => resolveBlocks(sections), [sections]);
    const pages = useMemo(() => {
        const out: Block[][] = [[]];
        for (const block of blocks) {
            if (block.type === 'page_break') out.push([]);
            else out[out.length - 1].push(block);
        }
        return out.filter((page, index) => page.length > 0 || index === 0);
    }, [blocks]);

    const client = {
        id: 'portal-client',
        clientName,
        logoUrl,
        accountManager: '',
    } as ClientProject;

    const ctx: ReportContext = {
        reportId,
        client,
        reportMonth,
        executiveSummary,
        recommendations,
        metrics,
        history,
        hideEmpty: true,
        planSnapshot,
    };

    return (
        <div>
            <style>{`
                .print-only { display: none; }
                @media print {
                    body * { visibility: hidden; }
                    #report-print-area, #report-print-area * { visibility: visible; }
                    #report-print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 0 !important; background: white !important; }
                    .report-page { box-shadow: none !important; border: none !important; border-radius: 0 !important; margin: 0 0 24px !important; break-after: page; }
                    .print-hidden { display: none !important; }
                    .print-only { display: block !important; }
                    @page { margin: 14mm; }
                }
            `}</style>
            <div className="print-hidden mb-4 flex items-center justify-between gap-3">
                <div>
                    <Link href="/portal/reports" className="text-sm text-muted-foreground hover:text-foreground">All reports</Link>
                    <h2 className="text-xl font-semibold">{title}</h2>
                    <p className="text-sm text-muted-foreground">{monthLabel(reportMonth)}</p>
                </div>
                <button
                    type="button"
                    onClick={() => window.print()}
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
                >
                    Download PDF
                </button>
            </div>
            <div id="report-print-area" className="mx-auto max-w-[860px] space-y-6">
                {pages.map((page, index) => (
                    <div key={index} className="report-page space-y-7 rounded-xl border border-border/40 bg-white px-6 py-8 text-neutral-900 shadow-sm sm:px-10">
                        {page.map(block => (
                            <div key={block.id} style={{ breakInside: 'avoid' }}>
                                <RenderBlock block={block} ctx={ctx} />
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}
