import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import React, { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Bell, ChevronLeft, Search } from 'lucide-react';
import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import type { ReviewVersion, StaffReviewData, StaffReviewItem } from '@/components/approvals-v2/StaffReviewTypes';
import type { GbpPostPayload } from '@/lib/gbp-approvals/registry';
import type { PagePayload } from '@/lib/approvals-v2/registry';

Object.assign(globalThis, { React });
const require = createRequire(import.meta.url);
require.extensions['.css'] = () => {};
const { StaffReviewView } = require('@/components/approvals-v2/StaffReviewView') as typeof import('@/components/approvals-v2/StaffReviewView');

const titles = [
  'Free In-Home Walkthrough + Written Quote in 48 Hours',
  'Free Kitchen Walkthrough + Written Quote in 48 Hours',
  'Free ADU or Addition Walkthrough + 48-Hour Quote',
  'Free Electrical Walkthrough + 48-Hour Written Quote',
  'Free Remodel Walkthrough + 48-Hour Written Quote',
  'Free Patio and Deck Walkthrough + 48-Hour Quote',
  'Last Week for a Free Walkthrough: Ends Dec 31',
];
const dates = ['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28'];
const electricalCopy = "Holiday lights, space heaters, a house full of guests. That's a real test for your electrical. If breakers keep tripping, you're short on outlets, or one room never has enough light, start with a walkthrough. Here's what we handle: electrical panel upgrades and installations, whole-house rewiring, new circuits, recessed lighting, and EV charger installation. We'll walk the house with you, hear what you need, and give you our recommendations. A written quote follows within 48 hours. Free in-home walkthrough plus a written quote in 48 hours, through Dec 31. Tap below to request your free walkthrough. Larger or more complex projects may need extra time for an accurate quote.";

function item(index: number, payload: ReviewVersion['payload'], photoPath: string | null): StaffReviewItem {
  const id = `item-${index + 1}`;
  const version: ReviewVersion = {
    id: `${id}-v1`, item_id: id, version_no: 1, payload, photo_path: photoPath,
    change_note: null, created_at: '2026-11-16T16:00:00Z',
  };
  return {
    id, position: index + 1, item_type: 'pageKind' in payload ? 'page' : 'gbp_post',
    page_kind: 'pageKind' in payload ? payload.pageKind : null, status: 'pending',
    current_version_id: version.id, released_version_id: null, decision_lock_reason: null,
    version, releasedVersion: null, response: null,
    staffReview: index < 3 && !('pageKind' in payload) ? {
      decision: index === 2 ? 'changes_requested' : 'approved',
      note: index === 2 ? 'Please clarify which kinds of additions qualify for the walkthrough.' : null,
      tags: index === 2 ? ['copy'] : [], reviewer_id: 'staff-fixture', reviewer_name: 'Fixture reviewer',
      created_at: '2026-11-24T19:00:00Z', version_id: version.id,
    } : null,
  };
}

function request(items: StaffReviewItem[], title: string, photos: StaffReviewData['photos']): StaffReviewData {
  return {
    request: {
      id: 'fixture', title, item_type: items[0].item_type, stage: 'draft', archived_at: null, due_at: null,
      created_at: '2026-11-16T16:00:00Z', created_via: 'bot', clients: { name: 'ALL-IN-1 Construction', domain: 'example.com' },
    },
    items, versions: items.flatMap(entry => entry.version ? [entry.version] : []), questions: [], events: [],
    photos, link: null, owner: null, botName: 'content-writer', canSend: true, canWrite: true,
    sendReason: null, actorId: 'staff-fixture',
  };
}

