import { notFound } from 'next/navigation';

import { SearchInsightsPreview } from '@/components/search-insights/Preview';

export default function SearchInsightsPreviewPage() {
    if (process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_SEARCH_REPORTING !== 'true') notFound();
    return <SearchInsightsPreview />;
}
