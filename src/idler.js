// 挂卡主流程：维护 Steam 连接、定期读取徽章页并上报正在游戏
const { EventEmitter } = require('events');
const SteamUser = require('steam-user');
const store = require('./store');
const log = require('./log');
const { fetchAllDroppable, NotLoggedInError } = require('./badges');
const { planIdle } = require('./planner');
const { detectDrops, phaseOf, estimateMinutes, dropsOnDay } = require('./progress');

const { EResult, EPersonaState } = SteamUser;

// 这些错误说明凭据已失效，重试无意义，需要在网页上重新登录
const AUTH_ERRORS = new Set([
  EResult.InvalidPassword, EResult.AccessDenied, EResult.Expired, EResult.Revoked,
  EResult.AccountLogonDenied, EResult.AccountLoginDeniedNeedTwoFactor, EResult.InvalidSignature,
]);

// 多个账号的徽章页请求串行执行并留出间隔，避免同一 IP 短时间内请求过多
const BADGE_GAP_MS = 3_000;
let badgeQueue = Promise.resolve();
function enqueueBadgeFetch(fn, gapMs) {
  const run = badgeQueue.then(fn);
  badgeQueue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, gapMs).unref()));
  return run;
}

const PERSONA = {
  online: EPersonaState.Online,
  invisible: EPersonaState.Invisible,
  offline: EPersonaState.Offline,
};

/**
 * 单个 Steam 账号的挂卡流程。
 *
 * 状态：
 * - logged_out   没有凭据
 * - connecting   正在连接 / 重连
 * - running      已登录，正常挂卡（或暂无可挂游戏）
 * - paused       用户在网页上暂停
 * - blocked      账号正在其他设备上游戏
 * - auth_failed  登录凭据失效，需要重新登录
 */
