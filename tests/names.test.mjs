import { sanitizeDeviceName, defaultDeviceName, formatStamp, conflictCopyPath, findCaseCollisions } from '../server-plugin/names.mjs';

const DATE = new Date(2026, 8, 29, 15, 30);

describe('sanitizeDeviceName', () => {
    test('removes characters illegal in Windows file names', () => {
        expect(sanitizeDeviceName('a:b/c?')).toBe('abc');
        expect(sanitizeDeviceName('x\\y*"<>|z')).toBe('xyz');
    });
    test('strips trailing dots and spaces', () => {
        expect(sanitizeDeviceName('pc. ')).toBe('pc');
    });
    test('falls back to "device" when empty', () => {
        expect(sanitizeDeviceName('   ')).toBe('device');
        expect(sanitizeDeviceName(undefined)).toBe('device');
    });
});

describe('defaultDeviceName', () => {
    test('uses android when hostname is localhost or empty', () => {
        expect(defaultDeviceName('localhost')).toBe('android');
        expect(defaultDeviceName('')).toBe('android');
    });
    test('uses the sanitized hostname otherwise', () => {
        expect(defaultDeviceName('MY-PC')).toBe('MY-PC');
    });
});

test('formatStamp pads fields', () => {
    expect(formatStamp(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02 0304');
});

describe('conflictCopyPath', () => {
    test('inserts marker before the extension, keeping the folder', () => {
        expect(conflictCopyPath('chats/X/c.jsonl', 'B', DATE)).toBe('chats/X/c (衝突 B 2026-09-29 1530).jsonl');
    });
    test('adds a counter when n > 1', () => {
        expect(conflictCopyPath('settings.json', 'B', DATE, 2)).toBe('settings (衝突 B 2026-09-29 1530 2).json');
    });
    test('handles files without extension', () => {
        expect(conflictCopyPath('README', 'B', DATE)).toBe('README (衝突 B 2026-09-29 1530)');
    });
});

test('findCaseCollisions lists every path whose lowercase form is shared', () => {
    expect(findCaseCollisions(['a/Alice.png', 'b.txt', 'a/alice.png'])).toEqual(['a/Alice.png', 'a/alice.png']);
    expect(findCaseCollisions(['a.txt', 'b.txt'])).toEqual([]);
});
