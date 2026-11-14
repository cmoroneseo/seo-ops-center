'use client';

import { useEffect, useState } from 'react';
import { useOrganization } from '@/components/providers/organization-provider';
export function ApprovalBadge() {
  const {
    organization
  } = useOrganization();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      fetch('/api/approval-requests', {
        cache: 'no-store',
        signal: controller.signal
      }).then(async r => {
        if (r.ok) setCount((await r.json()).badgeCount);
      }).catch(() => { });
    };
    load();
    window.addEventListener('focus', load);
    window.addEventListener('approvals:changed', load);
    return () => {
      controller.abort();
      window.removeEventListener('focus', load);
      window.removeEventListener('approvals:changed', load);
    };
  }, [organization?.id]);
  return count ? <span aria-label={`${count} approvals need attention`} className="ml-auto rounded-full bg-[#DB0A8B] px-2 py-0.5 text-xs text-white">
    {count}
  </span> : null;
}
