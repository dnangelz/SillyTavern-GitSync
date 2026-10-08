// Top-level entries of the SillyTavern user folder, grouped for selective push.
// Anything not listed falls into 'other'.
export const CATEGORY_PATHS = {
    characters: ['characters'],
    chats: ['chats'],
    groups: ['groups', 'group chats'],
    worlds: ['worlds'],
    settings: ['settings.json', 'KoboldAI Settings', 'NovelAI Settings', 'OpenAI Settings', 'TextGen Settings', 'instruct', 'context', 'sysprompt', 'reasoning', 'themes', 'movingUI', 'QuickReplies'],
    media: ['User Avatars', 'backgrounds', 'assets', 'user'],
};
export const ALL_CATEGORIES = [...Object.keys(CATEGORY_PATHS), 'other'];

const OWNER = new Map(Object.entries(CATEGORY_PATHS).flatMap(([key, paths]) => paths.map(p => [p, key])));

export function categoryOf(relPath) {
    return OWNER.get(relPath.split('/')[0]) ?? 'other';
}

// Drops unknown keys; undefined/non-array means "everything".
export function normalizeCategories(value) {
    return Array.isArray(value) ? ALL_CATEGORIES.filter(key => value.includes(key)) : [...ALL_CATEGORIES];
}
