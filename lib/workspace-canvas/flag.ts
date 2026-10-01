/**
 * Opt-in for the client Overview canvas.
 *
 * `NEXT_PUBLIC_WORKSPACE_OVERVIEW=true` only mounts the legacy health-score
 * widget inside the existing Overview. It is intentionally a different switch.
 * Unset or any value other than `true` keeps the legacy Overview.
 */
export function workspaceCanvasEnabled(): boolean {
    return process.env.NEXT_PUBLIC_WORKSPACE_CANVAS === 'true';
}
