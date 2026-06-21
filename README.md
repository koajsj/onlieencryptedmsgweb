# 在线加密聊天网站部署说明

## 项目说明

这是一个轻量级的浏览器端加密聊天系统，提供用户聊天界面和独立的后台管理界面。系统以 Node.js 单服务运行，前端为原生静态页面，默认使用 Cookie Session 认证，并兼容 Bearer Token 作为恢复与兜底认证方式。

项目当前包含这些核心能力：

- 用户注册、登录、会话恢复与基础身份校验
- 基于加密载荷的点对点消息收发与历史会话查询
- SSE 实时事件推送与在线状态相关能力
- 管理员登录、用户管理、消息审查、系统状态与统计面板
- 基于本地 JSON/JSONL 文件的数据持久化与审计记录

账号与密钥安全约束：

- 用户修改密码时，浏览器会用新密码重新加密私钥包，服务端同时轮换密码哈希并撤销其他会话。
- 管理员不能直接重置用户密码，因为管理员不持有用户私钥；用户需在聊天设置中自行修改。
- 管理员账号或密码重置后，所有已有管理员会话都会失效，需要使用新凭据重新登录。
- 联系人公钥采用首次信任并本地固定；后续公钥变化会暂停发送，需核对安全码后手动确认。

适用环境：Debian 12、个人域名、Cloudflare 托管 DNS、Caddy 自动 HTTPS、Node.js 20.17 或更高版本。

## 管理员账号

管理员用户名默认是 `admin`，也可以在部署时通过 `ADMIN_USERNAME` 覆盖。

管理员密码**没有可用的内置默认值**：服务启动时如果没有配置 `ADMIN_PASSWORD` 或 `ADMIN_PASSWORD_HASH`，进程会直接报错退出。生产环境必须在部署前设置其中之一：

- `ADMIN_PASSWORD`：明文口令，服务会在写入 `/etc/default/secure-chat`（权限 0600）前自动哈希。
- `ADMIN_PASSWORD_HASH`：`scrypt:salt:hash` 形式的预生成哈希，直接喂入。

部署脚本会把最终的凭据写入 `/etc/default/secure-chat`。仓库里存在一个仅供本地试跑的弱口令，但它默认被禁用，只有显式设置 `ALLOW_INSECURE_DEFAULT_ADMIN=1` 时才会启用——**切勿在生产环境这样做**。

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

更新脚本现在会按下面的顺序执行：

- 自动还原允许覆盖的构建产物，避免 `git pull` 被压缩文件卡住
- `git fetch` + `git checkout main` + `git pull --ff-only`
- `npm ci --include=dev`
- `npm run build`
- `systemctl restart secure-chat`
- 如果服务器装了 Caddy，再自动 `validate + reload`

它不会删除 `/var/lib/secure-chat/data` 里的生产数据，也不会重置你手工维护的 Caddy 证书状态。

如果仓库里还有其他手工改动，脚本会直接报错并列出文件，避免误覆盖。

如果 `/etc/default/secure-chat` 里已经有管理员口令，脚本不会重新写入。

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

## 8. 本地开发

本地需要 Node.js 20.17 或更高版本。

本地启动必须提供管理员凭据，否则服务会报错退出：

```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD='你的口令' npm start
```

也支持用 `ADMIN_PASSWORD_HASH`（`scrypt:salt:hash` 形式）直接喂入预生成哈希。

如果只是想用内置弱口令快速试跑（**仅限本地**），可以显式开启：

```bash
ALLOW_INSECURE_DEFAULT_ADMIN=1 npm start
```

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

检查构建产物：

```bash
npm run check
```
