const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'idler-idler-'));
const store = require('../src/store');
const { Idler } = require('../src/idler');

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

  setPersona() {}
  webLogOn() {}
}

function makeIdler() {
  const client = new FakeClient();
  const idler = new Idler({ client });
  return { idler, client };
}

test.afterEach(() => store.clearToken());

test('自动重连等待期间退出 Steam 也会调用 logOff，取消重连', async () => {
  store.saveToken({ accountName: 'a', steamID: '1', refreshToken: 'old-token' });
  const { idler, client } = makeIdler();
  idler.start();
  // 断线后 steam-user 处于重连等待：steamID 为 null
  client.steamID = null;
  await idler.logout();
  assert.deepStrictEqual(client.calls.map((c) => c[0]), ['logOn', 'logOff']);
  assert.strictEqual(store.loadToken(), null);
  assert.strictEqual(idler.status().state, 'logged_out');
  await idler.shutdown();
});

test('已登录时退出：先停止游戏再登出，等待断开完成', async () => {
  store.saveToken({ accountName: 'a', steamID: '1', refreshToken: 'old-token' });
  const { idler, client } = makeIdler();
  idler.start();
  client.steamID = { getSteamID64: () => '1' };
  await idler.logout();
  assert.deepStrictEqual(client.calls.slice(1), [['gamesPlayed', []], ['logOff']]);
  assert.strictEqual(client.steamID, null);
  await idler.shutdown();
});

test('重连期间用新凭据登录：先取消旧连接再登录', async () => {
  store.saveToken({ accountName: 'a', steamID: '1', refreshToken: 'old-token' });
  const { idler, client } = makeIdler();
  idler.start();
  await idler.useToken({ accountName: 'b', steamID: '2', refreshToken: 'new-token' });
  assert.deepStrictEqual(client.calls, [['logOn', 'old-token'], ['logOff'], ['logOn', 'new-token']]);
  assert.strictEqual(store.loadToken().refreshToken, 'new-token');
  await idler.shutdown();
});
