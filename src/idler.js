// 挂卡主流程：维护 Steam 连接、定期读取徽章页并上报正在游戏
const { EventEmitter } = require('events');
const SteamUser = require('steam-user');
const store = require('./store');
const log = require('./log');
const { fetchAllDroppable, NotLoggedInError } = require('./badges');
const { planIdle } = require('./planner');

const { EResult, EPersonaState } = SteamUser;

// 这些错误说明凭据已失效，重试无意义，需要在网页上重新登录
const AUTH_ERRORS = new Set([
  EResult.InvalidPassword, EResult.AccessDenied, EResult.Expired, EResult.Revoked,
  EResult.AccountLogonDenied, EResult.AccountLoginDeniedNeedTwoFactor, EResult.InvalidSignature,
]);

const PERSONA = {
  online: EPersonaState.Online,
  invisible: EPersonaState.Invisible,
  offline: EPersonaState.Offline,
};

/**
 * 状态：
 * - logged_out   未登录 Steam
 * - connecting   正在连接 / 重连
 * - running      已登录，正常挂卡（或暂无可挂游戏）
 * - paused       用户在网页上暂停
 * - blocked      账号正在其他设备上游戏
 * - auth_failed  登录凭据失效，需要重新登录
 */
class Idler extends EventEmitter {
  constructor() {
    super();
    this.config = store.loadConfig();
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
    this.lastError = null;
    this.checkTimer = null;
    this.retryTimer = null;
    this.intervalTimer = null;
    this.client = this.createClient();
    this.resetInterval();
  }

  createClient() {
    const client = new SteamUser({
      dataDirectory: store.files.steamUser,
      renewRefreshTokens: true,
      autoRelogin: true,
    });

    client.on('refreshToken', (refreshToken) => {
      const saved = store.loadToken() || {};
      store.saveToken({ ...saved, refreshToken });
      this.updateAccount();
      const exp = store.tokenExpiresAt(refreshToken);
      log.info(`登录凭据已续期${exp ? `，有效期至 ${exp.toLocaleString()}` : ''}`);
    });

    client.on('loggedOn', () => {
      log.info(`已登录 Steam：${client.steamID.getSteamID64()}`);
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
        log.info(`账号正在其他设备上游戏（appid ${playingApp}），暂停挂卡`);
        this.refreshState();
      } else if (!isBlocked && this.blocked) {
        this.blocked = false;
        log.info('其他设备已结束游戏，恢复挂卡');
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
      log.warn(`与 Steam 断开：${EResult[eresult] || eresult}${msg ? ` ${msg}` : ''}，自动重连中`);
      this.setState('connecting');
    });

    client.on('error', (err) => {
      this.cookies = null;
      this.current = [];
      this.playing = [];
      this.lastError = err.message;
      if (err.eresult === EResult.LoggedInElsewhere) {
        // 在电脑上启动游戏并选择“继续”时，Steam 会踢掉本会话
        log.info('会话被其他设备上的游戏顶下线，稍后重新登录');
        this.retryLogOn(2);
      } else if (AUTH_ERRORS.has(err.eresult)) {
        log.error(`登录凭据已失效（${err.message}），请在网页上重新登录 Steam`);
        this.setState('auth_failed');
      } else {
        log.error(`Steam 错误：${err.message}`);
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
    const t = store.loadToken();
    this.account = t
      ? { accountName: t.accountName || '', steamID: t.steamID || '', tokenExpiresAt: store.tokenExpiresAt(t.refreshToken) }
      : null;
  }

  logOn() {
    const t = store.loadToken();
    if (!t) {
      this.setState('logged_out');
      return;
    }
    clearTimeout(this.retryTimer);
    this.setState('connecting');
    log.info(`正在登录 ${t.accountName || ''}…`);
    this.client.logOn({ refreshToken: t.refreshToken, machineName: this.config.machineName });
  }

  retryLogOn(minutes) {
    clearTimeout(this.retryTimer);
    this.setState('connecting');
    log.info(`${minutes} 分钟后重新登录`);
    this.retryTimer = setTimeout(() => this.logOn(), minutes * 60_000);
  }

  async logOffClient() {
    if (!this.client.steamID) return;
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

  // 网页登录成功后调用：保存凭据并（重新）登录
  async useToken({ accountName, steamID, refreshToken }) {
    await this.logOffClient();
    store.saveToken({ accountName, steamID, refreshToken });
    this.updateAccount();
    this.resetRuntime();
    this.logOn();
  }

  async logout() {
    clearTimeout(this.retryTimer);
    await this.logOffClient();
    store.clearToken();
    this.account = null;
    this.resetRuntime();
    this.games = [];
    this.lastCheckAt = null;
    log.info('已退出 Steam 登录并删除凭据');
    this.setState('logged_out');
  }

  resetRuntime() {
    this.cookies = null;
    this.blocked = false;
    this.current = [];
    this.playing = [];
    this.lastError = null;
  }

  setConfig(patch) {
    const prev = this.config;
    this.config = store.saveConfig(patch);
    if (prev.checkIntervalMinutes !== this.config.checkIntervalMinutes) this.resetInterval();
    if (prev.personaState !== this.config.personaState && this.client.steamID) {
      this.client.setPersona(PERSONA[this.config.personaState]);
    }
    if (prev.paused !== this.config.paused) {
      log.info(this.config.paused ? '已暂停挂卡' : '已恢复挂卡');
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
      log.info('已停止挂卡');
    } else {
      const names = games.map((g) => `${g.name}(${g.appid}, ${g.hours}h, 剩${g.drops})`).join('、');
      log.info(`开始挂 ${ids.length} 个游戏：${names}`);
    }
    this.emitStatus();
  }

  async check() {
    if (this.checking || this.blocked || !this.client.steamID || !this.cookies) return;
    this.checking = true;
    try {
      const all = await fetchAllDroppable(this.client.steamID.getSteamID64(), this.cookies);
      this.lastCheckAt = new Date();
      this.nextCheckAt = new Date(Date.now() + this.config.checkIntervalMinutes * 60_000);
      const skip = new Set(this.config.skipAppIds);
      this.games = all.map((g) => ({ ...g, skipped: skip.has(g.appid) }));
      const games = all.filter((g) => !skip.has(g.appid));
      const totalDrops = games.reduce((s, g) => s + g.drops, 0);
      log.info(`可掉卡游戏 ${games.length} 个，剩余 ${totalDrops} 张`);
      if (this.blocked) return; // 拉取期间账号开始在别处游戏
      this.setPlaying(this.config.paused ? [] : planIdle(games, this.config));
    } catch (err) {
      if (err instanceof NotLoggedInError) {
        log.warn(`${err.message}，重新获取网页会话`);
        this.cookies = null;
        this.client.webLogOn();
      } else {
        log.warn(`检查徽章页失败：${err.message}`);
      }
    } finally {
      this.checking = false;
      this.emitStatus();
    }
  }

  checkNow() {
    this.scheduleCheck(0);
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
      state: this.state,
      account: this.account,
      playing: this.playing,
      games: this.games,
      totalDrops: this.games.filter((g) => !g.skipped).reduce((s, g) => s + g.drops, 0),
      lastCheckAt: this.lastCheckAt,
      nextCheckAt: this.client.steamID ? this.nextCheckAt : null,
      lastError: this.lastError,
      config: this.config,
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
