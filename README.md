# 在线加密聊天网站部署说明

## 项目说明

这是一个轻量级的浏览器端加密聊天系统，提供用户聊天界面和独立的后台管理界面。系统以 Node.js 单服务运行，前端为原生静态页面，默认仅使用 HttpOnly、SameSite=Strict 的 Cookie Session 认证。

项目当前包含这些核心能力：

- 用户注册、登录、会话恢复与基础身份校验
- 基于加密载荷的点对点消息收发与历史会话查询
- SSE 实时事件推送与在线状态相关能力
- 管理员登录、用户管理、消息审查、系统状态与统计面板
- 基于本地 JSON/JSONL 文件的数据持久化与审计记录

账号与密钥安全约束：

- 用户私钥只在浏览器本地生成并保存在本机安全存储中；修改密码只会轮换服务端密码哈希并撤销其他会话，不会触碰私钥。
- 管理员不能直接重置用户密码，因为管理员不持有用户私钥；用户需在聊天设置中自行修改。
- 管理员账号或密码重置后，所有已有管理员会话都会失效，需要使用新凭据重新登录。
- 联系人公钥需要先核对安全码并手动信任后才能开始发送；后续公钥变化也会暂停发送，直到再次确认。
- 系统仅使用同站 HttpOnly Cookie 认证，不再支持 Bearer Token 兼容模式，避免令牌进入脚本可读内存、日志或外部客户端。
- 开启 `TRUST_PROXY=1` 时，只接受 `TRUSTED_PROXY_ADDRESSES` 中代理发送的转发头，防止伪造客户端 IP 绕过限流。
- 访问日志默认保留 30 天，并限制待写队列，避免长期磁盘增长或数据库变慢时耗尽内存。
- 后台 IP 国家/地区/城市归属默认在服务端通过固定 HTTPS 接口查询并缓存；如需关闭第三方归属查询，可设置 `ENABLE_IP_GEO=0`。

适用环境：Debian 12、个人域名、Cloudflare 托管 DNS、Caddy 自动 HTTPS、Node.js 20.17 或更高版本。

## 管理员账号

管理员用户名默认固定为 `admin`，默认管理员密码为 `qwer@1234`。如果没有配置 `ADMIN_PASSWORD` 或 `ADMIN_PASSWORD_HASH`，服务会自动使用这个默认密码。

- `ADMIN_PASSWORD`：明文口令，服务会在写入 `/etc/default/secure-chat`（权限 0600）前自动哈希。
- `ADMIN_PASSWORD_HASH`：`scrypt:salt:hash` 形式的预生成哈希，直接喂入。
- `ADMIN_UPDATE_PASSPHRASE`：管理员账号热更新验证口令，默认是 `admin`。
- `AUDIT_HMAC_KEY`：管理员审计链 HMAC 密钥。生产环境建议持久化保存，避免管理员密码调整后出现审计链误告警。

部署脚本会把最终凭据写入 `/etc/default/secure-chat`；更新脚本会保留已有凭据，除非你显式传入新的管理员变量。

后台地址：

```text
https://257823.xyz/admin.html
```

## 1. 准备服务器

需要：

- Debian 12 云服务器
- 一个已经解析到服务器公网 IP 的域名
- 域名已经接入 Cloudflare
- 云服务器安全组放行 `80` 和 `443`
- 可以 SSH 登录服务器，并且有 `sudo` 权限

先登录服务器：

```bash
ssh root@你的服务器IP
```

安装 Git 并拉取项目：

```bash
apt-get update && apt-get install -y git
git clone https://github.com/koajsj/onlieencryptedmsgweb.git /var/www/onlieencryptedmsgweb
cd /var/www/onlieencryptedmsgweb
```

## 2. Cloudflare 基础配置

Cloudflare 中至少保留两条记录：

| Type | Name | Content | Proxy status |
| --- | --- | --- | --- |
| A | `@` | 服务器公网 IPv4 | Proxied |
| CNAME | `www` | `你的根域名` | Proxied |

SSL/TLS 模式必须是：

```text
Full (strict)
```

不要用 `Flexible`，否则会导致循环跳转。

## 3. 首次部署

默认方式：

```bash
cd /var/www/onlieencryptedmsgweb
sudo bash scripts/deploy-debian.sh
```

