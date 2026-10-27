const { EventEmitter } = require('events');

const MAX_ENTRIES = 500;
const entries = [];
const bus = new EventEmitter();
bus.setMaxListeners(0);

function ts(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * @param {string} level
 * @param {any[]} args
 * @param {{id:string, name:string}|null} account 日志所属账号，全局日志为 null
 */
function write(level, args, account) {
  const now = new Date();
  const message = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
  const tag = account ? ` [${account.name || account.id}]` : '';
  const prefix = level === 'info' ? `[${ts(now)}]${tag}` : `[${ts(now)}] [${level.toUpperCase()}]${tag}`;
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(prefix, message);

  const entry = { time: now.toISOString(), level, message, accountId: account ? account.id : null, accountName: account ? account.name || account.id : null };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  bus.emit('entry', entry);
}

// 按账号标注的日志；account 对象可在登录后更新名称
function scope(account) {
  return {
    info: (...a) => write('info', a, account),
    warn: (...a) => write('warn', a, account),
    error: (...a) => write('error', a, account),
  };
}

module.exports = {
  info: (...a) => write('info', a, null),
  warn: (...a) => write('warn', a, null),
  error: (...a) => write('error', a, null),
  scope,
  // 直接输出到控制台、不进入网页日志（用于初始化码等敏感内容）
  raw: (line) => console.log(line),
  recent: () => entries.slice(),
  bus,
};
