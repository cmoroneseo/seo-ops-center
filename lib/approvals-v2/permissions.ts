export function canSendApproval(role: string | undefined, actor: string, accountManagerId: string | null | undefined, isBotActor = false) {
  return !isBotActor && ['owner', 'admin', 'member'].includes(role ?? '') && (role === 'owner' || role === 'admin' || accountManagerId === actor);
}
export const sendPermissionReason = 'Only an organization owner, admin, or this client’s account manager can send.';
