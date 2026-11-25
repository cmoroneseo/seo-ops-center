import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import React, { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Bell, ChevronLeft, MoreHorizontal, Search } from 'lucide-react';
import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import type { ReviewVersion, StaffReviewData, StaffReviewItem } from '@/components/approvals-v2/StaffReviewTypes';
import type { GbpPostPayload } from '@/lib/gbp-approvals/registry';
import type { PagePayload } from '@/lib/approvals-v2/registry';

Object.assign(globalThis, { React });
const require = createRequire(import.meta.url);
require.extensions['.css'] = () => {};
const { PublicReview } = require('@/components/gbp-approvals/PublicReview') as typeof import('@/components/gbp-approvals/PublicReview');
const { StaffReviewView } = require('@/components/approvals-v2/StaffReviewView') as typeof import('@/components/approvals-v2/StaffReviewView');

const posts = [
  {
    title: 'Holiday Party Catering', date: '01', photos: ['p1a.jpg', 'p1b.jpg'],
    body: "Hosting a holiday party this December? Let Swing Inn Cafe cater it. We'll handle the Texas-style smoked meats, sides and pies, so you can spend the party with your guests instead of in the kitchen. Send us your date and headcount on our catering page or call (951) 676-2321.",
  },
  {
    title: 'Kids Eat Free', date: '04', photos: ['p2a.jpg', 'p2b.jpg', 'p2c.jpg'],
    body: 'Wednesdays and Thursdays, kids eat free at Swing Inn Cafe with the purchase of an adult entree — one free kids meal with each adult entree. Bring the whole family to Old Town Temecula, skip the cooking, and let us handle dinner. See the menu or call (951) 676-2321.',
  },
  {
    title: 'Texas-Style BBQ', date: '08', photos: ['p3a.jpg', 'p3b.jpg'],
    body: 'Brisket, pork spare ribs, pork belly burnt ends and smoked turkey, all smoked on location in Old Town Temecula. Grab a BBQ platter with Texas toast and your pick of sides, or order smoked meats and sides to take home. Lunch daily, dinner Wednesday through Sunday.',
  },
  {
    title: 'Come By Swing Inn', date: '11', photos: ['p4a.jpg', 'p4b.jpg', 'p4c.jpg'],
    body: "Come by Swing Inn Cafe in Old Town Temecula. Start the day with breakfast, or come in for Texas-style BBQ smoked on location. Good food and a table with your people, plus a dog-friendly patio when the weather's nice. See the menu or call (951) 676-2321.",
  },
  {
    title: 'Pie and Cinnamon Buns', date: '15', photos: ['p5a.jpg', 'p5b.jpg', 'p5c.jpg'],
    body: "Save room for pie. We serve it by the slice in apple, cherry, strawberry rhubarb, Reese's cream, chocolate cream and coconut cream, plus giant cinnamon buns baked fresh daily. A sweet stop on your next December stroll through Old Town Temecula.",
  },
  {
    title: '$25 Large Brisket Platter', date: '18', photos: ['p6a.jpg', 'p6b.jpg', 'p6c.jpg'],
    body: 'Wednesdays and Thursdays, the large brisket platter is $25 at Swing Inn Cafe, with your choice of one side. Texas-style brisket, smoked on location in Old Town Temecula and served with Texas toast. See the menu or call (951) 676-2321 to grab a platter.',
  },
  {
    title: 'Holiday Hours', date: '22', photos: ['p7a.jpg', 'p7b.jpg'],
    body: "Holiday hours at Swing Inn Cafe: Christmas Eve (Dec 24): Unknown – confirm. Christmas Day (Dec 25): Closed. New Year's Eve (Dec 31): Unknown – confirm. New Year's Day (Jan 1): Unknown – confirm. Questions? Call (951) 676-2321. Happy holidays from Old Town Temecula!",
  },
  {
    title: 'Breakfast for the New Year', date: '29', photos: ['p8a.jpg', 'p8b.jpg', 'p8c.jpg'],
    body: "Start the new year with breakfast in Old Town Temecula. Buttermilk pancakes, Belgian waffles, French toast, eggs Benedict-style bennies and breakfast burritos, served every day. Bring the whole crew, and grab a table on our dog-friendly patio if the weather's nice.",
  },
];
const sampleAssets = resolve('public/dev/gbp-approvals');
const referenceAssets = '/workspace/approvals-redesign/premium/assets';
const fontPath = '/usr/share/fonts/truetype/sand-box/google/Plus Jakarta Sans/PlusJakartaSans-VariableFont_wght.ttf';
const fallbackPhotos = ['post1.jpg', 'post2.jpg', 'post3.jpg', 'post4.jpg', 'post6.jpg', 'post7.jpg', 'stand-in.webp'];

