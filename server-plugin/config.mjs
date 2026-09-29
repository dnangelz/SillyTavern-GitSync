import fs from 'node:fs';
import path from 'node:path';

export const SHARED_FILE = 'git-sync.json';
export const LOCAL_FILE = 'git-sync.local.json';

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return {};
    }
}

function mergeJson(file, patch) {
    fs.writeFileSync(file, JSON.stringify({ ...readJson(file), ...patch }, null, 4));
}

export function readSettings(dir, defaultDevice) {
    const shared = readJson(path.join(dir, SHARED_FILE));
    const local = readJson(path.join(dir, LOCAL_FILE));
    return {
        repoUrl: shared.repoUrl ?? '',
        branch: shared.branch || 'main',
        deviceName: local.deviceName || defaultDevice,
        lastSync: local.lastSync ?? null,
    };
}

export function updateShared(dir, patch) {
    mergeJson(path.join(dir, SHARED_FILE), patch);
}

export function updateLocal(dir, patch) {
    mergeJson(path.join(dir, LOCAL_FILE), patch);
}
