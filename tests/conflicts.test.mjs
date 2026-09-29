import fs from 'node:fs';
import { simpleGit } from 'simple-git';
import path from 'node:path';
import { initRepo, pull, push } from '../server-plugin/sync.mjs';
import { tempDir, makeRemote, write, read, opts } from './helpers.mjs';

const COPY = 'chats/X/c (衝突 B 2026-09-29 1530).jsonl';

async function twoDevices(files) {
    const remote = await makeRemote();
    const a = tempDir();
    const b = tempDir();
    for (const [rel, content] of Object.entries(files)) {
        write(a, rel, content);
    }
    await initRepo(a, opts(remote, 'A'));
    await initRepo(b, opts(remote, 'B'));
    return { remote, a, b };
}

test('both edit the same chat: remote wins, local kept as a copy, copy reaches the other device', async () => {
    const { remote, a, b } = await twoDevices({ 'chats/X/c.jsonl': 'base\n' });
    write(a, 'chats/X/c.jsonl', 'base\nfromA\n');
    await push(a, opts(remote, 'A'));
    write(b, 'chats/X/c.jsonl', 'base\nfromB\n');

    const result = await push(b, opts(remote, 'B'));

    expect(result).toMatchObject({ pushed: true, updated: true, conflicts: ['chats/X/c.jsonl'] });
    expect(read(b, 'chats/X/c.jsonl').toString()).toBe('base\nfromA\n');
    expect(read(b, COPY).toString()).toBe('base\nfromB\n');
    await pull(a, opts(remote, 'A'));
    expect(read(a, COPY).toString()).toBe('base\nfromB\n');
});

test('binary conflict copy keeps the exact local bytes', async () => {
    const { remote, a, b } = await twoDevices({ 'characters/Alice.png': Buffer.from([1, 2, 3]) });
    write(a, 'characters/Alice.png', Buffer.from([0, 255, 10, 13, 0]));
    await push(a, opts(remote, 'A'));
    const local = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x00, 0xff]);
    write(b, 'characters/Alice.png', local);

    const result = await pull(b, opts(remote, 'B'));

    expect(result.conflicts).toEqual(['characters/Alice.png']);
    expect(read(b, 'characters/Alice (衝突 B 2026-09-29 1530).png')).toEqual(local);
    expect(read(b, 'characters/Alice.png')).toEqual(Buffer.from([0, 255, 10, 13, 0]));
});

test('remote deleted, local edited: keep local, no copy', async () => {
    const { remote, a, b } = await twoDevices({ 'chats/X/d.jsonl': 'v1\n' });
    fs.rmSync(path.join(a, 'chats/X/d.jsonl'));
    await push(a, opts(remote, 'A'));
    write(b, 'chats/X/d.jsonl', 'v1\nlocal\n');

    const result = await pull(b, opts(remote, 'B'));

    expect(result.conflicts).toEqual([]);
    expect(read(b, 'chats/X/d.jsonl').toString()).toBe('v1\nlocal\n');
    expect(fs.readdirSync(path.join(b, 'chats/X'))).toEqual(['d.jsonl']);
});

test('local deleted, remote edited: remote version comes back', async () => {
    const { remote, a, b } = await twoDevices({ 'chats/X/e.jsonl': 'v1\n' });
    write(a, 'chats/X/e.jsonl', 'v1\nremote\n');
    await push(a, opts(remote, 'A'));
    fs.rmSync(path.join(b, 'chats/X/e.jsonl'));

    const result = await pull(b, opts(remote, 'B'));

    expect(result.conflicts).toEqual([]);
    expect(read(b, 'chats/X/e.jsonl').toString()).toBe('v1\nremote\n');
});

test('file names with glob characters are matched literally', async () => {
    const { remote, a, b } = await twoDevices({
        'characters/Alice [v2].png': Buffer.from([1]),
        'characters/Alice v.png': Buffer.from([9]),
    });
    write(a, 'characters/Alice [v2].png', Buffer.from([2, 2]));
    await push(a, opts(remote, 'A'));
    write(b, 'characters/Alice [v2].png', Buffer.from([3, 3, 3]));

    const result = await pull(b, opts(remote, 'B'));

    expect(result.conflicts).toEqual(['characters/Alice [v2].png']);
    expect(read(b, 'characters/Alice [v2].png')).toEqual(Buffer.from([2, 2]));
    expect(read(b, 'characters/Alice [v2] (衝突 B 2026-09-29 1530).png')).toEqual(Buffer.from([3, 3, 3]));
    expect(read(b, 'characters/Alice v.png')).toEqual(Buffer.from([9]));
});

