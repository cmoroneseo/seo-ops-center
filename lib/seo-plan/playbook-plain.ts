/**
 * Plain wording for catalog rows in the playbook drawer.
 * The stored checklist titles and template keys stay as they are.
 * Only the words a person sees in the drawer change.
 */
export interface DrawerWording {
    title: string;
    description: string;
}

export const DRAWER_WORDING: Record<string, DrawerWording> = {
    'Confirm website and CMS access': {
        title: 'Confirm access to the website editor',
        description: 'Collect the login for the website editor and hosting. Confirm pages, templates, and redirects can be edited.',
    },
    'Connect GA4 and Search Console': {
        title: 'Connect Google Analytics and Search Console',
        description: 'Connect Google Analytics and Search Console. Confirm the agency account can read traffic and search data.',
    },
    'Create the SEO roadmap and recommendations': {
        title: 'Create the search roadmap and recommendations',
        description: 'Create the search roadmap and the list of recommendations for this engagement.',
    },
    'Complete initial Google Business Profile setup': {
        title: 'Complete the first Google Business Profile setup',
        description: 'Finish the first setup of the Google Business Profile. This appears only when that profile is part of the work.',
    },
    'Connect Google Search Console': {
        title: 'Connect Google Search Console',
        description: 'Confirm the client’s site is verified in Google Search Console and add the agency account. Confirm search data is coming through.',
    },
    'Connect Google Analytics 4': {
        title: 'Connect Google Analytics',
        description: 'Get admin or editor access to Google Analytics. Confirm the tracking code fires on all pages and the nightly update shows data.',
    },
    'Verify Google Business Profile access': {
        title: 'Confirm access to the Google Business Profile',
        description: 'Ask for manager access to the client’s Google Business Profile. Confirm ownership, the main category, and that the insights are visible.',
    },
    'Add client to Ahrefs tracking': {
        title: 'Add the client to rank tracking',
        description: 'Create the rank-tracking project, set the target keywords, and run the first crawl of the site.',
    },
    'Confirm conversion events and goals': {
        title: 'Confirm conversion events and goals',
        description: 'Agree with the client on what counts as a conversion, such as calls, forms, purchases, or bookings. Confirm each one is tracked in Google Analytics.',
    },
    'Collect brand assets and guidelines': {
        title: 'Collect brand assets and guidelines',
        description: 'Gather logo files, brand colors, tone-of-voice notes, and any style guide for content and Google Business Profile posts.',
    },
    'Run full site crawl': {
        title: 'Run a full site crawl',
        description: 'Crawl the whole site with the search research tool. Save the issues report and record the health score as the starting point.',
    },
    'Fix crawl errors and broken links': {
        title: 'Fix crawl errors and broken links',
        description: 'Fix missing pages, server errors, broken links inside the site, and long redirect chains found by the crawl. Crawl again to confirm.',
    },
    'Review robots.txt and XML sitemap': {
        title: 'Review the crawl rules and the page list',
        description: 'Confirm the file that tells search engines which pages they may read is not hiding important sections. Confirm the page list includes every page that should be found, and that the list is submitted in Google Search Console.',
    },
    'Check HTTPS and redirect health': {
        title: 'Check the secure address and redirects',
        description: 'Confirm the site uses a secure address, one preferred version of the domain, and no mixed secure and insecure content.',
    },
    'Audit Core Web Vitals': {
        title: 'Check page speed and stability',
        description: 'Review loading speed, how quickly the page responds, and how much the page jumps, using Google Search Console and PageSpeed Insights. List the top fixes for slow templates.',
    },
    'Resolve duplicate content and canonicals': {
        title: 'Resolve duplicate pages',
        description: 'Find duplicate or near-duplicate pages, point them at one preferred address, and hide thin utility pages from search engines.',
    },
    'Implement baseline schema markup': {
        title: 'Add labels search engines can read',
        description: 'Add business labels across the site, plus the right labels on key templates such as services, common questions, and breadcrumbs. Check them with Google’s rich results test.',
    },
    'Build the keyword universe in Ahrefs': {
        title: 'Build the full keyword list',
        description: 'Expand the starting keywords with matching terms, questions, and related searches. Save search volume, difficulty, and what the searcher wants.',
    },
    'Identify top competitors': {
        title: 'Identify top competitors',
        description: 'Pick 3 to 5 sites that actually show up in search for the target keywords, not only business rivals.',
    },
    'Run competitor content gap analysis': {
        title: 'Find content competitors have and this site does not',
        description: 'Find keywords competitors rank for that the client does not. Shortlist the valuable gaps.',
    },
    'Run competitor backlink gap analysis': {
        title: 'Find links competitors have and this site does not',
        description: 'Compare who links to competitors. Save sites that link to two or more competitors.',
    },
    'Inventory existing content': {
        title: 'Inventory existing content',
        description: 'Export every page that can appear in search, with traffic, impressions, and the top searches. This is the working sheet for the audit. Use Google Search Console and Google Analytics.',
    },
    'Update or consolidate underperformers': {
        title: 'Update or combine weak pages',
        description: 'Refresh outdated pages, combine overlapping ones with a permanent redirect, and remove pages that no longer help. Track the changes for before-and-after reporting.',
    },
    'Improve core service page copy': {
        title: 'Improve the main service page copy',
        description: 'Rewrite the priority service pages: one clear main heading, copy about the benefit, signs people can trust, a block of common questions, and a clear next step.',
    },
    'Audit heading structure': {
        title: 'Check the heading structure',
        description: 'Confirm each page has one main heading with the target keyword, then a clear order of section headings. Do not skip levels or fake a heading with styling alone.',
    },
    'Fix image alt text and compression': {
        title: 'Fix image descriptions and file size',
        description: 'Add a description to meaningful images and shrink oversized files, using a smaller image format where the site allows it.',
    },
    'Review URL structure': {
        title: 'Review page addresses',
        description: 'Confirm page addresses are short, relevant, and lowercase. Change an address only when the gain is worth a permanent redirect.',
    },
    'Add FAQ sections to key pages': {
        title: 'Add common questions to key pages',
        description: 'Add 3 to 6 real customer questions, with short answers, on service pages, and mark them up so search engines can read them.',
    },
    'Deep-audit the top 10 landing pages': {
        title: 'Review the top 10 landing pages in detail',
        description: 'Review the 10 most important pages: does the page match what people searched, is the content deep enough, does it show experience and trust, is the next step clear, and does the page feel easy to use.',
    },
    'Audit the baseline backlink profile': {
        title: 'Review who links to the site today',
        description: 'Review the sites that link here, the words they use, and whether that authority is rising or falling. Record the starting strength score and the number of linking sites.',
    },
    'Build the citation and directory foundation': {
        title: 'Build the directory listings',
        description: 'Submit the same business name, address, and phone number to the core directories and the relevant industry and local directories. Keep a log of each listing.',
    },
    'Monitor new and lost backlinks': {
        title: 'Watch new and lost links',
        description: 'Review new and lost links each month. Try to recover valuable links that disappeared, and flag suspicious new ones.',
    },
    'Complete the GBP profile': {
        title: 'Complete the Google Business Profile',
        description: 'Fill every field on the Google Business Profile: description, services, hours, attributes, service areas, and booking links. A complete profile helps the listing rank.',
    },
    'Review GBP categories and services': {
        title: 'Review Google Business Profile categories and services',
        description: 'Set the most specific main category and add the relevant extra categories. Make the service list match the website.',
    },
    'Establish GBP photo and post cadence': {
        title: 'Set a photo and post rhythm for the Google Business Profile',
        description: 'Upload clear photos of the outside, inside, team, and work examples, and schedule regular posts for offers, updates, and projects.',
    },
    'Audit NAP consistency': {
        title: 'Check that the business details match everywhere',
        description: 'Confirm the name, address, and phone number are identical on the website, the Google Business Profile, and every directory. Fix any mismatch.',
    },
};

export function drawerWording(title: string, description: string): DrawerWording {
    return DRAWER_WORDING[title] ?? { title, description };
}
