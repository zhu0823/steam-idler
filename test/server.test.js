const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { EventEmitter } = require('events');
const { Auth } = require('../src/auth');
const { buildServer, parseTrustProxy } = require('../src/server');

const quietLog = Object.assign(new EventEmitter(), {
  info() {},
  warn() {},
  error() {},
  recent: () => [],
  bus: new EventEmitter(),
});

function makeApp({ trustProxy = false } = {}) {
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
  const app = buildServer({ auth, idler, loginFlow, log: quietLog, trustProxy });
  return { app, auth, idler };
}

const json = (method, url, payload, headers = {}) => ({
  method,
  url,
  payload: JSON.stringify(payload || {}),
  headers: { 'content-type': 'application/json', 'x-requested-with': 'steam-idler', host: 'nas.local:8080', ...headers },
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

test('写操作需要 JSON 和自定义请求头，不依赖 Host', async () => {
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

  const noHeader = await app.inject(json('POST', '/api/idler/pause', {}, { cookie, 'x-requested-with': '' }));
  assert.strictEqual(noHeader.statusCode, 403);

  const cross = await app.inject(json('POST', '/api/idler/pause', {}, { cookie, 'sec-fetch-site': 'cross-site' }));
  assert.strictEqual(cross.statusCode, 403);

  // 反向代理改写了 Host（Nginx 默认配置），Origin 与 Host 不一致也应正常工作
  const proxied = await app.inject(
    json('POST', '/api/idler/pause', {}, {
      cookie,
      host: '127.0.0.1:8080',
      origin: 'https://idler.example.com',
      'sec-fetch-site': 'same-origin',
    }),
  );
  assert.strictEqual(proxied.statusCode, 200);
  assert.strictEqual(proxied.json().paused, true);
});

test('TRUST_PROXY=true 只信任内网来源的 X-Forwarded-For', async () => {
  assert.strictEqual(parseTrustProxy(''), false);
  assert.strictEqual(parseTrustProxy('false'), false);
  assert.strictEqual(parseTrustProxy('10.0.0.1/8'), '10.0.0.1/8');

  const { app } = makeApp({ trustProxy: parseTrustProxy('true') });
  app.get('/test-ip', async (req) => ({ ip: req.ip }));
  const viaProxy = await app.inject({ method: 'GET', url: '/test-ip', remoteAddress: '172.18.0.1', headers: { 'x-forwarded-for': '203.0.113.9' } });
  assert.strictEqual(viaProxy.json().ip, '203.0.113.9');
  const spoofed = await app.inject({ method: 'GET', url: '/test-ip', remoteAddress: '198.51.100.7', headers: { 'x-forwarded-for': '1.2.3.4' } });
  assert.strictEqual(spoofed.json().ip, '198.51.100.7');
});

test('退出面板后被复制的 Cookie 也失效', async () => {
  const { app, auth } = makeApp();
  const cookie = cookieOf(await app.inject(json('POST', '/api/auth/setup', { code: auth.ensureSetupCode(), password: 'password123' })));
  assert.strictEqual((await app.inject({ method: 'GET', url: '/api/status', headers: { cookie } })).statusCode, 200);
  await app.inject(json('POST', '/api/auth/logout', {}, { cookie }));
  assert.strictEqual((await app.inject({ method: 'GET', url: '/api/status', headers: { cookie } })).statusCode, 401);
});

test('修改密码后已打开的 SSE 连接被断开', async () => {
  const { app, auth } = makeApp();
  const cookie = cookieOf(await app.inject(json('POST', '/api/auth/setup', { code: auth.ensureSetupCode(), password: 'password123' })));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address();
  try {
    const body = await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/events', headers: { cookie } }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
          // 收到初始数据后修改密码
          if (data.includes('event: logs') && !data.includes('event: auth')) {
            auth.changePassword('1.1.1.1', 'password123', 'another-pass-1').catch(reject);
          }
        });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      setTimeout(() => reject(new Error('SSE 连接未被断开')), 5_000).unref();
    });
    assert.match(body, /event: auth\ndata: \{"authenticated":false\}/);
  } finally {
    await app.close();
  }
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

test('修改密码后旧 Cookie 失效，退出面板清除 Cookie', async () => {
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
