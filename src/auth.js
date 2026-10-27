// 管理面板认证：首次初始化码、管理员密码、会话 Cookie
const crypto = require('crypto');
const { promisify } = require('util');
const fs = require('fs');

const scrypt = promisify(crypto.scrypt);

// 去掉 0/O、1/I/L 等易混淆字符
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;
const SESSION_TTL_MS = 30 * 86400_000;
const MAX_FAILS_PER_IP = 5;
const LOCK_MS = 15 * 60_000;
const MAX_SETUP_FAILS = 20;
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

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return { salt, hash };
}

class FailureLimiter {
  constructor(now) {
    this.now = now;
    this.map = new Map();
  }

  check(key) {
    const e = this.map.get(key);
    if (e && e.lockedUntil > this.now()) {
      const minutes = Math.ceil((e.lockedUntil - this.now()) / 60_000);
      throw new AuthError(429, `尝试次数过多，请 ${minutes} 分钟后再试`);
    }
  }

  fail(key) {
    const e = this.map.get(key) || { count: 0, lockedUntil: 0 };
    if (e.lockedUntil && e.lockedUntil <= this.now()) e.count = 0;
    e.count += 1;
    if (e.count >= MAX_FAILS_PER_IP) e.lockedUntil = this.now() + LOCK_MS;
    this.map.set(key, e);
  }

  reset(key) {
    this.map.delete(key);
  }
}

class Auth {
  /**
   * @param {object} opts
   * @param {{admin:string, setupCode:string}} opts.files
   * @param {(code:string)=>void} [opts.onSetupCode] 初始化码生成或更换时回调
   */
  constructor({ files, onSetupCode = () => {}, now = Date.now }) {
    this.files = files;
    this.onSetupCode = onSetupCode;
    this.now = now;
    this.limiter = new FailureLimiter(now);
    this.setupFails = 0;
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

  async setup(ip, code, password) {
    if (this.isInitialized()) throw new AuthError(404, '已初始化');
    this.limiter.check(`setup:${ip}`);
    const expected = this.ensureSetupCode();
    if (!safeEqual(normalizeSetupCode(code), expected)) {
      this.limiter.fail(`setup:${ip}`);
      this.setupFails += 1;
      // 全局失败过多时作废旧码，防止分布式猜测
      if (this.setupFails >= MAX_SETUP_FAILS) this.rotateSetupCode();
      throw new AuthError(403, '初始化码错误');
    }
    checkPassword(password);
    this.limiter.reset(`setup:${ip}`);

    const { salt, hash } = await hashPassword(password);
    const nowIso = new Date(this.now()).toISOString();
    const admin = {
      version: 1,
      salt,
      hash,
      sessionSecret: crypto.randomBytes(32).toString('hex'),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.saveAdmin(admin);
    fs.rmSync(this.files.setupCode, { force: true });
    return this.createSession(admin);
  }

  async login(ip, password) {
    const admin = this.loadAdmin();
    if (!admin) throw new AuthError(409, '尚未初始化');
    this.limiter.check(`login:${ip}`);
    const { hash } = await hashPassword(String(password || ''), admin.salt);
    if (!safeEqual(hash, admin.hash)) {
      this.limiter.fail(`login:${ip}`);
      throw new AuthError(401, '密码错误');
    }
    this.limiter.reset(`login:${ip}`);
    return this.createSession(admin);
  }

  // 修改密码会提升版本号并更换会话密钥，旧会话全部失效
  async changePassword(ip, current, next) {
    await this.login(ip, current);
    checkPassword(next);
    const admin = this.loadAdmin();
    const { salt, hash } = await hashPassword(next);
    const updated = {
      ...admin,
      version: admin.version + 1,
      salt,
      hash,
      sessionSecret: crypto.randomBytes(32).toString('hex'),
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.saveAdmin(updated);
    return this.createSession(updated);
  }

  createSession(admin) {
    const payload = Buffer.from(JSON.stringify({ v: admin.version, exp: this.now() + SESSION_TTL_MS })).toString('base64url');
    const sig = crypto.createHmac('sha256', admin.sessionSecret).update(payload).digest('base64url');
    return { token: `${payload}.${sig}`, maxAge: SESSION_TTL_MS / 1000 };
  }

  verifySession(token) {
    const admin = this.loadAdmin();
    if (!admin || typeof token !== 'string') return false;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return false;
    const expected = crypto.createHmac('sha256', admin.sessionSecret).update(payload).digest('base64url');
    if (!safeEqual(sig, expected)) return false;
    try {
      const { v, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return v === admin.version && exp > this.now();
    } catch {
      return false;
    }
  }
}

module.exports = {
  Auth,
  AuthError,
  CODE_ALPHABET,
  CODE_LENGTH,
  formatSetupCode,
  normalizeSetupCode,
};
