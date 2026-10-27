// 网页上的 Steam 登录流程：扫码 / 账号密码 + Steam Guard
const { EventEmitter } = require('events');
const QRCode = require('qrcode');
const { LoginSession, EAuthTokenPlatformType, EAuthSessionGuardType, EResult } = require('steam-session');

const LOGIN_TIMEOUT_MS = 180_000;

const ERROR_TEXT = {
  [EResult.InvalidPassword]: '账号或密码错误',
  [EResult.RateLimitExceeded]: '尝试过于频繁，请稍后再试',
  [EResult.InvalidLoginAuthCode]: '验证码错误',
  [EResult.TwoFactorCodeMismatch]: '验证码错误',
  [EResult.Expired]: '登录请求已过期，请重新开始',
  [EResult.AccessDenied]: '登录被拒绝',
};

function describeError(err) {
  return ERROR_TEXT[err.eresult] || err.message || '登录失败';
}

/**
 * 状态：
 * - idle            没有进行中的登录
 * - waiting_scan    已生成二维码，等待扫码
 * - scanned         已扫码，等待在手机上确认
 * - need_code       需要输入手机令牌 / 邮箱验证码
 * - need_confirm    需要在 App 或邮件中确认
 * - authenticated   登录成功
 * - failed          失败（超时、密码错误等）
 */
class LoginFlow extends EventEmitter {
  /**
   * @param {object} opts
   * @param {(info:{accountName:string, steamID:string, refreshToken:string})=>Promise<void>} opts.onAuthenticated
   * @param {()=>object} [opts.createSession] 用于测试注入
   */
  constructor({ onAuthenticated, createSession }) {
    super();
    this.onAuthenticated = onAuthenticated;
    this.createSession = createSession || (() => new LoginSession(EAuthTokenPlatformType.SteamClient));
    this.session = null;
    this.reset();
  }

  reset() {
    this.state = 'idle';
    this.method = null;
    this.qrSvg = null;
    this.codeType = null;
    this.emailDomain = null;
    this.error = null;
    this.expiresAt = null;
  }

  status() {
    return {
      state: this.state,
      method: this.method,
      qrSvg: this.qrSvg,
      codeType: this.codeType,
      emailDomain: this.emailDomain,
      error: this.error,
      expiresAt: this.expiresAt,
    };
  }

  update(patch) {
    Object.assign(this, patch);
    this.emit('update', this.status());
  }

  cancel() {
    if (this.session) {
      this.session.removeAllListeners();
      this.session.on('error', () => {});
      try {
        this.session.cancelLoginAttempt();
      } catch {}
      this.session = null;
    }
    this.reset();
    this.emit('update', this.status());
  }

  newSession(method) {
    this.cancel();
    const session = this.createSession();
    session.loginTimeout = LOGIN_TIMEOUT_MS;
    this.session = session;
    this.method = method;
    this.expiresAt = new Date(Date.now() + LOGIN_TIMEOUT_MS);

    session.on('remoteInteraction', () => {
      if (this.session === session && this.state === 'waiting_scan') this.update({ state: 'scanned' });
    });
    session.on('timeout', () => {
      if (this.session === session) this.fail('登录超时，请重新开始');
    });
    session.on('error', (err) => {
      if (this.session === session) this.fail(describeError(err));
    });
    session.on('authenticated', async () => {
      if (this.session !== session) return;
      try {
        await this.onAuthenticated({
          accountName: session.accountName,
          steamID: session.steamID.getSteamID64(),
          refreshToken: session.refreshToken,
        });
        this.session = null;
        this.update({ state: 'authenticated', qrSvg: null, error: null });
      } catch (err) {
        this.fail(err.message);
      }
    });
    return session;
  }

  fail(message) {
    this.session = null;
    this.update({ state: 'failed', error: message, qrSvg: null });
  }

  async startQR() {
    const session = this.newSession('qr');
    try {
      const result = await session.startWithQR();
      const qrSvg = await QRCode.toString(result.qrChallengeUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      if (this.session === session) this.update({ state: 'waiting_scan', qrSvg });
    } catch (err) {
      if (this.session === session) this.fail(describeError(err));
    }
    return this.status();
  }

  async startCredentials(accountName, password) {
    if (!accountName || !password) throw Object.assign(new Error('请输入账号和密码'), { statusCode: 400 });
    const session = this.newSession('password');
    try {
      const result = await session.startWithCredentials({ accountName, password });
      if (this.session !== session) return this.status();
      if (result.actionRequired) this.applyGuards(result.validActions);
    } catch (err) {
      if (this.session === session) this.fail(describeError(err));
    }
    return this.status();
  }

  applyGuards(validActions) {
    const code = validActions.find((a) => a.type === EAuthSessionGuardType.DeviceCode || a.type === EAuthSessionGuardType.EmailCode);
    if (code) {
      this.update({
        state: 'need_code',
        codeType: code.type === EAuthSessionGuardType.EmailCode ? 'email' : 'device',
        emailDomain: code.type === EAuthSessionGuardType.EmailCode ? code.detail || null : null,
        error: null,
      });
      return;
    }
    const confirm = validActions.find((a) => a.type === EAuthSessionGuardType.DeviceConfirmation || a.type === EAuthSessionGuardType.EmailConfirmation);
    if (confirm) {
      this.update({
        state: 'need_confirm',
        codeType: confirm.type === EAuthSessionGuardType.EmailConfirmation ? 'email' : 'device',
        error: null,
      });
    }
  }

  async submitCode(code) {
    if (!this.session || this.state !== 'need_code') {
      throw Object.assign(new Error('当前没有等待验证码的登录'), { statusCode: 409 });
    }
    const session = this.session;
    try {
      await session.submitSteamGuardCode(String(code || '').trim());
    } catch (err) {
      // 验证码错误时保留会话，允许重新输入
      if (this.session === session) this.update({ error: describeError(err) });
    }
    return this.status();
  }
}

module.exports = { LoginFlow };
