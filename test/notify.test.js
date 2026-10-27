const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'idler-notify-'));
const store = require('../src/store');
const log = require('../src/log');
const { Notifier } = require('../src/notify');

function fakeFetch(handler = () => ({ status: 200, body: { ok: true } })) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const r = handler(url);
    if (r instanceof Error) throw r;
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

test.beforeEach(() => {
  fs.rmSync(store.dataDir, { recursive: true, force: true });
  fs.mkdirSync(store.dataDir, { recursive: true });
});

test('只发送订阅的事件，各渠道按各自格式发送', async () => {
  store.saveNotifyConfig({
    telegram: { enabled: true, botToken: '123:abc', chatId: '42' },
    bark: { enabled: true, url: 'https://api.day.app/KEY' },
    webhook: { enabled: true, url: 'https://example.test/hook' },
  });
  const fetch = fakeFetch();
  const notifier = new Notifier({ fetch });
  const account = { id: '1', name: 'alice' };

  assert.deepStrictEqual(await notifier.send({ event: 'drops', title: '掉落 1 张卡片', text: 'Hades +1', account }), []);
  assert.strictEqual(fetch.calls.length, 0);

  const results = await notifier.send({ event: 'finished', title: '卡片已全部掉完', text: '完成', account });
  assert.ok(results.every((r) => r.ok));
  const [tg, bark, hook] = fetch.calls;
  assert.strictEqual(tg.url, 'https://api.telegram.org/bot123:abc/sendMessage');
  assert.deepStrictEqual(tg.body, { chat_id: '42', text: 'alice：卡片已全部掉完\n完成', disable_web_page_preview: true });
  assert.deepStrictEqual(bark.body, { title: 'alice：卡片已全部掉完', body: '完成', group: 'steam-idler' });
  assert.strictEqual(hook.body.event, 'finished');
  assert.deepStrictEqual(hook.body.account, account);
});

test('发送失败只记录日志，错误信息不含地址中的密钥', async () => {
  store.saveNotifyConfig({ bark: { enabled: true, url: 'https://api.day.app/SECRET' }, webhook: { enabled: true, url: 'https://example.test/hook' } });
  const fetch = fakeFetch((url) =>
    url.includes('SECRET') ? Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }) : { status: 500, body: null },
  );
  const results = await new Notifier({ fetch }).send({ event: 'authFailed', title: '登录凭据已失效' });
  assert.deepStrictEqual(results, [
    { channel: 'bark', ok: false, error: '网络错误（ENOTFOUND）' },
    { channel: 'webhook', ok: false, error: 'HTTP 500' },
  ]);
  assert.ok(!log.recent().some((e) => e.message.includes('SECRET')));
});

test('测试通知不受事件订阅限制；未启用渠道时报错', async () => {
  const notifier = new Notifier({ fetch: fakeFetch() });
  await assert.rejects(notifier.test(), { statusCode: 400 });
  store.saveNotifyConfig({ webhook: { enabled: true, url: 'https://example.test/hook' }, events: { finished: false, authFailed: false } });
  assert.deepStrictEqual(await notifier.test(), [{ channel: 'webhook', ok: true }]);
  assert.strictEqual(notifier.getConfig().webhook.url, '');
  assert.strictEqual(notifier.getConfig().webhook.urlSet, true);
});
