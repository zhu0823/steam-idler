// 交互式登录：获取 refresh token 并保存到 data/refresh_token.json
// 用法：node src/login.js           扫码登录（推荐，不输入密码）
//      node src/login.js --password 账号密码 + Steam Guard
const readline = require('readline');
const qrcode = require('qrcode-terminal');
const { LoginSession, EAuthTokenPlatformType, EAuthSessionGuardType } = require('steam-session');
const token = require('./token');
const { tokenFile } = require('./config');

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.startsWith(question)) rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function handleGuard(session, validActions) {
  const types = validActions.map((a) => a.type);
  if (types.includes(EAuthSessionGuardType.DeviceConfirmation)) {
    console.log('请在 Steam 手机 App 中确认本次登录（或输入令牌验证码）。');
  }
  if (types.includes(EAuthSessionGuardType.EmailConfirmation)) {
    console.log('请打开邮件中的确认链接。');
  }
  const codeType = types.find((t) => t === EAuthSessionGuardType.DeviceCode || t === EAuthSessionGuardType.EmailCode);
  if (codeType !== undefined) {
    const hint = codeType === EAuthSessionGuardType.EmailCode
      ? `邮箱验证码（${validActions.find((a) => a.type === codeType).detail || '邮箱'}）`
      : '手机令牌验证码';
    const code = await ask(`${hint}，已在 App 中确认可直接回车：`);
    if (code) await session.submitSteamGuardCode(code);
  }
}

async function main() {
  const usePassword = process.argv.includes('--password');
  const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
  session.loginTimeout = 180_000;

  const done = new Promise((resolve, reject) => {
    session.on('authenticated', resolve);
    session.on('timeout', () => reject(new Error('登录超时，请重新运行')));
    session.on('error', reject);
  });

  if (usePassword) {
    const accountName = await ask('Steam 账号：');
    const password = await ask('密码：', { hidden: true });
    const result = await session.startWithCredentials({ accountName, password });
    if (result.actionRequired) await handleGuard(session, result.validActions);
  } else {
    const result = await session.startWithQR();
    console.log('请用 Steam 手机 App 扫描下方二维码（右上角盾牌图标 → 扫描二维码）：\n');
    qrcode.generate(result.qrChallengeUrl, { small: true });
    console.log(`\n二维码无法显示时，可将此链接转成二维码后扫描：${result.qrChallengeUrl}`);
  }

  await done;
  token.save({
    accountName: session.accountName,
    steamID: session.steamID.getSteamID64(),
    refreshToken: session.refreshToken,
  });
  const exp = token.expiresAt(session.refreshToken);
  console.log(`\n登录成功：${session.accountName}`);
  console.log(`凭据已保存到 ${tokenFile}${exp ? `，有效期至 ${exp.toLocaleString()}` : ''}`);
  console.log('该文件等同于账号登录凭据，请勿泄露。');
  process.exit(0);
}

main().catch((err) => {
  console.error(`登录失败：${err.message}`);
  process.exit(1);
});
