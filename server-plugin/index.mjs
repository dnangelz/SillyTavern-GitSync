import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { initRepo, pull, push, status } from './sync.mjs';
import { readSettings, updateShared, updateLocal } from './config.mjs';
import { defaultDeviceName, sanitizeDeviceName } from './names.mjs';
import { redact } from './redact.mjs';

export const TOKEN_KEY = 'git_sync_token';
const BRANCH_PATTERN = /^[A-Za-z0-9._/][A-Za-z0-9._/-]*$/;
const AUTH_ERROR = /Authentication failed|Invalid username or password|could not read Username|terminal prompts disabled|\b40[13]\b/i;

export const info = {
    id: 'git-sync',
    name: 'Git Sync',
    description: 'Sync the SillyTavern user data folder with a Git repository.',
};

// SillyTavern chdirs to its root on startup; importing by absolute path keeps
// this working when the plugin folder is a junction into another repo.
function loadSillyTavernSecrets() {
    return import(pathToFileURL(path.join(process.cwd(), 'src/endpoints/secrets.js')).href);
}

function friendlyMessage(message) {
    if (AUTH_ERROR.test(message)) {
        return '驗證失敗：請確認 Token 正確，且擁有此倉庫的 Contents 讀寫權限。';
    }
    return message;
}

export function createRoutes(router, {
    loadSecrets = loadSillyTavernSecrets,
    hostname = os.hostname(),
    actions = { init: initRepo, pull, push },
    getStatus = status,
} = {}) {
    const busy = new Set();
    const defaultDevice = defaultDeviceName(hostname);

    function syncRoute(action) {
        return async (req, res) => {
            const dirs = req.user.directories;
            const dir = dirs.root;
            const { readSecret } = await loadSecrets();
            const token = readSecret(dirs, TOKEN_KEY);
            const settings = readSettings(dir, defaultDevice);
            if (!settings.repoUrl) {
                return res.status(400).json({ error: '尚未設定倉庫 URL' });
            }
            if (!token) {
                return res.status(400).json({ error: '尚未設定 Token' });
            }
            if (busy.has(dir)) {
                return res.status(409).json({ error: '同步進行中，請稍候' });
            }
            busy.add(dir);
            try {
                const result = await action(dir, {
                    remoteUrl: settings.repoUrl,
                    branch: settings.branch,
                    token,
                    deviceName: settings.deviceName,
                });
                if (result.largeFiles.length === 0 && result.caseCollisions.length === 0) {
                    updateLocal(dir, { lastSync: new Date().toISOString() });
                }
                return res.json({ ok: true, ...result });
            } catch (error) {
                const message = friendlyMessage(redact(error?.message ?? String(error), [token]));
                console.error('[git-sync]', message);
                return res.status(500).json({ error: message });
            } finally {
                busy.delete(dir);
            }
        };
    }

    router.post('/status', async (req, res) => {
        const dirs = req.user.directories;
        const { readSecret } = await loadSecrets();
        const settings = readSettings(dirs.root, defaultDevice);
        const st = await getStatus(dirs.root, settings.branch).catch(() => ({ initialized: false, pendingChanges: 0 }));
        return res.json({ ...settings, ...st, hasToken: Boolean(readSecret(dirs, TOKEN_KEY)) });
    });

    router.post('/config', async (req, res) => {
        const dirs = req.user.directories;
        const { repoUrl, branch, deviceName, token } = req.body ?? {};
        const shared = {};
        if (typeof repoUrl === 'string' && repoUrl.trim() !== '') {
            if (!/^https:\/\//i.test(repoUrl.trim())) {
                return res.status(400).json({ error: '倉庫 URL 必須以 https:// 開頭' });
            }
            shared.repoUrl = repoUrl.trim();
        }
        if (typeof branch === 'string' && branch.trim() !== '') {
            if (!BRANCH_PATTERN.test(branch.trim())) {
                return res.status(400).json({ error: '分支名稱不合法' });
            }
            shared.branch = branch.trim();
        }
        if (Object.keys(shared).length > 0) {
            updateShared(dirs.root, shared);
        }
        if (typeof deviceName === 'string' && deviceName.trim() !== '') {
            updateLocal(dirs.root, { deviceName: sanitizeDeviceName(deviceName) });
        }
        if (typeof token === 'string' && token.trim() !== '') {
            const { writeSecret } = await loadSecrets();
            writeSecret(dirs, TOKEN_KEY, token.trim());
        }
        return res.json({ ok: true });
    });

    router.post('/init', syncRoute(actions.init));
    router.post('/pull', syncRoute(actions.pull));
    router.post('/push', syncRoute(actions.push));
}

export async function init(router) {
    createRoutes(router);
}

export async function exit() {}
