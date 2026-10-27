# steam-idler

无需 Steam 客户端的自托管挂卡程序，带网页管理面板，适合部署在家庭 NAS 或 VPS 上。

- 通过 Steam 客户端协议（[steam-user](https://github.com/DoctorMcKay/node-steam-user)）登录，向服务器上报“正在游戏”，不下载、不运行任何游戏。
- 在网页上扫码或用账号密码 + Steam Guard 登录 Steam，可视化查看挂卡状态、调整挂卡参数。
- 定期读取自己的徽章页，只挂还有卡片可掉的游戏，掉完自动切换。
- 未满 2 小时的游戏同时挂（最多 32 个）累计时长，满 2 小时后逐个单独挂。
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

然后浏览器打开 `http://<NAS 或 VPS 地址>:8080`，按下文完成初始化并登录 Steam。

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

  输出形如 `[steam-idler] SETUP CODE: K7QM-4XPD  (open http://<host>:8080 to create admin password)`。
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

Steam 登录状态（`data/refresh_token.json`）和挂卡配置（`data/config.json`）不受影响，重新初始化期间挂卡照常进行。

## 使用

- **登录 Steam**：概览页选择“扫码登录”，用 Steam 手机 App 扫码并确认；或选择“账号密码”，按提示输入令牌/邮箱验证码或在 App 中确认。
- **概览**：账号状态、正在挂的游戏、每个游戏剩余掉落、运行日志；可暂停/恢复、立即检查、退出 Steam。
- **设置**：同时挂的游戏数、单独挂的时长阈值、检查间隔、在线状态、设备名称、跳过的游戏；保存后立即生效。还可以修改面板密码。

## 安全建议

- 管理面板可以控制你的 Steam 账号，请设置足够强的面板密码。
- **VPS 上不要把面板直接暴露在公网 HTTP 上**：把 `docker-compose.yml` 的端口改为 `127.0.0.1:8080:8080`，再通过 Nginx/Caddy 反向代理加 HTTPS（并设置 `TRUST_PROXY=true`），或用 SSH 隧道访问：

  ```bash
  ssh -L 8080:127.0.0.1:8080 user@your-vps
  ```

- 优先使用扫码登录，Steam 密码不经过网络传输到面板。
- `data/` 目录下的 `refresh_token.json` 可以直接登录你的 Steam 账号，请勿上传或分享。
- 挂卡使用的是非官方客户端协议，Valve 一般不处理单纯的挂卡行为，但请自行评估风险。

## 部署选项

`.env` 中可设置（均为可选）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WEB_PORT` | 8080 | 面板映射到宿主机的端口 |
| `TRUST_PROXY` | false | 在反向代理之后时设为 `true` |
| `PUID` / `PGID` | 1000 | 容器运行用户 |
| `TZ` | Asia/Shanghai | 时区 |

## 常见情况

- **面板提示“登录凭据已失效”**：在 Steam 里撤销了设备授权、修改了密码，或 token 已过期。在概览页重新登录 Steam 即可。
- **在电脑上启动游戏时提示“账号正在其他电脑上游戏”**：选择继续即可。程序会被顶下线，2 分钟后重新登录，并在你游戏期间保持暂停。
- **为什么某个游戏不掉卡**：免费游戏、受限账户（未消费满 5 美元）或已掉完一半卡片的游戏不会再掉落，这是 Steam 的规则。
- **停用**：在面板中退出 Steam，然后 `docker compose down`，并在 Steam 网页的“授权设备”中移除 `steam-idler`。

## 本地开发

需要 Node.js 22.12 及以上：

```bash
npm ci
npm run dev:server   # 后端，默认 http://localhost:8080
npm run dev:web      # 前端开发服务器，接口转发到后端
npm test
npm run build        # 构建前端到 web/dist，由后端直接托管
```
