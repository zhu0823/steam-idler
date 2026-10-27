const { EventEmitter } = require('events');

const MAX_ENTRIES = 300;
const entries = [];
const bus = new EventEmitter();
bus.setMaxListeners(0);

function ts(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function write(level, args) {
  const now = new Date();
  const message = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
  const prefix = level === 'info' ? `[${ts(now)}]` : `[${ts(now)}] [${level.toUpperCase()}]`;
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(prefix, message);

  const entry = { time: now.toISOString(), level, message };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  bus.emit('entry', entry);
}

module.exports = {
  info: (...a) => write('info', a),
  warn: (...a) => write('warn', a),
  error: (...a) => write('error', a),
  // 直接输出到控制台、不进入网页日志（用于初始化码等敏感内容）
  raw: (line) => console.log(line),
  recent: () => entries.slice(),
  bus,
};
