# steam-idler

无需 Steam 客户端的自托管挂卡程序，带网页管理面板，适合部署在家庭 NAS 或 VPS 上。

- 通过 Steam 客户端协议（[steam-user](https://github.com/DoctorMcKay/node-steam-user)）登录，向服务器上报“正在游戏”，不下载、不运行任何游戏。
- 支持多个 Steam 账号同时挂卡：在网页上扫码或用账号密码 + Steam Guard 添加账号，统一查看各账号状态、调整挂卡参数。
- 定期读取自己的徽章页，只挂还有卡片可掉的游戏，掉完自动切换。
- 未满 2 小时的游戏同时挂（最多 32 个）累计时长，满 2 小时后逐个单独挂。
- 默认跳过还在退款期内（购买不满 14 天且游玩不足 2 小时）的游戏，避免挂卡让它们失去退款资格。
- 可调整挂卡顺序，用优先队列指定先挂哪些游戏；卡片掉完后可继续挂指定游戏累计时长，并自定义好友看到的“正在游戏”文本。
- 凭据失效、卡片全部掉完、掉卡时可推送到 Telegram、Bark 或自定义 Webhook。
- 你在电脑或掌机上实际玩游戏时自动暂停，退出游戏后自动恢复。
- 只保存 refresh token（约 200 天有效，会自动续期），不保存 Steam 密码。

## 部署（Docker）

推送到 `main` 后，GitHub Actions 会先跑测试并构建前端，再构建 `linux/amd64`、`linux/arm64` 镜像并推送到 `ghcr.io/zhu0823/steam-idler:latest`（另带 `sha-<提交>` 标签）。

仓库是私有的，镜像默认也是私有的，NAS/VPS 拉取前需要先登录 GHCR。到 GitHub → Settings → Developer settings → Personal access tokens 创建一个只勾选 `read:packages` 的 token，然后：

```bash
echo <token> | docker login ghcr.io -u zhu0823 --password-stdin
```

部署只需要 `docker-compose.yml` 和 `.env.example` 两个文件：

```bash
cp .env.example .env          # 可选，按需修改端口等
mkdir -p data
docker compose pull           # 本地构建则在 docker-compose.yml 中启用 build 后执行 docker compose build
docker compose up -d
```

面板默认只监听宿主机的 `127.0.0.1:8600`，按使用场景选择访问方式：

- **VPS**：用 Nginx/Caddy 反向代理到 `http://127.0.0.1:8600` 并配置 HTTPS，`.env` 中设置 `TRUST_PROXY=true`；或用 SSH 隧道临时访问（见“安全建议”）。
- **NAS 内网**：在 `.env` 中设置 `WEB_BIND=0.0.0.0`，然后浏览器打开 `http://<NAS 地址>:8600`。

打开面板后按下文完成初始化并添加 Steam 账号。

Nginx 反向代理示例（实时推送使用 SSE，需关闭缓冲）：

```nginx
location / {
    proxy_pass http://127.0.0.1:8600;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

更新到最新镜像：

```bash
docker compose pull && docker compose up -d
```

`data/` 目录需对容器用户可写。群晖、威联通等 NAS 上若日志提示数据目录不可写，把 `.env` 里的 `PUID`/`PGID` 改成目录所有者的 UID/GID（`id` 命令可查），或执行 `chown -R 1000:1000 data`。

## 首次初始化

第一次打开面板时需要输入**初始化码**并创建管理员密码。初始化码在首次启动时生成，可以通过以下任一方式获取：

- 命令行：

  ```bash
  docker compose logs steam-idler | grep "SETUP CODE"
  ```

  输出形如 `[steam-idler] SETUP CODE: K7QM-4XPD  (open the web panel to create admin password)`。
- NAS 图形界面（群晖 Container Manager、威联通 Container Station、Unraid、Portainer 等）：在该容器的“日志”页查找 `SETUP CODE`。
- 文件：用 NAS 文件管理器打开数据目录下的 `data/setup_code`。

说明：

- 初始化完成前，初始化码在重启后保持不变，并且每 10 分钟在日志中重复输出一次，日志被轮转或容器重建后也能找到。
- 输入时不区分大小写，空格和横线可省略。
- 同一 IP 连续输错 5 次锁定 15 分钟；累计输错 20 次会作废旧码并生成新码（同样输出到日志和文件）。
- 初始化完成后初始化码立即失效，`data/setup_code` 会被删除。

## 忘记面板密码

1. 删除 `data/admin.json`
2. 重启容器：`docker compose restart`
3. 按“首次初始化”获取新的初始化码，重新设置密码

各账号的 Steam 登录状态和挂卡配置（`data/accounts/`、`data/config.json`）不受影响，重新初始化期间挂卡照常进行。

## 面板登录保护

- 同一 IP 连续输错面板密码 5 次锁定 15 分钟（登录页会提示剩余次数）；所有来源合计输错 30 次时，面板登录会整体暂停 15 分钟（期间管理员也需等待），用于防止轮换 IP 猜密码。
- 退出面板会吊销当前会话；修改面板密码会让其他设备上的会话和已打开的页面立即失效。
- `data/config.json` 或账号目录下的配置、凭据文件损坏时，程序会把原文件备份为 `*.broken-<时间戳>` 并使用默认值启动，不会反复重启。

## 使用

- **添加账号**：侧栏或概览页点击“添加账号”，弹窗中默认显示登录二维码，用 Steam 手机 App 扫码确认；也可切换到“账号密码”按提示输入令牌/邮箱验证码。重复添加同一个账号会更新它的登录凭据，不会重复创建。
- **概览**：挂卡中账号、正在挂的游戏、待掉卡片（含今日已掉）、预计全部掉完时间；每个账号卡片显示当前阶段（同时挂累计时长的进度，或正在单独挂的游戏）。“账号 / 日志”可切换查看合并日志并按账号筛选；支持全部暂停 / 恢复 / 检查。
- **账号详情**：两阶段挂卡进度、游戏列表（时长进度、剩余掉落，可搜索筛选；点星标加入优先队列、勾选“跳过”立即生效）、最近掉卡记录、账号设置（单独设置挂卡参数、调整优先队列顺序、卡片掉完后挂的游戏、跳过列表外的 AppID）、该账号日志；可暂停/恢复、立即检查、重新登录、移除。
- **全局设置**：默认挂卡参数（同时挂的游戏数、单独挂的时长阈值、检查间隔、在线状态、设备名称、挂卡顺序、退款期保护、是否跳过从未玩过的游戏、自定义状态文本），未单独设置的账号保存后立即生效；通知渠道与推送事件；修改面板密码。

### 挂卡策略

- **挂卡顺序**：决定同时挂时先挑哪些游戏、满阈值后先单独挂哪个，可选时长最多 / 剩余卡少 / 剩余卡多 / 名称 / 徽章页顺序，默认时长最多的优先。
- **优先队列**：队列中还有可掉卡的游戏时只挂队列里的游戏（仍按两阶段规则，已满阈值的先单独挂），全部掉完后才挂其他游戏；开启“只挂优先队列中的游戏”后队列挂完就停止挂卡。
- **退款期保护**：根据账号的许可证购买时间和付款方式判断，激活码、免费领取、赠送的游戏不算在内。读取购买信息失败时会在日志中提示并沿用上一次的结果。游戏过了退款期或游玩满 2 小时后自动开始挂卡。
- **卡片掉完后挂的游戏**：每个账号单独设置，最多 32 个，用于累计游戏时长；需要账号拥有这些游戏。
- **状态文本**：以“非 Steam 游戏”的形式显示在好友列表中，会占用一个游戏位（同时挂的上限变为 31 个）。挂卡时的文本支持 `{name}`、`{appid}`、`{count}`，同时挂多个游戏时取排在最前的那个。

### 通知

在“全局设置 → 通知”中启用渠道并选择推送的事件（默认推送“登录凭据失效”和“卡片全部掉完”，“每次掉卡”默认关闭）：

- **Telegram**：通过 @BotFather 创建机器人，先给机器人发一条消息，再填写 Bot Token 和自己的 Chat ID。服务器需要能访问 `api.telegram.org`。
- **Bark**：填写 Bark App 中带设备 Key 的地址，例如 `https://api.day.app/<Key>`。
- **Webhook**：以 JSON 格式 POST 到指定地址，字段为 `event`（`drops` / `finished` / `authFailed` / `test`）、`title`、`text`、`account`（`{ id, name }`）、`time`。

Bot Token 和推送地址保存后不会再显示在面板上，留空保存表示保持不变。“发送测试通知”会先保存当前填写的内容再发送。

各账号读取徽章页的请求会依次进行并留出间隔，避免同一 IP 短时间内请求过多。

“今日已掉”和掉卡记录来自前后两次检查的剩余掉落对比，程序重启后的第一次检查只建立基准；“预计全部掉完”按每张约 30 分钟加上未满阈值游戏的累计时长粗略估算，仅供参考。

面板默认跟随系统深浅色，侧栏底部可手动切换。

### 数据目录

```
data/
  admin.json               面板管理员（密码哈希）
  config.json              全局默认挂卡参数
  notify.json              通知渠道（含 Bot Token、推送地址）与推送的事件
  accounts/<SteamID64>/
    token.json             该账号的登录凭据（refresh token）
    config.json            该账号的跳过列表、优先队列、掉完后挂的游戏、暂停状态、单独设置的参数
    drops.json             该账号最近 30 天的掉卡记录
  steam-user/              Steam 连接缓存
```

从单账号版本升级时，原来的 `data/refresh_token.json` 和跳过列表会在启动时自动迁移到 `data/accounts/<SteamID64>/`，无需重新登录。

## 安全建议

- 管理面板可以控制你的 Steam 账号，请设置足够强的面板密码。
- **VPS 上不要把面板直接暴露在公网 HTTP 上**：保持默认的 `WEB_BIND=127.0.0.1`，通过 Nginx/Caddy 反向代理加 HTTPS（并设置 `TRUST_PROXY=true`），或用 SSH 隧道访问后打开 `http://localhost:8600`：

  ```bash
  ssh -L 8600:127.0.0.1:8600 user@your-vps
  ```

  注意 Docker 发布的端口会绕过 ufw 等防火墙，设置 `WEB_BIND=0.0.0.0` 即等于对外开放。

- 优先使用扫码登录，Steam 密码不经过网络传输到面板。
- `data/accounts/` 下各账号的 `token.json` 可以直接登录对应的 Steam 账号，请勿上传或分享；`data/notify.json` 中的 Bot Token 和推送地址同样需要保密。
- 挂卡使用的是非官方客户端协议，Valve 一般不处理单纯的挂卡行为，但请自行评估风险。

## 部署选项

`.env` 中可设置（均为可选）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WEB_PORT` | 8600 | 面板映射到宿主机的端口 |
| `WEB_BIND` | 127.0.0.1 | 面板监听的宿主机地址；NAS 内网直接访问时设为 `0.0.0.0` |
| `TRUST_PROXY` | false | 在反向代理之后时设为 `true`（只信任本机和内网来源的代理），或填写代理的 IP/CIDR 列表 |
| `PUID` / `PGID` | 1000 | 容器运行用户 |
| `TZ` | Asia/Shanghai | 时区 |

## 常见情况

- **面板提示“登录凭据已失效”**：在 Steam 里撤销了设备授权、修改了密码，或 token 已过期。在该账号详情页重新登录即可。
- **在电脑上启动游戏时提示“账号正在其他电脑上游戏”**：选择继续即可。程序会被顶下线，2 分钟后重新登录，并在你游戏期间保持暂停。
- **为什么某个游戏不掉卡**：免费游戏、受限账户（未消费满 5 美元）或已掉完一半卡片的游戏不会再掉落，这是 Steam 的规则。
- **停用**：在面板中移除账号，然后 `docker compose down`，并在 Steam 网页的“授权设备”中移除 `steam-idler`。

## 本地开发

需要 Node.js 22.12 及以上：

```bash
npm ci
npm run dev:server   # 后端，默认 http://localhost:8080
npm run dev:web      # 前端开发服务器，接口转发到后端
npm test
npm run build        # 构建前端到 web/dist，由后端直接托管
```
