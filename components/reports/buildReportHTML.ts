import { ClientProject } from '@/lib/types';
import {
    REPORT_SECTIONS, METRIC_DEFS, formatMetric, computeDelta,
    monthLabel, SectionConfig, ReportSourceKey,
} from '@/lib/reports/sections';

type MetricMap = Partial<Record<ReportSourceKey, Record<string, any>>>;

interface ReportData {
    title: string;
    reportMonth: string;
    executiveSummary: string | null;
    recommendations: string | null;
    sections: SectionConfig[];
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));

/** Branded, print-ready HTML for a monthly report (print → Save as PDF). */
export function buildReportHTML(
    client: ClientProject,
    report: ReportData,
    metrics: { current: MetricMap; previous: MetricMap },
): string {
    const accent = '#ef4444';
    const initials = client.clientName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const logo = client.logoUrl
        ? `<img src="${esc(client.logoUrl)}" style="width:56px;height:56px;border-radius:12px;object-fit:cover" />`
        : `<div style="width:56px;height:56px;border-radius:12px;background:${accent};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:22px">${esc(initials)}</div>`;

    const enabled = [...report.sections].filter(s => s.enabled).sort((a, b) => a.order - b.order);

    const sectionHTML = enabled.map(cfg => {
        const def = REPORT_SECTIONS.find(s => s.key === cfg.key);
        if (!def) return '';
        const cur = metrics.current[cfg.key];
        if (!cur || Object.keys(cur).length === 0) return ''; // hide empty
        const prev = metrics.previous[cfg.key] ?? {};

        const cards = METRIC_DEFS[cfg.key].map(m => {
            if (cur[m.key] == null) return '';
            const d = computeDelta(cur[m.key], prev[m.key], m.lowerIsBetter);
            const deltaHTML = d && d.direction !== 'flat'
                ? `<span style="color:${d.isGood ? '#16a34a' : '#dc2626'};font-size:11px;font-weight:600">${d.direction === 'up' ? '▲' : '▼'} ${Math.abs(d.pct).toFixed(1)}%</span>`
                : '';
            return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;min-width:120px">
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">${esc(m.label)}</div>
                <div style="font-size:22px;font-weight:700;margin-top:2px">${esc(formatMetric(cur[m.key], m.format))} ${deltaHTML}</div>
            </div>`;
        }).join('');

        return `<div style="margin-top:28px;page-break-inside:avoid">
            <div style="display:flex;align-items:center;gap:8px;border-bottom:2px solid ${accent};padding-bottom:6px;margin-bottom:14px">
                <span style="font-size:18px">${def.icon}</span>
                <h2 style="margin:0;font-size:17px;color:#111827">${esc(def.name)}</h2>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:10px">${cards}</div>
        </div>`;
    }).join('');

    const summaryBlock = report.executiveSummary
        ? `<div style="margin-top:24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:18px">
            <h2 style="margin:0 0 8px;font-size:15px;color:${accent}">Executive Summary</h2>
            <p style="margin:0;line-height:1.6;color:#374151;white-space:pre-wrap">${esc(report.executiveSummary)}</p>
        </div>` : '';

    const recsBlock = report.recommendations
        ? `<div style="margin-top:20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:18px;page-break-inside:avoid">
            <h2 style="margin:0 0 8px;font-size:15px;color:${accent}">Recommendations</h2>
            <p style="margin:0;line-height:1.7;color:#374151;white-space:pre-wrap">${esc(report.recommendations)}</p>
        </div>` : '';

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title>
    <style>@media print{@page{margin:18mm}} body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;margin:0;padding:32px;max-width:900px}</style>
    </head><body>
        <div style="display:flex;align-items:center;gap:16px;border-bottom:1px solid #e5e7eb;padding-bottom:18px">
            ${logo}
            <div>
                <div style="font-size:22px;font-weight:700">${esc(client.clientName)}</div>
                <div style="font-size:13px;color:#6b7280">${esc(monthLabel(report.reportMonth))} · SEO Performance Report</div>
            </div>
        </div>
        ${summaryBlock}
        ${sectionHTML}
        ${recsBlock}
        <div style="margin-top:36px;border-top:1px solid #e5e7eb;padding-top:12px;font-size:11px;color:#9ca3af">
            Prepared by ${esc(client.accountManager || 'Marketing Empire Group')} · Generated ${new Date().toLocaleDateString()}
        </div>
    </body></html>`;
}
