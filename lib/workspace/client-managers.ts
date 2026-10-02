import type { ClientProject } from '../types';

type ManagedClient = Pick<ClientProject, 'accountManager' | 'accountManagerId'>;
export interface ManagerIdentity { id: string; name: string; email?: string }
export interface ManagerFilterOption { value: string; label: string; accountManagerId?: string; aliases: string[] }
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

function identities(clients: ManagedClient[], members: ManagerIdentity[]): ManagerIdentity[] {
    const byId = new Map(members.map(member => [member.id, member]));
    for (const client of clients) {
        if (client.accountManagerId && !byId.has(client.accountManagerId)) {
            byId.set(client.accountManagerId, {id:client.accountManagerId, name:client.accountManager});
        }
    }
    return [...byId.values()];
}

/** An ID wins; a legacy short name resolves only when exactly one member matches. */
export function clientManagerId(client: ManagedClient, known: ManagerIdentity[]): string | undefined {
    if (client.accountManagerId) return client.accountManagerId;
    const name = normalize(client.accountManager);
    if (!name || name === 'unassigned') return undefined;
    const exact = known.filter(member => normalize(member.name) === name || (member.email && normalize(member.email) === name));
    if (name.includes(' ') || name.includes('@')) return exact.length === 1 ? exact[0].id : undefined;
    const short = known.filter(member => normalize(member.name).split(' ')[0] === name);
    return short.length === 1 ? short[0].id : undefined;
}

export function buildManagerOptions(clients: ManagedClient[], members: ManagerIdentity[] = []): ManagerFilterOption[] {
    const known = identities(clients, members);
    const options = new Map<string, ManagerFilterOption>();
    for (const client of clients) {
        const id = clientManagerId(client, known);
        const alias = normalize(client.accountManager);
        const value = id ?? `name:${alias}`;
        const label = id ? known.find(member => member.id === id)?.name || client.accountManager || 'Team member' : client.accountManager.trim() || 'Unassigned';
        const existing = options.get(value);
        if (existing) { if (!existing.aliases.includes(alias)) existing.aliases.push(alias); }
        else options.set(value, {value, label, accountManagerId:id, aliases:[alias]});
    }
    return [...options.values()].sort((a,b)=>a.label.localeCompare(b.label));
}

export function matchesManager(client: ManagedClient, option: ManagerFilterOption, clients: ManagedClient[], members: ManagerIdentity[]): boolean {
    const id = clientManagerId(client, identities(clients,members));
    return option.accountManagerId ? id === option.accountManagerId : !id && option.aliases.includes(normalize(client.accountManager));
}

export function isMyClient(client: ManagedClient, user: ManagerIdentity, clients: ManagedClient[], members: ManagerIdentity[] = []): boolean {
    if (!user.id) return false;
    // Current identity also supports legacy full names when the member directory is unavailable.
    const known = identities(clients, [...members.filter(member => member.id !== user.id), members.find(member => member.id === user.id) ?? user]);
    return clientManagerId(client, known) === user.id;
}
