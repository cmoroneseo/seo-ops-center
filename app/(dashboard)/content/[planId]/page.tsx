'use client';

import { useParams } from 'next/navigation';
import { ContentPlanWorkspace } from '@/components/content/ContentPlanWorkspace';

export default function ContentPlanPage() {
    const params = useParams<{ planId: string }>();
    return <ContentPlanWorkspace planId={params.planId} />;
}
