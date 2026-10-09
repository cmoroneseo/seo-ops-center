/**
 * One HTML document for print and for the email summary.
 * Client audience is stripped of AM-only blocks before it leaves the server.
 */

import type { ClientBlock, ClientReportModel, Piece } from './render-model';
import { forAudience } from './render-model';
import { stripAmOnly } from './strip-am-only';

export const CLIENT_REPORT_PRINT_CSS = `
@page { size: Letter; margin: 0.6in; }
@media (max-width: 720px) {
  .client-report-hero { font-size: 26px !important; line-height: 1.2 !important; }
  .client-report-cities { grid-template-columns: 1fr !important; }
  .client-report-switcher { flex-wrap: wrap; }
}
@media print {
  html, body { background: white !important; height: auto !important; overflow: visible !important; }
  body * { visibility: hidden; }
  #report-print-area, #report-print-area * { visibility: visible; }
  #report-print-area { position: absolute; left: 0; top: 0; width: 100%; background: white !important; }
  .client-report-chrome, .amonly-block, .draftbar, .btn { display: none !important; }
  .client-report-page { break-after: page; page-break-after: always; }
  .client-report-page:last-child { break-after: auto; page-break-after: auto; }
  .client-report-card { break-inside: avoid; page-break-inside: avoid; }
}
`;

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function piecesHtml(pieces: Piece[]): string {
    return pieces.map(piece => {
        if (piece.kind === 'text') return escapeHtml(piece.text);
        return `<span class="client-receipt" data-receipt="tier-a">${escapeHtml(piece.display)}</span>`;
    }).join('');
}

function blockHtml(block: ClientBlock): string {
    const open = `<section class="client-report-card${block.kind === 'whats_next' && block.audience === 'am' ? ' amonly-block' : ''}" data-client-block="${block.kind}">`;
    switch (block.kind) {
        case 'hero':
            return `${open}<h1 class="client-report-hero">${piecesHtml(block.pieces)}</h1>${block.lede ? `<p>${escapeHtml(block.lede)}</p>` : ''}${block.comparison ? `<p>Prior times shown: <s>${escapeHtml(block.comparison.prior)}</s>. ${escapeHtml(block.comparison.reason)}</p>` : ''}</section>`;
        case 'at_a_glance':
            return `${open}<h2>At a glance</h2>${block.rows.map(row => `<div class="${row.audience === 'am' ? 'amonly-block' : ''}" data-glance="${row.id}"><p>${escapeHtml(row.question)}</p><p>${piecesHtml(row.pieces)}</p><p>${escapeHtml(row.pill)}</p></div>`).join('')}</section>`;
        case 'where_you_show_up':
            return `${open}<h2>Where you show up</h2><p>${escapeHtml(block.intro)}</p>${block.empty ? `<p>${escapeHtml(block.empty)}</p>` : ''}<div class="client-report-cities">${block.cities.map(city => `<article><h3>${escapeHtml(city.name)}</h3><p><span style="color:var(--map)">Map</span> ${piecesHtml(city.mapPieces)}</p><p><span style="color:var(--chart-1)">Website</span> ${piecesHtml(city.websitePieces)}</p></article>`).join('')}</div></section>`;
        case 'work_completed':
            return `${open}<h2>Work completed and where it landed</h2><ul>${block.items.map(item => `<li>${escapeHtml(item.title)}. ${escapeHtml(item.line)} <a href="${escapeHtml(item.url)}">${escapeHtml(item.url)}</a></li>`).join('')}</ul></section>`;
        case 'what_changed':
            return `${open}<h2>What changed</h2><p>${escapeHtml(block.sentence)}</p></section>`;
        case 'whats_next':
            return `${open}<h2>Next month</h2>${block.intro ? `<p>${escapeHtml(block.intro)}</p>` : ''}<ul>${block.items.map(item => `<li><strong>${escapeHtml(item.label)}.</strong> ${escapeHtml(item.sentence)}</li>`).join('')}</ul></section>`;
        case 'what_we_need':
            return `${open}<h2>What we need from you</h2><ul>${block.items.map(item => `<li>${escapeHtml(item.sentence)}</li>`).join('')}</ul></section>`;
        case 'about_these_numbers':
            return `${open}<h2>About these numbers</h2>${block.lines.map(line => `<p>${escapeHtml(line)}</p>`).join('')}</section>`;
        case 'domain_rating':
            return `${open}<h2>Domain Rating</h2><p>${escapeHtml(block.sentence)}</p></section>`;
        default: {
            const never: never = block;
            return never;
        }
    }
}

export function renderClientReportHtml(model: ClientReportModel, options: { audience: 'client' | 'staff'; pages?: 'summary' | 'full' }): string {
    const visible = forAudience(model, options.audience);
    const summary = visible.summary.map(blockHtml).join('');
    const detail = visible.detail.map(blockHtml).join('');
    const banner = visible.staffBanner
        ? `<div class="amonly-block draftbar">${escapeHtml(visible.staffBanner)}</div>`
        : '';
    const pages = options.pages === 'summary'
        ? `<section class="client-report-page" data-page="summary">${summary}</section>`
        : `<section class="client-report-page" data-page="summary">${summary}</section><section class="client-report-page" data-page="detail">${detail}</section>`;
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><style>${CLIENT_REPORT_PRINT_CSS}</style></head><body><article class="client-report">${banner}<div id="report-print-area">${pages}</div></article></body></html>`;
    return options.audience === 'client' ? stripAmOnly(html) : html;
}
