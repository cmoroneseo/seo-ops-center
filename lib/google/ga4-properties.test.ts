import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ga4PropertyOptions } from '../../components/workspace/GooglePropertyPicker.tsx';
import { PropertySearchInput } from '../../components/workspace/PropertySearchInput.tsx';
import { filterGa4Properties, ga4SearchEmptyMessage, type Ga4PropertySummary } from './ga4-properties.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const properties: Ga4PropertySummary[] = [
    { id: 'properties/367930949', displayName: 'AccuPay, Inc - GA4', account: 'AccuPay, Inc' },
    { id: 'properties/379618386', displayName: 'accupaysystems.com', account: 'AccuPay, Inc' },
    { id: 'properties/384233495', displayName: 'http://www.topnotch-auto.com - GA4', account: 'Top-Notch Auto' },
];

function renderOptions(query: string, selected = '') {
    return renderToStaticMarkup(createElement(Ga4PropertyOptions, {
        properties,
        selected,
        query,
        onQueryChange: () => undefined,
        onSelect: () => undefined,
    }));
}

test('search matches display name, account name, and property id without reordering', () => {
    assert.deepEqual(filterGa4Properties(properties, '').map(property => property.id), properties.map(property => property.id));
    assert.deepEqual(filterGa4Properties(properties, '   ').map(property => property.id), properties.map(property => property.id));
    assert.deepEqual(filterGa4Properties(properties, 'GA4').map(property => property.displayName), [
        'AccuPay, Inc - GA4',
        'http://www.topnotch-auto.com - GA4',
    ]);
    assert.deepEqual(filterGa4Properties(properties, 'top-notch').map(property => property.id), ['properties/384233495']);
    assert.deepEqual(filterGa4Properties(properties, '379618386').map(property => property.displayName), ['accupaysystems.com']);
    assert.deepEqual(filterGa4Properties(properties, 'properties/367930949').map(property => property.account), ['AccuPay, Inc']);
    assert.deepEqual(filterGa4Properties(properties, 'ID: 384233495').map(property => property.account), ['Top-Notch Auto']);
    assert.deepEqual(filterGa4Properties(properties, 'id'), []);
    assert.deepEqual(filterGa4Properties(properties, 'inc\nproperties'), []);
    assert.deepEqual(filterGa4Properties(properties, 'zzzz'), []);
    assert.deepEqual(filterGa4Properties(properties, 'ga4)'), []);
    const snapshot = properties.map(property => ({ ...property }));
    filterGa4Properties(properties, 'accupay');
    assert.deepEqual(properties, snapshot);
});

test('the GA4 picker reuses the Search Console search field and announces an empty query', () => {
    const field = renderToStaticMarkup(createElement(PropertySearchInput, {
        value: '',
        onChange: () => undefined,
        placeholder: 'Search by domain or URL…',
    }));
    assert.match(field, /aria-label="Search properties"/);
    assert.match(field, /placeholder="Search by domain or URL…"/);
    assert.equal(field.includes('autofocus'), false);

    const html = renderOptions('zzzz', 'properties/367930949');
    assert.match(html, /aria-label="Search properties"/);
    assert.match(html, /placeholder="Search by name, account, or ID…"/);
    assert.match(html, /autofocus/);
    assert.equal(html.includes('AccuPay, Inc - GA4'), false);
    assert.match(html, /No properties match (?:&quot;|")zzzz(?:&quot;|")/);
    assert.equal(ga4SearchEmptyMessage('  zzzz  '), 'No properties match "zzzz"');
    assert.equal(html.includes('>1<'), false);
    assert.equal(html.includes('>2<'), false);
});

test('filtering keeps the selected card marked and shows the account name', () => {
    const filtered = renderOptions('accupay', 'properties/367930949');
    const rows = filtered.split('<button').slice(1);
    assert.equal(rows.length, 2);
    assert.match(rows[0], /bg-primary\/10/);
    assert.match(rows[0], /type="button"/);
    assert.match(rows[0], /aria-pressed="true"/);
    assert.match(rows[0], /AccuPay, Inc - GA4/);
    assert.match(rows[0], /AccuPay, Inc · ID: 367930949/);
    assert.equal(rows[1].includes('bg-primary/10'), false);
    assert.equal(rows[1].includes('379618386'), true);
    assert.equal(filtered.includes('384233495'), false);
    assert.equal(filtered.includes('No properties match'), false);

    const restored = renderOptions('', 'properties/367930949');
    assert.match(restored, /bg-primary\/10[\s\S]*AccuPay, Inc - GA4/);
    assert.match(restored, /Top-Notch Auto · ID: 384233495/);
    assert.equal(restored.includes('No properties match'), false);
    assert.equal((restored.match(/type="button"/g) || []).length, 3);
});