test('a failing merge commit aborts the merge and leaves the repo clean', async () => {
    const { remote, a, b } = await twoDevices({ 'chats/X/c.jsonl': 'base\n' });
    write(a, 'chats/X/c.jsonl', 'base\nfromA\n');
    await push(a, opts(remote, 'A'));
    write(b, 'chats/X/c.jsonl', 'base\nfromB\n');
    const hook = path.join(b, '.git/hooks/commit-msg');
    fs.writeFileSync(hook, '#!/bin/sh\ngrep -q "^Merge" "$1" && { echo "hook rejected merge commit" >&2; exit 1; }\nexit 0\n', { mode: 0o755 });

    await expect(pull(b, opts(remote, 'B'))).rejects.toThrow();

    expect(fs.existsSync(path.join(b, '.git/MERGE_HEAD'))).toBe(false);
    expect(read(b, 'chats/X/c.jsonl').toString()).toBe('base\nfromB\n');
    fs.rmSync(hook);
    const retry = await pull(b, opts(remote, 'B'));
    expect(retry.conflicts).toEqual(['chats/X/c.jsonl']);
    expect(read(b, 'chats/X/c.jsonl').toString()).toBe('base\nfromA\n');
});

test('second conflict in the same minute gets a numbered copy', async () => {
    const { remote, a, b } = await twoDevices({ 'chats/X/c.jsonl': 'base\n' });
    for (const round of [1, 2]) {
        write(a, 'chats/X/c.jsonl', `base\nA${round}\n`);
        await push(a, opts(remote, 'A'));
        write(b, 'chats/X/c.jsonl', `base\nB${round}\n`);
        await push(b, opts(remote, 'B'));
    }
    expect(read(b, COPY).toString()).toBe('base\nB1\n');
    expect(read(b, 'chats/X/c (衝突 B 2026-09-29 1530 2).jsonl').toString()).toBe('base\nB2\n');
});

test('a merge interrupted after conflicts appeared is aborted and redone, never committed with markers', async () => {
    const { remote, a, b } = await twoDevices({ 'chats/X/c.jsonl': 'base\n' });
    write(a, 'chats/X/c.jsonl', 'base\nfromA\n');
    await push(a, opts(remote, 'A'));
    write(b, 'chats/X/c.jsonl', 'base\nfromB\n');
    const git = simpleGit(b);
    await git.raw(['add', '-A']);
    await git.raw(['commit', '-m', 'local']);
    await git.raw(['fetch', remote, '+refs/heads/main:refs/remotes/origin/main']);
    await git.raw(['merge', '--no-edit', 'refs/remotes/origin/main']).catch(() => {});
    expect(fs.existsSync(path.join(b, '.git', 'MERGE_HEAD'))).toBe(true);
    expect(read(b, 'chats/X/c.jsonl').toString()).toContain('<<<<<<<');

    const result = await push(b, opts(remote, 'B'));

    expect(result).toMatchObject({ pushed: true, conflicts: ['chats/X/c.jsonl'] });
    expect(read(b, 'chats/X/c.jsonl').toString()).toBe('base\nfromA\n');
    expect(read(b, COPY).toString()).toBe('base\nfromB\n');
    expect(fs.existsSync(path.join(b, '.git', 'MERGE_HEAD'))).toBe(false);
    await pull(a, opts(remote, 'A'));
    expect(read(a, 'chats/X/c.jsonl').toString()).not.toContain('<<<<<<<');
});

test('add/add: both devices have a different settings.json before initializing', async () => {
    const remote = await makeRemote();
    const a = tempDir();
    const b = tempDir();
    write(a, 'settings.json', '{"from":"A"}');
    await initRepo(a, opts(remote, 'A'));
    write(b, 'settings.json', '{"from":"B"}');

    const result = await initRepo(b, opts(remote, 'B'));

    expect(result).toMatchObject({ pushed: true, conflicts: ['settings.json'] });
    expect(read(b, 'settings.json').toString()).toBe('{"from":"A"}');
    expect(read(b, 'settings (衝突 B 2026-09-29 1530).json').toString()).toBe('{"from":"B"}');
});
