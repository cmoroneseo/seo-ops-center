import { buildThemeCss } from '@/lib/theme/palette';
import { resolveServerTheme } from '@/lib/theme/server';

/**
 * Server-rendered brand stylesheet.
 *
 * Rendered inside the dashboard segment rather than the root layout on
 * purpose: reading cookies in the root layout would make the public marketing
 * pages dynamic too, and they have no organization to brand. Dashboard routes
 * are already auth-gated, so they were never usefully static.
 *
 * BrandThemeSync mutates this same element by id for live changes (an org
 * switch, or the Appearance tab preview), which is why there is exactly one
 * brand stylesheet in the document no matter how the theme was resolved.
 */
export async function BrandThemeStyle() {
    const theme = await resolveServerTheme();

    return (
        <style
            id="brand-theme"
            // The client mutates this element's text directly, so React must
            // not try to reconcile its contents.
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: buildThemeCss(theme) }}
        />
    );
}
