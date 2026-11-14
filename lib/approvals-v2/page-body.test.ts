import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { normalizePageBody, parsePagePayload } from './page-body.ts';
import { markdownDoc, nodeText, sanitizeDoc } from './page-doc.ts';
import { canonicalJson, pageType, pagePayloadSchema } from './registry.ts';
import { parseBotApproval } from '../bots/approvals.ts';
const pageFixture = {
  schemaVersion: 1,
  pageKind: 'blog',
  title: 'Kitchen guide',
  metaTitle: 'Kitchen remodeling guide',
  metaDescription: 'Plan your remodel.',
  slug: 'kitchen-guide',
  plannedDate: '2026-11-30',
  mockupAlt: 'Kitchen mockup',
  targetKeyword: 'kitchens',
  body: {
    type: 'doc',
    content: [{
      type: 'heading',
      attrs: {
        level: 2
      },
      content: [{
        type: 'text',
        text: 'Start here'
      }]
    }, {
      type: 'paragraph',
      content: [{
        type: 'text',
        text: 'Hello world.'
      }]
    }]
  }
};
test('page sanitizer drops active nodes, event/style attrs, unsafe URLs and unknown marks', () => {
  const body = sanitizeDoc({
    type: 'doc',
    attrs: {
      onclick: 'evil()'
    },
    content: [...['script', 'iframe', 'style', 'rawHtml'].map(type => ({
      type,
      content: [{
        type: 'text',
        text: 'evil'
      }]
    })), {
      type: 'unknown',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'Keep me'
        }]
      }]
    }, {
      type: 'heading',
      attrs: {
        level: 9,
        onload: 'evil',
        style: 'color:red'
      },
      content: [{
        type: 'text',
        text: 'Heading',
        marks: [{
          type: 'bold'
        }, {
          type: 'italic'
        }, {
          type: 'code'
        }, {
          type: 'evil'
        }, {
          type: 'link',
          attrs: {
            href: 'javascript:alert(1)'
          }
        }]
      }]
    }, ...['javascript:alert(1)', 'data:image/png,xx', 'http://example.com/a.png', '//example.com/x', 'https://example.com/\nonload=x'].map(src => ({
      type: 'image',
      attrs: {
        src
      }
    })), {
      type: 'image',
      attrs: {
        src: 'https://example.com/good.png',
        alt: 'Alt',
        onerror: 'evil'
      }
    }, ...['https://example.com', 'http://example.com', 'mailto:test@example.com', 'data:text/html,hi', 'java\nscript:hi'].map(href => ({
      type: 'paragraph',
      content: [{
        type: 'text',
        text: 'Link',
        marks: [{
          type: 'link',
          attrs: {
            href,
            target: 'evil',
            rel: 'opener'
          }
        }]
      }]
    }))]
  });
  const serialized = JSON.stringify(body);
  for (const value of ['evil', 'onload', 'onerror', 'onclick', 'style', 'javascript', 'data:']) assert.equal(serialized.includes(value), false, value);
  assert.equal(body.content[1].attrs?.level, 4);
  assert.deepEqual(body.content[1].content?.[0].marks, [{
    type: 'bold'
  }, {
    type: 'italic'
  }, {
    type: 'code'
  }]);
  assert.equal(body.content.filter(node => node.type === 'image').length, 1);
  for (const node of body.content.slice(3, 6)) assert.equal(node.content?.[0].marks?.[0].attrs?.rel, 'noopener noreferrer nofollow');
  assert.match(nodeText(body), /Keep me/);
});
test('Markdown converts headings, marks, lists, quotes, rules, tables and images without interpreting HTML', () => {
  const doc = markdownDoc('## Guide\n\nA **bold** *italic* `code` [link](https://example.com).\n\n- First\n- Second\n\n1. One\n2. Two\n\n> Quote\n\n---\n\n| A | B |\n| --- | --- |\n| C | D |\n\n![Kitchen](https://example.com/kitchen.png)\n\n<script>alert(1)</script><iframe>hidden</iframe>');
  assert.deepEqual(doc.content?.map(node => node.type), ['heading', 'paragraph', 'bulletList', 'orderedList', 'blockquote', 'horizontalRule', 'table', 'image']);
  assert.equal(JSON.stringify(doc).includes('alert(1)'), false);
  assert.equal(parsePagePayload({
    ...pageFixture,
    body: {
      format: 'markdown',
      text: '## Guide'
    }
  }).ok, true);
  assert.equal(parsePagePayload({
    ...pageFixture,
    body: {
      format: 'prosemirror',
      doc
    }
  }).ok, true);
});
test('block ids survive text edits and reordering; duplicate pasted identities are replaced', () => {
  const first = normalizePageBody(pageFixture.body);
  const edit = structuredClone(first.body);
  edit.content[1].content![0].text = 'Hello worlds.';
  edit.content.push({
    type: 'paragraph',
    content: [{
      type: 'text',
      text: 'New block'
    }]
  });
  const next = normalizePageBody(edit);
  assert.equal(next.body.content[1].attrs?.blockId, first.body.content[1].attrs?.blockId);
  assert.equal(next.body.content[0].attrs?.sectionId, first.body.content[0].attrs?.sectionId);
  assert.notEqual(next.body.content[2].attrs?.blockId, first.body.content[1].attrs?.blockId);
  assert.notEqual(first.bodyHash, next.bodyHash);
  const copied = normalizePageBody({
    type: 'doc',
    content: [first.body.content[0], first.body.content[0]]
  });
  assert.notEqual(copied.body.content[0].attrs?.blockId, copied.body.content[1].attrs?.blockId);
  assert.notEqual(copied.body.content[0].attrs?.sectionId, copied.body.content[1].attrs?.sectionId);
  assert.equal(copied.outline[1].slug, 'start-here-1');
  const reordered = normalizePageBody({
    type: 'doc',
    content: [...first.body.content].reverse()
  });
  assert.equal(reordered.body.content[0].attrs?.blockId, first.body.content[1].attrs?.blockId);
});
test('outline lengths and canonical SHA match; anchors and internal keyword do not change visible snapshot', () => {
  const normalized = normalizePageBody(pageFixture.body);
  assert.equal(normalized.outline[0].blocks[1].len, 12);
  assert.equal(normalized.bodyHash, createHash('sha256').update(canonicalJson(normalized.body)).digest('hex'));
  const original = pagePayloadSchema.parse({
    ...pageFixture,
    body: normalized.body
  });
  const changed = structuredClone(original);
  changed.targetKeyword = 'internal update';
  const attrs = (changed.body.content[0] as {
    attrs: Record<string, string>;
  }).attrs;
  attrs.blockId = 'different';
  attrs.sectionId = 'different-section';
  assert.deepEqual(pageType.visibleSnapshot(original, null), pageType.visibleSnapshot(changed, null));
  for (const key of ['title', 'metaTitle', 'metaDescription', 'slug', 'plannedDate', 'mockupAlt', 'pageKind'] as const) {
    const value = key === 'pageKind' ? 'city' : key === 'plannedDate' ? '2026-12-01' : 'changed';
    assert.notDeepEqual(pageType.visibleSnapshot(original, null), pageType.visibleSnapshot({
      ...original,
      [key]: value
    }, null), key);
  }
  assert.notDeepEqual(pageType.visibleSnapshot(original, null), pageType.visibleSnapshot(original, 'https://example.com/mockup.png'));
});
test('page input caps body depth and payload size', () => {
  let nested: unknown = {
    type: 'text',
    text: 'Hello'
  };
  for (let i = 0; i < 40; i++) nested = {
    type: 'blockquote',
    content: [nested]
  };
  assert.throws(() => sanitizeDoc({
    type: 'doc',
    content: [nested]
  }), /deeply nested/);
  assert.equal(parsePagePayload({
    ...pageFixture,
    title: 'x'.repeat(1048577)
  }).ok, false);
});
test('bot page normalization accepts mixed kinds and has deterministic retries without changing GBP hash rules', () => {
  const command = {
    itemType: 'page',
    idempotencyKey: 'page-create-001',
    clientName: 'Client',
    taskTitle: 'Task',
    title: 'Pages',
    items: [{
      position: 1,
      payload: pageFixture,
      mockupUrl: 'https://example.com/mockup.png'
    }, {
      position: 2,
      payload: {
        ...pageFixture,
        pageKind: 'city'
      }
    }]
  };
  const parsed = parseBotApproval(command);
  const retry = parseBotApproval(command);
  assert.ok(parsed.ok && retry.ok);
  assert.equal(parsed.command.itemType, 'page');
  assert.equal(parsed.command.items[0].photoPath, 'https://example.com/mockup.png');
  assert.equal(parsed.command.requestHash, retry.command.requestHash);
  assert.equal(parseBotApproval({
    ...command,
    items: [{
      position: 1,
      payload: {
        postType: 'update'
      }
    }]
  }).ok, false);
});
test('TipTap schema preserves saved block and section attrs on editor transactions', async () => {
  const {
    getSchema
  } = await import('@tiptap/core');
  const {
    default: StarterKit
  } = await import('@tiptap/starter-kit');
  const {
    default: Image
  } = await import('@tiptap/extension-image');
  const {
    TableKit
  } = await import('@tiptap/extension-table');
  const {
    AnchorAttrs
  } = await import('./anchor-attrs');
  const schema = getSchema([StarterKit, Image, TableKit, AnchorAttrs]);
  const normalized = normalizePageBody(pageFixture.body);
  const doc = schema.nodeFromJSON(normalized.body);
  const {
    EditorState
  } = await import('@tiptap/pm/state');
  const state = EditorState.create({
    schema,
    doc
  });
  const changed = state.apply(state.tr.insertText('New ', 1)).doc.toJSON();
  assert.equal(changed.content[0].attrs.blockId, normalized.body.content[0].attrs?.blockId);
  assert.equal(changed.content[0].attrs.sectionId, normalized.body.content[0].attrs?.sectionId);
  assert.equal(changed.content[1].attrs.blockId, normalized.body.content[1].attrs?.blockId);
});
