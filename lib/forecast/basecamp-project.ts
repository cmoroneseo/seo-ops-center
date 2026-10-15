import { createHash } from 'node:crypto';

import type { ForecastDeskClient, ForecastSeoClient } from './clients.ts';
import { isCampaignDeskClientId, suggestCampaignDeskClientId } from './clients.ts';

/**
 * Where an internal planner block was sent in Basecamp.
 *
 * `client` is an SEO client binding (project role or the client's saved
 * project id). `internal` and `ignored` stay off client forecasts. `unknown`
 * can still match a Campaign Desk client by project name.
 */
export interface ForecastBasecampProject {
    id: string;
    name: string | null;
    kind: 'client' | 'internal' | 'ignored' | 'unknown';
    clientId?: string;
    clientName?: string;
    clientDomain?: string;
}

export interface ProjectClientAttribution {
    clientId: string;
    clientName: string;
    clientDomain: string | null;
    /**
     * Set when the desk id came from the project name and there is no SEO
     * client to run through the saved-link resolver. Null means the usual
     * resolver should decide.
     */
    campaignDeskClientId: string | null;
}

const PROJECT_NAMESPACE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const MIN_PREFIX = 8;

/** Stable id for a Basecamp project that has no SEO client row. */
export function projectDeskClientKey(projectId: string): string {
    return uuidV5(`basecamp-project:${projectId.trim()}`, PROJECT_NAMESPACE);
}

/** Drop the " Growth OS …" suffix Basecamp project titles share. */
export function projectStem(name: string): string {
    return name.trim().replace(/ growth os\b.*$/i, '').trim();
}

export function attributeBasecampProject(input: {
    projectId: string | undefined;
    projects: readonly ForecastBasecampProject[];
    seoClients: readonly ForecastSeoClient[];
    deskClients: readonly ForecastDeskClient[] | null;
    links: ReadonlyMap<string, string>;
}): ProjectClientAttribution | null {
    const projectId = input.projectId?.trim() ?? '';
    if (!projectId) return null;
    const project = input.projects.find(item => item.id === projectId);
    if (!project || project.kind === 'internal' || project.kind === 'ignored') return null;

    const boundId = project.clientId?.trim().toLowerCase() ?? '';
    const boundName = project.clientName?.trim() ?? '';
    if (project.kind === 'client' && boundId && boundName) {
        return {
            clientId: boundId,
            clientName: boundName,
            clientDomain: project.clientDomain?.trim() || null,
            campaignDeskClientId: null,
        };
    }

    return matchProjectName({
        projectId,
        projectName: project.name,
        seoClients: input.seoClients,
        deskClients: input.deskClients,
        links: input.links,
    });
}

function matchProjectName(input: {
    projectId: string;
    projectName: string | null;
    seoClients: readonly ForecastSeoClient[];
    deskClients: readonly ForecastDeskClient[] | null;
    links: ReadonlyMap<string, string>;
}): ProjectClientAttribution | null {
    const raw = input.projectName?.trim() ?? '';
    if (!raw) return null;
    const stem = projectStem(raw);
    const labels = [...new Set([raw, stem].filter(label => label.length > 0))];

    const seoExact = unique(input.seoClients, client => labels.some(label => client.name.trim() === label));
    if (seoExact) return fromSeo(seoExact);

    if (input.deskClients) {
        for (const label of labels) {
            const deskId = suggestCampaignDeskClientId(label, input.deskClients);
            if (deskId) return fromDesk(input, deskId);
        }
    }

    const seoPrefix = unique(input.seoClients, client => nameIsPrefix(client.name, raw) || nameIsPrefix(client.name, stem));
    if (seoPrefix) return fromSeo(seoPrefix);

    if (input.deskClients) {
        const prefixed = unique(input.deskClients, client =>
            isCampaignDeskClientId(client.id) && (nameIsPrefix(client.name, raw) || nameIsPrefix(client.name, stem)));
        if (prefixed) return fromDesk(input, prefixed.id);
    }
    return null;
}

function fromSeo(client: ForecastSeoClient): ProjectClientAttribution {
    return {
        clientId: client.id.toLowerCase(),
        clientName: client.name.trim(),
        clientDomain: client.domain,
        campaignDeskClientId: null,
    };
}

function fromDesk(
    input: { projectId: string; seoClients: readonly ForecastSeoClient[]; deskClients: readonly ForecastDeskClient[] | null; links: ReadonlyMap<string, string> },
    deskId: string,
): ProjectClientAttribution | null {
    const linked = unique(input.seoClients, client => input.links.get(client.id.toLowerCase()) === deskId);
    if (linked) return fromSeo(linked);
    const desk = input.deskClients?.find(client => client.id === deskId);
    const name = desk?.name.trim() ?? '';
    if (!name || !isCampaignDeskClientId(deskId)) return null;
    return {
        clientId: projectDeskClientKey(input.projectId),
        clientName: name,
        clientDomain: null,
        campaignDeskClientId: deskId,
    };
}

function nameIsPrefix(clientName: string, projectName: string): boolean {
    const name = clientName.trim();
    if (name.length < MIN_PREFIX || !projectName.startsWith(name)) return false;
    return projectName.length === name.length || projectName[name.length] === ' ';
}

function unique<T>(items: readonly T[], predicate: (item: T) => boolean): T | null {
    const hits = items.filter(predicate);
    return hits.length === 1 ? hits[0] : null;
}

function uuidV5(name: string, namespace: string): string {
    const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
    const hash = createHash('sha1').update(ns).update(name, 'utf8').digest();
    const bytes = Buffer.from(hash.subarray(0, 16));
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
