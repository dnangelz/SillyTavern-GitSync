import fs from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { findCaseCollisions } from './names.mjs';
import { listConflicted, resolveConflicts } from './conflicts.mjs';

export const GITIGNORE_ENTRIES = ['secrets.json', 'git-sync.local.json', 'extensions/', 'thumbnails/', 'backups/', 'vectors/'];
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

// simple-git rejects these variables as unsafe; Termux always sets PREFIX and VS Code sets GIT_ASKPASS.
const DROPPED_ENV = /^(GIT_.*|SSH_ASKPASS|EDITOR|VISUAL|PAGER|PREFIX|LANGUAGE|LC_.*)$/;

export function gitEnv(source = process.env) {
    const env = {};
    for (const [key, value] of Object.entries(source)) {
        if (value !== undefined && !DROPPED_ENV.test(key)) {
            env[key] = value;
        }
    }
    env.GIT_TERMINAL_PROMPT = '0';
    env.LC_ALL = 'C'; // error matching below relies on English git output
    return env;
}

export function gitFor(dir) {
    return simpleGit({
        baseDir: dir,
        config: ['credential.helper='],
        timeout: { block: 120_000 },
        unsafe: { allowUnsafeCredentialHelper: true },
    }).env(gitEnv());
}

export function authUrl(remoteUrl, token) {
    if (!token || !/^https:\/\//i.test(remoteUrl)) {
        return remoteUrl;
    }
    const url = new URL(remoteUrl);
    url.username = 'x-access-token';
    url.password = token;
    return url.toString();
}

export function isInitialized(dir) {
    return fs.existsSync(path.join(dir, '.git'));
}

export function ensureGitignore(dir) {
    const file = path.join(dir, '.gitignore');
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const present = new Set(existing.split(/\r?\n/).map(line => line.trim()));
    const missing = GITIGNORE_ENTRIES.filter(entry => !present.has(entry));
    if (missing.length === 0) {
        return;
    }
    const separator = existing && !existing.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(file, existing + separator + missing.join('\n') + '\n');
}

async function applyRepoConfig(git, deviceName) {
    const settings = {
        'core.autocrlf': 'false',
        'core.fileMode': 'false',
        'core.quotePath': 'false',
        'user.name': deviceName,
        'user.email': 'git-sync@sillytavern.local',
    };
    for (const [key, value] of Object.entries(settings)) {
        await git.addConfig(key, value);
    }
}

function withDefaults(options) {
    return { branch: 'main', token: '', deviceName: 'device', now: new Date(), maxFileBytes: MAX_FILE_BYTES, ...options };
}

async function headSha(git) {
    const out = await git.raw(['rev-parse', '--verify', '-q', 'HEAD']).catch(() => '');
    return out.trim();
}

async function checkPending(git, dir, maxFileBytes) {
    const st = await git.status();
    const largeFiles = st.files
        .map(file => file.path)
        .filter(rel => {
            const full = path.join(dir, rel);
            return fs.existsSync(full) && fs.statSync(full).isFile() && fs.statSync(full).size > maxFileBytes;
        });
    const tracked = (await git.raw(['ls-files', '-z'])).split('\0').filter(Boolean);
    const caseCollisions = findCaseCollisions([...new Set([...tracked, ...st.not_added])]);
    return { largeFiles, caseCollisions };
}

async function commitAll(git, deviceName, now) {
    await git.raw(['add', '-A']);
    const hasHead = (await headSha(git)) !== '';
    const staged = (await git.raw(['diff', '--cached', '--name-only', '-z'])).length > 0;
    if (hasHead && !staged) {
        return;
    }
    // An empty root commit lets a brand-new device merge the remote history.
    await git.raw(['commit', '--allow-empty', '-m', `sync: ${deviceName} ${now.toISOString()}`]);
}

