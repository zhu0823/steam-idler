// 管理面板认证：首次初始化码、管理员密码、会话 Cookie
const crypto = require('crypto');
const { promisify } = require('util');
const { EventEmitter } = require('events');
const fs = require('fs');

const scrypt = promisify(crypto.scrypt);

// 去掉 0/O、1/I/L 等易混淆字符
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;
const SESSION_TTL_MS = 30 * 86400_000;
const MAX_FAILS_PER_IP = 5;
// 所有来源合计的失败上限，防止通过轮换 IP 绕过单 IP 限制
const MAX_FAILS_GLOBAL = 30;
const LOCK_MS = 15 * 60_000;
const MAX_SETUP_FAILS = 20;
// scrypt 每次约占 16MB 内存，限制并发避免被大量请求耗尽内存
const MAX_CONCURRENT_HASH = 4;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

class AuthError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function generateSetupCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

function formatSetupCode(code) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// 忽略大小写、空格和横线
function normalizeSetupCode(input) {
  return String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    throw new AuthError(400, `密码至少 ${PASSWORD_MIN} 位`);
  }
  if (password.length > PASSWORD_MAX) throw new AuthError(400, `密码最多 ${PASSWORD_MAX} 位`);
}

/**
 * 失败次数限制。尝试开始时先计数（悲观计数），成功后再清零，
 * 这样并发请求无法在第一次失败记录前全部通过检查。
 */
class FailureLimiter {
  constructor({ max, lockMs, now }) {
    this.max = max;
    this.lockMs = lockMs;
    this.now = now;
    this.map = new Map();
  }

  entry(key) {
    let e = this.map.get(key);
    if (e && e.lockedUntil && e.lockedUntil <= this.now()) e = null;
    if (!e) {
      e = { count: 0, lockedUntil: 0 };
      this.map.set(key, e);
    }
    return e;
  }

  attempt(key) {
    const e = this.entry(key);
    if (e.lockedUntil > this.now() || e.count >= this.max) {
      if (!e.lockedUntil) e.lockedUntil = this.now() + this.lockMs;
      const minutes = Math.ceil((e.lockedUntil - this.now()) / 60_000);
      throw new AuthError(429, `尝试次数过多，请 ${minutes} 分钟后再试`);
    }
    e.count += 1;
    if (e.count >= this.max) e.lockedUntil = this.now() + this.lockMs;
    this.prune();
  }

  succeed(key) {
    this.map.delete(key);
  }

  // 锁定前还能再失败几次
  remaining(key) {
    const e = this.map.get(key);
    return Math.max(this.max - (e ? e.count : 0), 0);
  }

  // 防止伪造来源 IP 导致记录无限增长
  prune() {
    if (this.map.size < 10_000) return;
    for (const [k, e] of this.map) {
      if (!e.lockedUntil || e.lockedUntil <= this.now()) this.map.delete(k);
    }
  }
}

/**
 * 事件：
 * - sessions  会话被吊销或密码变更，已建立的长连接需要重新校验
 */
class Auth extends EventEmitter {
  /**
   * @param {object} opts
   * @param {{admin:string, setupCode:string}} opts.files
   * @param {(code:string)=>void} [opts.onSetupCode] 初始化码生成或更换时回调
   */
  constructor({ files, onSetupCode = () => {}, now = Date.now }) {
    super();
    this.setMaxListeners(0);
    this.files = files;
    this.onSetupCode = onSetupCode;
    this.now = now;
    this.ipLimiter = new FailureLimiter({ max: MAX_FAILS_PER_IP, lockMs: LOCK_MS, now });
    this.globalLimiter = new FailureLimiter({ max: MAX_FAILS_GLOBAL, lockMs: LOCK_MS, now });
    this.setupFails = 0;
    this.settingUp = false;
    this.hashing = 0;
  }

  loadAdmin() {
    if (!fs.existsSync(this.files.admin)) return null;
    return JSON.parse(fs.readFileSync(this.files.admin, 'utf8'));
  }

