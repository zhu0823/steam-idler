const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { Auth } = require('../src/auth');
const { buildServer } = require('../src/server');

const quietLog = Object.assign(new EventEmitter(), {
  info() {},
  warn() {},
  error() {},
  recent: () => [],
  bus: new EventEmitter(),
});

function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idler-server-'));
  const auth = new Auth({ files: { admin: path.join(dir, 'admin.json'), setupCode: path.join(dir, 'setup_code') } });
  const idler = Object.assign(new EventEmitter(), {
    config: { maxConcurrent: 32, paused: false },
    calls: [],
    status() {
      return { state: 'logged_out', config: this.config };
    },
    setConfig(patch) {
      if (patch.personaState === 'busy') throw new Error('personaState 只能是 online / invisible / offline');
      this.calls.push(patch);
      this.config = { ...this.config, ...patch };
      return this.config;
    },
    checkNow() {},
    async logout() {},
  });
  const loginFlow = Object.assign(new EventEmitter(), {
    status: () => ({ state: 'idle' }),
    cancel() {},
  });
  const app = buildServer({ auth, idler, loginFlow, log: quietLog });
  return { app, auth, idler };
}

const json = (method, url, payload, headers = {}) => ({
  method,
  url,
  payload: JSON.stringify(payload || {}),
  headers: { 'content-type': 'application/json', host: 'nas.local:8080', ...headers },
});

function cookieOf(res) {
  const c = res.cookies.find((x) => x.name === 'sid');
  return c && `sid=${c.value}`;
}

test('初始化前受保护接口返回 401，初始化后获得会话 Cookie', async () => {
  const { app, auth } = makeApp();
  const state = await app.inject({ method: 'GET', url: '/api/auth/state' });
  assert.deepStrictEqual(state.json(), { initialized: false, authenticated: false });

  assert.strictEqual((await app.inject({ method: 'GET', url: '/api/status' })).statusCode, 401);

  const code = auth.ensureSetupCode();
  const bad = await app.inject(json('POST', '/api/auth/setup', { code: 'AAAAAAAA', password: 'password123' }));
  assert.strictEqual(bad.statusCode, 403);

  const ok = await app.inject(json('POST', '/api/auth/setup', { code, password: 'password123' }));
  assert.strictEqual(ok.statusCode, 200);
  const sc = ok.cookies.find((c) => c.name === 'sid');
  assert.ok(sc.httpOnly);
  assert.strictEqual(sc.sameSite, 'Strict');

  const status = await app.inject({ method: 'GET', url: '/api/status', headers: { cookie: cookieOf(ok) } });
  assert.strictEqual(status.statusCode, 200);
  assert.strictEqual(status.json().idler.state, 'logged_out');
  assert.strictEqual(status.headers['x-frame-options'], 'DENY');
});

test('写操作需要 JSON 且同源', async () => {
  const { app, auth } = makeApp();
  const res = await app.inject(json('POST', '/api/auth/setup', { code: auth.ensureSetupCode(), password: 'password123' }));
  const cookie = cookieOf(res);

  const form = await app.inject({
    method: 'POST',
    url: '/api/idler/pause',
    payload: 'a=1',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
  });
  assert.strictEqual(form.statusCode, 415);

  const cross = await app.inject(json('POST', '/api/idler/pause', {}, { cookie, origin: 'https://evil.example' }));
  assert.strictEqual(cross.statusCode, 403);

  const same = await app.inject(json('POST', '/api/idler/pause', {}, { cookie, origin: 'http://nas.local:8080' }));
  assert.strictEqual(same.statusCode, 200);
  assert.strictEqual(same.json().paused, true);
});

test('配置接口只接受白名单字段，非法值返回 400', async () => {
  const { app, auth, idler } = makeApp();
  const cookie = cookieOf(await app.inject(json('POST', '/api/auth/setup', { code: auth.ensureSetupCode(), password: 'password123' })));

  const ok = await app.inject(json('PUT', '/api/config', { maxConcurrent: 8, paused: true, evil: 1 }, { cookie }));
  assert.strictEqual(ok.statusCode, 200);
  assert.deepStrictEqual(idler.calls.at(-1), { maxConcurrent: 8 });

  const bad = await app.inject(json('PUT', '/api/config', { personaState: 'busy' }, { cookie }));
  assert.strictEqual(bad.statusCode, 400);
  assert.match(bad.json().error, /personaState/);
});

test('退出面板后会话失效；修改密码后旧 Cookie 失效', async () => {
  const { app, auth } = makeApp();
  const first = cookieOf(await app.inject(json('POST', '/api/auth/setup', { code: auth.ensureSetupCode(), password: 'password123' })));

  const changed = await app.inject(json('POST', '/api/auth/password', { current: 'password123', next: 'another-pass-1' }, { cookie: first }));
  assert.strictEqual(changed.statusCode, 200);
  assert.strictEqual((await app.inject({ method: 'GET', url: '/api/status', headers: { cookie: first } })).statusCode, 401);
  assert.strictEqual((await app.inject({ method: 'GET', url: '/api/status', headers: { cookie: cookieOf(changed) } })).statusCode, 200);

  const logout = await app.inject(json('POST', '/api/auth/logout', {}, { cookie: cookieOf(changed) }));
  const cleared = logout.cookies.find((c) => c.name === 'sid');
  assert.strictEqual(cleared.value, '');
});

test('未知接口返回 404 JSON', async () => {
  const { app } = makeApp();
  const res = await app.inject({ method: 'GET', url: '/api/nope' });
  assert.strictEqual(res.statusCode, 404);
});
