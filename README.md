# 在线加密聊天网站（Debian + 个人域名部署说明）

这份文档只讲两件事：
1. 用你自己的域名 `257823.xyz` 把这个项目部署到 Debian 云服务器。
2. 以后怎么把服务器代码更新到 GitHub 最新版本。

不讲复杂理论，按步骤做就行。

## 0. 先准备好这些

- 一台 Debian 云服务器（建议 Debian 12）
- 一个域名：`257823.xyz`
- 这个项目的 GitHub 仓库地址：
  `https://github.com/koajsj/onlieencryptedmsgweb.git`
- 你可以 SSH 登录服务器（有 sudo 权限）

---

## 1. 第一次部署（从 0 到可访问）

### 第 1 步：登录服务器

```bash
ssh root@你的服务器IP
```

如果你不是 root，就用你自己的用户登录，后面命令前面加 `sudo`。

### 第 2 步：安装 Node.js 18+、Git、Caddy

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

检查版本：

```bash
node -v
npm -v
git --version
caddy version
```

### 第 3 步：拉代码到服务器

```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/koajsj/onlieencryptedmsgweb.git
cd onlieencryptedmsgweb
```

### 第 4 步：安装依赖并构建

```bash
npm install
npm run build
```

### 第 5 步：创建 systemd 服务（让它后台常驻）

新建服务文件：

```bash
nano /etc/systemd/system/secure-chat.service
```

粘贴下面内容：

```ini
[Unit]
Description=Encrypted Chat Web
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/onlieencryptedmsgweb
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=TRUST_PROXY=1
Environment=TRUSTED_ORIGINS=https://257823.xyz,https://www.257823.xyz
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

启动并设为开机自启：

```bash
systemctl daemon-reload
systemctl enable secure-chat
systemctl start secure-chat
systemctl status secure-chat
```

如果看到 `active (running)` 就是正常。

### 第 6 步：配置 Caddy 反向代理 + HTTPS

编辑 Caddy 配置：

```bash
nano /etc/caddy/Caddyfile
```

写成这样：

```caddy
257823.xyz, www.257823.xyz {
    reverse_proxy 127.0.0.1:3000
}
```

重载 Caddy：

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
systemctl status caddy
```

Caddy 会自动申请 HTTPS 证书。

### 第 7 步：在域名 DNS 里加解析

去你的 DNS 管理面板（比如 Cloudflare）：

- `A` 记录：`@` -> 你的服务器公网 IP
- `A` 记录：`www` -> 你的服务器公网 IP

等解析生效后访问：

- `https://257823.xyz`
- `https://www.257823.xyz`

---

## 2. 以后如何更新到最新仓库代码

每次你改完代码并推到 GitHub 后，服务器只要跑下面这几步。

```bash
cd /var/www/onlieencryptedmsgweb
git pull --ff-only origin main
npm install
npm run build
systemctl restart secure-chat
systemctl status secure-chat --no-pager
```

就这么简单。

如果你只改了前端静态文件，也建议照样跑一遍 `npm run build`，避免线上文件不是最新压缩版本。

---

## 3. 常用排错命令（出问题先看这里）

看服务日志：

```bash
journalctl -u secure-chat -n 200 --no-pager
```

实时看日志：

```bash
journalctl -u secure-chat -f
```

看 Caddy 日志：

```bash
journalctl -u caddy -n 200 --no-pager
```

看 3000 端口是否监听：

```bash
ss -lntp | grep 3000
```

---

## 4. 一句话总结

- 第一次部署：装环境 -> 拉代码 -> build -> systemd 启服务 -> Caddy 绑域名和 HTTPS。
- 日常更新：`git pull` -> `npm install` -> `npm run build` -> `systemctl restart`。
