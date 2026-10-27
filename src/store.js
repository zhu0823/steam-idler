// data 目录下的持久化文件：全局挂卡配置、各账号的登录凭据与配置
//
// data/
//   config.json                 全局默认挂卡参数
//   accounts/<SteamID64>/
//     token.json                该账号的 refresh token
//     config.json               该账号的跳过列表、优先队列、掉完后挂的游戏、暂停状态、参数覆盖
//     drops.json                该账号最近 30 天的掉卡记录
//   notify.json                 通知渠道与订阅的事件
const fs = require('fs');
const path = require('path');
const log = require('./log');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

const files = {
  config: path.join(dataDir, 'config.json'),
  accounts: path.join(dataDir, 'accounts'),
  admin: path.join(dataDir, 'admin.json'),
  notify: path.join(dataDir, 'notify.json'),
  setupCode: path.join(dataDir, 'setup_code'),
  steamUser: path.join(dataDir, 'steam-user'),
  // 单账号版本的凭据文件，启动时迁移到 accounts/ 下
  legacyToken: path.join(dataDir, 'refresh_token.json'),
};

const PERSONA_STATES = ['online', 'invisible', 'offline'];
// 挂卡顺序，见 planner.js
const FARMING_ORDERS = ['hours', 'fewestDrops', 'mostDrops', 'name', 'badge'];
const STATUS_TEXT_MAX = 64;
// Steam 最多允许同时上报 32 个游戏
const MAX_GAMES = 32;

// 挂卡参数：全局默认值，账号可整体覆盖
const DEFAULT_SETTINGS = {
  // 同时挂的游戏数上限，Steam 限制为 32
  maxConcurrent: 32,
  // 游玩时长达到该值后改为单独挂；0 表示始终逐个挂
  hoursUntilDrops: 2,
  checkIntervalMinutes: 15,
  personaState: 'online',
  machineName: 'steam-idler',
  farmingOrder: 'hours',
  // 跳过仍在退款期内（购买不满 14 天且游玩不足 2 小时）的游戏，挂卡会让它们失去退款资格
  skipRefundable: true,
  // 跳过从未玩过的游戏
  skipUnplayed: false,
  // 自定义“正在游戏”文本，空字符串表示不显示；挂卡时支持 {name} {appid} {count} 占位符
  farmingStatusText: '',
  idleStatusText: '',
};

const DEFAULT_ACCOUNT_CONFIG = {
  skipAppIds: [],
  // 优先队列：其中的游戏按列表顺序先挂，全部掉完后才挂其他游戏
  priorityAppIds: [],
  // 只挂优先队列中的游戏
  priorityOnly: false,
  // 卡片全部掉完后挂这些游戏累计时长
  idleAppIds: [],
  paused: false,
  // null 表示使用全局默认参数
  overrides: null,
};

const ACCOUNT_ID_RE = /^\d{5,20}$/;

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// 先写临时文件再 rename，避免写到一半导致文件损坏
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
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

function appIdList(value, name, max = Infinity) {
  if (!Array.isArray(value)) throw new Error(`${name} 必须是数组`);
  const ids = [...new Set(value.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length > max) throw new Error(`${name} 最多 ${max} 个`);
  return ids;
}

function statusText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, STATUS_TEXT_MAX);
}

// 校验并补全挂卡参数，非法字段抛出错误，缺失字段使用默认值
function normalizeSettings(input = {}) {
  const c = { ...DEFAULT_SETTINGS, ...input };
  const personaState = String(c.personaState).toLowerCase();
  if (!PERSONA_STATES.includes(personaState)) throw new Error('personaState 只能是 online / invisible / offline');
  const machineName = String(c.machineName).trim().slice(0, 64);
  if (!FARMING_ORDERS.includes(c.farmingOrder)) throw new Error(`farmingOrder 只能是 ${FARMING_ORDERS.join(' / ')}`);
  return {
    maxConcurrent: clampInt(c.maxConcurrent, 1, 32, 'maxConcurrent'),
    hoursUntilDrops: Math.min(Math.max(Number(c.hoursUntilDrops) || 0, 0), 100),
    checkIntervalMinutes: clampInt(c.checkIntervalMinutes, 5, 1440, 'checkIntervalMinutes'),
    personaState,
    machineName: machineName || DEFAULT_SETTINGS.machineName,
    farmingOrder: c.farmingOrder,
    skipRefundable: Boolean(c.skipRefundable),
    skipUnplayed: Boolean(c.skipUnplayed),
    farmingStatusText: statusText(c.farmingStatusText),
    idleStatusText: statusText(c.idleStatusText),
  };
}

