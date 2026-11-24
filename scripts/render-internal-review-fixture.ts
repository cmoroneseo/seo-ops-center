import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import { InternalReview } from '@/components/internal-review/InternalReview';
import type { InternalReviewView } from '@/lib/internal-review/model';

const fixture: InternalReviewView = {
    clientName: 'Oak Street Renovations',
    batches: [{
        title: 'December Google posts',
        posts: [
            {
                itemId: 'sample-post-one',
                versionId: 'sample-version-one',
                position: 1,
                title: 'Plan your kitchen update before the new year',
                body: 'A better kitchen starts with a plan. Walk through layout, storage and finishes with our team, and get a clear picture of what it takes to bring your ideas to life.',
                postType: 'offer',
                scheduledDate: '2026-12-01',
                offerStart: '2026-12-01',
                offerEnd: '2026-12-29',
                terms: 'Complimentary consultation for projects within our service area. Booking required.',
                ctaUrl: 'https://example.com/consultation?utm_source=google&utm_medium=organic',
                ctaLabel: 'Book a consultation',
                photoSrc: '../public/dev/gbp-approvals/post1.jpg',
                feedback: [{ reviewerName: 'Jordan Lee', decision: 'changes_requested', comment: 'Please mention that evening appointments are available.' }],
            },
            {
                itemId: 'sample-post-two',
                versionId: 'sample-version-two',
                position: 2,
                title: 'Make room for holiday guests',
                body: 'From a refreshed guest bath to extra storage by the front door, small upgrades can make hosting easier this season.',
                postType: 'update',
                scheduledDate: '2026-12-15',
                offerStart: null,
                offerEnd: null,
                terms: '',
                ctaUrl: 'https://example.com/projects?utm_source=google',
                ctaLabel: 'Explore recent projects',
                // The stored photo_path is already an HTTPS URL, so the view uses it directly.
                photoSrc: 'https://drive.google.com/thumbnail?id=fixture-thumbnail',
                feedback: [],
            },
        ],
    }],
};

async function render() {
    const html = renderToStaticMarkup(createElement(InternalReview, { view: fixture }));
    const styles = await postcss([tailwind()]).process(
        '@import "tailwindcss" source(none); @source "./components/internal-review/InternalReview.tsx";',
        { from: resolve('internal-review-fixture.css') },
    );
    const output = '.next-internal-review-fixture/index.html';
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="img-src 'self' file:">
<title>Internal review fixture</title>
<style>${styles.css}</style>
</head>
<body>${html}</body>
</html>
`);
    console.log(output);
}

void render();
