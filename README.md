# steam-idler

无需 Steam 客户端的自托管挂卡程序，适合部署在家庭 NAS 或 VPS 上。

- 通过 Steam 客户端协议（[steam-user](https://github.com/DoctorMcKay/node-steam-user)）登录，向服务器上报“正在游戏”，不下载、不运行任何游戏。
- 定期读取自己的徽章页，只挂还有卡片可掉的游戏，掉完自动切换。
- 未满 2 小时的游戏同时挂（最多 32 个）累计时长，满 2 小时后逐个单独挂。
- 你在电脑或掌机上实际玩游戏时自动暂停，退出游戏后自动恢复。
- 只保存 refresh token（约 200 天有效，会自动续期），不保存密码。

## 部署（Docker）

```bash
# 1. 上传本目录到 NAS/VPS 后进入目录
cp .env.example .env          # 可选，按需修改
mkdir -p data

# 2. 构建镜像
docker compose build

# 3. 首次登录：扫码（推荐）
docker compose run --rm -it steam-idler node src/login.js
#    或账号密码 + Steam Guard
docker compose run --rm -it steam-idler node src/login.js --password

# 4. 后台运行
docker compose up -d
docker compose logs -f
```

`data/` 目录需对容器用户可写。群晖、威联通等 NAS 上若遇到 `EACCES`，把 `.env` 里的 `PUID`/`PGID` 改成目录所有者的 UID/GID（`id` 命令可查），或执行 `chown -R 1000:1000 data`。

## 不用 Docker

需要 Node.js 18 及以上：

```bash
npm ci --omit=dev
npm run login        # 扫码登录；加 -- --password 用账号密码
npm start
```

长期运行可用 systemd 或 pm2 托管。

## 配置

全部通过环境变量（`.env`）设置，均为可选：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MAX_CONCURRENT` | 32 | 同时挂的游戏数上限 |
| `HOURS_UNTIL_DROPS` | 2 | 时长达到该值后改为单独挂；0 表示始终逐个挂 |
| `CHECK_INTERVAL_MINUTES` | 15 | 检查徽章页的间隔，最小 5 |
| `SKIP_APPIDS` | 空 | 不挂的游戏 appid，逗号分隔 |
| `PERSONA_STATE` | online | `online` / `invisible` / `offline` |
| `MACHINE_NAME` | steam-idler | 在 Steam 设备列表中显示的名称 |

## 常见情况

- **日志提示“登录凭据已失效”**：在 Steam 里撤销了设备授权、修改了密码，或 token 已过期。重新执行第 3 步登录，再执行 `docker compose restart`。
- **在电脑上启动游戏时提示“账号正在其他电脑上游戏”**：选择继续即可。程序会被顶下线，2 分钟后重新登录，并在你游戏期间保持暂停。
- **为什么某个游戏不掉卡**：免费游戏、受限账户（未消费满 5 美元）或已掉完一半卡片的游戏不会再掉落，这是 Steam 的规则。
- **停用**：`docker compose down`，然后在 Steam 网页的“授权设备”中移除 `steam-idler`。

## 安全提示

`data/refresh_token.json` 可以直接登录你的 Steam 账号，请勿上传到网盘、Git 或公开分享。挂卡使用的是非官方客户端协议，Valve 一般不处理单纯的挂卡行为，但请自行评估风险。
