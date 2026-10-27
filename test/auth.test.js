const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Auth, CODE_ALPHABET, CODE_LENGTH, normalizeSetupCode } = require('../src/auth');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idler-auth-'));
  const files = { admin: path.join(dir, 'admin.json'), setupCode: path.join(dir, 'setup_code') };
  let now = 1_700_000_000_000;
  const printed = [];
  const auth = new Auth({ files, onSetupCode: (c) => printed.push(c), now: () => now });
  return { auth, files, printed, advance: (ms) => (now += ms) };
}

test('初始化码：字符集不含易混淆字符，重启后保持不变', () => {
  const { auth, files, printed } = setup();
  const code = auth.ensureSetupCode();
  assert.strictEqual(code.length, CODE_LENGTH);
  assert.ok([...code].every((c) => CODE_ALPHABET.includes(c)));
  assert.ok(!/[01OIL]/.test(CODE_ALPHABET));
  assert.match(fs.readFileSync(files.setupCode, 'utf8'), /^[A-Z0-9]{4}-[A-Z0-9]{4}\n$/);
  assert.deepStrictEqual(printed, [code]);

  // 模拟重启：新实例读取同一个文件
  const again = new Auth({ files, onSetupCode: () => assert.fail('不应重新生成') });
  assert.strictEqual(again.ensureSetupCode(), code);
});

test('初始化码输入忽略大小写、空格和横线', () => {
  assert.strictEqual(normalizeSetupCode(' k7qm - 4xpd '), 'K7QM4XPD');
});

test('初始化：错误码被拒绝，正确码创建管理员并删除初始化码', async () => {
  const { auth, files } = setup();
  const code = auth.ensureSetupCode();
  await assert.rejects(auth.setup('1.1.1.1', 'WRONGCOD', 'password123'), { statusCode: 403 });
  await assert.rejects(auth.setup('1.1.1.1', code, 'short'), { statusCode: 400 });

  const session = await auth.setup('1.1.1.1', code.toLowerCase(), 'password123');
  assert.ok(auth.isInitialized());
  assert.ok(!fs.existsSync(files.setupCode));
  assert.ok(auth.verifySession(session.token));
  assert.strictEqual(auth.ensureSetupCode(), null);
  await assert.rejects(auth.setup('1.1.1.1', code, 'password123'), { statusCode: 404 });

  const admin = JSON.parse(fs.readFileSync(files.admin, 'utf8'));
  assert.ok(!JSON.stringify(admin).includes('password123'));
});

test('同一 IP 连续输错 5 次锁定 15 分钟', async () => {
  const { auth, advance } = setup();
  const code = auth.ensureSetupCode();
  for (let i = 0; i < 5; i++) await assert.rejects(auth.setup('2.2.2.2', 'AAAAAAAA', 'password123'), { statusCode: 403 });
  await assert.rejects(auth.setup('2.2.2.2', code, 'password123'), { statusCode: 429 });
  // 其他 IP 不受影响的锁定
  await assert.rejects(auth.setup('3.3.3.3', 'AAAAAAAA', 'password123'), { statusCode: 403 });
  advance(15 * 60_000 + 1);
  await auth.setup('2.2.2.2', code, 'password123');
});

test('全局累计输错 20 次后更换初始化码', async () => {
  const { auth, printed } = setup();
  const first = auth.ensureSetupCode();
  for (let i = 0; i < 20; i++) {
    await assert.rejects(auth.setup(`10.0.0.${i}`, 'AAAAAAAA', 'password123'), { statusCode: 403 });
  }
  assert.strictEqual(printed.length, 2);
  const second = auth.ensureSetupCode();
  assert.notStrictEqual(second, first);
  await assert.rejects(auth.setup('9.9.9.9', first, 'password123'), { statusCode: 403 });
  await auth.setup('9.9.9.9', second, 'password123');
});

test('登录、会话过期与修改密码后旧会话失效', async () => {
  const { auth, advance } = setup();
  await auth.setup('1.1.1.1', auth.ensureSetupCode(), 'password123');
  await assert.rejects(auth.login('1.1.1.1', 'bad-password'), { statusCode: 401 });

  const old = await auth.login('1.1.1.1', 'password123');
  assert.ok(auth.verifySession(old.token));
  assert.ok(!auth.verifySession(`${old.token}x`));
  assert.ok(!auth.verifySession('garbage'));

  const fresh = await auth.changePassword('1.1.1.1', 'password123', 'new-password-456');
  assert.ok(!auth.verifySession(old.token));
  assert.ok(auth.verifySession(fresh.token));
  await assert.rejects(auth.login('1.1.1.1', 'password123'), { statusCode: 401 });

  advance(31 * 86400_000);
  assert.ok(!auth.verifySession(fresh.token));
});

test('删除 admin.json 后重新进入初始化流程', async () => {
  const { auth, files } = setup();
  const s = await auth.setup('1.1.1.1', auth.ensureSetupCode(), 'password123');
  fs.rmSync(files.admin);
  assert.ok(!auth.isInitialized());
  assert.ok(!auth.verifySession(s.token));
  const code = auth.ensureSetupCode();
  assert.ok(fs.existsSync(files.setupCode));
  await auth.setup('1.1.1.1', code, 'password456');
  assert.ok(auth.isInitialized());
});
