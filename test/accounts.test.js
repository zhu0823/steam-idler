const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'idler-accounts-'));
const store = require('../src/store');
const { AccountManager } = require('../src/accounts');

const A = '76561190000000001';
const B = '76561190000000002';

class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.steamID = null;
    this.calls = [];
  }

  logOn(details) {
    this.calls.push(['logOn', details.refreshToken]);
  }

  logOff() {
    this.calls.push(['logOff']);
    if (this.steamID) {
      // 模拟 steam-user：发送 LogOff 后触发 disconnected 并清空 steamID
      setImmediate(() => {
        this.emit('disconnected', 0, 'Logged off');
        this.steamID = null;
      });
    }
  }

  gamesPlayed(ids) {
    this.calls.push(['gamesPlayed', ids]);
  }

  setPersona(state) {
    this.calls.push(['setPersona', state]);
  }

  webLogOn() {}

  async getProductInfo(apps, packages) {
    this.calls.push(['getProductInfo', apps, packages]);
    return this.productInfo || { apps: {}, packages: {} };
  }
}

function makeManagerWith(idlerOptions = {}) {
  const clients = new Map();
  const manager = new AccountManager({
    createClient: (id) => {
      const c = new FakeClient();
      clients.set(id, c);
      return c;
    },
    idlerOptions,
  });
  return { manager, clients };
}

const makeManager = () => makeManagerWith();

test.beforeEach(() => {
  fs.rmSync(store.dataDir, { recursive: true, force: true });
  fs.mkdirSync(store.dataDir, { recursive: true });
});

test('启动时迁移旧版数据并登录所有已保存的账号', async () => {
  fs.writeFileSync(store.files.legacyToken, JSON.stringify({ accountName: 'alice', steamID: A, refreshToken: 'ta' }));
  store.saveAccountToken(B, { accountName: 'bob', refreshToken: 'tb' });
  const { manager, clients } = makeManager();
  manager.start();

  assert.deepStrictEqual([...manager.idlers.keys()].sort(), [A, B]);
  assert.deepStrictEqual(clients.get(A).calls, [['logOn', 'ta']]);
  assert.deepStrictEqual(clients.get(B).calls, [['logOn', 'tb']]);
  const s = manager.status();
  assert.deepStrictEqual(s.accounts.map((a) => a.account.accountName).sort(), ['alice', 'bob']);
  await manager.shutdown();
});

test('网页登录：新 SteamID 新增账号，已有 SteamID 更新凭据并重新登录', async () => {
  const { manager, clients } = makeManager();
  manager.start();
  let events = 0;
  manager.on('status', () => events++);

  await manager.upsert({ accountName: 'alice', steamID: A, refreshToken: 't1' });
  assert.deepStrictEqual(store.listAccountIds(), [A]);
  assert.deepStrictEqual(clients.get(A).calls, [['logOn', 't1']]);
  assert.ok(events > 0);

  clients.get(A).steamID = { getSteamID64: () => A };
  await manager.upsert({ accountName: 'alice', steamID: A, refreshToken: 't2' });
  assert.strictEqual(manager.idlers.size, 1);
  assert.deepStrictEqual(clients.get(A).calls.slice(1), [['gamesPlayed', []], ['logOff'], ['logOn', 't2']]);
  assert.strictEqual(store.loadAccountToken(A).refreshToken, 't2');
  await manager.shutdown();
});

test('移除账号：自动重连等待期间也会调用 logOff，并删除该账号数据', async () => {
  store.saveAccountToken(A, { accountName: 'alice', refreshToken: 'ta' });
  store.saveAccountToken(B, { accountName: 'bob', refreshToken: 'tb' });
  const { manager, clients } = makeManager();
  manager.start();
  // 断线后 steam-user 处于重连等待：steamID 为 null
  await manager.remove(A);
  assert.deepStrictEqual(clients.get(A).calls, [['logOn', 'ta'], ['logOff']]);
  assert.deepStrictEqual(store.listAccountIds(), [B]);
  assert.deepStrictEqual([...manager.idlers.keys()], [B]);
  await assert.rejects(manager.remove(A), { statusCode: 404 });
  await manager.shutdown();
});

test('全局参数变更同步到未覆盖的账号，覆盖的账号不受影响', async () => {
  store.saveAccountToken(A, { accountName: 'alice', refreshToken: 'ta' });
  store.saveAccountToken(B, { accountName: 'bob', refreshToken: 'tb' });
  const { manager } = makeManager();
  manager.start();
  manager.setAccountConfig(B, { overrides: { maxConcurrent: 4 } });

  manager.setGlobalConfig({ maxConcurrent: 12 });
  assert.strictEqual(manager.get(A).config.maxConcurrent, 12);
  assert.strictEqual(manager.get(B).config.maxConcurrent, 4);
  assert.strictEqual(manager.status().global.maxConcurrent, 12);
  await manager.shutdown();
});

