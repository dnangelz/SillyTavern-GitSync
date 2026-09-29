import { redact } from '../server-plugin/redact.mjs';

test('replaces every occurrence of each secret', () => {
    expect(redact('a tok b tok', ['tok'])).toBe('a *** b ***');
});

test('replaces the URL-encoded form of a secret', () => {
    expect(redact('x a%2Fb y', ['a/b'])).toBe('x *** y');
});

test('removes credentials embedded in URLs even without the secret list', () => {
    expect(redact('fatal: https://x-access-token:abc@github.com/u/r.git')).toBe('fatal: https://***@github.com/u/r.git');
});

test('ignores empty secrets and non-string input', () => {
    expect(redact('hello', ['', null])).toBe('hello');
    expect(redact(undefined)).toBe('');
});
