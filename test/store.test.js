const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'idler-store-'));
const store = require('../src/store');

const A = '76561190000000001';
const B = '76561190000000002';

function reset() {
  fs.rmSync(store.dataDir, { recursive: true, force: true });
  fs.mkdirSync(store.dataDir, { recursive: true });
}

test.beforeEach(reset);

test('没有配置文件时使用默认值', () => {
  assert.deepStrictEqual(store.loadGlobalConfig(), store.DEFAULT_SETTINGS);
  assert.deepStrictEqual(store.listAccountIds(), []);
});

test('全局参数保存时校验并限制取值范围', () => {
  const c = store.saveGlobalConfig({ maxConcurrent: 100, checkIntervalMinutes: 1, hoursUntilDrops: -3, personaState: 'INVISIBLE', machineName: '  ' });
  assert.deepStrictEqual(c, { maxConcurrent: 32, hoursUntilDrops: 0, checkIntervalMinutes: 5, personaState: 'invisible', machineName: 'steam-idler' });
  assert.deepStrictEqual(store.loadGlobalConfig(), c);
  assert.throws(() => store.saveGlobalConfig({ personaState: 'busy' }), /personaState/);
  assert.deepStrictEqual(store.loadGlobalConfig(), c);
});

test('账号凭据与配置按 SteamID 分目录保存，权限为 600', () => {
  store.saveAccountToken(A, { accountName: 'alice', refreshToken: 'ta' });
  store.saveAccountToken(B, { accountName: 'bob', refreshToken: 'tb' });
  assert.deepStrictEqual(store.listAccountIds(), [A, B]);
  assert.strictEqual(store.loadAccountToken(A).refreshToken, 'ta');
  assert.strictEqual(store.loadAccountToken(B).steamID, B);
  const file = path.join(store.files.accounts, A, 'token.json');
  assert.strictEqual((fs.statSync(file).mode & 0o777).toString(8), '600');

  store.removeAccount(A);
  assert.deepStrictEqual(store.listAccountIds(), [B]);
  assert.strictEqual(store.loadAccountToken(A), null);
});

test('账号 ID 必须是数字，防止路径穿越', () => {
  assert.throws(() => store.loadAccountToken('../admin'), { statusCode: 400 });
  assert.throws(() => store.removeAccount('..'), { statusCode: 400 });
  fs.mkdirSync(path.join(store.files.accounts, 'not-an-id'), { recursive: true });
  assert.deepStrictEqual(store.listAccountIds(), []);
});

test('生效配置：默认使用全局值，开启覆盖后使用账号值，跳过列表与暂停按账号', () => {
  store.saveAccountToken(A, { accountName: 'alice', refreshToken: 'ta' });
  store.saveGlobalConfig({ maxConcurrent: 10 });
  store.saveAccountConfig(A, { skipAppIds: ['570', 570, 'x', 730], paused: true });

  let c = store.effectiveConfig(A);
  assert.strictEqual(c.maxConcurrent, 10);
  assert.deepStrictEqual(c.skipAppIds, [570, 730]);
  assert.strictEqual(c.paused, true);
  assert.strictEqual(c.customized, false);

  store.saveAccountConfig(A, { overrides: { maxConcurrent: 3, personaState: 'offline' } });
  c = store.effectiveConfig(A);
  assert.strictEqual(c.maxConcurrent, 3);
  assert.strictEqual(c.personaState, 'offline');
  assert.strictEqual(c.hoursUntilDrops, 2);
  assert.strictEqual(c.customized, true);
  // 覆盖后全局值变化不影响该账号
  store.saveGlobalConfig({ maxConcurrent: 20 });
  assert.strictEqual(store.effectiveConfig(A).maxConcurrent, 3);

  store.saveAccountConfig(A, { overrides: null });
  assert.strictEqual(store.effectiveConfig(A).maxConcurrent, 20);
  assert.throws(() => store.saveAccountConfig(A, { overrides: [1] }), /overrides/);
});

