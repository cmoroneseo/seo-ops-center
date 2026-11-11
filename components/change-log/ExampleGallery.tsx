'use client';

import { useSearchParams } from 'next/navigation';

import { exampleBoard, exampleConfounders, EXAMPLE_BASELINE_NOTE, EXAMPLE_NOTE, EXAMPLE_TODAY, ecoworkzH1Input } from '@/lib/change-log/fixture';

import { ChangeLogView } from './ChangeLogView';

const SCREENS = ['timeline', 'log', 'detail', 'empty', 'loading'] as const;

export function ExampleGallery() {
    const params = useSearchParams();
    const screen = params.get('screen') ?? 'timeline';
    const board = exampleBoard();
    const h1 = board.changes[0];
    const mode = screen === 'log'
        ? 'form'
        : screen === 'detail'
            ? 'detail'
            : screen === 'empty'
                ? 'empty'
                : screen === 'loading'
                    ? 'loading'
                    : 'list';
    return (
        <div className="space-y-4">
            <nav className="flex flex-wrap gap-2 text-sm" aria-label="Example screens">
                {SCREENS.map(item => (
                    <a
                        key={item}
                        href={`/change-log-example?screen=${item}`}
                        className={`rounded-full px-3 py-1 ring-1 ring-inset ${item === screen ? 'bg-zinc-900 text-white ring-zinc-900' : 'bg-card ring-border'}`}
                    >
                        {item}
                    </a>
                ))}
            </nav>
            <ChangeLogView
                clientName="Ecoworkz"
                mode={mode}
                example
                exampleNote={EXAMPLE_NOTE}
                items={board.items}
                detail={{
                    change: h1,
                    impact: board.impacts[h1.id],
                    confounders: exampleConfounders(board, h1.id),
                    baselineNote: EXAMPLE_BASELINE_NOTE,
                }}
                revertOpen={params.get('revert') === '1'}
                formInitial={ecoworkzH1Input()}
                onLog={() => { window.location.href = '/change-log-example?screen=log'; }}
                onOpen={() => { window.location.href = '/change-log-example?screen=detail'; }}
                onBack={() => { window.location.href = '/change-log-example?screen=timeline'; }}
                onSubmit={() => { window.location.href = '/change-log-example?screen=detail'; }}
                onRemove={() => undefined}
                today={EXAMPLE_TODAY}
            />
        </div>
    );
}
