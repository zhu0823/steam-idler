// 推送通知：Telegram、Bark、通用 Webhook
const store = require('./store');
const log = require('./log');

const TIMEOUT_MS = 10_000;

const CHANNEL_NAMES = { telegram: 'Telegram', bark: 'Bark', webhook: 'Webhook' };

// 错误信息里不带地址，避免把密钥写进日志
function describeError(err) {
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return '请求超时';
  const code = err.cause?.code;
  return code ? `网络错误（${code}）` : err.message;
}

async function postJson(fetchImpl, url, body) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'steam-idler' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.description || data?.message || `HTTP ${res.status}`);
  return data;
}

const SENDERS = {
  async telegram(fetchImpl, { botToken, chatId }, msg) {
    await postJson(fetchImpl, `https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: msg.text ? `${msg.title}\n${msg.text}` : msg.title,
      disable_web_page_preview: true,
    });
  },
  async bark(fetchImpl, { url }, msg) {
    await postJson(fetchImpl, url, { title: msg.title, body: msg.text || msg.title, group: 'steam-idler' });
  },
  async webhook(fetchImpl, { url }, msg) {
    await postJson(fetchImpl, url, {
      event: msg.event,
      title: msg.title,
      text: msg.text,
      account: msg.account || null,
      time: new Date().toISOString(),
    });
  },
};

class Notifier {
  /**
   * @param {object} [opts]
   * @param {Function} [opts.fetch] 用于测试注入
   */
  constructor({ fetch: fetchImpl = fetch } = {}) {
    this.fetch = fetchImpl;
  }

  getConfig() {
    return store.maskNotifyConfig(store.loadNotifyConfig());
  }

  saveConfig(patch) {
    return store.maskNotifyConfig(store.saveNotifyConfig(patch));
  }

  // 发送到所有已启用的渠道，返回各渠道结果；不会抛出错误
  async dispatch(config, msg) {
    const channels = Object.keys(SENDERS).filter((c) => config[c].enabled);
    return Promise.all(
      channels.map(async (channel) => {
        try {
          await SENDERS[channel](this.fetch, config[channel], msg);
          return { channel, ok: true };
        } catch (err) {
          const error = describeError(err);
          log.warn(`${CHANNEL_NAMES[channel]} 通知发送失败：${error}`);
          return { channel, ok: false, error };
        }
      }),
    );
  }

  /**
   * 按订阅的事件发送通知。
   * @param {{event:string, title:string, text?:string, account?:{id:string,name:string}}} msg
   */
  async send(msg) {
    let config;
    try {
      config = store.loadNotifyConfig();
    } catch {
      return [];
    }
    if (!config.events[msg.event]) return [];
    const title = msg.account ? `${msg.account.name}：${msg.title}` : msg.title;
    return this.dispatch(config, { ...msg, title });
  }

  // 面板上的“发送测试通知”，不受事件订阅限制
  async test() {
    const config = store.loadNotifyConfig();
    if (!Object.keys(SENDERS).some((c) => config[c].enabled)) {
      throw Object.assign(new Error('尚未启用任何通知渠道'), { statusCode: 400 });
    }
    return this.dispatch(config, { event: 'test', title: 'steam-idler 测试通知', text: '收到这条消息说明通知配置正确。' });
  }
}

module.exports = { Notifier };