function item(index: number, payload: ReviewVersion['payload'], paths: string[] = []): StaffReviewItem {
  const id = `item-${index + 1}`;
  const version: ReviewVersion = {
    id: `${id}-v2`, item_id: id, version_no: 2, payload, photo_path: paths[0] ?? null, photo_paths: paths,
    change_note: null, created_at: '2026-11-24T16:00:00Z',
  };
  return {
    id, position: index + 1, item_type: 'pageKind' in payload ? 'page' : 'gbp_post',
    page_kind: 'pageKind' in payload ? payload.pageKind : null, status: 'pending',
    current_version_id: version.id, released_version_id: null, decision_lock_reason: null,
    version, releasedVersion: null, response: null, staffReview: null,
  };
}

function reviewed(items: StaffReviewItem[], done: boolean): StaffReviewItem[] {
  return items.map((entry, index) => {
    if (!done && index > 3) return entry;
    const changes = index === 3;
    return { ...entry, staffReview: {
      decision: changes ? 'changes_requested' : 'approved',
      note: changes ? 'Please lead with breakfast and keep the patio mention at the end.' : null,
      tags: changes ? ['copy'] : [], reviewer_id: 'staff-fixture', reviewer_name: 'Fixture reviewer',
      created_at: '2026-11-24T19:00:00Z', version_id: entry.current_version_id!,
    } };
  });
}

function request(items: StaffReviewItem[], title: string, photos: StaffReviewData['photos']): StaffReviewData {
  return {
    request: {
      id: 'fixture', title, item_type: items[0].item_type, stage: 'draft', archived_at: null, due_at: null,
      created_at: '2026-11-16T16:00:00Z', created_via: 'bot', clients: { name: items[0].item_type === 'gbp_post' ? 'Swing Inn Cafe' : 'ALL-IN-1 Construction', domain: 'example.com' },
    },
    items, versions: items.flatMap(entry => entry.version ? [entry.version] : []), questions: [], events: [],
    photos, link: null, owner: null, botName: 'content-writer', canSend: true, canWrite: true,
    sendReason: null, actorId: 'staff-fixture',
  };
}

