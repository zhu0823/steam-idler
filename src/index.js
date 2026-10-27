const path = require('path');
const store = require('./store');
const log = require('./log');
const { Auth, formatSetupCode } = require('./auth');
const { Idler } = require('./idler');
const { LoginFlow } = require('./steam-login');
const { buildServer } = require('./server');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
const SETUP_REMINDER_MS = 10 * 60_000;

try {
  store.ensureWritable();
} catch (err) {
  log.error(err.message);
  process.exit(1);
}

let listening = false;

// 初始化码只输出到控制台；该行保持纯 ASCII，避免部分 NAS 日志界面乱码
function printSetupCode(code) {
  log.raw(`[steam-idler] SETUP CODE: ${formatSetupCode(code)}  (open http://<host>:${PORT} to create admin password)`);
  log.raw(`[steam-idler] 首次使用：打开管理面板，输入上面的初始化码并创建管理员密码；初始化码也保存在 ${store.files.setupCode}`);
}

const auth = new Auth({
  files: store.files,
  onSetupCode: (code) => listening && printSetupCode(code),
});

const idler = new Idler();
const loginFlow = new LoginFlow({
  onAuthenticated: async (info) => {
    log.info(`Steam 登录成功：${info.accountName}`);
    await idler.useToken(info);
  },
});

const app = buildServer({
  auth,
  idler,
  loginFlow,
  log,
  staticDir: path.join(__dirname, '..', 'web', 'dist'),
  trustProxy: TRUST_PROXY,
});

async function main() {
  await app.listen({ port: PORT, host: HOST });
  log.info(`管理面板已启动：http://${HOST === '0.0.0.0' ? '<host>' : HOST}:${PORT}`);

  // 先生成（或读取）初始化码再开启回调输出，避免首次启动重复打印
  const setupCode = auth.ensureSetupCode();
  listening = true;
  if (setupCode) {
    printSetupCode(setupCode);
    // 日志可能被轮转或容器重建清空，未初始化期间定期重复输出
    const reminder = setInterval(() => {
      if (auth.isInitialized()) return clearInterval(reminder);
      printSetupCode(auth.ensureSetupCode());
    }, SETUP_REMINDER_MS);
    reminder.unref();
  }

  idler.start();
  if (!store.loadToken()) log.info('尚未登录 Steam，请在管理面板中登录');
}

async function shutdown() {
  log.info('正在退出…');
  const force = setTimeout(() => process.exit(0), 8_000);
  force.unref();
  loginFlow.cancel();
  await idler.shutdown().catch(() => {});
  await app.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  log.error(`启动失败：${err.message}`);
  process.exit(1);
});
