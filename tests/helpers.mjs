import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';

export function tempDir(prefix = 'gitsync-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// A bare repository standing in for GitHub.
export async function makeRemote() {
    const dir = tempDir('remote-');
    await simpleGit(dir).raw(['init', '--bare', '-b', 'main']);
    return dir;
}

export function write(dir, rel, content) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
}

export function read(dir, rel) {
    return fs.readFileSync(path.join(dir, rel));
}

export function opts(remote, deviceName, extra = {}) {
    return { remoteUrl: remote, branch: 'main', token: '', deviceName, now: new Date(2026, 8, 29, 15, 30), ...extra };
}
