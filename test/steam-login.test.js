const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { EAuthSessionGuardType, EResult } = require('steam-session');
const { LoginFlow } = require('../src/steam-login');

class FakeSession extends EventEmitter {
  constructor(behavior = {}) {
    super();
    this.behavior = behavior;
    this.cancelled = false;
    this.submitted = [];
  }

  async startWithQR() {
    return { actionRequired: true, qrChallengeUrl: 'https://s.team/q/1/123', validActions: [] };
  }

  async startWithCredentials({ accountName, password }) {
    this.credentials = { accountName, password };
    if (this.behavior.startError) throw this.behavior.startError;
    return { actionRequired: true, validActions: this.behavior.validActions || [] };
  }

  async submitSteamGuardCode(code) {
    this.submitted.push(code);
    if (code !== '12345') throw Object.assign(new Error('mismatch'), { eresult: EResult.TwoFactorCodeMismatch });
    this.authenticate();
  }

  authenticate() {
    this.accountName = 'tester';
    this.steamID = { getSteamID64: () => '76561190000000001' };
    this.refreshToken = 'refresh-token-secret';
    this.emit('authenticated');
  }

  cancelLoginAttempt() {
    this.cancelled = true;
  }
}

const tick = () => new Promise((r) => setImmediate(r));

function makeFlow(behavior) {
  const sessions = [];
  const authenticated = [];
  const flow = new LoginFlow({
    createSession: () => {
      const s = new FakeSession(behavior);
      sessions.push(s);
      return s;
    },
    onAuthenticated: async (info) => authenticated.push(info),
  });
  return { flow, sessions, authenticated };
}

test('扫码登录：生成 SVG 二维码，扫码后状态变化，确认后回调凭据', async () => {
  const { flow, sessions, authenticated } = makeFlow();
  const s = await flow.startQR();
  assert.strictEqual(s.state, 'waiting_scan');
  assert.match(s.qrSvg, /^<svg/);

  sessions[0].emit('remoteInteraction');
  assert.strictEqual(flow.status().state, 'scanned');

  sessions[0].authenticate();
  await tick();
  assert.strictEqual(flow.status().state, 'authenticated');
  assert.deepStrictEqual(authenticated, [{ accountName: 'tester', steamID: '76561190000000001', refreshToken: 'refresh-token-secret' }]);
  assert.ok(!JSON.stringify(flow.status()).includes('refresh-token-secret'));
});

test('账号密码登录：需要令牌验证码，输错可重试，输对完成登录', async () => {
  const { flow, authenticated } = makeFlow({
    validActions: [{ type: EAuthSessionGuardType.DeviceConfirmation }, { type: EAuthSessionGuardType.DeviceCode }],
  });
  const s = await flow.startCredentials('tester', 'secret-password');
  assert.strictEqual(s.state, 'need_code');
  assert.strictEqual(s.codeType, 'device');
  assert.ok(!JSON.stringify(s).includes('secret-password'));

  const wrong = await flow.submitCode('00000');
  assert.strictEqual(wrong.state, 'need_code');
  assert.strictEqual(wrong.error, '验证码错误');

  await flow.submitCode(' 12345 ');
  await tick();
  assert.strictEqual(flow.status().state, 'authenticated');
  assert.strictEqual(authenticated.length, 1);
});

test('邮箱验证码显示邮箱域名；仅需 App 确认时进入 need_confirm', async () => {
  const email = makeFlow({ validActions: [{ type: EAuthSessionGuardType.EmailCode, detail: 'gmail.com' }] });
  const s1 = await email.flow.startCredentials('a', 'b');
  assert.deepStrictEqual([s1.state, s1.codeType, s1.emailDomain], ['need_code', 'email', 'gmail.com']);

  const confirm = makeFlow({ validActions: [{ type: EAuthSessionGuardType.DeviceConfirmation }] });
  const s2 = await confirm.flow.startCredentials('a', 'b');
  assert.deepStrictEqual([s2.state, s2.codeType], ['need_confirm', 'device']);
});

test('密码错误、超时与取消', async () => {
  const bad = makeFlow({ startError: Object.assign(new Error('InvalidPassword'), { eresult: EResult.InvalidPassword }) });
  const s = await bad.flow.startCredentials('a', 'b');
  assert.deepStrictEqual([s.state, s.error], ['failed', '账号或密码错误']);

  const { flow, sessions } = makeFlow();
  await flow.startQR();
  sessions[0].emit('timeout');
  assert.strictEqual(flow.status().state, 'failed');

  await flow.startQR();
  flow.cancel();
  assert.ok(sessions[1].cancelled);
  assert.strictEqual(flow.status().state, 'idle');
  // 已取消的会话事件不再影响状态
  sessions[1].emit('remoteInteraction');
  assert.strictEqual(flow.status().state, 'idle');

  await assert.rejects(flow.submitCode('1'), { statusCode: 409 });
  await assert.rejects(flow.startCredentials('', ''), { statusCode: 400 });
});

test('无需 Steam Guard 或验证码已通过时进入 authenticating', async () => {
  const flow = new LoginFlow({
    createSession: () => {
      const s = new FakeSession();
      s.startWithCredentials = async () => ({ actionRequired: false });
      return s;
    },
    onAuthenticated: async () => {},
  });
  const s = await flow.startCredentials('tester', 'secret');
  assert.strictEqual(s.state, 'authenticating');

  // 验证码提交成功但 Steam 尚未返回结果
  const deferred = makeFlow({ validActions: [{ type: EAuthSessionGuardType.DeviceCode }] });
  await deferred.flow.startCredentials('tester', 'secret');
  deferred.sessions[0].submitSteamGuardCode = async () => {};
  const after = await deferred.flow.submitCode('12345');
  assert.strictEqual(after.state, 'authenticating');
  deferred.sessions[0].authenticate();
  await tick();
  assert.strictEqual(deferred.flow.status().state, 'authenticated');
});
