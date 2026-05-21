# 在线加密聊天网站（Debian + 域名部署教程）

这份 README 的目标是让你直接把网站部署上线，并且后续能稳定更新。

默认示例：
- 域名：`257823.xyz`
- 仓库：`https://github.com/koajsj/onlieencryptedmsgweb.git`
- 系统：Debian 12

## 0. 部署前检查清单

- 已有可 SSH 登录的 Debian 服务器（有 `sudo` 权限）
- 域名 DNS 可改（至少能添加 `A` 记录）
- 服务器安全组/防火墙已放行 `22`、`80`、`443`
- 确认服务器时间正确（证书申请依赖系统时间）

---

## 1. 首次部署（一次做完可长期用）

### 1.1 登录服务器

```bash
ssh root@你的服务器IP
```

如果你不是 `root`，后文命令前加 `sudo`。

### 1.2 安装依赖（Node.js 20 + Git + Caddy）

```bash
apt update
apt install -y curl gnupg2 ca-certificates lsb-release debian-keyring debian-archive-keyring apt-transport-https git

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
```

验证安装：

```bash
node -v
npm -v
git --version
caddy version
```

### 1.3 拉取项目并构建

```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/koajsj/onlieencryptedmsgweb.git
cd onlieencryptedmsgweb
npm install
npm run build
```

### 1.4 配置 systemd 服务（后台常驻）

创建服务文件：

```bash
nano /etc/systemd/system/secure-chat.service
```

写入：

```ini
[Unit]
Description=Encrypted Chat Web
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/onlieencryptedmsgweb
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=DATA_DIR=/var/www/onlieencryptedmsgweb/data
Environment=TRUST_PROXY=1
Environment=TRUSTED_ORIGINS=https://257823.xyz,https://www.257823.xyz
Environment=SESSION_TTL_MS=604800000
Environment=MAX_MESSAGES_PER_CONVERSATION_WINDOW=60
Environment=MESSAGE_PERSIST_DEBOUNCE_MS=180
Environment=HSTS_MAX_AGE_SECONDS=31536000
Environment=ADMIN_USERNAME=你的管理员账号
Environment=ADMIN_PASSWORD=你的管理员密码
Environment=ADMIN_ACCOUNTS=admin账号1:密码1,admin账号2:密码2
Environment=AUDIT_TEXT_RETENTION_DAYS=30
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

生效并启动：

```bash
systemctl daemon-reload
systemctl enable secure-chat
systemctl start secure-chat
systemctl status secure-chat --no-pager
```

看到 `active (running)` 说明应用已正常运行。

### 1.5 配置域名反代和 HTTPS（Caddy）

编辑配置：

```bash
nano /etc/caddy/Caddyfile
```

写入：

```caddy
257823.xyz, www.257823.xyz {
    reverse_proxy 127.0.0.1:3000
}
```

检查并重载：

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
systemctl status caddy --no-pager
```

### 1.6 DNS 解析

到域名面板添加：

- `A` 记录：`@` -> 服务器公网 IP
- `A` 记录：`www` -> 服务器公网 IP

等解析生效后访问：

- `https://257823.xyz`
- `https://www.257823.xyz`

---

## 2. 更新网站到最新代码（后续常用）

每次你把本地改动推到 GitHub 后，在服务器执行：

```bash
cd /var/www/onlieencryptedmsgweb
git pull --ff-only origin main
npm install
npm run build
systemctl restart secure-chat
systemctl status secure-chat --no-pager
```

说明：
- 即使只改前端，也建议执行 `npm run build`，避免线上仍是旧的压缩文件。
- 如果 `npm start` 报构建过期，先运行 `npm run build` 再重启服务。

---

## 2.1 会话恢复说明

- 页面刷新后会尝试恢复登录 token。
- 为了继续解密历史消息，页面会要求你再输入一次密码来解锁本地私钥。
- 如果取消输入密码，会清理本地 token 并回到登录页。

---

## 3. 常用排错命令

查看应用日志：

```bash
journalctl -u secure-chat -n 200 --no-pager
```

实时追踪应用日志：

```bash
journalctl -u secure-chat -f
```

查看 Caddy 日志：

```bash
journalctl -u caddy -n 200 --no-pager
```

检查 3000 端口监听：

```bash
ss -lntp | grep 3000
```

---

## 4. 一句话总结

- 首次部署：装环境 -> 拉代码 -> 构建 -> systemd 启服务 -> Caddy 绑定域名与 HTTPS。
- 日常更新：`git pull` -> `npm install` -> `npm run build` -> `systemctl restart secure-chat`。

---

## 5. 后台管理员入口

- 后台地址：`https://你的域名/admin.html`
- 账号密码：由服务器环境变量 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 控制
- 多管理员账号：由 `ADMIN_ACCOUNTS` 控制，格式 `账号1:密码1,账号2:密码2`
- 支持：站点统计、用户筛选分页、批量封禁/解封、改用户名、改密码、查看聊天审计、审计日志链路、水印导出。
