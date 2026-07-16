import type { MarketingPlan, MarketingPlanItem } from './types';

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Escape user text, then convert [label](url) markdown links to anchors. */
function linkify(text: string): string {
    return escapeHtml(text).replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_m, label, url) => `<a href="${url}">${label}</a>`,
    );
}

/**
 * Builds a clean, self-contained HTML document for exporting a marketing plan
 * to PDF (print) or Word (.doc). Excludes ignored items; includes comments as notes.
 * Client-facing: no progress counts, priorities, assignees, or due dates.
 */
export function buildMarketingPlanExportHtml(input: {
    plan: MarketingPlan;
    clientName: string;
}): string {
    const { plan, clientName } = input;
    const items = (plan.items ?? []).filter(i => i.status !== 'ignored');
    const generatedOn = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
    });

    const steps = [...plan.steps].sort((a, b) => a.sortOrder - b.sortOrder);

    const renderItem = (item: MarketingPlanItem): string => {
        const done = item.status === 'done';
        const notes = item.comments.length > 0
            ? `<div class="notes">
                <div class="notes-label">Notes</div>
                ${item.comments.map(c => `
                <div class="note">
                    <span class="note-author">${escapeHtml(c.authorName)}</span>
                    <span class="note-date">${new Date(c.createdAt).toLocaleDateString()}</span>
                    <div class="note-body">${linkify(c.body)}</div>
                </div>`).join('')}
               </div>`
            : '';

        return `
        <div class="item">
            <div class="item-title${done ? ' done' : ''}">${done ? '<span class="check">✓</span> ' : ''}${escapeHtml(item.title)}</div>
            ${item.description ? `<div class="item-desc">${linkify(item.description)}</div>` : ''}
            ${notes}
        </div>`;
    };

    const sections = steps
        .map(step => {
            const stepItems = items
                .filter(i => i.stepKey === step.key)
                .sort((a, b) => a.sortOrder - b.sortOrder);
            if (stepItems.length === 0) return '';
            return `
        <section class="step">
            <h2>${escapeHtml(step.name)}</h2>
            ${stepItems.map(renderItem).join('')}
        </section>`;
        })
        .join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(clientName)} — SEO Marketing Plan</title>
<style>
    :root { color-scheme: light; }
    html, body { background: #ffffff; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; max-width: 800px; margin: 0 auto; padding: 40px 32px; line-height: 1.5; }
    a { color: #1d4ed8; }
    .doc-header { border-bottom: 3px solid #1a1a1a; padding-bottom: 16px; margin-bottom: 28px; }
    h1 { font-size: 26px; margin: 0 0 4px; }
    .subtitle { font-size: 13px; color: #555; }
    h2 { font-size: 17px; border-bottom: 1px solid #ccc; padding-bottom: 6px; margin: 28px 0 12px; }
    .step { page-break-inside: auto; }
    .item { margin: 0 0 16px; page-break-inside: avoid; }
    .item-title { font-weight: bold; font-size: 14px; }
    .item-title.done { color: #555; }
    .check { color: #16a34a; }
    .item-desc { font-size: 13px; color: #333; margin-top: 3px; }
    .notes { margin: 8px 0 0 14px; padding: 8px 12px; background: #f6f6f4; border-left: 3px solid #d4d4d0; }
    .notes-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 4px; }
    .note { margin-bottom: 6px; font-size: 12.5px; }
    .note:last-child { margin-bottom: 0; }
    .note-author { font-weight: bold; }
    .note-date { color: #999; font-size: 11px; margin-left: 6px; }
    @media print {
        body { padding: 0; }
        @page { margin: 18mm 15mm; }
    }
</style>
</head>
<body>
    <div class="doc-header">
        <h1>${escapeHtml(clientName)} — SEO Marketing Plan</h1>
        <div class="subtitle">Marketing Empire Group · Generated ${generatedOn}</div>
    </div>
    ${sections}
</body>
</html>`;
}