test('旧版单账号数据迁移到 accounts/<SteamID>', () => {
  fs.writeFileSync(store.files.legacyToken, JSON.stringify({ accountName: 'alice', steamID: A, refreshToken: 'legacy' }));
  fs.writeFileSync(store.files.config, JSON.stringify({ maxConcurrent: 8, skipAppIds: [570], paused: true, personaState: 'invisible' }));

  assert.strictEqual(store.migrateLegacy(), A);
  assert.ok(!fs.existsSync(store.files.legacyToken));
  assert.strictEqual(store.loadAccountToken(A).refreshToken, 'legacy');
  assert.deepStrictEqual(store.loadAccountConfig(A), { skipAppIds: [570], paused: true, overrides: null });
  const global = JSON.parse(fs.readFileSync(store.files.config, 'utf8'));
  assert.deepStrictEqual(global, { maxConcurrent: 8, hoursUntilDrops: 2, checkIntervalMinutes: 15, personaState: 'invisible', machineName: 'steam-idler' });

  // 再次启动不会重复迁移
  assert.strictEqual(store.migrateLegacy(), null);
});

test('旧版凭据缺少 SteamID 时备份并跳过迁移', () => {
  fs.writeFileSync(store.files.legacyToken, JSON.stringify({ accountName: 'alice', refreshToken: 'legacy' }));
  assert.strictEqual(store.migrateLegacy(), null);
  assert.ok(fs.readdirSync(store.dataDir).some((f) => f.startsWith('refresh_token.json.broken-')));
  assert.deepStrictEqual(store.listAccountIds(), []);
});

test('配置文件损坏时备份并使用默认值，个别字段非法时只丢弃该字段', () => {
  fs.writeFileSync(store.files.config, '{ broken json');
  assert.deepStrictEqual(store.loadGlobalConfig(), store.DEFAULT_SETTINGS);
  assert.ok(fs.readdirSync(store.dataDir).some((f) => f.startsWith('config.json.broken-')));

  fs.writeFileSync(store.files.config, JSON.stringify({ maxConcurrent: 6, personaState: 'away' }));
  const c = store.loadGlobalConfig();
  assert.strictEqual(c.maxConcurrent, 6);
  assert.strictEqual(c.personaState, 'online');

  store.saveAccountToken(A, { accountName: 'alice', refreshToken: 'ta' });
  fs.writeFileSync(path.join(store.files.accounts, A, 'config.json'), JSON.stringify({ skipAppIds: 'x', paused: true }));
  assert.deepStrictEqual(store.loadAccountConfig(A), { skipAppIds: [], paused: true, overrides: null });

  fs.writeFileSync(path.join(store.files.accounts, A, 'token.json'), 'not json');
  assert.strictEqual(store.loadAccountToken(A), null);
});

test('数据目录不可写时给出明确提示', { skip: process.getuid && process.getuid() === 0 }, () => {
  const ro = fs.mkdtempSync(path.join(os.tmpdir(), 'idler-ro-'));
  fs.chmodSync(ro, 0o500);
  const { execFileSync } = require('child_process');
  const script = "try { require('./src/store').ensureWritable() } catch (e) { console.log(e.message) }";
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATA_DIR: path.join(ro, 'data') },
  }).toString();
  fs.chmodSync(ro, 0o700);
  assert.match(out, /不可写.*PUID\/PGID/);
});

test('掉卡记录追加保存，超过 30 天的自动清理', () => {
  store.saveAccountToken(A, { accountName: 'alice', refreshToken: 'ta' });
  const old = new Date(Date.now() - 31 * 86400_000).toISOString();
  store.appendDropHistory(A, [{ time: old, appid: 1, name: 'Old', count: 1 }]);
  const list = store.appendDropHistory(A, [{ time: new Date().toISOString(), appid: 2, name: 'New', count: 2 }]);
  assert.deepStrictEqual(list.map((e) => e.name), ['New']);
  assert.deepStrictEqual(store.loadDropHistory(A).map((e) => e.count), [2]);
  fs.writeFileSync(path.join(store.files.accounts, A, 'drops.json'), 'broken');
  assert.deepStrictEqual(store.loadDropHistory(A), []);
});