async function render() {
  const arg = process.argv[2];
  if (!arg) throw new Error('Usage: npx tsx scripts/render-approvals-option-b-fixture.ts <output-directory>');
  const output = resolve(arg);
  const photos: StaffReviewData['photos'] = {};
  await mkdir(resolve(output, 'assets'), { recursive: true });
  const gbpItems = await Promise.all(titles.map(async (title, index) => {
    const position = index + 1;
    const file = `post${position}.jpg`;
    const source = resolve('public/dev/gbp-approvals', file);
    let path = null;
    if (position !== 5 && await access(source).then(() => true, () => false)) {
      await copyFile(source, resolve(output, 'assets', file));
      path = `assets/${file}`;
      photos[path] = path;
    }
    const isUpdate = position === 7;
    const payload: GbpPostPayload = {
      schemaVersion: 1, postType: isUpdate ? 'update' : 'offer', title, scheduledDate: dates[index],
      offerStart: isUpdate ? null : dates[index], offerEnd: isUpdate ? null : '2026-12-31',
      body: position === 4 ? electricalCopy : 'Plan your next home project with our team. We’ll talk through what you need and follow up with a written quote.',
      terms: isUpdate ? '' : 'Complimentary walkthrough for projects in our service area.',
      ctaLabel: position === 4 ? 'Call now' : 'Learn more', ctaUrl: 'https://example.com/contact',
    };
    return item(index, payload, path);
  }));
  const galleryVersion = gbpItems[5].version!;
  const galleryPhotos = [galleryVersion.photo_path, gbpItems[0].version?.photo_path, gbpItems[1].version?.photo_path];
  if (galleryPhotos.some(path => !path)) throw new Error('The GBP gallery fixture needs post6.jpg, post1.jpg, and post2.jpg.');
  galleryVersion.photo_paths = galleryPhotos.filter((path): path is string => Boolean(path));
  const page: PagePayload = {
    schemaVersion: 1, pageKind: 'service', title: 'Electrical upgrades for Banning homes',
    slug: 'services/electrical', metaTitle: 'Electrical upgrades in Banning | ALL-IN-1', metaDescription: 'Plan panel upgrades, lighting, rewiring, and new circuits with our team.',
    plannedDate: '2026-12-07', body: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Update your home’s electrical system for the appliances and lighting you use every day.' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Panel and circuit upgrades' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'A walkthrough helps identify the circuits, outlets, and panel capacity your project needs.' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Schedule a walkthrough' }] },
    ] },
  };
  const gbp = request(gbpItems, 'GBP holiday posts: free walkthrough (Nov 16 – Dec 31)', photos);
  const landing = request([item(0, page, null)], 'Electrical services landing page', {});
  const compiled = await postcss([tailwind()]).process(
    '@import "tailwindcss" source(none); @source "./components/approvals-v2"; @source "./components/gbp-approvals"; @source "./components/ui"; @source "./scripts/render-approvals-option-b-fixture.ts";',
    { from: resolve('approvals-option-b-fixture.css') },
  );
  const css = [compiled.css, ...await Promise.all(['page-review.css', 'staff-review.css'].map(name => readFile(resolve('components/approvals-v2', name), 'utf8')))].join('\n');
  const formats = [
    { name: 'desktop', data: gbp, selected: 'item-6', screen: 'list' },
    { name: 'mobile-list', data: gbp, selected: 'item-4', screen: 'list' },
    { name: 'mobile-detail', data: gbp, selected: 'item-4', screen: 'detail' },
    { name: 'page-item', data: landing, selected: 'item-1', screen: 'detail' },
  ] as const;
  for (const { name, data, selected, screen } of formats) {
    const markup = renderToStaticMarkup(h('div', { className: 'ar-shell flex h-dvh min-w-0 flex-col overflow-hidden' },
      h('header', { className: 'ar-shell-header' },
        h('a', { className: 'ar-shell-back', href: '#items' }, h(ChevronLeft, { size: 20 }), 'Approvals'),
        h('button', { className: 'ar-button ar-shell-search !justify-start' }, h(Search, { size: 16 }), 'Search or jump to…', h('kbd', { className: 'ml-auto' }, '⌘K')),
        h('div', { className: 'ml-auto flex items-center gap-2' },
          h('button', { className: 'ar-bell relative grid size-11 place-items-center', 'aria-label': 'Notifications, 6 unread' }, h(Bell, { size: 20 }),
            h('span', { className: 'absolute right-0 top-0 rounded-full bg-[#B91C1C] px-1 text-[11px] font-bold text-white', 'aria-hidden': true }, '6')),
          h('span', { className: 'grid size-8 place-items-center rounded-full bg-[#BE0A79] text-xs font-bold text-white' }, 'CR'))),
      h('main', { id: 'items', className: 'ar-shell-scroll min-h-0 flex-1 overflow-y-auto', 'data-approval-scroll': '' },
        h(StaffReviewView, { data, initialSelection: selected, initialMobileScreen: screen, saveReview: async () => {} })),
    ));
    await writeFile(resolve(output, `${name}.html`), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' file: data:">
<title>Approvals Option B fixture</title>
<style>${css}
body {font-family: "Plus Jakarta Sans", system-ui, sans-serif}
</style>
</head>
<body>${markup}</body>
</html>
`);
  }
  console.log(output);
}

void render();
