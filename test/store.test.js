const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'idler-store-'));
const store = require('../src/store');

test('没有配置文件时使用默认值', () => {
  assert.deepStrictEqual(store.loadConfig(), store.DEFAULT_CONFIG);
});

test('保存配置时校验并限制取值范围', () => {
  const c = store.saveConfig({
    maxConcurrent: 100,
    checkIntervalMinutes: 1,
    hoursUntilDrops: -3,
    skipAppIds: ['570', 570, 'abc', -1, 730],
    personaState: 'INVISIBLE',
    machineName: '  ',
  });
  assert.strictEqual(c.maxConcurrent, 32);
  assert.strictEqual(c.checkIntervalMinutes, 5);
  assert.strictEqual(c.hoursUntilDrops, 0);
  assert.deepStrictEqual(c.skipAppIds, [570, 730]);
  assert.strictEqual(c.personaState, 'invisible');
  assert.strictEqual(c.machineName, 'steam-idler');
  assert.deepStrictEqual(store.loadConfig(), c);
});

test('非法配置抛出错误且不写入', () => {
  const before = store.loadConfig();
  assert.throws(() => store.saveConfig({ personaState: 'busy' }), /personaState/);
  assert.throws(() => store.saveConfig({ maxConcurrent: 'abc' }), /maxConcurrent/);
  assert.deepStrictEqual(store.loadConfig(), before);
});

test('部分更新保留其他字段，暂停状态持久化', () => {
  store.saveConfig({ maxConcurrent: 8 });
  const c = store.saveConfig({ paused: true });
  assert.strictEqual(c.maxConcurrent, 8);
  assert.strictEqual(store.loadConfig().paused, true);
});

test('凭据读写与过期时间解析', () => {
  assert.strictEqual(store.loadToken(), null);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `x.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.y`;
  store.saveToken({ accountName: 'a', steamID: '1', refreshToken: jwt });
  assert.strictEqual(store.loadToken().refreshToken, jwt);
  assert.strictEqual(store.tokenExpiresAt(jwt).getTime(), exp * 1000);
  assert.strictEqual((fs.statSync(store.files.token).mode & 0o777).toString(8), '600');
  store.clearToken();
  assert.strictEqual(store.loadToken(), null);
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

test('配置文件损坏时备份并使用默认值，个别字段非法时只丢弃该字段', () => {
  fs.writeFileSync(store.files.config, '{ broken json');
  assert.deepStrictEqual(store.loadConfig(), store.DEFAULT_CONFIG);
  const backups = fs.readdirSync(store.dataDir).filter((f) => f.startsWith('config.json.broken-'));
  assert.strictEqual(backups.length, 1);
  assert.ok(!fs.existsSync(store.files.config));

  fs.writeFileSync(store.files.config, JSON.stringify({ maxConcurrent: 6, personaState: 'away', skipAppIds: 'x' }));
  const c = store.loadConfig();
  assert.strictEqual(c.maxConcurrent, 6);
  assert.strictEqual(c.personaState, 'online');
  assert.deepStrictEqual(c.skipAppIds, []);
  // 仍可通过保存修复
  assert.strictEqual(store.saveConfig({ personaState: 'invisible' }).maxConcurrent, 6);

  fs.writeFileSync(store.files.token, 'not json');
  assert.strictEqual(store.loadToken(), null);
  assert.ok(fs.readdirSync(store.dataDir).some((f) => f.startsWith('refresh_token.json.broken-')));
});
