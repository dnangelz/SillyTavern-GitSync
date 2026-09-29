import fs from 'node:fs';
import path from 'node:path';
import { conflictCopyPath } from './names.mjs';

export function splitNul(output) {
    return output.split('\0').filter(Boolean);
}

export async function listConflicted(git) {
    return splitNul(await git.raw(['diff', '--name-only', '--diff-filter=U', '-z']));
}

// Stage 2 is the local ("ours") version, stage 3 is the remote ("theirs") version.
async function stagesOf(git, file) {
    const entries = splitNul(await git.raw(['ls-files', '-u', '-z', '--', file]));
    return new Set(entries.map(entry => Number(entry.split('\t')[0].split(' ')[2])));
}

function freeCopyPath(dir, file, deviceName, now) {
    for (let n = 1; ; n++) {
        const candidate = conflictCopyPath(file, deviceName, now, n);
        if (!fs.existsSync(path.join(dir, candidate))) {
            return candidate;
        }
    }
}

export async function resolveConflicts(git, dir, deviceName, now) {
    const saved = [];
    for (const file of await listConflicted(git)) {
        const stages = await stagesOf(git, file);
        if (!stages.has(3)) {
            // Deleted remotely, changed locally: keep the local file.
            await git.raw(['checkout', '--ours', '--', file]);
            await git.raw(['add', '--', file]);
            continue;
        }
        if (!stages.has(2)) {
            // Deleted locally, changed remotely: restore the remote file.
            await git.raw(['checkout', '--theirs', '--', file]);
            await git.raw(['add', '--', file]);
            continue;
        }
        const local = await git.binaryCatFile(['blob', `:2:${file}`]);
        const copy = freeCopyPath(dir, file, deviceName, now);
        fs.writeFileSync(path.join(dir, copy), local);
        await git.raw(['checkout', '--theirs', '--', file]);
        await git.raw(['add', '--', file, copy]);
        saved.push(file);
    }
    return saved;
}
