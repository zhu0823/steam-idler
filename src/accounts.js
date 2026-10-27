// 多账号管理：每个账号一个 Idler，统一处理新增、移除、全局配置和批量操作
const { EventEmitter } = require('events');
const store = require('./store');
const log = require('./log');
const { Idler } = require('./idler');

class AccountManager extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {(id:string)=>object} [opts.createClient] 用于测试注入 SteamUser 实例
   * @param {object} [opts.idlerOptions] 传给每个 Idler 的额外参数（测试用）
   * @param {import('./notify').Notifier} [opts.notifier] 账号事件的通知发送者
   */
  constructor({ createClient, idlerOptions = {}, notifier = null } = {}) {
    super();
    this.setMaxListeners(0);
    this.createClient = createClient;
    this.idlerOptions = idlerOptions;
    this.notifier = notifier;
    this.idlers = new Map();
  }

  // 迁移旧数据后启动所有已保存的账号
  start() {
    store.migrateLegacy();
    for (const id of store.listAccountIds()) this.add(id).start();
    if (this.idlers.size === 0) log.info('尚未添加 Steam 账号，请在管理面板中登录');
  }

  add(id) {
    const idler = new Idler({ ...this.idlerOptions, id, client: this.createClient ? this.createClient(id) : undefined });
    idler.on('status', () => this.emit('status', this.status()));
    idler.on('notify', (msg) => {
      if (this.notifier) this.notifier.send({ ...msg, account: { id: idler.id, name: idler.tag.name } });
    });
    this.idlers.set(idler.id, idler);
    return idler;
  }

  get(id) {
    const idler = this.idlers.get(String(id));
    if (!idler) throw Object.assign(new Error('账号不存在'), { statusCode: 404 });
    return idler;
  }

  // 网页登录成功：已有账号则更新凭据重新登录，否则新增账号
  async upsert({ accountName, steamID, refreshToken }) {
    const existing = this.idlers.get(String(steamID));
    if (existing) {
      log.info(`重新登录账号：${accountName}`);
      await existing.useToken({ accountName, refreshToken });
      return existing;
    }
    store.saveAccountToken(steamID, { accountName, refreshToken });
    log.info(`已添加账号：${accountName}`);
    const idler = this.add(steamID);
    idler.start();
    this.emit('status', this.status());
    return idler;
  }

  // 退出登录并删除该账号的凭据和配置
  async remove(id) {
    const idler = this.get(id);
    this.idlers.delete(idler.id);
    idler.removeAllListeners('status');
    idler.removeAllListeners('notify');
    await idler.shutdown();
    store.removeAccount(idler.id);
    log.info(`已移除账号：${idler.tag.name}`);
    this.emit('status', this.status());
  }

  setGlobalConfig(patch) {
    const config = store.saveGlobalConfig(patch);
    for (const idler of this.idlers.values()) idler.reloadConfig();
    return config;
  }

  setAccountConfig(id, patch) {
    return this.get(id).setAccountConfig(patch);
  }

  pauseAll() {
    for (const idler of this.idlers.values()) idler.setAccountConfig({ paused: true });
  }

  resumeAll() {
    for (const idler of this.idlers.values()) idler.setAccountConfig({ paused: false });
  }

  checkAll() {
    for (const idler of this.idlers.values()) idler.checkNow();
  }

  status() {
    return {
      accounts: [...this.idlers.values()].map((i) => i.status()),
      global: store.loadGlobalConfig(),
    };
  }

  async shutdown() {
    await Promise.all([...this.idlers.values()].map((i) => i.shutdown().catch(() => {})));
  }
}

module.exports = { AccountManager };
