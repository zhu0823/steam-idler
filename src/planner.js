/**
 * 决定本轮要挂哪些游戏。
 * - 有游戏的时长已达到阈值：单独挂第一个，掉卡最快；
 * - 否则同时挂多个（最多 maxConcurrent 个）先累计时长；
 * - hoursUntilDrops 为 0 时始终逐个挂。
 */
function planIdle(games, { maxConcurrent, hoursUntilDrops }) {
  if (games.length === 0) return [];
  if (hoursUntilDrops <= 0) return [games[0]];

  const ready = games.filter((g) => g.hours >= hoursUntilDrops);
  if (ready.length > 0) {
    // 时长最多的优先，通常最接近下一次掉落
    return [ready.reduce((a, b) => (b.hours > a.hours ? b : a))];
  }
  return games.slice(0, maxConcurrent);
}

module.exports = { planIdle };
