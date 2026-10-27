// 挂卡策略的纯计算：哪些游戏参与挂卡、按什么顺序、本轮挂哪些

// Steam 退款条件：购买不满 14 天且游玩不足 2 小时
const REFUND_DAYS = 14;
const REFUND_MAX_HOURS = 2;
// Steam 最多允许同时上报 32 个游戏，自定义文本占用其中一个
const MAX_GAMES = 32;

// 挂卡顺序，同时决定“同时挂”时优先挑哪些游戏和满阈值后先单独挂哪个
const ORDERS = {
  // 时长最多优先，通常最接近下一次掉落
  hours: (a, b) => b.hours - a.hours,
  // 剩余卡少的优先，尽快挂完一个个游戏
  fewestDrops: (a, b) => a.drops - b.drops || b.hours - a.hours,
  mostDrops: (a, b) => b.drops - a.drops || b.hours - a.hours,
  name: (a, b) => a.name.localeCompare(b.name),
  // 徽章页原始顺序
  badge: () => 0,
};

/**
 * 标注每个游戏是否参与挂卡。
 * @param {{appid:number,name:string,hours:number,drops:number}[]} games 徽章页中可掉卡的游戏
 * @param {object} config 账号生效配置
 * @param {Map<number,Date>} refundable 仍在退款期内的游戏及退款截止时间
 * @returns 带 skipped / skipReason / refundableUntil / priority 的游戏列表；skipped 为 true 的不参与挂卡
 */
function annotateGames(games, config, refundable = new Map(), now = new Date()) {
  const skip = new Set(config.skipAppIds);
  const priority = new Map(config.priorityAppIds.map((id, i) => [id, i + 1]));
  return games.map((g) => {
    const until = refundable.get(g.appid);
    const inRefund = until && until > now && g.hours < REFUND_MAX_HOURS;
    let skipReason = null;
    if (skip.has(g.appid)) skipReason = 'manual';
    else if (config.skipRefundable && inRefund) skipReason = 'refundable';
    else if (config.skipUnplayed && g.hours <= 0) skipReason = 'unplayed';
    return {
      ...g,
      skipped: skipReason !== null,
      skipReason,
      refundableUntil: inRefund ? until.toISOString() : null,
      priority: priority.get(g.appid) || null,
    };
  });
}

// 优先队列中的游戏按队列顺序排在最前，其余按 farmingOrder 排序
function orderGames(games, farmingOrder) {
  const cmp = ORDERS[farmingOrder] || ORDERS.hours;
  return [...games].sort((a, b) => (a.priority || Infinity) - (b.priority || Infinity) || cmp(a, b));
}

/**
 * 决定本轮要挂哪些游戏。
 * - 优先队列中还有可挂的游戏时只挂它们；priorityOnly 时队列为空就不挂；
 * - 有游戏的时长已达到阈值：单独挂排在最前的那个，掉卡最快；
 * - 否则同时挂多个（最多 maxConcurrent 个）先累计时长；
 * - hoursUntilDrops 为 0 时始终逐个挂。
 */
function planIdle(games, { maxConcurrent, hoursUntilDrops, farmingOrder, priorityOnly }) {
  const active = games.filter((g) => !g.skipped);
  const queued = active.filter((g) => g.priority);
  const candidates = orderGames(queued.length > 0 || priorityOnly ? queued : active, farmingOrder);
  if (candidates.length === 0) return [];
  if (hoursUntilDrops <= 0) return [candidates[0]];

  const ready = candidates.find((g) => g.hours >= hoursUntilDrops);
  if (ready) return [ready];
  return candidates.slice(0, maxConcurrent);
}

// 购买时间在退款期内、且付款方式可退款的许可证
const NON_REFUNDABLE_PAYMENTS = new Set([
  0, // None
  1, // ActivationCode
  8, // GuestPass
  16, // HardwarePromo
  129, // Valve
  130, // MasterComp
  131, // Promotional
  256, // OEMTicket
]);
const COMPLIMENTARY = 1024;
const LICENSE_EXPIRED = 8;

function refundableLicenses(licenses, now = new Date()) {
  const cutoff = now.getTime() / 1000 - REFUND_DAYS * 86400;
  return (licenses || []).filter(
    (l) =>
      l.time_created > cutoff &&
      !NON_REFUNDABLE_PAYMENTS.has(l.payment_method) &&
      !(l.payment_method & COMPLIMENTARY) &&
      !(l.flags & LICENSE_EXPIRED),
  );
}

/**
 * 由许可证和 PICS 包信息得到退款期内的游戏。
 * @param {object[]} licenses refundableLicenses 的结果
 * @param {object} packages getProductInfo 返回的 packages
 * @returns {Map<number,Date>} appid → 退款截止时间
 */
function refundableApps(licenses, packages) {
  const map = new Map();
  for (const l of licenses) {
    const appids = Object.values(packages[l.package_id]?.packageinfo?.appids || {}).map(Number);
    const until = new Date((l.time_created + REFUND_DAYS * 86400) * 1000);
    for (const appid of appids) {
      if (!map.has(appid) || map.get(appid) < until) map.set(appid, until);
    }
  }
  return map;
}

// 显示自定义文本时可同时挂的游戏数
function gameSlots(text) {
  return text ? MAX_GAMES - 1 : MAX_GAMES;
}

/**
 * 发给 Steam 的“正在游戏”列表：可选的自定义文本（显示为非 Steam 游戏）加上 appid。
 * 挂卡时文本支持 {name} {appid} {count}，同时挂多个时取排在最前的游戏。
 */
function playPayload(games, text) {
  const ids = games.map((g) => g.appid);
  if (!text) return ids;
  const first = games[0];
  const rendered = text
    .replace(/\{name\}/g, first?.name || '')
    .replace(/\{appid\}/g, first ? String(first.appid) : '')
    .replace(/\{count\}/g, String(games.length))
    .trim();
  return rendered ? [rendered, ...ids] : ids;
}

module.exports = {
  REFUND_DAYS,
  annotateGames,
  orderGames,
  planIdle,
  refundableLicenses,
  refundableApps,
  gameSlots,
  playPayload,
};
