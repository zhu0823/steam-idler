const test = require('node:test');
const assert = require('node:assert');

test('设置页跳过列表：游戏列表晚加载时已知 AppID 从文本框移到复选框', async () => {
  const { parseIdList, extraIdsText, mergeSkipIds } = await import('../web/src/skip-ids.mjs');

  // 配置加载时游戏列表为空：所有 AppID 都在文本框里
  const skip = [570, 730];
  assert.strictEqual(extraIdsText(skip, new Set()), '570, 730');

  // 游戏列表加载后 570 是已知游戏，只剩 730 在文本框
  const known = new Set([570, 440]);
  const { ids } = parseIdList('570, 730');
  assert.strictEqual(extraIdsText(ids, known), '730');

  // 取消勾选 570 后保存，不应因文本框残留而继续跳过
  assert.deepStrictEqual(mergeSkipIds([730], known, parseIdList('730').ids), [730]);
  assert.deepStrictEqual(mergeSkipIds([570, 730], known, [730, 999]), [570, 730, 999]);

  assert.strictEqual(parseIdList('1，2 3').valid, true);
  assert.strictEqual(parseIdList('abc').valid, false);
});
