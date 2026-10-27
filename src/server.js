// 管理面板 HTTP 服务：认证、接口、SSE 推送与前端静态文件
const fs = require('fs');
const path = require('path');
const Fastify = require('fastify');

const COOKIE = 'sid';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

/**
 * @param {object} deps
 * @param {import('./auth').Auth} deps.auth
 * @param {import('./idler').Idler} deps.idler
 * @param {import('./steam-login').LoginFlow} deps.loginFlow
 * @param {object} deps.log
 * @param {string} [deps.staticDir] 前端构建产物目录
 * @param {boolean} [deps.trustProxy]
 */
function buildServer({ auth, idler, loginFlow, log, staticDir, trustProxy = false }) {
  const app = Fastify({ logger: false, trustProxy, bodyLimit: 64 * 1024 });
  app.register(require('@fastify/cookie'));

  app.addHook('onSend', async (_req, reply, payload) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) reply.header(k, v);
    return payload;
  });

  // CSRF 防护：写操作只接受 JSON，且 Origin 必须与当前站点一致
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') || !MUTATING.has(req.method)) return;
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      return reply.code(415).send({ error: '请求必须为 JSON' });
    }
    const origin = req.headers.origin;
    if (origin) {
      let host;
      try {
        host = new URL(origin).host;
      } catch {
        host = null;
      }
      if (host !== req.headers.host) return reply.code(403).send({ error: '跨站请求被拒绝' });
    }
  });

  function setSession(req, reply, { token, maxAge }) {
    reply.setCookie(COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: req.protocol === 'https',
      maxAge,
    });
  }

  function requireAuth(req, reply, done) {
    if (!auth.verifySession(req.cookies[COOKIE])) {
      reply.code(401).send({ error: auth.isInitialized() ? '未登录' : '尚未初始化' });
      return;
    }
    done();
  }

  app.setErrorHandler((err, _req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) log.error(`接口错误：${err.message}`);
    reply.code(status).send({ error: status === 500 ? '服务器内部错误' : err.message });
  });

  // ---------- 面板认证 ----------

  app.get('/api/auth/state', async (req) => ({
    initialized: auth.isInitialized(),
    authenticated: auth.verifySession(req.cookies[COOKIE]),
  }));

  app.post('/api/auth/setup', async (req, reply) => {
    const { code, password } = req.body || {};
    const session = await auth.setup(req.ip, code, password);
    log.info('管理员密码已创建，初始化完成');
    setSession(req, reply, session);
    return { ok: true };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const session = await auth.login(req.ip, (req.body || {}).password);
    setSession(req, reply, session);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---------- 需要登录的接口 ----------

  app.register(async (api) => {
    api.addHook('preHandler', requireAuth);

    api.post('/api/auth/password', async (req, reply) => {
      const { current, next } = req.body || {};
      const session = await auth.changePassword(req.ip, current, next);
      log.info('管理员密码已修改');
      setSession(req, reply, session);
      return { ok: true };
    });

    api.get('/api/status', async () => ({ idler: idler.status(), login: loginFlow.status() }));

    api.get('/api/logs', async () => log.recent());

    api.get('/api/config', async () => idler.config);

    api.put('/api/config', async (req) => {
      const { maxConcurrent, hoursUntilDrops, checkIntervalMinutes, skipAppIds, personaState, machineName } = req.body || {};
      const patch = Object.fromEntries(
        Object.entries({ maxConcurrent, hoursUntilDrops, checkIntervalMinutes, skipAppIds, personaState, machineName })
          .filter(([, v]) => v !== undefined),
      );
      try {
        const config = idler.setConfig(patch);
        log.info('挂卡配置已更新');
        return config;
      } catch (err) {
        err.statusCode = err.statusCode || 400;
        throw err;
      }
    });

    api.post('/api/idler/pause', async () => idler.setConfig({ paused: true }));
    api.post('/api/idler/resume', async () => idler.setConfig({ paused: false }));
    api.post('/api/idler/check', async () => {
      idler.checkNow();
      return { ok: true };
    });

    api.post('/api/steam/login/qr', async () => loginFlow.startQR());

    api.post('/api/steam/login/credentials', async (req) => {
      const { accountName, password } = req.body || {};
      return loginFlow.startCredentials(String(accountName || '').trim(), String(password || ''));
    });

    api.post('/api/steam/login/code', async (req) => loginFlow.submitCode((req.body || {}).code));

    api.post('/api/steam/login/cancel', async () => {
      loginFlow.cancel();
      return loginFlow.status();
    });

    api.post('/api/steam/logout', async () => {
      loginFlow.cancel();
      await idler.logout();
      return { ok: true };
    });

    // 服务端推送：挂卡状态、登录流程、日志
    api.get('/api/events', (req, reply) => {
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const onStatus = (s) => send('status', s);
      const onLogin = (s) => send('login', s);
      const onLog = (e) => send('log', e);

      send('status', idler.status());
      send('login', loginFlow.status());
      send('logs', log.recent());
      idler.on('status', onStatus);
      loginFlow.on('update', onLogin);
      log.bus.on('entry', onLog);
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

      req.raw.on('close', () => {
        clearInterval(heartbeat);
        idler.off('status', onStatus);
        loginFlow.off('update', onLogin);
        log.bus.off('entry', onLog);
      });
    });
  });

  // ---------- 前端静态文件 ----------

  const hasStatic = staticDir && fs.existsSync(path.join(staticDir, 'index.html'));
  if (hasStatic) {
    app.register(require('@fastify/static'), { root: staticDir, wildcard: true });
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && hasStatic) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ error: '未找到' });
  });

  return app;
}

module.exports = { buildServer };
