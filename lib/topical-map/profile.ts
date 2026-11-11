import type { TopicalMapProfile } from '../types';
import { normalizeSeedKeywords } from './seed-keywords';

function stringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
}

export function profileFromStored(profile: unknown): TopicalMapProfile | null {
    if (!profile || typeof profile !== 'object') return null;
    const stored = profile as Record<string, unknown>;
    return {
        brandName: String(stored.brand_name ?? ''),
        businessDescription: String(stored.business_description ?? ''),
        contentLanguage: typeof stored.content_language === 'string' && stored.content_language
            ? stored.content_language
            : 'en',
        focusTopics: stringList(stored.focus_topics),
        rivals: stringList(stored.rivals),
        keywords: normalizeSeedKeywords(stored.keywords),
        profileGeneratedAt: typeof stored.profile_generated_at === 'string' ? stored.profile_generated_at : undefined,
    };
}

export function profileToStored(profile: TopicalMapProfile, generatedAt = new Date().toISOString()): Record<string, unknown> {
    return {
        brand_name: profile.brandName,
        business_description: profile.businessDescription,
        content_language: profile.contentLanguage,
        focus_topics: profile.focusTopics,
        rivals: profile.rivals,
        keywords: normalizeSeedKeywords(profile.keywords),
        profile_generated_at: generatedAt,
    };
}
