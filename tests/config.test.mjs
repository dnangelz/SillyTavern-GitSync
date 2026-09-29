import fs from 'node:fs';
import path from 'node:path';
import { readSettings, updateShared, updateLocal } from '../server-plugin/config.mjs';
import { tempDir } from './helpers.mjs';

test('returns defaults when no files exist', () => {
    const dir = tempDir();
    expect(readSettings(dir, 'PC')).toEqual({ repoUrl: '', branch: 'main', deviceName: 'PC', lastSync: null });
});

test('merges patches into the shared and local files', () => {
    const dir = tempDir();
    updateShared(dir, { repoUrl: 'https://github.com/u/r.git' });
    updateShared(dir, { branch: 'data' });
    updateLocal(dir, { deviceName: 'phone' });
    updateLocal(dir, { lastSync: '2026-09-29T07:30:00.000Z' });
    expect(readSettings(dir, 'PC')).toEqual({
        repoUrl: 'https://github.com/u/r.git',
        branch: 'data',
        deviceName: 'phone',
        lastSync: '2026-09-29T07:30:00.000Z',
    });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'git-sync.json'), 'utf8'))).toEqual({ repoUrl: 'https://github.com/u/r.git', branch: 'data' });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'git-sync.local.json'), 'utf8')).deviceName).toBe('phone');
});

test('treats a corrupt file as empty', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'git-sync.json'), '{not json');
    expect(readSettings(dir, 'PC').repoUrl).toBe('');
});

test('treats valid JSON that is not an object as empty', () => {
    const dir = tempDir();
    for (const content of ['null', '[1]', '"x"', '5']) {
        fs.writeFileSync(path.join(dir, 'git-sync.json'), content);
        expect(readSettings(dir, 'PC').repoUrl).toBe('');
        updateShared(dir, { branch: 'dev' });
        expect(readSettings(dir, 'PC').branch).toBe('dev');
        fs.rmSync(path.join(dir, 'git-sync.json'));
    }
});
