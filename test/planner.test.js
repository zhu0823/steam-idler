const test = require('node:test');
const assert = require('node:assert');
const { annotateGames, planIdle, refundableLicenses, refundableApps, gameSlots, playPayload } = require('../src/planner');

const BASE = {
  maxConcurrent: 2,
  hoursUntilDrops: 2,
  farmingOrder: 'hours',
  skipRefundable: true,
  skipUnplayed: false,
  skipAppIds: [],
  priorityAppIds: [],
  priorityOnly: false,
};

const game = (appid, hours, drops = 3, name = `G${appid}`) => ({ appid, name, hours, drops });
const plan = (games, cfg = {}, refundable) => {
  const config = { ...BASE, ...cfg };
  return planIdle(annotateGames(games, config, refundable), config).map((g) => g.appid);
};

test('planIdle：未满阈值时批量挂时长多的，满阈值后单独挂排在最前的', () => {
  const a = game(1, 0.5);
  const b = game(2, 1);
  const c = game(3, 0);
  assert.deepStrictEqual(plan([a, b, c]), [2, 1]);
  assert.deepStrictEqual(plan([a, b, c], { farmingOrder: 'badge' }), [1, 2]);
  assert.deepStrictEqual(plan([a, game(4, 2.1), game(5, 8)]), [5]);
  assert.deepStrictEqual(plan([a, b], { hoursUntilDrops: 0 }), [2]);
  assert.deepStrictEqual(plan([]), []);
});

test('挂卡顺序：剩余卡少 / 多、名称', () => {
  const games = [game(1, 3, 5, 'Beta'), game(2, 4, 1, 'Alpha'), game(3, 5, 3, 'Gamma')];
  assert.deepStrictEqual(plan(games), [3]);
  assert.deepStrictEqual(plan(games, { farmingOrder: 'fewestDrops' }), [2]);
  assert.deepStrictEqual(plan(games, { farmingOrder: 'mostDrops' }), [1]);
  assert.deepStrictEqual(plan(games, { farmingOrder: 'name' }), [2]);
});

test('优先队列：按队列顺序先挂，队列挂完才挂其他；priorityOnly 时只挂队列', () => {
  const games = [game(1, 5), game(2, 0.5), game(3, 0)];
  assert.deepStrictEqual(plan(games, { priorityAppIds: [3, 2] }), [3, 2]);
  assert.deepStrictEqual(plan(games, { priorityAppIds: [2], maxConcurrent: 32 }), [2]);
  // 队列中的游戏不在可掉卡列表里（已掉完）时回到普通顺序
  assert.deepStrictEqual(plan(games, { priorityAppIds: [99] }), [1]);
  assert.deepStrictEqual(plan(games, { priorityAppIds: [99], priorityOnly: true }), []);
  // 被跳过的游戏不会因为在队列中而被挂
  assert.deepStrictEqual(plan(games, { priorityAppIds: [3], skipAppIds: [3] }), [1]);

  const annotated = annotateGames(games, { ...BASE, priorityAppIds: [3, 2] });
  assert.deepStrictEqual(annotated.map((g) => g.priority), [null, 2, 1]);
});

test('退款期内且不足 2 小时的游戏跳过；超过 2 小时或已过期的照常挂', () => {
  const now = new Date('2026-10-27T00:00:00Z');
  const future = new Date('2026-11-05T00:00:00Z');
  const past = new Date('2026-10-20T00:00:00Z');
  const refundable = new Map([[1, future], [2, future], [3, past]]);
  const games = annotateGames([game(1, 1.9), game(2, 2), game(3, 0), game(4, 0)], BASE, refundable, now);
  assert.deepStrictEqual(games.map((g) => g.skipReason), ['refundable', null, null, null]);
  assert.strictEqual(games[0].refundableUntil, future.toISOString());
  assert.strictEqual(games[1].refundableUntil, null);

  const off = annotateGames([game(1, 1.9)], { ...BASE, skipRefundable: false }, refundable, now);
  assert.strictEqual(off[0].skipped, false);
  // 关闭保护时仍标注退款截止时间，面板可以提示
  assert.strictEqual(off[0].refundableUntil, future.toISOString());
});

test('跳过从未玩过的游戏；手动跳过优先显示', () => {
  const games = annotateGames([game(1, 0), game(2, 0.1), game(3, 0)], { ...BASE, skipUnplayed: true, skipAppIds: [3] });
  assert.deepStrictEqual(games.map((g) => g.skipReason), ['unplayed', null, 'manual']);
});

test('从许可证计算退款期内的游戏：排除激活码、赠送、过期许可证', () => {
  const now = new Date('2026-10-27T00:00:00Z');
  const t = (days) => Math.floor(now.getTime() / 1000) - days * 86400;
  const licenses = [
    { package_id: 10, time_created: t(3), payment_method: 2, flags: 0 }, // 信用卡，3 天前
    { package_id: 11, time_created: t(20), payment_method: 2, flags: 0 }, // 超过 14 天
    { package_id: 12, time_created: t(1), payment_method: 1, flags: 0 }, // 激活码
    { package_id: 13, time_created: t(1), payment_method: 1024, flags: 0 }, // 免费赠送
    { package_id: 14, time_created: t(1), payment_method: 128, flags: 8 }, // 已过期
    { package_id: 15, time_created: t(1), payment_method: 128, flags: 0 }, // 钱包
  ];
  const recent = refundableLicenses(licenses, now);
  assert.deepStrictEqual(recent.map((l) => l.package_id), [10, 15]);

  const packages = {
    10: { packageinfo: { appids: { 0: 100, 1: 101 } } },
    15: { packageinfo: { appids: [101] } },
  };
  const map = refundableApps(recent, packages);
  assert.deepStrictEqual([...map.keys()], [100, 101]);
  // 同一个游戏取较晚的退款截止时间
  assert.strictEqual(map.get(101).getTime(), (t(1) + 14 * 86400) * 1000);
  assert.strictEqual(map.get(100).getTime(), (t(3) + 14 * 86400) * 1000);
  assert.deepStrictEqual(refundableLicenses(null), []);
});

test('自定义状态文本：替换占位符并占用一个游戏位', () => {
  const games = [game(1, 0, 3, 'Portal'), game(2, 0)];
  assert.deepStrictEqual(playPayload(games, ''), [1, 2]);
  assert.deepStrictEqual(playPayload(games, '挂卡：{name}({appid}) 共 {count} 个'), ['挂卡：Portal(1) 共 2 个', 1, 2]);
  assert.deepStrictEqual(playPayload([], '空闲中'), ['空闲中']);
  assert.deepStrictEqual(playPayload([], '{name}'), []);
  assert.strictEqual(gameSlots(''), 32);
  assert.strictEqual(gameSlots('x'), 31);
});
