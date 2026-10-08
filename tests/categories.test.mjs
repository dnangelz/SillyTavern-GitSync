import { categoryOf, normalizeCategories, ALL_CATEGORIES } from '../server-plugin/categories.mjs';

test('maps paths by their top-level entry', () => {
    expect(categoryOf('chats/Alice/c1.jsonl')).toBe('chats');
    expect(categoryOf('group chats/g.jsonl')).toBe('groups');
    expect(categoryOf('settings.json')).toBe('settings');
    expect(categoryOf('OpenAI Settings/p.json')).toBe('settings');
    expect(categoryOf('git-sync.json')).toBe('other');
    expect(categoryOf('settings (衝突 x).json')).toBe('other');
});

test('normalizeCategories defaults to all and drops unknown keys', () => {
    expect(normalizeCategories(undefined)).toEqual(ALL_CATEGORIES);
    expect(normalizeCategories(['worlds', 'x'])).toEqual(['worlds']);
});