class Idler extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.id 账号 SteamID64
   * @param {object} [opts.client] 用于测试注入的 SteamUser 实例
   * @param {Function} [opts.fetchBadges] 用于测试注入的徽章页读取函数
   * @param {number} [opts.badgeGapMs] 徽章页请求之间的间隔
   */
  constructor({ id, client, fetchBadges = fetchAllDroppable, badgeGapMs = BADGE_GAP_MS }) {
    super();
    this.id = String(id);
    // 日志标签，登录后用账号名替换
    this.tag = { id: this.id, name: this.id };
    this.log = log.scope(this.tag);
    this.config = store.effectiveConfig(this.id);
    this.state = 'logged_out';
    this.account = null;
    this.cookies = null;
    this.blocked = false;
    this.checking = false;
    this.loggingOff = false;
    this.current = []; // 当前正在挂的 appid
    this.playing = [];
    this.games = []; // 最近一次读取的可掉卡游戏（含已跳过）
    this.lastCheckAt = null;
    this.fetchBadges = fetchBadges;
    this.badgeGapMs = badgeGapMs;
    // 上一次读取的各游戏剩余掉落，用于识别掉卡；重启后第一次检查只建立基准
    this.prevDrops = null;
    this.dropHistory = store.loadDropHistory(this.id);
    this.lastError = null;
    this.checkTimer = null;
    this.retryTimer = null;
    this.intervalTimer = null;
    this.client = this.bindClient(
      client ||
        new SteamUser({
          dataDirectory: store.files.steamUser,
          renewRefreshTokens: true,
          autoRelogin: true,
        }),
    );
    this.updateAccount();
    this.resetInterval();
  }

  bindClient(client) {
    client.on('refreshToken', (refreshToken) => {
      const saved = store.loadAccountToken(this.id) || {};
      store.saveAccountToken(this.id, { ...saved, refreshToken });
      this.updateAccount();
      const exp = store.tokenExpiresAt(refreshToken);
      this.log.info(`登录凭据已续期${exp ? `，有效期至 ${exp.toLocaleString()}` : ''}`);
    });

    client.on('loggedOn', () => {
      this.log.info(`已登录 Steam：${client.steamID.getSteamID64()}`);
      this.current = [];
      this.playing = [];
      this.lastError = null;
      client.setPersona(PERSONA[this.config.personaState] ?? EPersonaState.Online);
      this.refreshState();
    });

    client.on('webSession', (_sessionID, cookies) => {
      this.cookies = cookies;
      this.scheduleCheck(2_000);
    });

    client.on('playingState', (isBlocked, playingApp) => {
      if (isBlocked && !this.blocked) {
        this.blocked = true;
        this.current = [];
        this.playing = [];
        this.log.info(`账号正在其他设备上游戏（appid ${playingApp}），暂停挂卡`);
        this.refreshState();
      } else if (!isBlocked && this.blocked) {
        this.blocked = false;
        this.log.info('其他设备已结束游戏，恢复挂卡');
        this.refreshState();
        this.scheduleCheck(5_000);
      }
    });

    client.on('newItems', (count) => {
      if (count > 0) this.scheduleCheck(30_000);
    });

    client.on('disconnected', (eresult, msg) => {
      this.cookies = null;
      if (this.loggingOff) return;
      this.log.warn(`与 Steam 断开：${EResult[eresult] || eresult}${msg ? ` ${msg}` : ''}，自动重连中`);
      this.setState('connecting');
    });

    client.on('error', (err) => {
      this.cookies = null;
      this.current = [];
      this.playing = [];
      this.lastError = err.message;
      if (err.eresult === EResult.LoggedInElsewhere) {
        // 在电脑上启动游戏并选择“继续”时，Steam 会踢掉本会话
        this.log.info('会话被其他设备上的游戏顶下线，稍后重新登录');
        this.retryLogOn(2);
      } else if (AUTH_ERRORS.has(err.eresult)) {
        this.log.error(`登录凭据已失效（${err.message}），请在网页上重新登录 Steam`);
        this.setState('auth_failed');
      } else {
        this.log.error(`Steam 错误：${err.message}`);
        this.retryLogOn(5);
      }
    });

    return client;
  }

  // 启动时若已有凭据则自动登录
  start() {
    this.updateAccount();
    if (this.account) this.logOn();
  }

  updateAccount() {
    const t = store.loadAccountToken(this.id);
    this.account = t
      ? { accountName: t.accountName || '', steamID: this.id, tokenExpiresAt: store.tokenExpiresAt(t.refreshToken) }
      : null;
    if (t && t.accountName) this.tag.name = t.accountName;
  }

  logOn() {
    const t = store.loadAccountToken(this.id);
    if (!t) {
      this.setState('logged_out');
      return;
    }
    clearTimeout(this.retryTimer);
    this.setState('connecting');
    this.log.info(`正在登录 ${t.accountName || ''}…`);
    this.client.logOn({ refreshToken: t.refreshToken, machineName: this.config.machineName });
  }

  retryLogOn(minutes) {
    clearTimeout(this.retryTimer);
    this.setState('connecting');
    this.log.info(`${minutes} 分钟后重新登录`);
    this.retryTimer = setTimeout(() => this.logOn(), minutes * 60_000);
  }

  async logOffClient() {
    if (!this.client.steamID) {
      // 正在连接或处于自动重连等待中：logOff 会关闭连接并取消 steam-user 的重连定时器，
      // 否则之后会用已删除的凭据重新登录
      try {
        this.client.logOff();
      } catch {}
      return;
    }
    this.loggingOff = true;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      this.client.once('disconnected', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        this.client.gamesPlayed([]);
        this.client.logOff();
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
    this.loggingOff = false;
  }

  // 网页上重新登录该账号后调用：保存新凭据并重新登录
  async useToken({ accountName, refreshToken }) {
    await this.logOffClient();
    store.saveAccountToken(this.id, { accountName, refreshToken });
    this.updateAccount();
    this.resetRuntime();
    this.logOn();
  }

  resetRuntime() {
    this.cookies = null;
    this.blocked = false;
    this.current = [];
    this.playing = [];
    this.lastError = null;
  }

  // 修改该账号的跳过列表、暂停状态或参数覆盖
  setAccountConfig(patch) {
    store.saveAccountConfig(this.id, patch);
    return this.reloadConfig();
  }

  // 重新计算生效配置（全局默认值变更后也会调用）
  reloadConfig() {
    const prev = this.config;
    this.config = store.effectiveConfig(this.id);
    if (prev.checkIntervalMinutes !== this.config.checkIntervalMinutes) this.resetInterval();
    if (prev.personaState !== this.config.personaState && this.client.steamID) {
      this.client.setPersona(PERSONA[this.config.personaState]);
    }
    if (prev.paused !== this.config.paused) {
      this.log.info(this.config.paused ? '已暂停挂卡' : '已恢复挂卡');
      if (this.config.paused) this.setPlaying([]);
    }
    this.refreshState();
    this.scheduleCheck(1_000);
    return this.config;
  }

  resetInterval() {
    clearInterval(this.intervalTimer);
    this.intervalTimer = setInterval(() => this.scheduleCheck(0), this.config.checkIntervalMinutes * 60_000);
    this.nextCheckAt = new Date(Date.now() + this.config.checkIntervalMinutes * 60_000);
  }

  scheduleCheck(delayMs) {
    clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => this.check(), delayMs);
  }

  setPlaying(games) {
    const ids = games.map((g) => g.appid);
    const same = ids.length === this.current.length && ids.every((id, i) => id === this.current[i]);
    this.playing = games;
    if (same) return;
    this.current = ids;
    if (this.client.steamID && !this.blocked) this.client.gamesPlayed(ids);
    if (ids.length === 0) {
      this.log.info('已停止挂卡');
    } else {
      const names = games.map((g) => `${g.name}(${g.appid}, ${g.hours}h, 剩${g.drops})`).join('、');
      this.log.info(`开始挂 ${ids.length} 个游戏：${names}`);
    }
    this.emitStatus();
  }

  async check() {
    if (this.checking || this.blocked || !this.client.steamID || !this.cookies) return;
    this.checking = true;
    try {
      const all = await enqueueBadgeFetch(() => this.fetchBadges(this.id, this.cookies), this.badgeGapMs);
      this.recordDrops(all);
      this.lastCheckAt = new Date();
      this.nextCheckAt = new Date(Date.now() + this.config.checkIntervalMinutes * 60_000);
      const skip = new Set(this.config.skipAppIds);
      this.games = all.map((g) => ({ ...g, skipped: skip.has(g.appid) }));
      const games = all.filter((g) => !skip.has(g.appid));
      const totalDrops = games.reduce((s, g) => s + g.drops, 0);
      this.log.info(`可掉卡游戏 ${games.length} 个，剩余 ${totalDrops} 张`);
      if (this.blocked) return; // 拉取期间账号开始在别处游戏
      this.setPlaying(this.config.paused ? [] : planIdle(games, this.config));
    } catch (err) {
      if (err instanceof NotLoggedInError) {
        this.log.warn(`${err.message}，重新获取网页会话`);
        this.cookies = null;
        this.client.webLogOn();
      } else {
        this.log.warn(`检查徽章页失败：${err.message}`);
      }
    } finally {
      this.checking = false;
      this.emitStatus();
    }
  }

  checkNow() {
    this.scheduleCheck(0);
  }

  recordDrops(all) {
    const drops = detectDrops(this.prevDrops, all);
    this.prevDrops = new Map(all.map((g) => [g.appid, { name: g.name, drops: g.drops }]));
    if (drops.length === 0) return;
    const time = new Date().toISOString();
    this.dropHistory = store.appendDropHistory(this.id, drops.map((d) => ({ time, ...d })));
    for (const d of drops) this.log.info(`掉落 ${d.count} 张卡片：${d.name}`);
  }

  refreshState() {
    if (!this.client.steamID) {
      // 未连接时保持 auth_failed / logged_out / connecting 等已有状态
      return this.emitStatus();
    }
    if (this.blocked) return this.setState('blocked');
    if (this.config.paused) return this.setState('paused');
    this.setState('running');
  }

  setState(state) {
    this.state = state;
    this.emitStatus();
  }

  emitStatus() {
    this.emit('status', this.status());
  }

  status() {
    return {
      id: this.id,
      state: this.state,
      account: this.account,
      playing: this.playing,
      games: this.games,
      totalDrops: this.games.filter((g) => !g.skipped).reduce((s, g) => s + g.drops, 0),
      lastCheckAt: this.lastCheckAt,
      nextCheckAt: this.client.steamID ? this.nextCheckAt : null,
      lastError: this.lastError,
      config: this.config,
      phase: phaseOf(this.playing, this.config.hoursUntilDrops),
      etaMinutes: this.lastCheckAt ? estimateMinutes(this.games, this.config.hoursUntilDrops) : null,
      dropsToday: dropsOnDay(this.dropHistory),
      recentDrops: this.dropHistory.slice(-10).reverse(),
    };
  }

  async shutdown() {
    clearInterval(this.intervalTimer);
    clearTimeout(this.checkTimer);
    clearTimeout(this.retryTimer);
    await this.logOffClient();
  }
}

module.exports = { Idler };
