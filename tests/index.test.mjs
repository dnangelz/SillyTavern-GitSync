import { createRoutes, info, TOKEN_KEY } from '../server-plugin/index.mjs';
import { readSettings } from '../server-plugin/config.mjs';
import { jest } from '@jest/globals';
import { tempDir } from './helpers.mjs';

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

function setup(actions = {}, deps = {}) {
    const routes = {};
    const router = { post: (route, handler) => { routes[route] = handler; } };
    const store = {};
    const loadSecrets = deps.loadSecrets ?? (async () => ({
        readSecret: (_dirs, key) => store[key] ?? '',
        writeSecret: (_dirs, key, value) => { store[key] = value; },
    }));
    const ok = async () => ({ pushed: true, updated: false, conflicts: [], largeFiles: [], caseCollisions: [] });
    createRoutes(router, {
        loadSecrets,
        hostname: 'MY-PC',
        checkInitialized: () => true,
        actions: { init: ok, pull: ok, push: ok, ...actions },
        ...deps,
    });
    const dir = tempDir();
    const call = async (route, body = {}) => {
        const res = {
            statusCode: 200,
            body: null,
            status(code) { this.statusCode = code; return this; },
            json(data) { this.body = data; return this; },
        };
        await routes[route]({ body, user: { directories: { root: dir } } }, res);
        return res;
    };
    return { call, store, dir };
}

test('plugin info uses the git-sync id', () => {
    expect(info.id).toBe('git-sync');
});

test('config validates URL and branch', async () => {
    const { call } = setup();
    expect((await call('/config', { repoUrl: 'http://x/y.git' })).statusCode).toBe(400);
    expect((await call('/config', { repoUrl: 'file:///etc' })).statusCode).toBe(400);
    expect((await call('/config', { branch: '--upload-pack=evil' })).statusCode).toBe(400);
});

test('config stores settings, sanitized device name and token; status reflects them', async () => {
    const { call, store } = setup();
    const res = await call('/config', { repoUrl: 'https://github.com/u/r.git', branch: 'main', deviceName: 'my:phone', token: ' tok ' });
    expect(res.body).toEqual({ ok: true });
    expect(store[TOKEN_KEY]).toBe('tok');

    const st = await call('/status');
    expect(st.body).toMatchObject({ repoUrl: 'https://github.com/u/r.git', branch: 'main', deviceName: 'myphone', hasToken: true, initialized: false });
});

test('status defaults device name from hostname and never returns the token', async () => {
    const { call } = setup();
    await call('/config', { token: 'secret-token' });
    const st = await call('/status');
    expect(st.body.deviceName).toBe('MY-PC');
    expect(JSON.stringify(st.body)).not.toContain('secret-token');
});

test('sync routes require URL and token', async () => {
    const { call } = setup();
    expect((await call('/push')).body.error).toBe('尚未設定倉庫 URL');
    await call('/config', { repoUrl: 'https://github.com/u/r.git' });
    expect((await call('/push')).body.error).toBe('尚未設定 Token');
});

test('concurrent sync for the same user returns 409', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const slow = async () => { await gate; return { pushed: true, updated: false, conflicts: [], largeFiles: [], caseCollisions: [] }; };
    const { call } = setup({ push: slow, pull: slow });
    await call('/config', { repoUrl: 'https://github.com/u/r.git', token: 'tok' });
    const first = call('/push');
    const second = await call('/pull');
    expect(second.statusCode).toBe(409);
    release();
    expect((await first).statusCode).toBe(200);
});

test('successful sync records lastSync; blocked sync does not', async () => {
    const blocked = async () => ({ pushed: false, updated: false, conflicts: [], largeFiles: ['big.bin'], caseCollisions: [] });
    const { call, dir } = setup({ pull: blocked });
    await call('/config', { repoUrl: 'https://github.com/u/r.git', token: 'tok' });
    await call('/pull');
    expect(readSettings(dir, 'x').lastSync).toBeNull();
    const res = await call('/push');
    expect(res.body).toMatchObject({ ok: true, pushed: true });
    expect(readSettings(dir, 'x').lastSync).toMatch(/^\d{4}-\d\d-\d\dT/);
});

test('errors are redacted and auth failures get a friendly message', async () => {
    const leak = async () => { throw new Error('fatal: unable to access https://x-access-token:tok123@github.com/u/r.git/: boom'); };
    const auth = async () => { throw new Error('remote: Invalid username or password.\nfatal: Authentication failed for https://github.com/u/r.git/'); };
    const { call } = setup({ push: leak, pull: auth });
    await call('/config', { repoUrl: 'https://github.com/u/r.git', token: 'tok123' });

    const leaked = await call('/push');
    expect(leaked.statusCode).toBe(500);
    expect(leaked.body.error).not.toContain('tok123');

    const denied = await call('/pull');
    expect(denied.body.error).toContain('驗證失敗');
});

test('a failing loadSecrets yields 500 instead of hanging', async () => {
    const { call } = setup({}, { loadSecrets: async () => { throw new Error('cannot import secrets'); } });
    for (const route of ['/status', '/config', '/push']) {
        const res = await call(route, { token: 'x' });
        expect(res.statusCode).toBe(500);
        expect(res.body.error).toContain('cannot import secrets');
    }
});

test('config rejects URLs with embedded credentials and saves nothing', async () => {
    const { call, dir } = setup();
    const res = await call('/config', { repoUrl: 'https://u:p@github.com/u/r.git', branch: 'dev' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('不可包含帳號或密碼');
    expect(readSettings(dir, 'x').repoUrl).toBe('');
    expect((await call('/config', { repoUrl: 'not a url' })).statusCode).toBe(400);
});

test('pull/push on an uninitialized folder return 400; init is still allowed', async () => {
    const { call } = setup({}, { checkInitialized: () => false });
    await call('/config', { repoUrl: 'https://github.com/u/r.git', token: 'tok' });
    for (const route of ['/pull', '/push']) {
        const res = await call(route);
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('尚未初始化，請先按「初始化」');
    }
    expect((await call('/init')).statusCode).toBe(200);
});
