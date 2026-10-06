'use client';

import NextLink from 'next/link';
import { createContext, useContext, type ComponentProps } from 'react';
import { portalViewHref } from '@/lib/portal/preview-policy';

const PortalViewContext = createContext({ basePath: '/portal', readOnly: false });
export const PortalViewProvider = PortalViewContext.Provider;
export function usePortalView() { return useContext(PortalViewContext); }

export function PortalLink({ href, ...props }: Omit<ComponentProps<typeof NextLink>, 'href'> & { href: string }) {
    const { basePath } = usePortalView();
    return <NextLink {...props} href={portalViewHref(href, basePath)} />;
}
