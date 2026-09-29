import fs from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { initRepo, pull, push, status, authUrl, gitEnv, gitFor, isNonFastForward } from '../server-plugin/sync.mjs';
import { tempDir, makeRemote, write, read, opts } from './helpers.mjs';

describe('authUrl', () => {
    test('embeds the token into https URLs', () => {
        expect(authUrl('https://github.com/u/r.git', 'tok')).toBe('https://x-access-token:tok@github.com/u/r.git');
    });
    test('leaves the URL alone without token or for local paths', () => {
        expect(authUrl('https://github.com/u/r.git', '')).toBe('https://github.com/u/r.git');
        expect(authUrl('C:\\tmp\\remote', 'tok')).toBe('C:\\tmp\\remote');
    });
});

test('gitEnv drops variables simple-git treats as unsafe and disables prompts', () => {
    const env = gitEnv({ PATH: '/bin', GIT_ASKPASS: 'x', SSH_ASKPASS: 'x', PREFIX: '/data', EDITOR: 'vi', HOME: '/h', LANGUAGE: 'zh_TW', LC_MESSAGES: 'zh_TW.UTF-8' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GIT_LITERAL_PATHSPECS: '1' });
});

test('git runs with the credential helper disabled even when the parent env has GIT_ASKPASS and PREFIX', async () => {
    const saved = { GIT_ASKPASS: process.env.GIT_ASKPASS, PREFIX: process.env.PREFIX };
    process.env.GIT_ASKPASS = 'x';
    process.env.PREFIX = '/data/data/com.termux/files/usr';
    try {
        const out = await gitFor(tempDir()).raw(['config', '--get-all', 'credential.helper']);
        // git prints an empty line for the empty override; trim() would swallow it.
        expect(out.replace(/\n$/, '').split('\n').pop()).toBe('');
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
});

test('A initializes and pushes, B initializes and receives identical bytes', async () => {
    const remote = await makeRemote();
    const a = tempDir();
    const b = tempDir();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 255]);
    write(a, 'characters/Alice.png', png);
    write(a, 'chats/Alice/c1.jsonl', '{"a":1}\n{"b":2}\n');

    const ra = await initRepo(a, opts(remote, 'A'));
    expect(ra).toMatchObject({ pushed: true, conflicts: [], largeFiles: [], caseCollisions: [] });

    write(b, 'settings.json', '{}');
    const rb = await initRepo(b, opts(remote, 'B'));
    expect(rb).toMatchObject({ pushed: true, updated: true, conflicts: [] });
    expect(read(b, 'characters/Alice.png')).toEqual(png);
    expect(read(b, 'chats/Alice/c1.jsonl').toString()).toBe('{"a":1}\n{"b":2}\n');

    await pull(a, opts(remote, 'A'));
    expect(read(a, 'settings.json').toString()).toBe('{}');
});

test('sets cross-platform repo config', async () => {
    const remote = await makeRemote();
    const a = tempDir();
    write(a, 'x.txt', 'x\n');
    await initRepo(a, opts(remote, 'A'));
    const git = simpleGit(a);
    expect((await git.raw(['config', 'core.autocrlf'])).trim()).toBe('false');
    expect((await git.raw(['config', 'core.fileMode'])).trim()).toBe('false');
    expect((await git.raw(['config', 'core.quotePath'])).trim()).toBe('false');
    expect((await git.raw(['config', 'user.name'])).trim()).toBe('A');
    expect((await git.raw(['remote', 'get-url', 'origin'])).trim()).toBe(remote);
});

test('ignored files are never committed', async () => {
    const remote = await makeRemote();
    const a = tempDir();
    write(a, 'secrets.json', '{"k":"v"}');
    write(a, 'git-sync.local.json', '{}');
    write(a, 'stats.json', '{}');
    write(a, 'extensions/foo/index.js', 'x');
    write(a, 'thumbnails/t.png', 'x');
    write(a, 'backups/b.jsonl', 'x');
    write(a, 'vectors/v.bin', 'x');
    write(a, 'chats/X/c.jsonl', '1\n');
    await initRepo(a, opts(remote, 'A'));
    const files = (await simpleGit(a).raw(['ls-files'])).split('\n').filter(Boolean);
    expect(files.sort()).toEqual(['.gitignore', 'chats/X/c.jsonl']);
});

test('large files abort the sync before anything is committed or pushed', async () => {
    const remote = await makeRemote();
    const a = tempDir();
    write(a, 'big.bin', Buffer.alloc(2048));
    write(a, 'small.txt', 'x');
    const result = await initRepo(a, opts(remote, 'A', { maxFileBytes: 1024 }));
    expect(result).toMatchObject({ pushed: false, largeFiles: ['big.bin'] });
    expect((await simpleGit(a).raw(['ls-remote', remote])).trim()).toBe('');

    const pulled = await pull(a, opts(remote, 'A', { maxFileBytes: 1024 }));
    expect(pulled.largeFiles).toEqual(['big.bin']);
});

test('status reports initialization and pending changes', async () => {
    const remote = await makeRemote();
    const a = tempDir();
    expect(await status(a)).toEqual({ initialized: false, pendingChanges: 0 });
    write(a, 'x.txt', 'x');
    await initRepo(a, opts(remote, 'A'));
    expect(await status(a)).toEqual({ initialized: true, pendingChanges: 0 });
    write(a, 'y.txt', 'y');
    expect((await status(a)).pendingChanges).toBe(1);
});

test('push with nothing new is a no-op that still succeeds', async () => {
    const remote = await makeRemote();
    const a = tempDir();
    write(a, 'x.txt', 'x');
    await initRepo(a, opts(remote, 'A'));
    const result = await push(a, opts(remote, 'A'));
    expect(result).toMatchObject({ pushed: true, updated: false, conflicts: [] });
});

test('pull and push refuse to run in a directory that is not initialized, even inside another repo', async () => {
    const outer = tempDir();
    const outerGit = simpleGit(outer);
    await outerGit.raw(['init', '-b', 'main']);
    write(outer, 'inner/data/x.txt', 'x');
    const inner = path.join(outer, 'inner', 'data');
    const remote = await makeRemote();
    await expect(pull(inner, opts(remote, 'A'))).rejects.toThrow('尚未初始化，請先按「初始化」');
    await expect(push(inner, opts(remote, 'A'))).rejects.toThrow('尚未初始化，請先按「初始化」');
    await expect(outerGit.raw(['rev-parse', '--verify', '-q', 'HEAD']).catch(() => '')).resolves.toBe('');
});

test('isNonFastForward matches push races only', () => {
    expect(isNonFastForward(' ! [rejected]        main -> main (fetch first)')).toBe(true);
    expect(isNonFastForward('! [rejected] main -> main (non-fast-forward)')).toBe(true);
    expect(isNonFastForward(' ! [remote rejected] main -> main (pre-receive hook declined)')).toBe(false);
    expect(isNonFastForward('fatal: Authentication failed')).toBe(false);
});
