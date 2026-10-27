// 挂卡进度相关的纯计算：识别掉卡、当前阶段、预计时间

// 单独挂时大约每张卡的掉落间隔（社区经验值，仅用于估算）
const MINUTES_PER_DROP = 30;

/**
 * 对比两次徽章页结果识别掉卡：剩余掉落减少，或游戏从列表消失（剩余掉落归零）。
 * @param {Map<number,{name:string,drops:number}>|null} prev 上一次的结果，首次检查为 null
 * @param {{appid:number,name:string,drops:number}[]} current
 * @returns {{appid:number,name:string,count:number}[]}
 */
function detectDrops(prev, current) {
  if (!prev) return [];
  const now = new Map(current.map((g) => [g.appid, g]));
  const drops = [];
  for (const [appid, before] of prev) {
    const after = now.has(appid) ? now.get(appid).drops : 0;
    if (after < before.drops) drops.push({ appid, name: before.name, count: before.drops - after });
  }
  return drops;
}

/**
 * 当前挂卡阶段
 * - idle   没有正在挂的游戏
 * - multi  同时挂，累计时长（含只剩一个未满阈值的游戏）
 * - solo   单独挂一个已满阈值的游戏
 */
function phaseOf(playing, threshold) {
  if (playing.length === 0) return { mode: 'idle', threshold };
  if (playing.length === 1 && (threshold <= 0 || playing[0].hours >= threshold)) {
    return { mode: 'solo', threshold, game: playing[0] };
  }
  // 第一个达到阈值的游戏决定何时切换为单独挂
  const maxHours = Math.max(...playing.map((g) => g.hours));
  return {
    mode: 'multi',
    threshold,
    maxHours,
    minutesToSolo: Math.max(0, Math.round((threshold - maxHours) * 60)),
  };
}

/**
 * 粗略估计全部掉完还需多少分钟：每张卡按固定间隔，加上未满阈值游戏累计时长的时间。
 * @returns {number|null} 没有可掉卡游戏时为 0
 */
function estimateMinutes(games, threshold) {
  const active = games.filter((g) => !g.skipped && g.drops > 0);
  if (active.length === 0) return 0;
  const drops = active.reduce((s, g) => s + g.drops, 0);
  const notReady = threshold > 0 ? active.filter((g) => g.hours < threshold) : [];
  const warmup = notReady.length ? (threshold - Math.min(...notReady.map((g) => g.hours))) * 60 : 0;
  return Math.round(drops * MINUTES_PER_DROP + warmup);
}

function isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dropsOnDay(history, day = new Date()) {
  return history.filter((e) => isSameLocalDay(new Date(e.time), day)).reduce((s, e) => s + e.count, 0);
}

module.exports = { MINUTES_PER_DROP, detectDrops, phaseOf, estimateMinutes, dropsOnDay };
