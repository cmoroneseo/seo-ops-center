/** Letter paper for the builder canvas and the client portal report. */
export const REPORT_PRINT_CSS = `
@page { size: Letter; margin: 0.6in; }
.print-only { display: none; }
@media print {
    html, body { background: white !important; height: auto !important; overflow: visible !important; }
    .h-screen { height: auto !important; overflow: visible !important; }
    body * { visibility: hidden; }
    #report-print-area, #report-print-area * { visibility: visible; }
    #report-print-area {
        position: fixed;
        left: 0;
        top: 0;
        width: 100%;
        padding: 0 !important;
        margin: 0 !important;
        background: white !important;
    }
    .report-page {
        box-shadow: none !important;
        border: none !important;
        border-radius: 0 !important;
        margin: 0 !important;
        break-after: page;
        page-break-after: always;
    }
    .report-page:last-child { break-after: auto; page-break-after: auto; }
    .report-block { break-inside: avoid; page-break-inside: avoid; }
    .print-hidden, .report-staff-only { display: none !important; }
    .print-only { display: block !important; }
}
`;
