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

## 1. 一键自动部署

第一次部署只跑这一条，下面所有部署命令都已经拆成单行，直接复制即可，不需要手工编辑 `Caddyfile`，也不需要输入任何交互内容：

```bash
sudo bash scripts/deploy-debian.sh
```

脚本会自动完成这些事：

- 安装 Node.js 20、Git、Caddy
- 拉取或更新仓库代码
- 安装依赖并执行构建
- 把站点配置自动写入 `/etc/caddy/Caddyfile`
- 把应用注册成 `systemd` 服务
- 把运行数据放到 `/var/lib/secure-chat/data`，避免更新代码时污染仓库
- 重载并启动 `caddy` 和 `secure-chat`

默认域名已经写死为：

- `257823.xyz`
- `www.257823.xyz`

如果你要换域名，不用手改文件，直接在执行前一次性带环境变量即可：

```bash
DOMAIN=你的域名 WWW_DOMAIN=www.你的域名 sudo bash scripts/deploy-debian.sh
```

DNS 里仍然需要把域名解析到服务器公网 IP：

- `A` 记录：`@` -> 服务器公网 IP
- `A` 记录：`www` -> 服务器公网 IP

解析生效后访问：

- `https://257823.xyz`
- `https://www.257823.xyz`

---

## 2. 以后如何更新到最新仓库代码

更新时同样只跑这一条，命令也是单行可直接复制：

```bash
sudo bash scripts/deploy-debian.sh
```

脚本会自动 `git pull --ff-only`，重新安装依赖，重新构建，再重启服务。

如果你只改了前端静态文件，脚本也会照样重新构建，避免线上文件不是最新压缩版本。
现在 `npm start` 会自动检查构建产物是否过期；如果报错，脚本会在部署阶段先补齐构建产物。

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

- 第一次部署：`sudo bash scripts/deploy-debian.sh`
- 日常更新：`sudo bash scripts/deploy-debian.sh`

---

## 5. 内部后台

- 后台页面仍然是 `https://你的域名/admin.html`
- 主站页面不再提供可见后台入口
- 账号密码：由服务器环境变量 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 控制
- 支持：站点统计、用户列表筛选分页、批量封禁/解封、改用户名、改密码、查看全站聊天审计、审计日志链路、水印导出
