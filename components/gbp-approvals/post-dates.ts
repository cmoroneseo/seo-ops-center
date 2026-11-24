import { isCalendarDate } from '@/lib/gbp-approvals/registry';
import { monthDay } from './sample';

export function postOfferRange({ postType, offerStart, offerEnd }: {
    postType?: string;
    offerStart: string | null;
    offerEnd: string | null;
}): string | null {
    if ((postType && postType !== 'offer') || !offerStart || !offerEnd
        || !isCalendarDate(offerStart) || !isCalendarDate(offerEnd)) return null;
    return `${monthDay(offerStart)} – ${monthDay(offerEnd)}`;
}
