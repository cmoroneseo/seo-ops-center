import { clientLabel, formatChange, formatCount, formatPrior, formatPulledAt, isSentinelLabel, sparkline, type GtmBreakdownRow, type GtmEventsSnapshot } from '@/lib/reports/gtm-events';

export const GTM_EVENTS_CSS = `
.gtm-report{color:#0f172a;font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.5;background:#f6f7f9}
.gtm-report *{box-sizing:border-box}
.gtm-report .chrome{background:#fff;border-bottom:1px solid #e5e7eb}
.gtm-report .chrome .in{max-width:1120px;margin:0 auto;padding:12px 24px;display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:12px;color:#64748b}
.gtm-report .brand{font-weight:800;color:#0f172a;font-size:13px}
.gtm-report .wrap{max-width:1120px;margin:0 auto;padding:28px 24px 48px}
.gtm-report .card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:24px;box-shadow:0 5px 18px rgb(0 0 0/6%);margin-bottom:20px}
.gtm-report .eyebrow{font-size:12px;font-weight:700;color:#1f3a8a;text-transform:uppercase;letter-spacing:.08em}
.gtm-report h1{font-size:30px;line-height:1.15;margin:6px 0 4px;font-weight:800}
.gtm-report h2{font-size:18px;margin:0 0 4px;font-weight:800}
.gtm-report h3{font-size:15px;margin:22px 0 6px;font-weight:800}
.gtm-report .lede{color:#64748b;margin:0 0 16px}
.gtm-report .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px}
.gtm-report .kpi{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;box-shadow:0 5px 18px rgb(0 0 0/6%)}
.gtm-report .kl{font-size:12px;color:#64748b;font-weight:700}
.gtm-report .kv{font-size:32px;font-weight:800;font-variant-numeric:tabular-nums;margin:2px 0}
.gtm-report .kd{font-weight:700;font-size:13px}
.gtm-report .kn{font-size:12px;color:#64748b;margin-top:6px}
.gtm-report .up{color:#047857}.gtm-report .down{color:#b91c1c}.gtm-report .flat{color:#64748b;font-weight:500}
.gtm-report .muted{color:#64748b;font-weight:500}
.gtm-report table{width:100%;border-collapse:collapse;font-size:13px}
.gtm-report th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;font-weight:700;padding:8px 10px;border-bottom:1px solid #e5e7eb;white-space:nowrap}
.gtm-report td{padding:10px;border-bottom:1px solid #f1f5f9;vertical-align:top}
.gtm-report td.r,.gtm-report th.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.gtm-report .sub{font-size:11px;color:#64748b;font-weight:500;margin-top:2px}
.gtm-report .dest{overflow-wrap:anywhere}
.gtm-report .mono{overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;font-weight:600}
.gtm-report .sparks{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.gtm-report .spark{margin:0;border:1px solid #e5e7eb;border-radius:8px;padding:12px}
.gtm-report .spark figcaption{display:flex;justify-content:space-between;font-size:13px}
.gtm-report .spark .num{font-weight:800;font-variant-numeric:tabular-nums}
.gtm-report svg{width:100%;height:auto;display:block}
.gtm-report .grid{stroke:#eef0f3}.gtm-report .ax{font-size:9px;fill:#94a3b8}
.gtm-report .line{fill:none;stroke:#2563eb;stroke-width:1.8}.gtm-report .area{fill:#2563eb;opacity:.08}.gtm-report .dot{fill:#2563eb}
.gtm-report .cap{margin:4px 0 0;font-size:11px;color:#64748b}
.gtm-report footer{color:#64748b;font-size:12px;text-align:center;margin-top:8px}
@media(max-width:820px){.gtm-report .kpis,.gtm-report .sparks{grid-template-columns:1fr}.gtm-report h1{font-size:24px}.gtm-report .wrap{padding:16px 12px 32px}.gtm-report .card{padding:16px}}
@media(max-width:520px){
.gtm-report .kv{font-size:26px}
.gtm-report table,.gtm-report tbody,.gtm-report tr,.gtm-report td{display:block;width:100%}
.gtm-report thead{display:none}
.gtm-report tr{border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;margin-bottom:10px}
.gtm-report td{border:0;padding:3px 0;display:flex;justify-content:space-between;gap:12px;text-align:right}
.gtm-report td::before{content:attr(data-l);color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:left}
.gtm-report td:first-child{display:block;text-align:left;font-size:14px;padding-bottom:6px;border-bottom:1px solid #f1f5f9;margin-bottom:4px}
.gtm-report td:first-child::before{display:none}
}
`;

