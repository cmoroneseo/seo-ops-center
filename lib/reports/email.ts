/**
 * The client email is the summary page plus a portal link.
 * From is the account manager's name on the verified agency address.
 * Reply-To is the account manager. There is no attachment.
 */

import { safePortalNext } from '@/lib/portal/access-policy';
import { renderClientReportHtml } from './client-html';
import type { ClientReportModel } from './render-model';
import { htmlText, stripAmOnly } from './strip-am-only';

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export interface ReportEmail {
    from: string;
    replyTo: string;
    to: string;
    subject: string;
    html: string;
    text: string;
}

function oneLine(value: string): string {
    return value.replace(/[\r\n<>"]/g, ' ').replace(/\s+/g, ' ').trim();
}

function address(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed || /[\r\n]/.test(value)) return null;
    const inside = trimmed.match(/<([^<>\s]+)>/)?.[1] ?? trimmed;
    return EMAIL.test(inside) ? inside : null;
}

export function reportFromHeader(amName: string, agencyName: string, verifiedFrom: string): string | null {
    const from = address(verifiedFrom);
    if (!from) return null;
    const manager = oneLine(amName) || 'Your account manager';
    const agency = oneLine(agencyName) || 'your agency';
    return `${manager} via ${agency} <${from}>`;
}

export function reportReplyTo(amEmail: string): string | null {
    return address(amEmail);
}

export function reportPortalUrl(siteUrl: string, clientId: string, reportId: string): string {
    const base = siteUrl.replace(/\/$/, '') || 'https://seo-ops-center.vercel.app';
    const portal = new URL('/portal/login', base);
    portal.searchParams.set('next', safePortalNext(`/portal/reports/${reportId}`));
    portal.searchParams.set('client', clientId);
    return portal.toString();
}

export function buildReportEmail(input: {
    model: ClientReportModel;
    amName: string;
    amEmail: string;
    agencyName: string;
    verifiedFrom: string;
    to: string;
    siteUrl: string;
    clientId: string;
    reportId: string;
}): ReportEmail | null {
    const from = reportFromHeader(input.amName, input.agencyName, input.verifiedFrom);
    const replyTo = reportReplyTo(input.amEmail);
    const to = address(input.to);
    if (!from || !replyTo || !to) return null;
    const link = reportPortalUrl(input.siteUrl, input.clientId, input.reportId);
    const summary = stripAmOnly(renderClientReportHtml(input.model, { audience: 'client', pages: 'summary' }));
    const href = link.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const html = summary.includes('</body>')
        ? summary.replace('</body>', `<p><a href="${href}">Open the report in your portal</a></p></body>`)
        : `${summary}<p><a href="${href}">Open the report in your portal</a></p>`;
    const subject = oneLine(`${input.model.clientName}: Your ${input.model.monthName} search report`);
    const text = `${htmlText(summary)}\n\nOpen the report in your portal: ${link}`;
    return { from, replyTo, to, subject, html, text };
}
