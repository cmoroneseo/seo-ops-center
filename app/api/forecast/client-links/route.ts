import { forecastClientLinksGet, forecastClientLinksPut } from '@/lib/forecast/wire';

export const dynamic = 'force-dynamic';

/** GET /api/forecast/client-links — owner/admin client map, with exact-name suggestions. */
export const GET = forecastClientLinksGet;

/** PUT /api/forecast/client-links — save or clear one link, or store exact name matches. */
export const PUT = forecastClientLinksPut;
