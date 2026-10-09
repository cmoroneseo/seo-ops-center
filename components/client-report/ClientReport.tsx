'use client';

import { Printer } from 'lucide-react';
import { Receipt } from '@/components/reporting/Receipt';
import { PortalLink } from '@/components/portal/PortalViewContext';
import { CLIENT_REPORT_PRINT_CSS } from '@/lib/reports/client-html';
import {
    forAudience,
    type CityCard,
    type ClientBlock,
    type ClientReportModel,
    type GlanceRow,
    type Piece,
} from '@/lib/reports/render-model';

function Pieces({ pieces }: { pieces: Piece[] }) {
    return (
        <>
            {pieces.map((piece, index) => piece.kind === 'text' ? (
                <span key={index}>{piece.text}</span>
            ) : (
                <Receipt
                    key={index}
                    input={{
                        title: piece.receipt.title,
                        value: piece.receipt.value,
                        freshness: piece.receipt.freshness,
                        source: piece.receipt.source,
                        dates: piece.receipt.dates,
                        note: piece.receipt.note,
                        audience: 'client',
                        tier: 'A',
                        frozenAt: piece.receipt.frozenAt || null,
                        metricSources: piece.receipt.metricSources,
                    }}
                />
            ))}
        </>
    );
}

function Glance({ row }: { row: GlanceRow }) {
    const am = row.audience === 'am';
    return (
        <div
            data-glance={row.id}
            className={`grid gap-3 border-t border-[#eceae6] px-4 py-4 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] sm:items-start ${am ? 'amonly-block bg-[#fff7ed]' : ''}`}
        >
            <p className="text-sm font-semibold text-[#1c1917]">{row.question}</p>
            <p className="text-sm leading-6 text-[#44403c]"><Pieces pieces={row.pieces} /></p>
            <p className="justify-self-start rounded-full bg-[#f4f1ee] px-2.5 py-1 text-xs font-medium text-[#57534e]">{row.pill}</p>
        </div>
    );
}

function City({ city }: { city: CityCard }) {
    return (
        <article className="client-report-card rounded-2xl border border-[#eceae6] bg-white p-4">
            <h3 className="text-base font-semibold text-[#1c1917]">{city.name}</h3>
            <p className="mt-3 text-sm leading-6 text-[#44403c]">
                <span className="mr-1.5 inline-flex items-center gap-1 font-medium" style={{ color: 'var(--map)' }}>Map</span>
                <Pieces pieces={city.mapPieces} />
            </p>
            <p className="mt-2 text-sm leading-6 text-[#44403c]">
                <span className="mr-1.5 inline-flex items-center gap-1 font-medium" style={{ color: 'var(--chart-1)' }}>Website</span>
                <Pieces pieces={city.websitePieces} />
            </p>
        </article>
    );
}

