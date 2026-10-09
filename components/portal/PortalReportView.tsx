'use client';

import { useMemo } from 'react';
import { PortalLink as Link } from './PortalViewContext';
import { RenderBlock, type ReportContext } from '@/components/reports/ReportBlocks';
import { blocksForClientRender, splitReportPages, type ReportSectionsField } from '@/lib/reports/blocks';
import { REPORT_PRINT_CSS } from '@/lib/reports/print-style';
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
    const blocks = useMemo(() => blocksForClientRender(sections), [sections]);
    const pages = useMemo(() => splitReportPages(blocks), [blocks]);

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
        clientFacing: true,
        planSnapshot,
    };

    return (
        <div>
            <style>{REPORT_PRINT_CSS}</style>
            <div className="print-hidden mb-6 flex flex-wrap items-center justify-between gap-3 text-foreground">
                <div>
                    <Link href="/portal/reports" className="text-sm text-muted-foreground hover:text-foreground">All reports</Link>
                    <h2 className="text-xl font-semibold">{title}</h2>
                    <p className="text-sm text-muted-foreground">{monthLabel(reportMonth)}</p>
                </div>
                <button
                    type="button"
                    onClick={() => window.print()}
                    className="portal-button"
                    title="Opens the print dialog. Choose Save as PDF to download."
                >
                    Save as PDF
                </button>
            </div>
            <p className="print-hidden mb-4 text-xs text-muted-foreground">To download a PDF, choose Save as PDF in your browser’s print dialog.</p>
            <div id="report-print-area" className="mx-auto max-w-[860px] space-y-6">
                {pages.map((page, index) => (
                    <div key={index} className="report-page space-y-7 rounded-xl border border-border/40 bg-white px-6 py-8 text-neutral-900 shadow-sm sm:px-10">
                        {page.map(block => (
                            <div key={block.id} className="report-block">
                                <RenderBlock block={block} ctx={ctx} />
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}