async function render() {
  const arg = process.argv[2];
  if (!arg) throw new Error('Usage: npx tsx scripts/render-approvals-option-b-fixture.ts <output-directory> [reference-assets-directory]');
  const output = resolve(arg);
  const photos: StaffReviewData['photos'] = {};
  await mkdir(resolve(output, 'assets'), { recursive: true });
  const assets = process.argv[3] ? resolve(process.argv[3]) : referenceAssets;
  const haveReference = Boolean(process.argv[3]) || await access(assets).then(() => true, () => false);

  async function copyAsset(directory: string, file: string, name = file) {
    const path = `assets/${name}`;
    await copyFile(resolve(directory, file), resolve(output, path));
    photos[path] = path;
    return path;
  }

  const [gbpItems, videoPath, posterPath, copiedFont] = await Promise.all([
    Promise.all(posts.map(async ({ title, date, body, photos: files }, index) => {
      const paths = await Promise.all(files.map((file, photoIndex) => {
        const fallback = fallbackPhotos[(index + photoIndex) % fallbackPhotos.length];
        return haveReference ? copyAsset(assets, file) : copyAsset(sampleAssets, fallback, file.replace(/\.jpg$/, fallback.endsWith('.webp') ? '.webp' : '.jpg'));
      }));
      return item(index, {
        schemaVersion: 1, postType: 'update', title, scheduledDate: `2026-12-${date}`, offerStart: null, offerEnd: null,
        body, terms: '', ctaLabel: 'Learn more', ctaUrl: 'https://example.com/menu',
      }, paths);
    })),
    copyAsset(sampleAssets, 'sample.mp4'),
    copyAsset(sampleAssets, 'sample-poster.jpg'),
    access(fontPath).then(async () => {
      await copyFile(fontPath, resolve(output, 'assets/plus-jakarta-sans.ttf'));
      return true;
    }, () => false),
  ]);
  const galleryVersion = gbpItems[5].version!;
  const videoItem = item(7, gbpItems[7].version!.payload);
  videoItem.version!.video_path = videoPath;
  videoItem.version!.video_poster_path = posterPath;
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
  const gbpTitle = 'December GBP posts: weekly updates';
  const gbp = request(gbpItems, gbpTitle, photos);
  const progress = request(reviewed(gbpItems, false), gbpTitle, photos);
  const done = request(reviewed(gbpItems, true), gbpTitle, photos);
  const video = request([...gbpItems.slice(0, -1), videoItem], gbpTitle, photos);
  const landing = request([item(0, page)], 'Electrical services landing page', {});
  const compiled = await postcss([tailwind()]).process(
    '@import "tailwindcss" source(none); @source "./components/approvals-v2"; @source "./components/gbp-approvals"; @source "./components/ui"; @source "./scripts/render-approvals-option-b-fixture.ts";',
    { from: resolve('approvals-option-b-fixture.css') },
  );
  const [cardCss, publicCss, pageCss, staffCss] = await Promise.all([
    'gbp-approvals/gbp-post-preview.css', 'gbp-approvals/public-review.css',
    'approvals-v2/page-review.css', 'approvals-v2/staff-review.css',
  ].map(path => readFile(resolve('components', path), 'utf8')));
  const font = copiedFont ? '@font-face {font-family: "Plus Jakarta Sans"; src: url("assets/plus-jakarta-sans.ttf") format("truetype"); font-weight: 200 800; font-display: block}' : '';
  const fixtureCss = '@media (max-width: 760px) { .ar-fixture .ar-header-actions:has(> .ar-menu) { display: none; } }';
  const css = [compiled.css, font, cardCss, pageCss, staffCss, fixtureCss].join('\n');
  const formats = [
    { name: 'desktop', data: gbp, selected: 'item-8', screen: 'list' },
    { name: 'desktop-progress', data: progress, selected: 'item-8', screen: 'list' },
    { name: 'desktop-done', data: done, selected: undefined, screen: 'list' },
    { name: 'desktop-video', data: video, selected: 'item-8', screen: 'list' },
    { name: 'mobile-list', data: gbp, selected: 'item-8', screen: 'list' },
    { name: 'mobile-detail', data: gbp, selected: 'item-8', screen: 'detail' },
    { name: 'mobile-gallery', data: gbp, selected: 'item-6', screen: 'detail' },
    { name: 'page-item', data: landing, selected: 'item-1', screen: 'detail' },
  ] as const;
  for (const { name, data, selected, screen } of formats) {
    const markup = renderToStaticMarkup(h('div', { className: 'ar-fixture ar-shell flex h-dvh min-w-0 flex-col overflow-hidden' },
      h('header', { className: 'ar-shell-header' },
        h('a', { className: 'ar-shell-back', href: '#items' }, h(ChevronLeft, { size: 20, 'aria-hidden': true }), 'Approvals'),
        h('button', { className: 'ar-shell-search' }, h(Search, { size: 16, 'aria-hidden': true }), 'Search or jump to…', h('kbd', null, '⌘K')),
        h('div', { className: 'ar-shell-user-actions ml-auto flex items-center gap-1' },
          h('div', { id: 'ar-mobile-top-more' },
            h('div', { className: 'ar-menu' }, h('button', { className: 'ar-icon-ghost', 'aria-label': 'Request actions', 'aria-haspopup': 'menu', 'aria-expanded': false }, h(MoreHorizontal, { size: 20, 'aria-hidden': true })))),
          h('div', { className: 'relative' },
            h('button', { className: 'relative inline-flex items-center', title: 'Notifications', 'aria-label': 'Notifications, 6 unread' }, h(Bell, { size: 18, 'aria-hidden': true }),
              h('span', { className: 'absolute flex items-center justify-center rounded-full px-1 text-[10px] font-bold text-white', 'aria-hidden': true }, '6'))),
          h('div', null, h('button', { className: 'inline-flex items-center', title: 'Account', 'aria-label': 'Carlos Morones' },
            h('span', { className: 'grid place-items-center rounded-full font-bold' }, 'CM'))))),
      h('main', { id: 'items', className: 'ar-shell-scroll min-h-0 flex-1 overflow-y-auto', 'data-approval-scroll': '' },
        h(StaffReviewView, { data, initialSelection: selected, initialMobileScreen: screen, saveReview: async () => {} })),
    ));
    // Static markup cannot read dimensions on image load. Reference photos are scaled copies of the originals.
    const withPhotoDimensions = haveReference && selected === 'item-8' && name !== 'desktop-video'
      ? markup.replace(/(<div class="ar-media-fact"><span class="ar-positive"><svg.*?<\/svg>)Included/, (_, prefix: string) => `${prefix}1600 × 2400 · 3 photos`)
      : markup;
    await writeFixture(output, name, withPhotoDimensions, css);
  }

  const clientMarkup = renderToStaticMarkup(h(PublicReview, {
    mode: 'review',
    clientName: gbp.request.clients?.name,
    token: 'fixture',
    posts: [{
      ...(galleryVersion.payload as GbpPostPayload),
      itemId: galleryVersion.item_id, versionId: galleryVersion.id,
      position: 1, scheduled: (galleryVersion.payload as GbpPostPayload).scheduledDate, photo: galleryVersion.photo_path,
      photoSrcs: galleryVersion.photo_paths, status: 'pending',
    }],
  }));
  await writeFixture(output, 'client', clientMarkup, [compiled.css, font, publicCss, cardCss].join('\n'));
  console.log(output);
}

function writeFixture(output: string, name: string, markup: string, css: string) {
  return writeFile(resolve(output, `${name}.html`), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' file: data:; font-src 'self' file:; media-src 'self' file:">
<title>Approvals Premium fixture</title>
<style>${css}
:root { --font-plus-jakarta: "Plus Jakarta Sans"; }
body { font-family: "Plus Jakarta Sans", system-ui, sans-serif; }
</style>
</head>
<body>${markup}</body>
</html>
`);
}

void render();