test('批量暂停与恢复；在线状态变更即时生效', async () => {
  store.saveAccountToken(A, { accountName: 'alice', refreshToken: 'ta' });
  store.saveAccountToken(B, { accountName: 'bob', refreshToken: 'tb' });
  const { manager, clients } = makeManager();
  manager.start();

  manager.pauseAll();
  assert.ok(manager.status().accounts.every((a) => a.config.paused));
  assert.strictEqual(store.loadAccountConfig(A).paused, true);
  manager.resumeAll();
  assert.ok(manager.status().accounts.every((a) => !a.config.paused));

  clients.get(A).steamID = { getSteamID64: () => A };
  manager.setGlobalConfig({ personaState: 'invisible' });
  assert.deepStrictEqual(clients.get(A).calls.at(-1), ['setPersona', 7]);
  assert.throws(() => manager.get('123'), { statusCode: 404 });
  await manager.shutdown();
});

test('日志按账号标注', async () => {
  const log = require('../src/log');
  store.saveAccountToken(A, { accountName: 'alice', refreshToken: 'ta' });
  const { manager } = makeManager();
  manager.start();
  const entry = log.recent().reverse().find((e) => e.accountId === A);
  assert.strictEqual(entry.accountName, 'alice');
  assert.match(entry.message, /正在登录/);
  await manager.shutdown();
});

test('检查徽章页时识别掉卡并持久化，状态包含阶段与预计时间', async () => {
  store.saveAccountToken(A, { accountName: 'alice', refreshToken: 'ta' });
  const results = [
    [{ appid: 10, name: 'Hades', hours: 2.5, drops: 3 }, { appid: 20, name: 'Celeste', hours: 0.5, drops: 4 }],
    [{ appid: 10, name: 'Hades', hours: 3, drops: 1 }, { appid: 20, name: 'Celeste', hours: 0.5, drops: 4 }],
    [{ appid: 20, name: 'Celeste', hours: 0.5, drops: 4 }],
  ];
  const { manager, clients } = makeManagerWith({ fetchBadges: async () => results.shift(), badgeGapMs: 0 });
  manager.start();
  const idler = manager.get(A);
  clients.get(A).steamID = { getSteamID64: () => A };
  idler.cookies = ['sessionid=x'];

  await idler.check();
  let s = idler.status();
  assert.strictEqual(s.dropsToday, 0);
  assert.strictEqual(s.phase.mode, 'solo');
  assert.strictEqual(s.phase.game.appid, 10);
  assert.ok(s.etaMinutes > 0);

  await idler.check();
  await idler.check();
  s = idler.status();
  assert.strictEqual(s.dropsToday, 3);
  assert.deepStrictEqual(s.recentDrops.map((d) => [d.name, d.count]), [['Hades', 1], ['Hades', 2]]);
  assert.strictEqual(s.phase.mode, 'multi');
  assert.strictEqual(store.loadDropHistory(A).length, 2);

  // 重启后掉卡记录仍在
  await manager.shutdown();
  const again = makeManager().manager;
  again.start();
  assert.strictEqual(again.get(A).status().dropsToday, 3);
  await again.shutdown();
});

function loggedIn(manager, clients, id = A) {
  const idler = manager.get(id);
  clients.get(id).steamID = { getSteamID64: () => id };
  idler.cookies = ['sessionid=x'];
  return idler;
}

const played = (client) => client.calls.filter((c) => c[0] === 'gamesPlayed').map((c) => c[1]);

test('退款期内的游戏不挂，许可证变化后重新计算', async () => {
  store.saveAccountToken(A, { accountName: 'alice', refreshToken: 'ta' });
  const games = [{ appid: 10, name: 'New', hours: 0, drops: 3 }, { appid: 20, name: 'Old', hours: 0.5, drops: 2 }];
  const { manager, clients } = makeManagerWith({ fetchBadges: async () => games, badgeGapMs: 0 });
  manager.start();
  const idler = loggedIn(manager, clients);
  const client = clients.get(A);
  const now = Math.floor(Date.now() / 1000);
  client.licenses = [
    { package_id: 1, time_created: now - 86400, payment_method: 2, flags: 0 },
    { package_id: 2, time_created: now - 100 * 86400, payment_method: 2, flags: 0 },
  ];
  client.productInfo = { apps: {}, packages: { 1: { packageinfo: { appids: { 0: 10 } } } } };

  await idler.check();
  assert.deepStrictEqual(client.calls.find((c) => c[0] === 'getProductInfo'), ['getProductInfo', [], [1]]);
  let s = idler.status();
  assert.deepStrictEqual(s.games.map((g) => g.skipReason), ['refundable', null]);
  assert.deepStrictEqual(s.playing.map((g) => g.appid), [20]);
  assert.strictEqual(s.totalDrops, 2);

  // 只在许可证变化后重新查询
  await idler.check();
  assert.strictEqual(client.calls.filter((c) => c[0] === 'getProductInfo').length, 1);

  // 关闭保护后照常挂
  manager.setGlobalConfig({ skipRefundable: false });
  await idler.check();
  s = idler.status();
  assert.deepStrictEqual(s.playing.map((g) => g.appid).sort(), [10, 20]);
  await manager.shutdown();
});

