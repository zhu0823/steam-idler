const fs = require('fs');
const path = require('path');
const { tokenFile } = require('./config');

function load() {
  if (!fs.existsSync(tokenFile)) return null;
  return JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
}

// 先写临时文件再 rename，避免续期时写到一半导致 token 丢失
function save(data) {
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  const tmp = `${tokenFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...data, savedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, tokenFile);
}

// 解析 JWT 的过期时间，仅用于提示，不做校验
function expiresAt(refreshToken) {
  try {
    const payload = JSON.parse(Buffer.from(refreshToken.split('.')[1], 'base64url').toString());
    return payload.exp ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}

module.exports = { load, save, expiresAt };
