# 在线加密聊天网站部署说明

适用环境：Debian 12、Node.js 20、已有反向代理或面板环境。

## 管理员账号

管理员用户名来自服务器环境变量 `ADMIN_USERNAME`。

管理员密码不会保存在仓库中，也不会在部署脚本执行完成后明文回显。首次部署时脚本会在服务器上提示输入密码，只把 `scrypt` 哈希写入 `/etc/default/secure-chat`。

后台地址：

```text
https://你的域名/admin.html
```

## 1. 准备服务器

需要：

- Debian 12 云服务器
- 可以 SSH 登录服务器，并且有 `sudo` 权限
- 服务器上已经有你自己的反向代理、网站面板或网关
- 该上游代理可以转发到 `127.0.0.1:3000`

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

## 2. 首次部署

脚本默认只启动 Node 服务，绑定到 `127.0.0.1:3000`，不会安装 Caddy，也不会占用 `80/443`。

直接执行：

```bash
sudo bash scripts/deploy-debian.sh
```

如果你要改端口或用户名：

```bash
APP_PORT=3100 ADMIN_USERNAME=siteadmin sudo -E bash scripts/deploy-debian.sh
```

脚本会自动完成：

- 安装 Node.js 20、Git
- 拉取或更新仓库
- 安装依赖并构建前端压缩文件
- 写入 `/etc/systemd/system/secure-chat.service`
- 写入 `/etc/default/secure-chat`
- 把运行数据放到 `/var/lib/secure-chat/data`
- 启动并启用 `secure-chat`

首次部署过程中会提示你在服务器终端里输入管理员密码，两次确认后只保存哈希。

## 3. 配置反向代理

本项目默认监听：

```text
127.0.0.1:3000
```

你可以在现有 Nginx、Caddy、宝塔、1Panel 或其他网关里，把域名反代到这个地址。

Nginx 示例：

```nginx
server {
    listen 443 ssl http2;
    server_name example.com www.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
    }
}
```

说明：

- 不要把仓库里的脚本再改成监听 `0.0.0.0:443`
- 反代层需要保留 `Host` 和 `X-Forwarded-*` 请求头
- SSE 已启用，反代层不要打开响应缓冲

## 4. 日常更新

以后更新代码，在服务器执行：

```bash
cd /var/www/onlieencryptedmsgweb
sudo bash scripts/deploy-debian.sh
```

更新时脚本会复用已有 `/etc/default/secure-chat`，不会再次要求输入管理员密码，也不会覆盖已有管理员哈希。

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

看监听端口：

```bash
ss -lntp | grep 3000
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

## 7. 本地开发

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
