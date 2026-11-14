export interface SamplePost {
    position: number;
    title: string;
    scheduled: string;
    offerStart: string;
    offerEnd: string;
    body: string;
    photo: string | null;
    status: 'pending' | 'approved' | 'changes_requested';
    comment?: string;
    suggestedBody?: string;
    previousBody?: string;
    replacementPhoto?: string;
}

const TERMS = 'Free in-home walkthrough ($250 value) and a written quote within 48 hours. Offer runs Nov 16 to Dec 31. Larger or more complex projects, including ground-up construction, may need more time for an accurate quote.';

export const SAMPLE_TERMS = TERMS;
export const LOGO = '/dev/gbp-approvals/logo.webp';

export const SAMPLE_POSTS: SamplePost[] = [
    {
        position: 1,
        title: 'Free In-Home Walkthrough + Written Quote in 48 Hours',
        scheduled: '2026-11-16',
        offerStart: '2026-11-16',
        offerEnd: '2026-12-31',
        body: 'If your bathroom has been bugging you, start with a walkthrough. We come to your home, look at the space with you, and hear what you want.',
        photo: '/dev/gbp-approvals/post1.jpg',
        status: 'approved',
    },
    {
        position: 2,
        title: 'Free Kitchen Walkthrough + Written Quote in 48 Hours',
        scheduled: '2026-11-23',
        offerStart: '2026-11-23',
        offerEnd: '2026-12-31',
        body: 'Thanksgiving week is when the kitchen works hardest. If you ran out of counter space, storage or light this year, write it down and bring that list.',
        photo: '/dev/gbp-approvals/post2.jpg',
        status: 'changes_requested',
        comment: 'Can we drop the leftovers line? Keep the ending simple.',
        previousBody: 'Happy Thanksgiving from everyone at ALL-IN-1 Construction in Banning, CA. Once the leftovers are gone, tap below to request your free walkthrough.',
        suggestedBody: 'Happy Thanksgiving from everyone at ALL-IN-1 Construction in Banning, CA. Tap below to request your free walkthrough.',
    },
    {
        position: 3,
        title: 'Free ADU or Addition Walkthrough + 48-Hour Quote',
        scheduled: '2026-11-30',
        offerStart: '2026-11-30',
        offerEnd: '2026-12-31',
        body: 'Running short on room after having everyone over? An ADU or an addition might be the answer, and a walkthrough is the easiest way to find out what fits.',
        photo: '/dev/gbp-approvals/post3.jpg',
        status: 'approved',
    },
    {
        position: 4,
        title: 'Free Electrical Walkthrough + 48-Hour Written Quote',
        scheduled: '2026-12-07',
        offerStart: '2026-12-07',
        offerEnd: '2026-12-31',
        body: 'Holiday lights, space heaters, a house full of guests. That is a real test for your electrical.',
        photo: '/dev/gbp-approvals/post4.jpg',
        status: 'approved',
    },
    {
        position: 5,
        title: 'Free Remodel Walkthrough + 48-Hour Written Quote',
        scheduled: '2026-12-14',
        offerStart: '2026-12-14',
        offerEnd: '2026-12-31',
        body: 'Spent the holidays wishing your house worked better? If a remodel is on your list for the new year, a walkthrough is how that list turns into a plan.',
        photo: null,
        status: 'changes_requested',
        comment: "Here's a finished remodel you can use.",
        replacementPhoto: '/dev/gbp-approvals/stand-in.webp',
    },
    {
        position: 6,
        title: 'Free Patio and Deck Walkthrough + 48-Hour Quote',
        scheduled: '2026-12-21',
        offerStart: '2026-12-21',
        offerEnd: '2026-12-31',
        body: 'Merry Christmas from all of us at ALL-IN-1 Construction. With everyone home this week, think about next year\'s get-togethers out back.',
        photo: '/dev/gbp-approvals/post6.jpg',
        status: 'pending',
    },
    {
        position: 7,
        title: 'Last Week for a Free Walkthrough: Ends Dec 31',
        scheduled: '2026-12-28',
        offerStart: '2026-12-28',
        offerEnd: '2026-12-31',
        body: 'Been wanting a walk-in shower? This is a good week to get the details.',
        photo: '/dev/gbp-approvals/post7.jpg',
        status: 'approved',
    },
];

export const SAMPLE_QUESTIONS = [
    {
        id: 'q1',
        prompt: 'The Dec 31 deadline: does the customer have to request the walkthrough by Dec 31, or have it done by Dec 31?',
        about: 'Whole request',
        answer: 'Request by Dec 31.',
    },
    {
        id: 'q2',
        prompt: 'Holiday blackout days: when can walkthroughs not happen around Thanksgiving (Thu Nov 26) and Christmas (Fri Dec 25), and does the 48-hour quote clock pause over those holidays?',
        about: 'Whole request',
        answer: null,
    },
    {
        id: 'q3',
        prompt: 'Can you send full-size originals of the photos for posts 3 and 6?',
        about: 'Posts 3 and 6',
        answer: null,
    },
];

export function monthDay(day: string): string {
    const [year, month, date] = day.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, date)));
}

export function weekday(day: string): string {
    const [year, month, date] = day.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, date)));
}
