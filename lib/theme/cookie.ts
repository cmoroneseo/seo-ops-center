/**
 * Name of the cookie mirroring the user's selected organization.
 *
 * Its own module so the client provider and the server resolver can share it
 * without the client pulling in `next/headers`.
 */
export const SELECTED_ORG_COOKIE = 'selectedOrgId';