  saveAdmin(admin) {
    const tmp = `${this.files.admin}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(admin, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.files.admin);
  }

  isInitialized() {
    return this.loadAdmin() !== null;
  }

  // 未初始化时返回当前初始化码；已存在则沿用，保证重启后日志中的旧码仍有效
  ensureSetupCode() {
    if (this.isInitialized()) return null;
    if (fs.existsSync(this.files.setupCode)) {
      const saved = normalizeSetupCode(fs.readFileSync(this.files.setupCode, 'utf8'));
      if (saved.length === CODE_LENGTH) return saved;
    }
    return this.rotateSetupCode();
  }

  rotateSetupCode() {
    const code = generateSetupCode();
    fs.writeFileSync(this.files.setupCode, `${formatSetupCode(code)}\n`, { mode: 0o600 });
    this.setupFails = 0;
    this.onSetupCode(code);
    return code;
  }

  async hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    if (this.hashing >= MAX_CONCURRENT_HASH) throw new AuthError(429, '请求过多，请稍后再试');
    this.hashing += 1;
    try {
      const hash = (await scrypt(password, salt, 64)).toString('hex');
      return { salt, hash };
    } finally {
      this.hashing -= 1;
    }
  }

  async setup(ip, code, password) {
    if (this.isInitialized()) throw new AuthError(404, '已初始化');
    // 同一时间只允许一个初始化请求，避免并发请求互相覆盖管理员密码
    if (this.settingUp) throw new AuthError(409, '正在初始化，请稍后刷新页面');
    this.ipLimiter.attempt(`setup:${ip}`);
    const expected = this.ensureSetupCode();
    if (!safeEqual(normalizeSetupCode(code), expected)) {
      this.setupFails += 1;
      // 全局失败过多时作废旧码，防止分布式猜测
      if (this.setupFails >= MAX_SETUP_FAILS) this.rotateSetupCode();
      throw new AuthError(403, '初始化码错误');
    }
    checkPassword(password);

    this.settingUp = true;
    try {
      const { salt, hash } = await this.hashPassword(password);
      if (this.isInitialized()) throw new AuthError(404, '已初始化');
      const nowIso = new Date(this.now()).toISOString();
      const admin = {
        version: 1,
        salt,
        hash,
        sessionSecret: crypto.randomBytes(32).toString('hex'),
        revoked: {},
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      this.saveAdmin(admin);
      fs.rmSync(this.files.setupCode, { force: true });
      this.ipLimiter.succeed(`setup:${ip}`);
      return this.createSession(admin);
    } finally {
      this.settingUp = false;
    }
  }

  async login(ip, password) {
    const admin = this.loadAdmin();
    if (!admin) throw new AuthError(409, '尚未初始化');
    this.ipLimiter.attempt(`login:${ip}`);
    this.globalLimiter.attempt('login');
    const { hash } = await this.hashPassword(String(password || ''), admin.salt);
    if (!safeEqual(hash, admin.hash)) {
      const left = this.ipLimiter.remaining(`login:${ip}`);
      throw new AuthError(401, left > 0 ? `密码错误，再错 ${left} 次将锁定 15 分钟` : '密码错误，已锁定 15 分钟');
    }
    this.ipLimiter.succeed(`login:${ip}`);
    this.globalLimiter.succeed('login');
    return this.createSession(admin);
  }

  // 修改密码会提升版本号并更换会话密钥，旧会话全部失效
  async changePassword(ip, current, next) {
    checkPassword(next);
    await this.login(ip, current);
    const admin = this.loadAdmin();
    const { salt, hash } = await this.hashPassword(next);
    const updated = {
      ...admin,
      version: admin.version + 1,
      salt,
      hash,
      sessionSecret: crypto.randomBytes(32).toString('hex'),
      revoked: {},
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.saveAdmin(updated);
    this.emit('sessions');
    return this.createSession(updated);
  }

  createSession(admin) {
    const claims = { v: admin.version, exp: this.now() + SESSION_TTL_MS, jti: crypto.randomBytes(12).toString('base64url') };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const sig = crypto.createHmac('sha256', admin.sessionSecret).update(payload).digest('base64url');
    return { token: `${payload}.${sig}`, maxAge: SESSION_TTL_MS / 1000 };
  }

  // 校验签名并返回会话声明，无效时返回 null
  readSession(token, admin = this.loadAdmin()) {
    if (!admin || typeof token !== 'string') return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', admin.sessionSecret).update(payload).digest('base64url');
    if (!safeEqual(sig, expected)) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (claims.v !== admin.version || claims.exp <= this.now()) return null;
      if (claims.jti && admin.revoked && admin.revoked[claims.jti]) return null;
      return claims;
    } catch {
      return null;
    }
  }

  verifySession(token) {
    return this.readSession(token) !== null;
  }

  // 退出面板时吊销该会话，即使 Cookie 已被复制也无法继续使用
  revokeSession(token) {
    const admin = this.loadAdmin();
    const claims = this.readSession(token, admin);
    if (!claims || !claims.jti) return;
    const revoked = Object.fromEntries(Object.entries(admin.revoked || {}).filter(([, exp]) => exp > this.now()));
    revoked[claims.jti] = claims.exp;
    this.saveAdmin({ ...admin, revoked });
    this.emit('sessions');
  }
}

module.exports = {
  Auth,
  AuthError,
  CODE_ALPHABET,
  CODE_LENGTH,
  MAX_FAILS_GLOBAL,
  formatSetupCode,
  normalizeSetupCode,
};
