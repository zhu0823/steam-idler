// 挂卡主流程：维护 Steam 连接、定期读取徽章页并上报正在游戏
const { EventEmitter } = require('events');
const SteamUser = require('steam-user');
const store = require('./store');
const log = require('./log');
const { fetchAllDroppable, NotLoggedInError } = require('./badges');
const { annotateGames, planIdle, refundableLicenses, refundableApps, gameSlots, playPayload } = require('./planner');
const { detectDrops, phaseOf, estimateMinutes, dropsOnDay } = require('./progress');

const { EResult, EPersonaState } = SteamUser;

// 这些错误说明凭据已失效，重试无意义，需要在网页上重新登录
const AUTH_ERRORS = new Set([
  EResult.InvalidPassword, EResult.AccessDenied, EResult.Expired, EResult.Revoked,
  EResult.AccountLogonDenied, EResult.AccountLoginDeniedNeedTwoFactor, EResult.InvalidSignature,
]);

// PICS 请求超时；steam-user 默认等待长达 1 小时
const PICS_TIMEOUT_MS = 60_000;

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 多个账号的徽章页请求串行执行并留出间隔，避免同一 IP 短时间内请求过多
const BADGE_GAP_MS = 3_000;
// 带自定义文本更新“正在游戏”时，先清空列表再等待这么久上报新列表，见 reportPlaying()
const PLAY_RESET_MS = 1_000;
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
 * 事件：
 * - status  状态变化，参数为 status()
 * - notify  需要推送通知的事件：{ event: 'drops'|'finished'|'authFailed', title, text }
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
   * @param {number} [opts.playResetMs] 带自定义文本更新“正在游戏”时清空后等待的时间
   */
  constructor({ id, client, fetchBadges = fetchAllDroppable, badgeGapMs = BADGE_GAP_MS, playResetMs = PLAY_RESET_MS }) {
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
    this.current = null; // 最近一次上报给 Steam 的“正在游戏”列表，null 表示需要重新上报
    this.playing = []; // 正在挂卡的游戏
    this.boosting = []; // 卡片掉完后正在挂时长的游戏 { appid, name }
    this.games = []; // 最近一次读取的可掉卡游戏（含已跳过）
    // 退款期内的游戏：appid → 退款截止时间；许可证变化后需要重新计算
    this.refundable = new Map();
    this.refundDirty = true;
    this.appNames = new Map();
    this.lastCheckAt = null;
    this.fetchBadges = fetchBadges;
    this.badgeGapMs = badgeGapMs;
    this.playResetMs = playResetMs;
    // 上一次读取的各游戏剩余掉落，用于识别掉卡；重启后第一次检查只建立基准
    this.prevDrops = null;
    this.prevActiveDrops = null;
    this.dropHistory = store.loadDropHistory(this.id);
    this.lastError = null;
    this.checkTimer = null;
    this.retryTimer = null;
    this.intervalTimer = null;
    this.playTimer = null;
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
      this.current = null;
      this.playing = [];
      this.lastError = null;
      client.setPersona(PERSONA[this.config.personaState] ?? EPersonaState.Online);
      this.refreshState();
    });

    // 登录时和购买、激活新游戏后触发
    client.on('licenses', () => {
      this.refundDirty = true;
      if (this.lastCheckAt) this.scheduleCheck(30_000);
    });

    client.on('webSession', (_sessionID, cookies) => {
      this.cookies = cookies;
      this.scheduleCheck(2_000);
    });

    client.on('playingState', (isBlocked, playingApp) => {
      if (isBlocked && !this.blocked) {
        this.blocked = true;
        this.current = null;
        this.playing = [];
        this.boosting = [];
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
      this.current = null;
      this.playing = [];
      this.boosting = [];
      this.lastError = err.message;
      if (err.eresult === EResult.LoggedInElsewhere) {
        // 在电脑上启动游戏并选择“继续”时，Steam 会踢掉本会话
        this.log.info('会话被其他设备上的游戏顶下线，稍后重新登录');
        this.retryLogOn(2);
      } else if (AUTH_ERRORS.has(err.eresult)) {
        this.log.error(`登录凭据已失效（${err.message}），请在网页上重新登录 Steam`);
        this.setState('auth_failed');
        this.notify('authFailed', '登录凭据已失效', `挂卡已停止（${err.message}），请在管理面板中重新登录该账号。`);
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
    clearTimeout(this.playTimer);
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
    this.current = null;
    this.playing = [];
    this.boosting = [];
    this.lastError = null;
    this.refundDirty = true;
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
    if (!prev.skipRefundable && this.config.skipRefundable) this.refundDirty = true;
    if (this.games.length > 0) {
      // 跳过列表、优先队列等变化立即反映到游戏列表，不必等徽章页重新读取
      this.games = annotateGames(this.games, this.config, this.refundable);
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

  /**
   * 上报正在游戏。
   * @param {object[]} games 挂卡的游戏
   * @param {object} [opts]
   * @param {object[]} [opts.boost] 没有可挂卡游戏时挂时长的游戏 { appid, name }
   * @param {string} [opts.text] 自定义“正在游戏”文本
   */
  setPlaying(games, { boost = [], text = '' } = {}) {
    const payload = playPayload(games.length ? games : boost, text);
    const same = this.current !== null && JSON.stringify(payload) === JSON.stringify(this.current);
    this.playing = games;
    this.boosting = games.length ? [] : boost;
    if (same) return;
    const wasEmpty = !this.current || this.current.length === 0;
    this.current = payload;
    if (this.client.steamID && !this.blocked) this.reportPlaying(payload, wasEmpty);
    if (games.length > 0) {
      const names = games.map((g) => `${g.name}(${g.appid}, ${g.hours}h, 剩${g.drops})`).join('、');
      this.log.info(`开始挂 ${games.length} 个游戏：${names}`);
    } else if (boost.length > 0) {
      this.log.info(`没有可挂卡的游戏，挂 ${boost.length} 个游戏累计时长：${boost.map((g) => g.appid).join('、')}`);
    } else if (payload.length > 0) {
      this.log.info(`没有可挂卡的游戏，显示自定义状态：${payload[0]}`);
    } else if (!wasEmpty) {
      this.log.info('已停止挂卡');
    }
    this.emitStatus();
  }

  /**
   * Steam 不会用新请求覆盖已在“正在游戏”中的自定义文本（非 Steam 游戏），
   * 自动轮换到下一个游戏时文本会消失。带文本更新时先清空列表，稍后再上报新列表。
   */
  reportPlaying(payload, wasEmpty) {
    clearTimeout(this.playTimer);
    if (wasEmpty || typeof payload[0] !== 'string') return this.client.gamesPlayed(payload);
    this.client.gamesPlayed([]);
    this.playTimer = setTimeout(() => {
      if (this.current === payload && this.client.steamID && !this.blocked) this.client.gamesPlayed(payload);
    }, this.playResetMs);
  }

  // 没有可挂卡游戏时挂的游戏，名称通过 PICS 查询，查询失败时只显示 appid
  boostGames() {
    const ids = this.config.idleAppIds.slice(0, gameSlots(this.config.idleStatusText));
    const missing = ids.filter((id) => !this.appNames.has(id));
    if (missing.length > 0 && this.client.steamID && typeof this.client.getProductInfo === 'function') {
      for (const id of missing) this.appNames.set(id, null);
      withTimeout(this.client.getProductInfo(missing, [], true), PICS_TIMEOUT_MS, 'PICS 请求超时')
        .then(({ apps }) => {
          for (const id of missing) this.appNames.set(id, apps?.[id]?.appinfo?.common?.name || null);
          this.boosting = this.boosting.map((g) => ({ ...g, name: this.appNames.get(g.appid) || g.name }));
          this.emitStatus();
        })
        .catch(() => {});
    }
    return ids.map((appid) => ({ appid, name: this.appNames.get(appid) || `App ${appid}` }));
  }

  // 从许可证列表计算退款期内的游戏
  async loadRefundable() {
    const licenses = refundableLicenses(this.client.licenses);
    if (licenses.length === 0) {
      this.refundable = new Map();
    } else {
      const { packages } = await withTimeout(
        this.client.getProductInfo([], licenses.map((l) => l.package_id), true),
        PICS_TIMEOUT_MS,
        'PICS 请求超时',
      );
      this.refundable = refundableApps(licenses, packages || {});
    }
    this.refundDirty = false;
  }

  async check() {
    if (this.checking || this.blocked || !this.client.steamID || !this.cookies) return;
    this.checking = true;
    try {
      const all = await enqueueBadgeFetch(() => this.fetchBadges(this.id, this.cookies), this.badgeGapMs);
      this.recordDrops(all);
      this.lastCheckAt = new Date();
      this.nextCheckAt = new Date(Date.now() + this.config.checkIntervalMinutes * 60_000);
      if (this.config.skipRefundable && this.refundDirty) {
        try {
          await this.loadRefundable();
        } catch (err) {
          // 沿用上一次的结果，下次检查重试
          this.log.warn(`读取游戏购买时间失败（${err.message}），本轮退款期判断可能不准确`);
        }
      }
      this.games = annotateGames(all, this.config, this.refundable);
      const active = this.games.filter((g) => !g.skipped);
      const totalDrops = active.reduce((s, g) => s + g.drops, 0);
      const refundSkipped = this.games.filter((g) => g.skipReason === 'refundable').length;
      this.log.info(`可掉卡游戏 ${active.length} 个，剩余 ${totalDrops} 张${refundSkipped ? `（${refundSkipped} 个在退款期内，已跳过）` : ''}`);
      this.checkFinished(totalDrops);
      if (this.blocked) return; // 拉取期间账号开始在别处游戏
      this.applyPlan();
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

  // 按当前游戏列表和配置决定挂什么
  applyPlan() {
    if (this.config.paused) return this.setPlaying([]);
    const { farmingStatusText, idleStatusText } = this.config;
    const maxConcurrent = Math.min(this.config.maxConcurrent, gameSlots(farmingStatusText));
    const games = planIdle(this.games, { ...this.config, maxConcurrent });
    if (games.length > 0) return this.setPlaying(games, { text: farmingStatusText });
    this.setPlaying([], { boost: this.boostGames(), text: idleStatusText });
  }

  // 可挂的卡片从有到无时通知一次；重启后第一次检查只建立基准
  checkFinished(totalDrops) {
    if (this.prevActiveDrops > 0 && totalDrops === 0) {
      const boost = this.config.idleAppIds.length ? `，开始挂 ${this.config.idleAppIds.length} 个游戏累计时长` : '';
      this.notify('finished', '卡片已全部掉完', `可挂的卡片已全部掉完${boost}。`);
    }
    this.prevActiveDrops = totalDrops;
  }

  notify(event, title, text) {
    this.emit('notify', { event, title, text });
  }

  recordDrops(all) {
    const drops = detectDrops(this.prevDrops, all);
    this.prevDrops = new Map(all.map((g) => [g.appid, { name: g.name, drops: g.drops }]));
    if (drops.length === 0) return;
    const time = new Date().toISOString();
    this.dropHistory = store.appendDropHistory(this.id, drops.map((d) => ({ time, ...d })));
    for (const d of drops) this.log.info(`掉落 ${d.count} 张卡片：${d.name}`);
    const count = drops.reduce((s, d) => s + d.count, 0);
    this.notify('drops', `掉落 ${count} 张卡片`, drops.map((d) => `${d.name} +${d.count}`).join('\n'));
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
      boosting: this.boosting,
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
    clearTimeout(this.playTimer);
    await this.logOffClient();
  }
}

module.exports = { Idler };
