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
}

function makeManager() {
  const clients = new Map();
  const manager = new AccountManager({
    createClient: (id) => {
      const c = new FakeClient();
      clients.set(id, c);
      return c;
    },
  });
  return { manager, clients };
}

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