如果你想从空机器直接一条命令完成拉取和部署：

```bash
apt-get update && apt-get install -y git
git clone https://github.com/koajsj/onlieencryptedmsgweb.git /var/www/onlieencryptedmsgweb
cd /var/www/onlieencryptedmsgweb
sudo bash scripts/deploy-debian.sh
```

如果你以后要换域名：

```bash
cd /var/www/onlieencryptedmsgweb
DOMAIN=example.com WWW_DOMAIN=www.example.com sudo -E bash scripts/deploy-debian.sh
```

脚本会自动完成：

- 安装 Node.js 20（最低 20.17）、Git、Caddy
- 更新仓库到 `main`
- 安装依赖并构建前端压缩文件
- 写入 `/etc/systemd/system/secure-chat.service`
- 写入 `/etc/default/secure-chat`
- 写入 `/etc/caddy/Caddyfile`
- 把运行数据放到 `/var/lib/secure-chat/data`
- 启动并启用 `secure-chat`
- 启动并启用 `caddy`
- 自动接管 `80/443`

部署完成后直接访问：

```text
https://257823.xyz
https://www.257823.xyz
```

注意：

- 这条默认部署路径会占用 `443`
- 不需要你自己额外配置反向代理
- 如果服务器上已经有别的服务占用了 `80/443`，需要先停掉那个服务

## 4. 日常更新

以后更新代码，只需要执行：

```bash
cd /var/www/onlieencryptedmsgweb
sudo bash scripts/update-debian.sh
```

Hot update notes for VPS:

- The update script keeps the currently running service online while it pulls, installs dependencies, lints, builds, and verifies assets.
- The only planned interruption is the final `systemctl restart secure-chat`.
- If the new revision fails to restart or `/health` does not respond, the script checks out the previous commit, rebuilds it, restarts the service, and exits with an error so you can inspect logs before retrying.
- Use the same command as before on the VPS; no new update command is required.

如果 VPS 上的本地部署脚本或更新脚本已经损坏，使用这个非交互式兜底更新入口：

```bash
curl -fsSL https://raw.githubusercontent.com/koajsj/onlieencryptedmsgweb/main/scripts/bootstrap-update-debian.sh | sudo bash
```

兜底脚本会先把本地差异备份到 `/var/backups/secure-chat-bootstrap/`，然后从 GitHub 刷新仓库中被跟踪的文件和脚本，再执行刷新后的更新流程。它不会执行 `git clean`，不会删除 `/var/lib/secure-chat/data` 里的生产数据，也不会要求输入确认。

更新脚本现在会按下面的顺序执行：

- 自动还原允许覆盖的构建产物，避免 `git pull` 被压缩文件卡住
- `git fetch` + `git checkout main` + `git pull --ff-only`
- `npm ci --include=dev`
- `npm run build`
- `systemctl restart secure-chat`
- 写回默认 443/Caddy 配置：应用监听 `127.0.0.1:3000`，Caddy 占用 `80/443`
- 自动 `validate + reload/restart caddy`

它不会删除 `/var/lib/secure-chat/data` 里的生产数据，也不会重置你手工维护的 Caddy 证书状态。

如果仓库里还有其他手工改动，脚本会直接报错并列出文件，避免误覆盖。

更新脚本默认会保留现有管理员用户名、密码哈希、热更新验证口令和审计 HMAC 密钥；只有你显式传入新的 `ADMIN_USERNAME`、`ADMIN_PASSWORD`、`ADMIN_PASSWORD_HASH` 或 `ADMIN_UPDATE_PASSPHRASE` 时才会覆盖。

如果你之前临时改成 `PORT=3001` 或 `MANAGE_CADDY=0`，新版更新脚本会恢复默认 Caddy/443 部署方式。运行前要确保没有 `mtproto-proxy`、Nginx、Apache 等非 Caddy 服务占用 `80/443`。

## 5. 常用检查命令

看应用状态：

```bash
systemctl status secure-chat --no-pager
```

看应用日志：

```bash
journalctl -u secure-chat -n 200 --no-pager
```

实时日志：

```bash
journalctl -u secure-chat -f
```

看 Caddy 状态：

```bash
systemctl status caddy --no-pager
```

看 Caddy 日志：

