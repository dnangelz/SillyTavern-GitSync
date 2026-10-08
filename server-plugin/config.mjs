import fs from 'node:fs';
import path from 'node:path';
import { normalizeCategories } from './categories.mjs';

export const SHARED_FILE = 'git-sync.json';
export const LOCAL_FILE = 'git-sync.local.json';

function readJson(file) {
    try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
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
        categories: normalizeCategories(local.pushCategories),
    };
}

export function updateShared(dir, patch) {
    mergeJson(path.join(dir, SHARED_FILE), patch);
}

export function updateLocal(dir, patch) {
    mergeJson(path.join(dir, LOCAL_FILE), patch);
}
