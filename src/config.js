const path = require('path');

function int(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`环境变量 ${name} 必须是非负数字，当前值：${v}`);
  return n;
}

function idList(name) {
  return (process.env[name] || '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isInteger);
}

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

module.exports = {
  dataDir,
  tokenFile: path.join(dataDir, 'refresh_token.json'),
  // 同时挂的游戏数上限，Steam 限制为 32
  maxConcurrent: Math.min(int('MAX_CONCURRENT', 32), 32),
  // 游玩时长达到该值后改为单独挂；0 表示始终逐个挂
  hoursUntilDrops: int('HOURS_UNTIL_DROPS', 2),
  checkIntervalMinutes: Math.max(int('CHECK_INTERVAL_MINUTES', 15), 5),
  skipAppIds: new Set(idList('SKIP_APPIDS')),
  personaState: (process.env.PERSONA_STATE || 'online').toLowerCase(),
  machineName: process.env.MACHINE_NAME || 'steam-idler',
};