```bash
journalctl -u caddy -n 200 --no-pager
```

看监听端口：

```bash
ss -lntp | grep -E ':80|:443|:3000'
```

本机健康检查：

```bash
curl -s http://127.0.0.1:3000/health
```

公开健康接口只返回存活状态。用户数、消息数、会话数和存储状态等详细指标仅在管理员后台提供。

## 6. 数据文件

生产数据目录：

```text
/var/lib/secure-chat/data
```

里面会自动生成：

- `users.json`
- `messages.json`
- `messages.jsonl`
- `admin_audit.jsonl`

这些是运行时数据，不应该提交到 GitHub。

## 7. 常见问题

### 访问提示重定向过多

通常是 Cloudflare 的 SSL/TLS 设成了 `Flexible`。改成：

```text
Full (strict)
```

### 域名打不开

检查：

- `@` 和 `www` 是否都解析到了当前服务器
- 服务器安全组是否放行 `80/443`
- `systemctl status caddy --no-pager`
- `systemctl status secure-chat --no-pager`

如果 Cloudflare 提示 `521 Web Server Is Down`，通常就是下面几种情况：

- `caddy` 没有安装或没有启动
- `secure-chat` 服务没有在 `127.0.0.1:3000` 正常监听
- 服务器防火墙没有放行 `80/443`
- 域名还没真正解析到当前 VPS

### 443 被占用

检查：

```bash
ss -lntp | grep ':443'
```

如果有 Nginx、Apache、宝塔面板站点或其他 Web 服务占用了 `443`，先停掉它，再重新执行部署脚本。
部署和更新脚本会直接打印 `ss -lntp` 中占用 `80/443` 的进程，并提示当前项目的默认结构是 Caddy 监听 `80/443`，应用只监听 `127.0.0.1:3000`。

## 8. 本地开发

本地需要 Node.js 20.17 或更高版本。

本地启动默认使用管理员账号 `admin/qwer@1234`，管理员热更新验证口令默认是 `admin`：

```bash
npm start
```

如需覆盖默认密码，也支持用 `ADMIN_PASSWORD` 或 `ADMIN_PASSWORD_HASH`（`scrypt:salt:hash` 形式）指定：

```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD='你的口令' npm start
```

本地运行数据默认写入：

```text
~/.secure-chat/data
```

这样不会把 session secret、审计链密钥或聊天运行数据混进仓库工作区。

安装依赖：

```bash
npm ci
```

构建：

```bash
npm run build
```

测试：

```bash
npm test
```

默认测试只跑快速的客户端与部署护栏，适合日常修改后快速确认。涉及安全、登录、消息发送或服务端接口时，部署前再跑完整 E2E：

```bash
npm run test:full
```

检查构建产物：

```bash
npm run check
```

## E2E zero-knowledge model

The chat path is client-encrypted and server zero-knowledge:

- Browser clients generate a long-lived P-256 ECDH identity key pair.
- The private identity key stays in the browser's local device vault. For multi-device recovery, the browser can upload a password-encrypted identity bundle; the server stores only that ciphertext and never decrypts or restores the private key.
- Public identity keys are published through `GET /public-key/:userId` and `GET /prekey-bundle/:userId`; an existing identity key cannot be silently replaced.
- Clients derive a non-extractable session message key with ECDH shared secret + HKDF-SHA256.
- Every message uses AES-GCM with a fresh nonce and non-null AAD bound to `{ from, to }`.
- `POST /api/messages` accepts only `ciphertext` and `nonce`; plaintext message bodies are rejected and never stored.
- `POST /api/messages/attachment` uses the same ciphertext-only path; attachment names, bytes, and previews are encrypted inside the client payload.
- The server stores message ciphertext, nonce, sender, recipient, id, and timestamp metadata only.
- The server keeps a per-sender nonce replay index and rejects duplicate nonces with `409 duplicate message nonce`.
- There is no base64 plaintext fallback and no server-side message decrypt path.
- The current `prekey-bundle` response is an identity-key compatibility bundle. It does not claim Signal Double Ratchet or one-time prekey pools; multi-device recovery is limited to the owner-only password-encrypted identity bundle returned after authentication.

Key exchange endpoints:

```text
GET  /public-key/:userId
POST /upload-public-key
GET  /prekey-bundle/:userId
```