function changeCell(current: number, prior: number) {
    const change = formatChange(current, prior);
    return <span className={change.tone}>{change.text}</span>;
}

function safe(value: string, fallback = 'Link') {
    return clientLabel(value, fallback);
}

function DataTable({
    headers,
    rows,
    render,
}: {
    headers: { label: string; right?: boolean }[];
    rows: GtmBreakdownRow[];
    render: (row: GtmBreakdownRow) => { primary: string; detail?: string | null };
}) {
    return (
        <div className="tbl">
            <table>
                <thead>
                    <tr>
                        {headers.map(header => <th key={header.label} className={header.right ? 'r' : undefined}>{header.label}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {rows.map(row => {
                        const primary = render(row);
                        return (
                            <tr key={`${primary.primary}|${row.destination}|${row.current}`}>
                                <td data-l={headers[0]?.label}>
                                    {safe(primary.primary)}
                                    {primary.detail && !isSentinelLabel(primary.detail) ? <div className="sub">{primary.detail.trim()}</div> : null}
                                </td>
                                <td data-l={headers[1]?.label} className="dest">{safe(row.destination, '')}</td>
                                <td data-l={headers[2]?.label} className="r">{formatCount(row.current)}</td>
                                <td data-l={headers[3]?.label} className="r">{formatPrior(row.prior)}</td>
                                <td data-l={headers[4]?.label} className="r">{changeCell(row.current, row.prior)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function TrendChart({ name, total, days, peakCount, peakDay, monthShort }: { name: string; total: number; days: number[]; peakCount: number; peakDay: number; monthShort: string }) {
    const chart = sparkline(days);
    const points = chart.points.map(point => `${point.x},${point.y}`).join(' ');
    const first = chart.points[0];
    const last = chart.points[chart.points.length - 1];
    const area = first && last ? `M${first.x},100 L${points.split(' ').join(' L')} L${last.x},100 Z` : '';
    const peak = chart.points[chart.peakIndex];
    const ticks = [0, 0.25, 0.5, 0.75, 1];
    const middle = days[Math.floor((days.length - 1) / 2)] != null ? Math.floor((days.length - 1) / 2) + 1 : 1;
    return (
        <figure className="spark">
            <figcaption><span className="mono">{safe(name, 'Event')}</span><span className="num">{formatCount(total)}</span></figcaption>
            <svg viewBox="0 0 300 120" role="img" aria-label={`Daily ${safe(name, 'event')} counts`}>
                {ticks.map(tick => {
                    const value = Math.round(chart.axisMax * tick);
                    const y = 100 - tick * 90;
                    return (
                        <g key={tick}>
                            <line x1="28" x2="294" y1={y} y2={y} className="grid" />
                            <text x="23" y={y + 3} className="ax" textAnchor="end">{value}</text>
                        </g>
                    );
                })}
                {area ? <path d={area} className="area" /> : null}
                <polyline points={points} className="line" />
                {peak ? <circle cx={peak.x} cy={peak.y} r="3" className="dot" /> : null}
                <text x="28" y="115" className="ax" textAnchor="start">{monthShort} 1</text>
                <text x="152" y="115" className="ax" textAnchor="middle">{monthShort} {middle}</text>
                <text x="294" y="115" className="ax" textAnchor="end">{monthShort} {days.length}</text>
            </svg>
            <p className="cap">Peak {formatCount(peakCount)} on {monthShort} {peakDay}</p>
        </figure>
    );
}

function Kpi({ label, current, prior, note, priorShort }: { label: string; current: number | null; prior: number | null; note: string; priorShort: string }) {
    const shown = current == null ? '—' : formatCount(current);
    const delta = current == null || prior == null ? null : formatChange(current, prior);
    return (
        <div className="kpi">
            <div className="kl">{label}</div>
            <div className="kv">{shown}</div>
            {delta ? <div className={`kd ${delta.tone}`}>{delta.text} <span className="muted">vs {priorShort} ({formatPrior(prior ?? 0)})</span></div> : <div className="kd flat">vs {priorShort}</div>}
            <div className="kn">{note}</div>
        </div>
    );
}

export function GtmEventsReport({ report, showChrome = false }: { report: GtmEventsSnapshot; showChrome?: boolean }) {
    const headers = (first: string, second: string) => [
        { label: first },
        { label: second },
        { label: report.monthShort, right: true },
        { label: report.priorShort, right: true },
        { label: 'Change', right: true },
    ];
    return (
        <div className="gtm-report">
            <style>{GTM_EVENTS_CSS}</style>
            {showChrome ? (
                <div className="chrome"><div className="in"><span className="brand">Marketing Empire Group · SEO Ops Center</span><span>Shared report</span></div></div>
            ) : null}
            <main className="wrap">
                <section className="card">
                    <div className="eyebrow">Shared report</div>
                    <h1>GTM Event Report</h1>
                    <p className="lede">{report.copy.lede}</p>
                </section>
                <section className="kpis">
                    <Kpi label="Total events" current={report.kpis.totalEvents.current} prior={report.kpis.totalEvents.prior} note={report.copy.totalEvents} priorShort={report.priorShort} />
                    <Kpi label="Events tracked via GTM" current={report.kpis.tagEvents.current} prior={report.kpis.tagEvents.prior} note={report.copy.tagEvents} priorShort={report.priorShort} />
                    <Kpi label="Sessions" current={report.kpis.sessions.current} prior={report.kpis.sessions.prior} note={report.copy.sessions} priorShort={report.priorShort} />
                </section>
                <section className="card">
                    <h2>Events in {report.periodLabel.split(' ')[0]}</h2>
                    <p className="lede">{report.copy.events}</p>
                    <div className="tbl">
                        <table>
                            <thead>
                                <tr>
                                    <th>Event</th>
                                    <th className="r">{report.monthShort}</th>
                                    <th className="r">{report.priorShort}</th>
                                    <th className="r">Change</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.events.map(row => (
                                    <tr key={row.name}>
                                        <td data-l="Event"><span className="mono">{safe(row.name, 'Event')}</span></td>
                                        <td data-l={report.monthShort} className="r">{formatCount(row.current)}</td>
                                        <td data-l={report.priorShort} className="r">{formatPrior(row.prior)}</td>
                                        <td data-l="Change" className="r">{changeCell(row.current, row.prior)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
                {report.outbound ? (
                    <section className="card">
                        <h2>Outbound clicks: which properties and links were clicked</h2>
                        <p className="lede">{report.copy.outbound}</p>
                        <h3>By property / destination</h3>
                        <DataTable
                            headers={headers('Property / link', 'Destination')}
                            rows={report.outbound.byProperty}
                            render={row => ({ primary: row.label })}
                        />
                        <h3>By link text</h3>
                        <p className="lede">{report.copy.links}</p>
                        <DataTable
                            headers={headers('Link', 'Destination')}
                            rows={report.outbound.byLink}
                            render={row => ({ primary: row.label, detail: row.detail })}
                        />
                        {report.booking ? (
                            <>
                                <h3>Booking clicks</h3>
                                <p className="lede">{report.copy.booking}</p>
                                <DataTable headers={headers('Link', 'Destination')} rows={report.booking.rows} render={row => ({ primary: row.label, detail: row.detail })} />
                            </>
                        ) : null}
                        {report.tickets ? (
                            <>
                                <h3>Ticket clicks</h3>
                                <p className="lede">{report.copy.tickets}</p>
                                <DataTable headers={headers('Ticket event', 'Destination')} rows={report.tickets.rows} render={row => ({ primary: row.label })} />
                            </>
                        ) : null}
                    </section>
                ) : null}
                {!report.outbound && (report.booking || report.tickets) ? (
                    <section className="card">
                        {report.booking ? <><h3>Booking clicks</h3><p className="lede">{report.copy.booking}</p><DataTable headers={headers('Link', 'Destination')} rows={report.booking.rows} render={row => ({ primary: row.label, detail: row.detail })} /></> : null}
                        {report.tickets ? <><h3>Ticket clicks</h3><p className="lede">{report.copy.tickets}</p><DataTable headers={headers('Ticket event', 'Destination')} rows={report.tickets.rows} render={row => ({ primary: row.label })} /></> : null}
                    </section>
                ) : null}
                {report.trends.length > 0 ? (
                    <section className="card">
                        <h2>Daily trend, {report.periodLabel}</h2>
                        <p className="lede">{report.copy.trends}</p>
                        <div className="sparks">
                            {report.trends.map(trend => (
                                <TrendChart key={trend.eventName} name={trend.eventName} total={trend.total} days={trend.days} peakCount={trend.peakCount} peakDay={trend.peakDay} monthShort={report.monthShort} />
                            ))}
                        </div>
                    </section>
                ) : null}
                <footer>Prepared by Marketing Empire Group{report.capturedAt ? ` · Data pulled ${formatPulledAt(report.capturedAt)} (PT)` : ''}</footer>
            </main>
        </div>
    );
}