async function fetchRemote(git, url, branch) {
    try {
        await git.raw(['fetch', url, `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
        return true;
    } catch (error) {
        if (/couldn't find remote ref/i.test(String(error?.message))) {
            return false;
        }
        throw error;
    }
}

async function mergeRemote(git, dir, o) {
    const before = await headSha(git);
    let mergeError = null;
    try {
        await git.raw(['merge', '--no-edit', '--allow-unrelated-histories', `refs/remotes/origin/${o.branch}`]);
    } catch (error) {
        mergeError = error;
    }
    const conflicted = await listConflicted(git);
    if (conflicted.length > 0) {
        const conflicts = await resolveConflicts(git, dir, o.deviceName, o.now);
        await git.raw(['commit', '--no-edit']);
        return { updated: true, conflicts };
    }
    if (mergeError) {
        await git.raw(['merge', '--abort']).catch(() => {});
        throw mergeError;
    }
    return { updated: (await headSha(git)) !== before, conflicts: [] };
}

async function syncDown(git, dir, o) {
    await commitAll(git, o.deviceName, o.now);
    if (!(await fetchRemote(git, authUrl(o.remoteUrl, o.token), o.branch))) {
        return { updated: false, conflicts: [] };
    }
    return mergeRemote(git, dir, o);
}

async function prepare(dir, options) {
    const o = withDefaults(options);
    const git = gitFor(dir);
    await applyRepoConfig(git, o.deviceName);
    ensureGitignore(dir);
    const blocked = await checkPending(git, dir, o.maxFileBytes);
    return { o, git, blocked };
}

function blockedResult(blocked) {
    if (blocked.largeFiles.length === 0 && blocked.caseCollisions.length === 0) {
        return null;
    }
    return { pushed: false, updated: false, conflicts: [], ...blocked };
}

function requireInitialized(dir) {
    if (!isInitialized(dir)) {
        throw new Error('尚未初始化，請先按「初始化」');
    }
}

export function isNonFastForward(message) {
    return /fetch first|non-fast-forward|\[rejected\]/i.test(message);
}

export async function pull(dir, options) {
    requireInitialized(dir);
    const { o, git, blocked } = await prepare(dir, options);
    const stop = blockedResult(blocked);
    if (stop) {
        return stop;
    }
    const down = await syncDown(git, dir, o);
    return { pushed: false, ...down, largeFiles: [], caseCollisions: [] };
}

export async function push(dir, options) {
    requireInitialized(dir);
    const { o, git, blocked } = await prepare(dir, options);
    const stop = blockedResult(blocked);
    if (stop) {
        return stop;
    }
    const url = authUrl(o.remoteUrl, o.token);
    const refspec = `HEAD:refs/heads/${o.branch}`;
    let down = await syncDown(git, dir, o);
    try {
        await git.raw(['push', url, refspec]);
    } catch (error) {
        if (!isNonFastForward(String(error?.message))) {
            throw error;
        }
        const retry = await syncDown(git, dir, o);
        down = { updated: down.updated || retry.updated, conflicts: [...down.conflicts, ...retry.conflicts] };
        await git.raw(['push', url, refspec]);
    }
    await git.raw(['update-ref', `refs/remotes/origin/${o.branch}`, 'HEAD']);
    return { pushed: true, ...down, largeFiles: [], caseCollisions: [] };
}

export async function initRepo(dir, options) {
    const o = withDefaults(options);
    if (!isInitialized(dir)) {
        await gitFor(dir).raw(['init', '-b', o.branch]);
    }
    const git = gitFor(dir);
    await git.raw(['remote', 'remove', 'origin']).catch(() => {});
    await git.raw(['remote', 'add', 'origin', o.remoteUrl]);
    return push(dir, options);
}

export async function status(dir, branch = 'main') {
    if (!isInitialized(dir)) {
        return { initialized: false, pendingChanges: 0 };
    }
    const git = gitFor(dir);
    const st = await git.status();
    const ahead = await git.raw(['rev-list', '--count', `refs/remotes/origin/${branch}..HEAD`]).catch(() => '0');
    return { initialized: true, pendingChanges: st.files.length + Number(ahead.trim() || 0) };
}