test('优先队列与跳过修改后立即反映到游戏列表', async () => {
  store.saveAccountToken(A, { accountName: 'alice', refreshToken: 'ta' });
  const games = [{ appid: 10, name: 'A', hours: 3, drops: 3 }, { appid: 20, name: 'B', hours: 2.5, drops: 2 }];
  const { manager, clients } = makeManagerWith({ fetchBadges: async () => games, badgeGapMs: 0 });
  manager.start();
  const idler = loggedIn(manager, clients);
  await idler.check();
  assert.deepStrictEqual(idler.status().playing.map((g) => g.appid), [10]);

  manager.setAccountConfig(A, { priorityAppIds: [20] });
  assert.deepStrictEqual(idler.status().games.map((g) => g.priority), [null, 1]);
  await idler.check();
  assert.deepStrictEqual(idler.status().playing.map((g) => g.appid), [20]);
  await manager.shutdown();
});

test('卡片掉完后挂指定游戏并显示自定义状态，挂卡时文本带游戏名', async () => {
  store.saveAccountToken(A, { accountName: 'alice', refreshToken: 'ta' });
  const results = [[{ appid: 10, name: 'Hades', hours: 3, drops: 1 }], []];
  const { manager, clients } = makeManagerWith({ fetchBadges: async () => results.shift(), badgeGapMs: 0 });
  manager.start();
  manager.setGlobalConfig({ farmingStatusText: '挂卡：{name}', idleStatusText: '休息中' });
  manager.setAccountConfig(A, { idleAppIds: [440, 570] });
  const idler = loggedIn(manager, clients);
  const client = clients.get(A);
  client.productInfo = { apps: { 440: { appinfo: { common: { name: 'Team Fortress 2' } } } }, packages: {} };

  await idler.check();
  assert.deepStrictEqual(played(client).at(-1), ['挂卡：Hades', 10]);
  await idler.check();
  assert.deepStrictEqual(played(client).at(-1), ['休息中', 440, 570]);
  await new Promise(setImmediate);
  const s = idler.status();
  assert.deepStrictEqual(s.playing, []);
  assert.deepStrictEqual(s.boosting, [{ appid: 440, name: 'Team Fortress 2' }, { appid: 570, name: 'App 570' }]);

  // 暂停时什么都不挂
  manager.setAccountConfig(A, { paused: true });
  assert.deepStrictEqual(played(client).at(-1), []);
  assert.deepStrictEqual(idler.status().boosting, []);
  await manager.shutdown();
});

test('掉卡、全部掉完、凭据失效时发出通知', async () => {
  store.saveAccountToken(A, { accountName: 'alice', refreshToken: 'ta' });
  const results = [
    [{ appid: 10, name: 'Hades', hours: 3, drops: 2 }],
    [{ appid: 10, name: 'Hades', hours: 3.5, drops: 1 }],
    [],
    [],
  ];
  const sent = [];
  const notifier = { send: (msg) => sent.push(msg) };
  const { manager, clients } = makeManagerWith({ fetchBadges: async () => results.shift(), badgeGapMs: 0 });
  manager.notifier = notifier;
  manager.start();
  const idler = loggedIn(manager, clients);

  for (let i = 0; i < 4; i++) await idler.check();
  assert.deepStrictEqual(
    sent.map((m) => [m.event, m.title, m.account.name]),
    [
      ['drops', '掉落 1 张卡片', 'alice'],
      ['drops', '掉落 1 张卡片', 'alice'],
      ['finished', '卡片已全部掉完', 'alice'],
    ],
  );
  assert.strictEqual(sent[0].text, 'Hades +1');

  const SteamUser = require('steam-user');
  clients.get(A).emit('error', Object.assign(new Error('AccessDenied'), { eresult: SteamUser.EResult.AccessDenied }));
  assert.strictEqual(sent.at(-1).event, 'authFailed');
  assert.strictEqual(idler.status().state, 'auth_failed');
  await manager.shutdown();
});
