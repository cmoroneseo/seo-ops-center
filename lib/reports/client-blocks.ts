/**
 * The only blocks a client report can mount. Spot checks, rank tables,
 * modeled traffic, hours, and a stacked share bar are not in the union,
 * so a renderer that switches on ClientBlock cannot show them.
 */

export const CLIENT_BLOCK_KINDS = [
    'hero',
    'at_a_glance',
    'where_you_show_up',
    'work_completed',
    'what_changed',
    'whats_next',
    'what_we_need',
    'about_these_numbers',
    'domain_rating',
] as const;

export type ClientBlockKind = (typeof CLIENT_BLOCK_KINDS)[number];

export const FORBIDDEN_CLIENT_KINDS = [
    'keyword_rankings_table',
    'grid_comparison',
    'spot_check',
    'map_spot_check',
    'modeled_traffic',
    'hours',
    'share_bar',
] as const;

export type ForbiddenClientKind = (typeof FORBIDDEN_CLIENT_KINDS)[number];

type ForbiddenOverlap = Extract<ClientBlockKind, ForbiddenClientKind>;
type AllowlistExcludesForbidden = ForbiddenOverlap extends never ? true : never;

export const CLIENT_BLOCK_ALLOWLIST_SOUND: AllowlistExcludesForbidden = true;

export function isClientBlockKind(value: string): value is ClientBlockKind {
    return (CLIENT_BLOCK_KINDS as readonly string[]).includes(value);
}