function normalizeAccountConfig(input = {}) {
  const c = { ...DEFAULT_ACCOUNT_CONFIG, ...input };
  if (c.overrides !== null && (typeof c.overrides !== 'object' || Array.isArray(c.overrides))) {
    throw new Error('overrides 必须是对象或 null');
  }
  return {
    skipAppIds: appIdList(c.skipAppIds, 'skipAppIds'),
    priorityAppIds: appIdList(c.priorityAppIds, 'priorityAppIds'),
    priorityOnly: Boolean(c.priorityOnly),
    idleAppIds: appIdList(c.idleAppIds, 'idleAppIds', MAX_GAMES),
    paused: Boolean(c.paused),
    overrides: c.overrides ? normalizeSettings(c.overrides) : null,
  };
}

// 损坏的文件改名备份，避免启动失败且无法通过网页修复
function backupBroken(file, reason) {
  const backup = `${file}.broken-${Date.now()}`;
  try {
    fs.renameSync(file, backup);
  } catch {}
  log.warn(`${path.relative(dataDir, file)} 无法解析（${reason}），已备份为 ${path.basename(backup)}`);
}

// 文件损坏时使用默认值；个别字段非法时只丢弃该字段
function loadLenient(file, defaults, normalize) {
  let raw;
  try {
    raw = readJson(file) || {};
  } catch (err) {
    backupBroken(file, err.message);
    return normalize({});
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    backupBroken(file, '不是 JSON 对象');
    return normalize({});
  }
  try {
    return normalize(raw);
  } catch {
    const valid = {};
    for (const key of Object.keys(defaults)) {
      if (!(key in raw)) continue;
      try {
        normalize({ [key]: raw[key] });
        valid[key] = raw[key];
      } catch (err) {
        log.warn(`${path.relative(dataDir, file)} 中的 ${key} 无效（${err.message}），已改用默认值`);
      }
    }
    return normalize(valid);
  }
}

// ---------- 全局默认参数 ----------

function loadGlobalConfig() {
  return loadLenient(files.config, DEFAULT_SETTINGS, normalizeSettings);
}

function saveGlobalConfig(patch) {
  const next = normalizeSettings({ ...loadGlobalConfig(), ...patch });
  writeJson(files.config, next);
  return next;
}

// ---------- 账号 ----------

function accountDir(id) {
  if (!ACCOUNT_ID_RE.test(String(id))) throw Object.assign(new Error('账号 ID 无效'), { statusCode: 400 });
  return path.join(files.accounts, String(id));
}

function listAccountIds() {
  if (!fs.existsSync(files.accounts)) return [];
  return fs
    .readdirSync(files.accounts)
    .filter((id) => ACCOUNT_ID_RE.test(id) && fs.existsSync(path.join(files.accounts, id, 'token.json')))
    .sort();
}

function loadAccountToken(id) {
  const file = path.join(accountDir(id), 'token.json');
  let t;
  try {
    t = readJson(file);
  } catch (err) {
    backupBroken(file, err.message);
    return null;
  }
  return t && t.refreshToken ? t : null;
}

function saveAccountToken(id, data) {
  writeJson(path.join(accountDir(id), 'token.json'), { ...data, steamID: String(id), savedAt: new Date().toISOString() });
}

function loadAccountConfig(id) {
  return loadLenient(path.join(accountDir(id), 'config.json'), DEFAULT_ACCOUNT_CONFIG, normalizeAccountConfig);
}

function saveAccountConfig(id, patch) {
  const next = normalizeAccountConfig({ ...loadAccountConfig(id), ...patch });
  writeJson(path.join(accountDir(id), 'config.json'), next);
  return next;
}

const DROP_HISTORY_DAYS = 30;

