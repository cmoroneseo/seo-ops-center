import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildFulfillmentCells, formatPromisedTotal, fulfillmentCellLabel } from './fulfillment-cells.ts';
import { FulfillmentMatrix } from '../../components/deliverables/FulfillmentMatrix.tsx';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const today = new Date('2026-10-13T15:00:00Z');

test('delivered work with no commitment is not a promise of zero', () => {
    const cells = buildFulfillmentCells([], [
        { clientId: 'north', type: 'Content', status: 'Published', dueDate: '2026-10-08' },
        { clientId: 'north', type: 'Content', status: 'In Progress', dueDate: '2026-10-20' },
        { clientId: 'sandbox', type: 'Content', status: 'Pending', dueDate: '2026-10-15' },
    ], today);
    assert.equal(cells.reduce((sum, cell) => sum + cell.delivered, 0), 1);
    assert.equal(cells.reduce((sum, cell) => sum + cell.generated, 0), 3);
    assert.equal(cells.every(cell => cell.promisedConfigured === false), true);
    assert.equal(formatPromisedTotal(cells), '—');
    assert.notEqual(formatPromisedTotal(cells), '0');
    assert.equal(formatPromisedTotal(null), '—');
    assert.equal(fulfillmentCellLabel(cells[0]), `${cells[0].delivered}/—`);
});

test('a configured promise of zero stays zero, and linked issues still count', () => {
    const none = buildFulfillmentCells([
        { id: 'cm', clientId: 'a', type: 'Content', expected: 0 },
    ], [], today);
    assert.equal(none[0].promisedConfigured, true);
    assert.equal(formatPromisedTotal(none), '0');

    const issued = buildFulfillmentCells([
        { id: 'cm', clientId: 'a', type: 'Content', expected: 2 },
    ], [
        { clientId: 'a', type: 'Content', status: 'Published', commitmentId: 'cm', dueDate: '2026-10-04' },
        { clientId: 'b', type: 'Content', status: 'Published', dueDate: '2026-10-04' },
    ], today);
    assert.equal(formatPromisedTotal(issued), '2');
    const unconfigured = issued.find(cell => cell.clientId === 'b');
    assert.equal(unconfigured?.promisedConfigured, false);
    assert.equal(fulfillmentCellLabel(unconfigured!), '1/—');
});

test('the matrix shows delivered work without inventing a promise', () => {
    const html = renderToStaticMarkup(createElement(FulfillmentMatrix, {
        clients: [{ id: 'north', name: 'Northside Plumbing Co.' }],
        cells: [{
            clientId: 'north',
            type: 'Content',
            promised: 0,
            promisedConfigured: false,
            generated: 2,
            delivered: 1,
            inProgress: 1,
            overdue: 0,
        }],
        daysLeftInMonth: 18,
        onCellClick: () => undefined,
    }));
    assert.match(html, /Northside Plumbing Co\./);
    assert.match(html, /1\/—/);
    assert.equal(html.includes('1/2'), false);
    assert.match(html, /No promise configured for this month/);
});
