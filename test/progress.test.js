const test = require('node:test');
const assert = require('node:assert');
const { detectDrops, phaseOf, estimateMinutes, dropsOnDay, MINUTES_PER_DROP } = require('../src/progress');

const g = (appid, hours, drops, extra = {}) => ({ appid, name: `G${appid}`, hours, drops, ...extra });

test('识别掉卡：剩余减少或游戏从列表消失；首次检查不记录', () => {
  assert.deepStrictEqual(detectDrops(null, [g(1, 0, 3)]), []);
  const prev = new Map([
    [1, { name: 'G1', drops: 3 }],
    [2, { name: 'G2', drops: 2 }],
    [3, { name: 'G3', drops: 4 }],
  ]);
  const drops = detectDrops(prev, [g(1, 3, 1), g(3, 0, 4), g(4, 0, 5)]);
  assert.deepStrictEqual(drops, [
    { appid: 1, name: 'G1', count: 2 },
    { appid: 2, name: 'G2', count: 2 },
  ]);
});

test('阶段：同时挂时按时长最多的游戏估算切换时间，单独挂需满阈值', () => {
  assert.strictEqual(phaseOf([], 2).mode, 'idle');

  const multi = phaseOf([g(1, 0.5, 3), g(2, 1.25, 3)], 2);
  assert.deepStrictEqual(multi, { mode: 'multi', threshold: 2, maxHours: 1.25, minutesToSolo: 45 });

  // 只剩一个未满阈值的游戏仍属于累计时长阶段
  assert.strictEqual(phaseOf([g(1, 1, 3)], 2).mode, 'multi');
  assert.strictEqual(phaseOf([g(1, 2.5, 3)], 2).mode, 'solo');
  assert.strictEqual(phaseOf([g(1, 0, 3)], 0).mode, 'solo');
});

test('预计时间：每张固定间隔 + 未满阈值游戏的累计时长；跳过的不计', () => {
  assert.strictEqual(estimateMinutes([], 2), 0);
  const games = [g(1, 2.5, 2), g(2, 0.5, 3), g(3, 0, 5, { skipped: true })];
  assert.strictEqual(estimateMinutes(games, 2), 5 * MINUTES_PER_DROP + 90);
  assert.strictEqual(estimateMinutes(games, 0), 5 * MINUTES_PER_DROP);
});

test('今日掉卡数按本地日期统计', () => {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400_000);
  const history = [
    { time: yesterday.toISOString(), count: 5 },
    { time: now.toISOString(), count: 2 },
    { time: now.toISOString(), count: 1 },
  ];
  assert.strictEqual(dropsOnDay(history, now), 3);
});