// 掉卡记录：[{ time, appid, name, count }]
function loadDropHistory(id) {
  try {
    const list = readJson(path.join(accountDir(id), 'drops.json'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function appendDropHistory(id, entries) {
  const cutoff = Date.now() - DROP_HISTORY_DAYS * 86400_000;
  const list = loadDropHistory(id).filter((e) => Date.parse(e.time) >= cutoff);
  list.push(...entries);
  writeJson(path.join(accountDir(id), 'drops.json'), list);
  return list;
}

function removeAccount(id) {
  fs.rmSync(accountDir(id), { recursive: true, force: true });
}

// 账号实际生效的配置：全局默认值或账号覆盖值 + 账号自己的游戏列表与暂停状态
function effectiveConfig(id) {
  const { overrides, ...account } = loadAccountConfig(id);
  return {
    ...(overrides || loadGlobalConfig()),
    ...account,
    customized: overrides !== null,
  };
}

// ---------- 通知 ----------

const NOTIFY_EVENTS = ['drops', 'finished', 'authFailed'];

// 渠道中的密钥字段：接口不回传，提交空值表示保持不变
const NOTIFY_SECRETS = { telegram: ['botToken'], bark: ['url'], webhook: ['url'] };

const DEFAULT_NOTIFY = {
  telegram: { enabled: false, botToken: '', chatId: '' },
  bark: { enabled: false, url: '' },
  webhook: { enabled: false, url: '' },
  events: { drops: false, finished: true, authFailed: true },
};

function httpUrl(value, name) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  let u;
  try {
    u = new URL(v);
  } catch {
    throw new Error(`${name} 不是有效的网址`);
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`${name} 必须以 http:// 或 https:// 开头`);
  return v.replace(/\/+$/, '');
}

function normalizeNotify(input = {}) {
  const pick = (key) => ({ ...DEFAULT_NOTIFY[key], ...(input[key] && typeof input[key] === 'object' ? input[key] : {}) });
  const telegram = pick('telegram');
  const bark = pick('bark');
  const webhook = pick('webhook');
  const events = pick('events');
  const botToken = String(telegram.botToken ?? '').trim();
  if (botToken && !/^\d+:[\w-]+$/.test(botToken)) throw new Error('Telegram Bot Token 格式不正确');
  const out = {
    telegram: { enabled: Boolean(telegram.enabled), botToken, chatId: String(telegram.chatId ?? '').trim().slice(0, 64) },
    bark: { enabled: Boolean(bark.enabled), url: httpUrl(bark.url, 'Bark 地址') },
    webhook: { enabled: Boolean(webhook.enabled), url: httpUrl(webhook.url, 'Webhook 地址') },
    events: Object.fromEntries(NOTIFY_EVENTS.map((e) => [e, Boolean(events[e])])),
  };
  if (out.telegram.enabled && (!out.telegram.botToken || !out.telegram.chatId)) throw new Error('启用 Telegram 需要填写 Bot Token 和 Chat ID');
  if (out.bark.enabled && !out.bark.url) throw new Error('启用 Bark 需要填写推送地址');
  if (out.webhook.enabled && !out.webhook.url) throw new Error('启用 Webhook 需要填写地址');
  return out;
}

function loadNotifyConfig() {
  return loadLenient(files.notify, DEFAULT_NOTIFY, normalizeNotify);
}

/**
 * 合并保存通知配置。密钥字段为 undefined 或空字符串时保留原值，为 null 时清空。
 */
function saveNotifyConfig(patch = {}) {
  const current = loadNotifyConfig();
  const next = { events: { ...current.events, ...(patch.events || {}) } };
  for (const channel of Object.keys(NOTIFY_SECRETS)) {
    const p = patch[channel] && typeof patch[channel] === 'object' ? { ...patch[channel] } : {};
    for (const key of NOTIFY_SECRETS[channel]) {
      if (p[key] === null) p[key] = '';
      else if (p[key] === undefined || String(p[key]).trim() === '') delete p[key];
    }
    next[channel] = { ...current[channel], ...p };
  }
  const config = normalizeNotify(next);
  writeJson(files.notify, config);
  return config;
}

// 面板展示用：去掉密钥，只标明是否已设置
function maskNotifyConfig(config) {
  const out = structuredClone(config);
  for (const [channel, keys] of Object.entries(NOTIFY_SECRETS)) {
    for (const key of keys) {
      out[channel][`${key}Set`] = Boolean(config[channel][key]);
      out[channel][key] = '';
    }
  }
  return out;
}

// 单账号版本升级：refresh_token.json 移到 accounts/<SteamID>/，原配置中的跳过列表和暂停状态归入该账号
function migrateLegacy() {
  if (!fs.existsSync(files.legacyToken)) return null;
  let token;
  try {
    token = readJson(files.legacyToken);
  } catch (err) {
    backupBroken(files.legacyToken, err.message);
    return null;
  }
  if (!token || !token.refreshToken || !ACCOUNT_ID_RE.test(String(token.steamID || ''))) {
    log.warn('旧版凭据文件缺少 SteamID，无法迁移，请在面板中重新登录该账号');
    backupBroken(files.legacyToken, '缺少 SteamID');
    return null;
  }
  const id = String(token.steamID);
  let legacyConfig = {};
  try {
    legacyConfig = readJson(files.config) || {};
  } catch {}

  if (!fs.existsSync(path.join(accountDir(id), 'token.json'))) saveAccountToken(id, token);
  saveAccountConfig(id, {
    skipAppIds: Array.isArray(legacyConfig.skipAppIds) ? legacyConfig.skipAppIds : [],
    paused: Boolean(legacyConfig.paused),
  });
  // 重写全局配置，去掉已归入账号的字段
  writeJson(files.config, loadGlobalConfig());
  fs.rmSync(files.legacyToken, { force: true });
  log.info(`已将旧版单账号数据迁移到 accounts/${id}`);
  return id;
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
  DEFAULT_SETTINGS,
  DEFAULT_ACCOUNT_CONFIG,
  FARMING_ORDERS,
  MAX_GAMES,
  readJson,
  writeJson,
  ensureWritable,
  normalizeSettings,
  normalizeAccountConfig,
  loadGlobalConfig,
  saveGlobalConfig,
  listAccountIds,
  loadAccountToken,
  saveAccountToken,
  loadAccountConfig,
  saveAccountConfig,
  removeAccount,
  loadDropHistory,
  appendDropHistory,
  effectiveConfig,
  loadNotifyConfig,
  saveNotifyConfig,
  maskNotifyConfig,
  migrateLegacy,
  tokenExpiresAt,
};
