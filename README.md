# steam-idler

无需 Steam 客户端的自托管挂卡程序，带网页管理面板，适合部署在 NAS 或 VPS 上。

## 项目介绍

- 通过 Steam 客户端协议（[steam-user](https://github.com/DoctorMcKay/node-steam-user)）上报“正在游戏”，不下载、不运行游戏。
- 支持多账号，扫码或账号密码 + Steam Guard 登录；只保存 refresh token（约 200 天，自动续期），不保存密码。
- 定期读取徽章页，只挂还能掉卡的游戏：未满 2 小时的游戏同时挂（最多 32 个）累计时长，之后逐个单独挂。
- 默认跳过退款期内的游戏；支持挂卡顺序、优先队列、跳过列表，掉完后可继续挂指定游戏，可自定义好友看到的状态文本。
- 掉卡、全部掉完、凭据失效时可推送到 Telegram、Bark 或 Webhook。
- 你在其他设备上玩游戏时自动暂停，退出后自动恢复。

## 开始使用

### 本地部署

需要 Node.js 22.12+：

```bash
npm ci
npm run build                 # 构建前端到 web/dist，由后端直接托管
HOST=127.0.0.1 npm start      # 打开 http://localhost:8080
```

1. 初始化：首次打开需输入初始化码并设置面板密码。初始化码会输出到终端日志（`SETUP CODE: ...`），同时写入 `data/setup_code`。
2. 添加账号：在面板中点击“添加账号”扫码登录，之后在“全局设置”和账号详情页调整挂卡参数与通知。

环境变量：`PORT`（默认 8080）、`HOST`（默认 0.0.0.0，所有网卡）、`DATA_DIR`（默认 `./data`）、`TRUST_PROXY`（反向代理后设为 `true`，默认 false）。长期运行可交给 systemd、pm2 等进程管理工具。

开发调试：`npm run dev:server` 启动后端，`npm run dev:web` 启动前端开发服务器（接口转发到后端），`npm test` 运行测试。

### Docker 部署

准备 `docker-compose.yml` 和 `.env.example`，然后启动：

```bash
cp .env.example .env    # 可选，修改端口、监听地址等
mkdir -p data
docker compose up -d
```

镜像为 `ghcr.io/zhu0823/steam-idler:latest`（amd64 / arm64），推送到 `main` 后由 GitHub Actions 自动构建；也可在 `docker-compose.yml` 中启用 `build: .` 本地构建。

面板默认只监听宿主机 `127.0.0.1:8600`：

- VPS：用 Nginx/Caddy 反向代理并开启 HTTPS，`.env` 中设置 `TRUST_PROXY=true`；SSE 推送需关闭代理缓冲（`proxy_buffering off`）。
- NAS 内网：`.env` 中设置 `WEB_BIND=0.0.0.0`，打开 `http://<NAS 地址>:8600`。

打开面板后按本地部署的初始化、添加账号步骤操作，初始化码可用 `docker compose logs steam-idler | grep "SETUP CODE"` 查看。

更新：`docker compose pull && docker compose up -d`。

`.env` 可选项：`WEB_PORT`（默认 8600）、`WEB_BIND`（默认 127.0.0.1）、`TRUST_PROXY`（默认 false）、`PUID` / `PGID`（默认 1000）、`TZ`（默认 Asia/Shanghai）。

## 注意事项

- 面板可以控制你的 Steam 账号，请设置强密码；VPS 上不要直接把面板暴露在公网 HTTP 上。Docker 发布的端口会绕过 ufw 等防火墙。
- `data/` 下的 `accounts/*/token.json` 可直接登录对应账号，`notify.json` 含推送密钥，请勿上传或分享。
- `data/` 需对容器用户可写；NAS 上提示不可写时，把 `PUID` / `PGID` 改为目录所有者，或执行 `chown -R 1000:1000 data`。
- 忘记面板密码：删除 `data/admin.json` 并重启，按初始化步骤重新设置，账号与挂卡配置不受影响。
- 凭据失效时在账号详情页重新登录；在电脑上启动游戏提示“账号正在其他电脑上游戏”时选择继续即可，程序会自动暂停。
- 免费游戏、受限账户或已掉完一半卡片的游戏不会再掉卡，这是 Steam 的规则。
- 停用：在面板中移除账号后 `docker compose down`，并在 Steam “授权设备”中移除 `steam-idler`。
- 本项目使用非官方客户端协议，与 Valve / Steam 无关，请自行评估账号风险。
- 基于 [MIT 协议](LICENSE) 开源。
