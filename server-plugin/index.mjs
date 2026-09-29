import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { initRepo, pull, push, status, isInitialized } from './sync.mjs';
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
    if (/block timeout reached/i.test(message)) {
        return '同步逾時：網路太慢或資料量太大，請改用較穩定的網路後重試（已傳輸的部分不會遺失）。';
    }
    if (AUTH_ERROR.test(message)) {
        return '驗證失敗：請確認 Token 正確，且擁有此倉庫的 Contents 讀寫權限。';
    }
    return message;
}

// git-sync.json is itself synced, so another device may have written anything into it.
function validateSharedSettings({ repoUrl, branch }) {
    let parsed = null;
    try {
        parsed = new URL(repoUrl);
    } catch {
        // handled below
    }
    if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password || !BRANCH_PATTERN.test(branch)) {
        return 'git-sync.json 中的倉庫 URL 或分支不合法（必須是不含帳號密碼的 https:// 網址），請重新儲存設定';
    }
    return null;
}

export function createRoutes(router, {
    loadSecrets = loadSillyTavernSecrets,
    hostname = os.hostname(),
    actions = { init: initRepo, pull, push },
    getStatus = status,
    checkInitialized = isInitialized,
} = {}) {
    const busy = new Set();
    const defaultDevice = defaultDeviceName(hostname);

    // Express 4 ignores rejected async handlers, so every handler goes through here.
    function handle(fn) {
        return async (req, res) => {
            const secrets = [];
            try {
                return await fn(req, res, secrets);
            } catch (error) {
                const message = friendlyMessage(redact(error?.message ?? String(error), secrets));
                console.error('[git-sync]', message);
                if (!res.headersSent) {
                    return res.status(500).json({ error: message });
                }
            }
        };
    }

    function syncRoute(action, { needsInit = true } = {}) {
        return handle(async (req, res, secrets) => {
            const dirs = req.user.directories;
            const dir = dirs.root;
            const { readSecret } = await loadSecrets();
            const token = readSecret(dirs, TOKEN_KEY);
            if (token) {
                secrets.push(token);
            }
            const settings = readSettings(dir, defaultDevice);
            if (!settings.repoUrl) {
                return res.status(400).json({ error: '尚未設定倉庫 URL' });
            }
            if (!token) {
                return res.status(400).json({ error: '尚未設定 Token' });
            }
            const invalid = validateSharedSettings(settings);
            if (invalid) {
                return res.status(400).json({ error: invalid });
            }
            if (needsInit && !checkInitialized(dir)) {
                return res.status(400).json({ error: '尚未初始化，請先按「初始化」' });
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
            } finally {
                busy.delete(dir);
            }
        });
    }

    router.post('/status', handle(async (req, res) => {
        const dirs = req.user.directories;
        const { readSecret } = await loadSecrets();
        const settings = readSettings(dirs.root, defaultDevice);
        const st = await getStatus(dirs.root, settings.branch).catch(() => ({ initialized: false, pendingChanges: 0 }));
        return res.json({ ...settings, ...st, hasToken: Boolean(readSecret(dirs, TOKEN_KEY)) });
    }));

    router.post('/config', handle(async (req, res) => {
        const dirs = req.user.directories;
        const { repoUrl, branch, deviceName, token } = req.body ?? {};
        const shared = {};
        if (typeof repoUrl === 'string' && repoUrl.trim() !== '') {
            let parsed = null;
            try {
                parsed = new URL(repoUrl.trim());
            } catch {
                // handled below
            }
            if (!parsed || parsed.protocol !== 'https:') {
                return res.status(400).json({ error: '倉庫 URL 必須以 https:// 開頭' });
            }
            if (parsed.username || parsed.password) {
                return res.status(400).json({ error: '倉庫 URL 不可包含帳號或密碼，請改在 Token 欄位輸入' });
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
    }));

    router.post('/init', syncRoute(actions.init, { needsInit: false }));
    router.post('/pull', syncRoute(actions.pull));
    router.post('/push', syncRoute(actions.push));
}

export async function init(router) {
    createRoutes(router);
}

export async function exit() {}
