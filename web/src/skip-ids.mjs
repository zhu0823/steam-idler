// 设置页“跳过的游戏”：徽章页中已知的游戏用复选框，其余 AppID 用文本框

export function parseIdList(text) {
  const parts = String(text || '').split(/[\s,，]+/).filter(Boolean);
  const ids = parts.map(Number);
  return { ids, valid: ids.every((n) => Number.isInteger(n) && n > 0) };
}

// 文本框只显示不在已知游戏列表中的 AppID，已知的由复选框表示
export function extraIdsText(skipAppIds, knownIds) {
  return skipAppIds.filter((id) => !knownIds.has(id)).join(', ');
}

export function mergeSkipIds(checkedIds, knownIds, extraIds) {
  return [...new Set([...checkedIds.filter((id) => knownIds.has(id)), ...extraIds])];
}
