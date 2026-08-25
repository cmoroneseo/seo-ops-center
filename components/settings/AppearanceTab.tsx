'use client';

import { Check, Loader2, Lock, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { previewThemeCss } from '@/components/providers/brand-theme';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { updateOrganizationTheme } from '@/lib/supabase/organizations';
import {
    DEFAULT_THEME,
    OrganizationTheme,
    THEME_PRESETS,
    buildThemeCss,
    previewAccentHex,
    previewHex,
    themeContrast,
} from '@/lib/theme/palette';
import { hexToOklch } from '@/lib/theme/color';
import { cn } from '@/lib/utils';

const sameTheme = (a: OrganizationTheme, b: OrganizationTheme) =>
    a.preset === b.preset && (a.preset !== 'custom' || a.hex === b.hex);

/** The hex the custom field should show for a given theme. */
const hexFor = (theme: OrganizationTheme) =>
    theme.preset === 'custom' ? theme.hex ?? '#ff0080' : '#ff0080';

const LEVEL_STYLES: Record<string, string> = {
    AA: 'bg-green-500/10 text-green-500 border-green-500/20',
    'AA Large': 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    Fail: 'bg-red-500/10 text-red-500 border-red-500/20',
};

export function AppearanceTab() {
    const { organization, setOrganization, isLoading: isOrgLoading } = useOrganization();
    const { isOwner, isLoading: isMemberLoading } = useCurrentMember();

    // Role is only trustworthy once both the session and the memberships have
    // landed; until then it defaults to 'member' and would wrongly tell an
    // owner they lack permission.
    const isRoleResolved = !isOrgLoading && !isMemberLoading;

    const saved = organization?.theme ?? DEFAULT_THEME;
    const [draft, setDraft] = useState<OrganizationTheme>(saved);
    const [customHex, setCustomHex] = useState(hexFor(saved));
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Distinguishes "the user picked this" from "this is just the initial
    // value", so a late-arriving saved theme can adopt without clobbering edits.
    const [isTouched, setIsTouched] = useState(false);

    const isDirty = isTouched && !sameTheme(draft, saved);
    const isCustom = draft.preset === 'custom';
    const contrast = themeContrast(draft);

    // The organization resolves after this component mounts, so the initial
    // draft is the default rather than the real theme. Adopt the saved theme
    // when it arrives — otherwise the picker shows the wrong colour and a
    // phantom unsaved-changes state.
    useEffect(() => {
        if (isTouched) return;
        setDraft(saved);
        setCustomHex(hexFor(saved));
        // `saved` is a fresh object each render; depending on it would loop.
        // Its two fields are the whole identity of a theme.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [saved.preset, saved.hex, isTouched]);

    // Applying the draft to the live stylesheet is the preview — the whole app
    // recolours, which is the only honest way to judge a brand colour.
    // Suppressed while the org loads so this never paints the default over the
    // correct colour the boot script already applied.
    useEffect(() => {
        if (isOrgLoading) return;
        previewThemeCss(buildThemeCss(draft));
    }, [draft, isOrgLoading]);

    // Abandoning the tab with an unsaved draft must not leave the app recoloured.
    const savedRef = useRef(saved);
    savedRef.current = saved;
    useEffect(
        () => () => {
            previewThemeCss(buildThemeCss(savedRef.current));
        },
        [],
    );

    const applyCustomHex = useCallback((value: string) => {
        setIsTouched(true);
        setCustomHex(value);
        if (hexToOklch(value)) setDraft({ preset: 'custom', hex: value.toLowerCase() });
    }, []);

    const selectPreset = useCallback((presetId: string) => {
        setIsTouched(true);
        setDraft({ preset: presetId });
    }, []);

    const discard = useCallback(() => {
        setIsTouched(false);
        setDraft(saved);
        setCustomHex(hexFor(saved));
    }, [saved]);

    const handleSave = async () => {
        if (!organization || !isOwner) return;
        setIsSaving(true);
        setError(null);

        const result = await updateOrganizationTheme(organization.id, draft);

        if (result.success) {
            setIsTouched(false);
            setOrganization({ ...organization, theme: draft });
        } else {
            setError(result.error ?? 'Could not save the theme.');
            previewThemeCss(buildThemeCss(saved));
            setIsTouched(false);
            setDraft(saved);
            setCustomHex(hexFor(saved));
        }
        setIsSaving(false);
    };

    return (
        <div className="grid gap-6">
            <div className="rounded-xl border border-border bg-card p-6">
                <div className="mb-6">
                    <h3 className="text-lg font-semibold">Brand color</h3>
                    <p className="text-sm text-muted-foreground">
                        Sets the accent color across the whole workspace for everyone on your team.
                        Status colors — success, warning, error — stay fixed so alerts remain readable.
                    </p>
                </div>

                {isRoleResolved && !isOwner && (
                    <div className="mb-6 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                        <Lock className="h-3.5 w-3.5 shrink-0" />
                        Only an organization owner can change the brand color.
                    </div>
                )}

                <fieldset disabled={!isRoleResolved || !isOwner || isSaving} className="disabled:opacity-60">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {THEME_PRESETS.map((preset) => {
                            const isSelected = draft.preset === preset.id;
                            return (
                                <button
                                    key={preset.id}
                                    type="button"
                                    onClick={() => selectPreset(preset.id)}
                                    aria-pressed={isSelected}
                                    className={cn(
                                        'group flex flex-col gap-2 rounded-lg border p-3 text-left transition-all',
                                        isSelected
                                            ? 'border-primary ring-2 ring-primary/40'
                                            : 'border-border hover:border-primary/50',
                                    )}
                                >
                                    <span className="flex items-center gap-1.5">
                                        <span
                                            className="h-7 w-7 rounded-full"
                                            style={{ backgroundColor: previewHex({ preset: preset.id }) }}
                                        />
                                        <span
                                            className="h-4 w-4 rounded-full"
                                            style={{
                                                backgroundColor: previewAccentHex({ preset: preset.id }),
                                            }}
                                        />
                                        {isSelected && <Check className="ml-auto h-4 w-4 text-primary" />}
                                    </span>
                                    <span className="text-xs font-medium">{preset.label}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Selected state matches the preset tiles — a tinted label alone
                        read as "nothing is selected" when a custom colour was active. */}
                    <div
                        className={cn(
                            'mt-4 flex flex-wrap items-center gap-3 rounded-lg border p-3 transition-all',
                            isCustom
                                ? 'border-primary ring-2 ring-primary/40'
                                : 'border-border',
                        )}
                    >
                        <label
                            htmlFor="brand-custom-color"
                            className={cn(
                                'flex items-center gap-2 text-sm font-medium',
                                isCustom && 'text-primary',
                            )}
                        >
                            <input
                                id="brand-custom-color"
                                type="color"
                                value={customHex}
                                onChange={(e) => applyCustomHex(e.target.value)}
                                className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
                            />
                            Custom
                        </label>
                        <input
                            type="text"
                            value={customHex}
                            onChange={(e) => applyCustomHex(e.target.value)}
                            spellCheck={false}
                            aria-label="Custom brand color hex"
                            className="h-9 w-32 rounded-md border border-input bg-background px-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                        <p className="text-xs text-muted-foreground">
                            Very light or very dark colors are adjusted to stay readable.
                        </p>
                        {isCustom && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
                    </div>
                </fieldset>
            </div>

            <div className="rounded-xl border border-border bg-card p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold">Preview</h3>
                    <span
                        className={cn(
                            'rounded-full border px-2.5 py-1 text-xs font-medium',
                            LEVEL_STYLES[contrast.level],
                        )}
                        title="Contrast between the brand color and the text placed on it"
                    >
                        {contrast.lightText ? 'White' : 'Dark'} text · {contrast.ratio.toFixed(2)}:1 ·{' '}
                        {contrast.level}
                    </span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                        Primary action
                    </button>
                    <button
                        type="button"
                        className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                    >
                        Secondary
                    </button>
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                        Badge
                    </span>
                    <span className="neon-gradient-text text-xl font-bold">Gradient heading</span>
                    <input
                        aria-label="Focus ring preview"
                        placeholder="Focus me"
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </div>
            </div>

            {error && (
                <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-500">
                    {error}
                </p>
            )}

            {isOwner && (
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={!isDirty || isSaving}
                        className="flex h-10 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                        {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                        {isSaving ? 'Saving…' : 'Save brand color'}
                    </button>
                    <button
                        type="button"
                        onClick={discard}
                        disabled={!isDirty || isSaving}
                        className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Discard
                    </button>
                    {isDirty && (
                        <span className="text-xs text-muted-foreground">Previewing unsaved changes</span>
                    )}
                </div>
            )}
        </div>
    );
}