function BlockView({ block }: { block: ClientBlock }) {
    switch (block.kind) {
        case 'hero':
            return (
                <header data-client-block="hero">
                    <h1 className="client-report-hero max-w-[18ch] text-[2.5rem] font-semibold leading-[1.05] tracking-tight text-[#1c1917]">
                        <Pieces pieces={block.pieces} />
                    </h1>
                    {block.lede ? <p className="mt-4 max-w-[46rem] text-sm leading-6 text-[#57534e]">{block.lede}</p> : null}
                    {block.comparison ? (
                        <p className="mt-3 text-sm text-[#57534e]">
                            Prior times shown: <s>{block.comparison.prior}</s>. {block.comparison.reason}
                        </p>
                    ) : null}
                </header>
            );
        case 'at_a_glance':
            return (
                <section data-client-block="at_a_glance" className="client-report-card overflow-hidden rounded-2xl border border-[#eceae6] bg-white">
                    <h2 className="px-4 py-3 text-xs font-semibold tracking-[0.14em] text-[#a8a29e]">AT A GLANCE</h2>
                    {block.rows.map(row => <Glance key={row.id} row={row} />)}
                </section>
            );
        case 'where_you_show_up':
            return (
                <section data-client-block="where_you_show_up">
                    <h2 className="text-xs font-semibold tracking-[0.14em] text-[#a8a29e]">WHERE YOU SHOW UP</h2>
                    <p className="mt-2 max-w-[46rem] text-sm leading-6 text-[#57534e]">{block.intro}</p>
                    {block.empty ? <p className="mt-4 text-sm text-[#57534e]">{block.empty}</p> : null}
                    {block.cities.length > 0 ? (
                        <div className="client-report-cities mt-4 grid grid-cols-3 gap-3">
                            {block.cities.map(city => <City key={city.name} city={city} />)}
                        </div>
                    ) : null}
                </section>
            );
        case 'work_completed':
            return (
                <section data-client-block="work_completed" className="client-report-card rounded-2xl border border-[#eceae6] bg-white p-4">
                    <h2 className="text-xs font-semibold tracking-[0.14em] text-[#a8a29e]">WORK COMPLETED AND WHERE IT LANDED</h2>
                    <ul className="mt-3 space-y-3 text-sm leading-6 text-[#44403c]">
                        {block.items.map(item => (
                            <li key={item.url}>
                                <span className="font-semibold text-[#1c1917]">{item.title}.</span> {item.line}{' '}
                                <a className="underline" href={item.url}>{item.url}</a>
                            </li>
                        ))}
                    </ul>
                </section>
            );
        case 'what_changed':
            return (
                <section data-client-block="what_changed" className="client-report-card rounded-2xl border border-[#eceae6] bg-white p-4">
                    <h2 className="text-xs font-semibold tracking-[0.14em] text-[#a8a29e]">WHAT CHANGED</h2>
                    <p className="mt-2 text-sm leading-6 text-[#44403c]">{block.sentence}</p>
                </section>
            );
        case 'whats_next':
            return (
                <section data-client-block="whats_next" className={`client-report-card rounded-2xl border border-dashed p-4 ${block.audience === 'am' ? 'amonly-block border-[#d8b4fe] bg-[#faf5ff]' : 'border-[#eceae6] bg-white'}`}>
                    <h2 className="text-xs font-semibold tracking-[0.14em] text-[#a8a29e]">NEXT MONTH</h2>
                    {block.intro ? <p className="mt-2 text-xs leading-5 text-[#7c3aed]">{block.intro}</p> : null}
                    <ul className="mt-3 space-y-2 text-sm leading-6 text-[#44403c]">
                        {block.items.map(item => (
                            <li key={item.label}><span className="font-semibold text-[#1c1917]">{item.label}.</span> {item.sentence}</li>
                        ))}
                    </ul>
                </section>
            );
        case 'what_we_need':
            return (
                <section data-client-block="what_we_need" className="client-report-card rounded-2xl border border-[#eceae6] bg-white p-4">
                    <h2 className="text-xs font-semibold tracking-[0.14em] text-[#a8a29e]">WHAT WE NEED FROM YOU</h2>
                    <ul className="mt-3 space-y-2 text-sm leading-6 text-[#44403c]">
                        {block.items.map(item => <li key={item.sentence}>{item.sentence}</li>)}
                    </ul>
                </section>
            );
        case 'about_these_numbers':
            return (
                <footer data-client-block="about_these_numbers" className="space-y-2 text-xs leading-5 text-[#a8a29e]">
                    {block.lines.map(line => <p key={line}>{line}</p>)}
                </footer>
            );
        case 'domain_rating':
            return (
                <section data-client-block="domain_rating" className="text-xs leading-5 text-[#a8a29e]">
                    <h2 className="text-xs font-semibold tracking-[0.14em]">DOMAIN RATING</h2>
                    <p className="mt-1">{block.sentence}</p>
                </section>
            );
        default: {
            const never: never = block;
            return never;
        }
    }
}

export function ClientReport({ model, audience }: { model: ClientReportModel; audience: 'client' | 'staff' }) {
    const visible = forAudience(model, audience);
    return (
        <article className="client-report mx-auto max-w-[920px] px-4 py-6 text-[#1c1917]" style={{ background: '#f6f5f7' }}>
            <style>{CLIENT_REPORT_PRINT_CSS}</style>
            {visible.staffBanner ? (
                <div className="amonly-block draftbar mb-4 rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-sm text-[#9a3412]">
                    {visible.staffBanner}
                </div>
            ) : null}
            <div className="client-report-chrome mb-6 flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--chart-1)' }}>{visible.agencyName}</p>
                    <p className="text-sm text-[#78716c]">{visible.clientName} · Google Search report</p>
                </div>
                <div className="client-report-switcher flex flex-wrap items-center gap-2">
                    {visible.switcher.map(chip => chip.disabled || !chip.href ? (
                        <button
                            key={chip.month}
                            type="button"
                            disabled
                            title={chip.tooltip ?? undefined}
                            className="rounded-full border border-[#e7e5e4] bg-white px-3 py-1.5 text-sm text-[#a8a29e]"
                        >
                            {chip.label}
                        </button>
                    ) : (
                        <PortalLink
                            key={chip.month}
                            href={chip.href}
                            aria-current={chip.current ? 'page' : undefined}
                            className={`rounded-full border px-3 py-1.5 text-sm ${chip.current ? 'border-[#1c1917] bg-[#1c1917] text-white' : 'border-[#e7e5e4] bg-white text-[#44403c]'}`}
                        >
                            {chip.label}
                        </PortalLink>
                    ))}
                    <button type="button" className="btn inline-flex items-center gap-1.5 rounded-full border border-[#e7e5e4] bg-white px-3 py-1.5 text-sm" onClick={() => window.print()}>
                        <Printer size={14} aria-hidden="true" /> Download PDF
                    </button>
                </div>
            </div>
            <div id="report-print-area" className="space-y-8">
                <section className="client-report-page space-y-6" data-page="summary">
                    <p className="text-xs font-semibold tracking-[0.16em]" style={{ color: 'var(--chart-1)' }}>{visible.monthName.toUpperCase()} {visible.year}</p>
                    {visible.summary.map(block => <BlockView key={block.kind} block={block} />)}
                </section>
                <section className="client-report-page space-y-6" data-page="detail">
                    {visible.detail.map(block => <BlockView key={`${block.kind}-${block.kind === 'whats_next' ? block.audience : ''}`} block={block} />)}
                </section>
            </div>
        </article>
    );
}
