# 在线加密聊天网站部署说明

适用环境：Debian 12 云服务器、个人域名、Cloudflare 托管 DNS、Caddy 自动 HTTPS、Node.js 20。

## 管理员账号密码

后台账号固定为：

```text
账号：admin
密码：qwer@1234
```

本地开发和生产部署都使用这组账号密码。

后台地址：

```text
https://你的域名/admin.html
```

## 1. 准备服务器

需要：

- Debian 12 云服务器
- 一个域名，例如 `257823.xyz`
- 域名已经接入 Cloudflare
- 服务器安全组放行 `80` 和 `443`
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

## 2. Cloudflare 域名托管

在 Cloudflare 添加站点后，Cloudflare 会给你 2 个 nameserver。

到你的域名注册商后台，把原来的 NS 服务器替换成 Cloudflare 提供的 2 个 nameserver。等待 Cloudflare 显示域名已激活。

## 3. Cloudflare DNS 记录

进入 Cloudflare Dashboard：

```text
你的站点 -> DNS -> Records
```

推荐记录：

| Type | Name | Content | Proxy status |
| --- | --- | --- | --- |
| A | `@` | 服务器公网 IPv4 | Proxied 橙色云 |
| CNAME | `www` | `你的根域名`，例如 `257823.xyz` | Proxied 橙色云 |

也可以把 `www` 配成 A 记录，直接指向同一个服务器 IP。

注意：

- Web 流量建议开启 Proxied 橙色云。
- 不要给本项目配置 Cloudflare Tunnel、Workers、Pages，除非你明确知道自己要替换当前 Caddy 部署方式。
- DNS 生效前访问域名可能失败，先用 `ping 你的域名` 或 Cloudflare 面板确认记录已生效。

## 4. Cloudflare SSL/TLS 设置

进入：

```text
你的站点 -> SSL/TLS -> Overview
```

设置：

```text
Encryption mode: Full (strict)
```

不要使用 `Flexible`。本项目用 Caddy 在源站自动签发 HTTPS 证书，Cloudflare 到服务器也应该走 HTTPS。

如果首次部署前 Cloudflare 已经打开橙色云，Caddy 通常仍可通过 HTTP-01 完成证书签发，因为 80/443 会被代理到服务器。确保服务器防火墙和云厂商安全组已放行 80/443。

## 5. 首次部署

默认部署域名是脚本里的 `257823.xyz` 和 `www.257823.xyz`。

如果你就用默认域名：

```bash
sudo bash scripts/deploy-debian.sh
```

如果你换成自己的域名：

```bash
DOMAIN=example.com WWW_DOMAIN=www.example.com sudo -E bash scripts/deploy-debian.sh
```

脚本会自动完成：

- 安装 Node.js 20、Git、Caddy
- 拉取或更新仓库
- 安装依赖并构建前端压缩文件
- 写入 `/etc/caddy/Caddyfile`
- 写入 `/etc/systemd/system/secure-chat.service`
- 写入 `/etc/default/secure-chat`
- 把运行数据放到 `/var/lib/secure-chat/data`
- 启动并启用 `secure-chat` 和 `caddy`

部署成功后访问：

```text
https://你的域名
https://www.你的域名
```

## 6. 日常更新

以后更新代码，只需要在服务器执行：

```bash
cd /var/www/onlieencryptedmsgweb
sudo bash scripts/deploy-debian.sh
```

脚本会：

- `git pull --ff-only`
- `npm ci --include=dev`
- `npm run build`
- 重启 `secure-chat`
- 重载 Caddy 配置

## 7. 常用检查命令

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

看端口监听：

```bash
ss -lntp | grep -E ':80|:443|:3000'
```

本机健康检查：

```bash
curl -s http://127.0.0.1:3000/health
```

## 8. 数据文件

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

如果服务启动失败，优先检查这些文件是不是合法 JSON/JSONL。

## 9. Cloudflare 常见问题

### 访问提示重定向过多

通常是 Cloudflare SSL/TLS 设成了 `Flexible`。改成：

```text
Full (strict)
```

### 域名打不开，但服务器 IP 能打开

检查：

- Cloudflare DNS 是否有 `@` 和 `www`
- A 记录是否指向正确公网 IP
- Proxy status 是否为橙色云
- 云服务器安全组是否放行 80/443
- Caddy 是否运行：`systemctl status caddy --no-pager`

### HTTPS 证书错误

检查：

- Cloudflare SSL/TLS 是否为 `Full (strict)`
- Caddy 日志是否有证书签发错误
- 80/443 是否能从公网访问
- DNS 是否已经生效

### 后台密码是什么

固定为：

```text
账号：admin
密码：qwer@1234
```

## 10. 本地开发

安装依赖：

```bash
npm ci
```

构建：

```bash
npm run build
```

启动：

```bash
npm start
```

测试：

```bash
npm test
```

检查构建产物：

```bash
npm run check
```

本地开发后台默认：

```text
账号：admin
密码：qwer@1234
```
