import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';

// tsx preserves the repository's classic JSX test transform. Next uses the automatic transform.
Object.assign(globalThis, {
  React
});
import { renderToStaticMarkup } from 'react-dom/server';
import { PageBody, PagePreview } from '../../components/approvals-v2/PagePreview';
import { TypeChip } from '../../components/approvals-v2/Shared';
import { normalizePageBody } from './page-body';
import { pagePayloadSchema } from './registry';
test('rich document renders safe headings, marks, tables and images with working anchor attributes', () => {
  const doc = normalizePageBody({
    format: 'markdown',
    text: '## Start\n\n**Hello** [link](https://example.com)\n\n## Start\n\n| A | B |\n| --- | --- |\n| C | D |\n\n![Alt](https://example.com/image.png)'
  });
  const html = renderToStaticMarkup(createElement(PageBody, {
    body: doc.body
  }));
  for (const section of doc.outline) assert.ok(html.includes(`id="${section.slug}"`));
  for (const section of doc.outline) for (const block of section.blocks) assert.ok(html.includes(`data-block-id="${block.blockId}"`));
  assert.match(html, /<strong>Hello<\/strong>/);
  assert.match(html, /<table/);
  assert.match(html, /<th/);
  assert.match(html, /alt="Alt"/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
  const attack = renderToStaticMarkup(createElement(PageBody, {
    body: {
      type: 'doc',
      content: [{
        type: 'script',
        content: [{
          type: 'text',
          text: 'alert(1)'
        }]
      }, {
        type: 'paragraph',
        attrs: {
          onmouseover: 'alert(1)'
        },
        content: [{
          type: 'text',
          text: '<img src=x onerror=alert(1)>',
          marks: [{
            type: 'link',
            attrs: {
              href: 'javascript:alert(1)'
            }
          }]
        }]
      }, {
        type: 'image',
        attrs: {
          src: 'data:image/svg+xml,evil'
        }
      }]
    }
  }));
  assert.doesNotMatch(attack, /<script|<img|href="javascript|onmouseover=/);
  assert.match(attack, /&lt;img/);
});
test('client search preview is read-only and never exposes target keyword; mixed chip is Pages', () => {
  const payload = pagePayloadSchema.parse({
    schemaVersion: 1,
    pageKind: 'blog',
    title: 'Page',
    metaTitle: 'Search title',
    metaDescription: 'Description',
    slug: 'guide',
    targetKeyword: 'SECRET INTERNAL KEYWORD',
    body: {
      type: 'doc',
      content: []
    }
  });
  const html = renderToStaticMarkup(createElement(PagePreview, {
    payload,
    domain: 'example.com'
  }));
  assert.match(html, /example.com \/ guide/);
  assert.match(html, /Read-only/);
  assert.doesNotMatch(html, /SECRET|<button|<input|<textarea/);
  const chip = renderToStaticMarkup(createElement(TypeChip, {
    row: {
      itemType: 'page',
      pageKinds: ['blog', 'city']
    }
  }));
  assert.match(chip, /Pages/);
  assert.match(chip, /Blog, City page/);
});
