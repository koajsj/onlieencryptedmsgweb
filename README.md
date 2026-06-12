# 在线加密聊天网站部署说明

适用环境：Debian 12、个人域名、Cloudflare 托管 DNS、Caddy 自动 HTTPS、Node.js 20。

## 管理员账号

管理员用户名默认是 `admin`，也可以在部署时通过 `ADMIN_USERNAME` 覆盖。

管理员密码不会保存在仓库中。首次部署时脚本会自动生成一串随机密码，只在部署完成时回显一次，并且只把 `scrypt` 哈希写入 `/etc/default/secure-chat`。

后台地址：

```text
https://你的域名/admin.html
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
DOMAIN=example.com WWW_DOMAIN=www.example.com sudo -E bash scripts/deploy-debian.sh
```

如果只想写一个域名：

```bash
cd /var/www/onlieencryptedmsgweb
DOMAIN=example.com sudo -E bash scripts/deploy-debian.sh
```

脚本会自动完成：

- 安装 Node.js 20、Git、Caddy
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
https://你的域名
https://www.你的域名
```

注意：

- 这条默认部署路径会占用 `443`
- 不需要你自己额外配置反向代理
- 如果服务器上已经有别的服务占用了 `80/443`，需要先停掉那个服务

## 4. 日常更新

以后更新代码，只需要执行：

```bash
cd /var/www/onlieencryptedmsgweb
DOMAIN=example.com WWW_DOMAIN=www.example.com sudo -E bash scripts/deploy-debian.sh
```

如果 `/etc/default/secure-chat` 里已经有管理员哈希，脚本不会重新生成密码。

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

### 443 被占用

检查：

```bash
ss -lntp | grep ':443'
```

如果有 Nginx、Apache、宝塔面板站点或其他 Web 服务占用了 `443`，先停掉它，再重新执行部署脚本。

## 8. 本地开发

本地运行前，需要自己显式提供管理员配置：

```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD_HASH='你的scrypt哈希' npm start
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
