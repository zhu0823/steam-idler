const path = require('path');
const SteamUser = require('steam-user');
const cfg = require('./config');
const log = require('./log');
const token = require('./token');
const { fetchAllDroppable, NotLoggedInError } = require('./badges');
const { planIdle } = require('./planner');

const { EResult, EPersonaState } = SteamUser;

// 这些错误说明凭据已失效，重试无意义，需要重新运行登录脚本
const AUTH_ERRORS = new Set([
  EResult.InvalidPassword, EResult.AccessDenied, EResult.Expired, EResult.Revoked,
  EResult.AccountLogonDenied, EResult.AccountLoginDeniedNeedTwoFactor, EResult.InvalidSignature,
]);

const PERSONA = {
  online: EPersonaState.Online,
  invisible: EPersonaState.Invisible,
  offline: EPersonaState.Offline,
};

let saved = token.load();
if (!saved || !saved.refreshToken) {
  log.error(`未找到登录凭据 ${cfg.tokenFile}，请先运行登录：npm run login`);
  process.exit(1);
}

const client = new SteamUser({
  dataDirectory: path.join(cfg.dataDir, 'steam-user'),
  renewRefreshTokens: true,
  autoRelogin: true,
});

let cookies = null;
let blocked = false; // 账号在其他设备上游戏中
let checking = false;
let current = []; // 当前正在挂的 appid
let checkTimer = null;
let retryTimer = null;

function logOn() {
  log.info(`正在登录 ${saved.accountName || ''}…`);
  client.logOn({ refreshToken: saved.refreshToken, machineName: cfg.machineName });
}

function retryLogOn(minutes) {
  clearTimeout(retryTimer);
  log.info(`${minutes} 分钟后重新登录`);
  retryTimer = setTimeout(logOn, minutes * 60_000);
}

function scheduleCheck(delayMs) {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(check, delayMs);
}

function setPlaying(games) {
  const ids = games.map((g) => g.appid);
  const same = ids.length === current.length && ids.every((id, i) => id === current[i]);
  if (same) return;
  current = ids;
  client.gamesPlayed(ids);
  if (ids.length === 0) {
    log.info('已停止挂卡');
  } else {
    const names = games.map((g) => `${g.name}(${g.appid}, ${g.hours}h, 剩${g.drops})`).join('、');
    log.info(`开始挂 ${ids.length} 个游戏：${names}`);
  }
}

async function check() {
  if (checking || blocked || !client.steamID || !cookies) return;
  checking = true;
  try {
    const all = await fetchAllDroppable(client.steamID.getSteamID64(), cookies);
    if (blocked) return; // 拉取期间账号开始在别处游戏
    const games = all.filter((g) => !cfg.skipAppIds.has(g.appid));
    const totalDrops = games.reduce((s, g) => s + g.drops, 0);
    log.info(`可掉卡游戏 ${games.length} 个，剩余 ${totalDrops} 张`);
    if (games.length === 0 && current.length === 0) log.info('暂无可掉卡的游戏，继续定期检查');
    setPlaying(planIdle(games, cfg));
  } catch (err) {
    if (err instanceof NotLoggedInError) {
      log.warn(`${err.message}，重新获取网页会话`);
      cookies = null;
      client.webLogOn();
    } else {
      log.warn(`检查徽章页失败：${err.message}`);
    }
  } finally {
    checking = false;
  }
}

client.on('refreshToken', (refreshToken) => {
  saved = { ...saved, refreshToken };
  token.save(saved);
  const exp = token.expiresAt(refreshToken);
  log.info(`登录凭据已续期${exp ? `，有效期至 ${exp.toLocaleString()}` : ''}`);
});

client.on('loggedOn', () => {
  log.info(`已登录 Steam：${client.steamID.getSteamID64()}`);
  current = [];
  client.setPersona(PERSONA[cfg.personaState] ?? EPersonaState.Online);
});

client.on('webSession', (_sessionID, c) => {
  cookies = c;
  scheduleCheck(2_000);
});

client.on('playingState', (isBlocked, playingApp) => {
  if (isBlocked && !blocked) {
    blocked = true;
    current = [];
    log.info(`账号正在其他设备上游戏（appid ${playingApp}），暂停挂卡`);
  } else if (!isBlocked && blocked) {
    blocked = false;
    log.info('其他设备已结束游戏，恢复挂卡');
    scheduleCheck(5_000);
  }
});

client.on('newItems', (count) => {
  if (count > 0) scheduleCheck(30_000);
});

client.on('disconnected', (eresult, msg) => {
  cookies = null;
  log.warn(`与 Steam 断开：${EResult[eresult] || eresult}${msg ? ` ${msg}` : ''}，自动重连中`);
});

client.on('error', (err) => {
  cookies = null;
  current = [];
  if (err.eresult === EResult.LoggedInElsewhere) {
    // 在电脑上启动游戏并选择“继续”时，Steam 会踢掉本会话
    log.info('会话被其他设备上的游戏顶下线，稍后重新登录');
    retryLogOn(2);
  } else if (AUTH_ERRORS.has(err.eresult)) {
    log.error(`登录凭据已失效（${err.message}），请重新运行登录脚本后重启本程序`);
    // 不退出也不重试，避免容器重启策略导致反复尝试登录
    setInterval(() => log.error('等待重新登录：npm run login'), 6 * 3600_000);
  } else {
    log.error(`Steam 错误：${err.message}`);
    retryLogOn(5);
  }
});

setInterval(() => scheduleCheck(0), cfg.checkIntervalMinutes * 60_000);

function shutdown() {
  log.info('正在退出…');
  try {
    client.gamesPlayed([]);
    client.logOff();
  } catch {}
  setTimeout(() => process.exit(0), 1_000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const exp = token.expiresAt(saved.refreshToken);
if (exp && exp.getTime() - Date.now() < 7 * 86400_000) {
  log.warn(`登录凭据将于 ${exp.toLocaleString()} 过期，程序会尝试自动续期，失败时请重新登录`);
}
logOn();
