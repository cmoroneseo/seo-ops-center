/**
 * How far above the viewport bottom a toast stack must sit so it clears
 * the floating timer. `widgetTop` is the timer's top edge in viewport pixels.
 */
export function toastClearancePx(viewportHeight: number, widgetTop: number, gap = 16): number {
    if (!Number.isFinite(viewportHeight) || !Number.isFinite(widgetTop)) return 0;
    return Math.max(0, Math.round(viewportHeight - widgetTop + gap));
}
