// data 目录下的持久化文件：挂卡配置、Steam 登录凭据
const fs = require('fs');
const path = require('path');
const log = require('./log');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

const files = {
  config: path.join(dataDir, 'config.json'),
  token: path.join(dataDir, 'refresh_token.json'),
  admin: path.join(dataDir, 'admin.json'),
  setupCode: path.join(dataDir, 'setup_code'),
  steamUser: path.join(dataDir, 'steam-user'),
};

const PERSONA_STATES = ['online', 'invisible', 'offline'];

const DEFAULT_CONFIG = {
  // 同时挂的游戏数上限，Steam 限制为 32
  maxConcurrent: 32,
  // 游玩时长达到该值后改为单独挂；0 表示始终逐个挂
  hoursUntilDrops: 2,
  checkIntervalMinutes: 15,
  skipAppIds: [],
  personaState: 'online',
  machineName: 'steam-idler',
  paused: false,
};

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// 先写临时文件再 rename，避免写到一半导致文件损坏
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function removeFile(file) {
  fs.rmSync(file, { force: true });
}

function ensureWritable() {
  const probe = path.join(dataDir, '.write-test');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
  } catch (err) {
    throw new Error(`数据目录 ${dataDir} 不可写（${err.code || err.message}），请检查目录权限或 PUID/PGID 设置`);
  }
}

function clampInt(value, min, max, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} 必须是数字`);
  return Math.min(Math.max(Math.round(n), min), max);
}

// 校验并补全配置，非法字段抛出错误，缺失字段使用默认值
function normalizeConfig(input = {}) {
  const c = { ...DEFAULT_CONFIG, ...input };
  const personaState = String(c.personaState).toLowerCase();
  if (!PERSONA_STATES.includes(personaState)) throw new Error('personaState 只能是 online / invisible / offline');
  const machineName = String(c.machineName).trim().slice(0, 64);
  if (!Array.isArray(c.skipAppIds)) throw new Error('skipAppIds 必须是数组');

  return {
    maxConcurrent: clampInt(c.maxConcurrent, 1, 32, 'maxConcurrent'),
    hoursUntilDrops: Math.min(Math.max(Number(c.hoursUntilDrops) || 0, 0), 100),
    checkIntervalMinutes: clampInt(c.checkIntervalMinutes, 5, 1440, 'checkIntervalMinutes'),
    skipAppIds: [...new Set(c.skipAppIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))],
    personaState,
    machineName: machineName || DEFAULT_CONFIG.machineName,
    paused: Boolean(c.paused),
  };
}

// 损坏的文件改名备份，避免启动失败且无法通过网页修复
function backupBroken(file, reason) {
  const backup = `${file}.broken-${Date.now()}`;
  try {
    fs.renameSync(file, backup);
  } catch {}
  log.warn(`${path.basename(file)} 无法解析（${reason}），已备份为 ${path.basename(backup)}`);
}

// 配置文件损坏时使用默认值；个别字段非法时只丢弃该字段
function loadConfig() {
  let raw;
  try {
    raw = readJson(files.config) || {};
  } catch (err) {
    backupBroken(files.config, err.message);
    return { ...DEFAULT_CONFIG };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    backupBroken(files.config, '不是 JSON 对象');
    return { ...DEFAULT_CONFIG };
  }
  try {
    return normalizeConfig(raw);
  } catch {
    const valid = {};
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      if (!(key in raw)) continue;
      try {
        normalizeConfig({ [key]: raw[key] });
        valid[key] = raw[key];
      } catch (err) {
        log.warn(`配置项 ${key} 无效（${err.message}），已改用默认值`);
      }
    }
    return normalizeConfig(valid);
  }
}

function saveConfig(patch) {
  const next = normalizeConfig({ ...loadConfig(), ...patch });
  writeJson(files.config, next);
  return next;
}

function loadToken() {
  let t;
  try {
    t = readJson(files.token);
  } catch (err) {
    backupBroken(files.token, err.message);
    return null;
  }
  return t && t.refreshToken ? t : null;
}

function saveToken(data) {
  writeJson(files.token, { ...data, savedAt: new Date().toISOString() });
}

function clearToken() {
  removeFile(files.token);
}

// 解析 JWT 的过期时间，仅用于展示，不做校验
function tokenExpiresAt(refreshToken) {
  try {
    const payload = JSON.parse(Buffer.from(refreshToken.split('.')[1], 'base64url').toString());
    return payload.exp ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}

module.exports = {
  dataDir,
  files,
  DEFAULT_CONFIG,
  readJson,
  writeJson,
  removeFile,
  ensureWritable,
  normalizeConfig,
  loadConfig,
  saveConfig,
  loadToken,
  saveToken,
  clearToken,
  tokenExpiresAt,
};
