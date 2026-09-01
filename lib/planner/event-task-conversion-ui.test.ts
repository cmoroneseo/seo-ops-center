import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EventConversionFields } from '../../components/tasks/EventConversionFields.tsx';

test('event conversion renders client search and the original-time controls', () => {
    // Catches opening the generic modal without any way to attach the event to a client.
    const html = renderToStaticMarkup(React.createElement(EventConversionFields, {
        clients: [
            { id: 'client-1', clientName: 'Ecoworkz' },
            { id: 'client-2', clientName: 'Titan Tent' },
        ],
        clientSearch: '',
        selectedClientId: '',
        durationMinutes: 180,
        logEventTime: true,
        countsTowardBudget: true,
        syncTimeToBasecamp: true,
        onClientSearchChange() {},
        onLogEventTimeChange() {},
        onCountsTowardBudgetChange() {},
        onSyncTimeToBasecampChange() {},
    }));

    assert.match(html, /Search or select a client/);
    assert.match(html, /Ecoworkz/);
    assert.match(html, /Log original event time/);
    assert.match(html, /180 min/);
    assert.match(html, /Count toward client SEO budget/);
    assert.match(html, /Send time to Basecamp timesheet/);
});
