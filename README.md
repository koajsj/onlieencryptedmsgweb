# 私聊消息

一个基于 Node.js 和浏览器 Web Crypto 的一对一私聊站点。用户只输入唯一用户名和密码即可注册或登录，密钥生成、私钥加密保存、消息发送与服务端加密存储都由程序自动完成。

## 当前功能

- 用户名 + 密码注册
- 用户名唯一校验
- 登录后搜索任意用户并发起私聊
- 聊天列表、在线状态、实时消息推送
- 桌面端和手机端适配
- 消息由服务器自动加密存储

## 消息加密与存储设计

1. 注册时，浏览器自动生成一组 `ECDH P-256` 密钥。
2. 私钥不会明文上传。浏览器会先用用户密码经 `PBKDF2-SHA-256` 派生出的密钥，将私钥用 `AES-256-GCM` 加密后再上传。
3. 服务端只保存：
   - 账号名
   - 密码哈希
   - 公钥
   - 加密后的私钥包
   - 加密后的消息信封
4. 私聊时，浏览器根据双方公私钥自动协商共享密钥，再用 `HKDF-SHA-256` 派生聊天密钥。
5. 消息正文以明文发送到服务端，服务端会自动使用 `AES-256-GCM` 加密后再落盘保存，并在接口返回时还原为明文。

## 服务端保存的内容

- `data/users.json`
  - 用户名
  - 用户名索引
  - 密码哈希
  - 公钥
  - 加密私钥包
- `data/messages.json`
  - 发送方
  - 接收方
  - `nonce`
  - `ciphertext`
  - 时间戳

这两个文件默认已加入 `.gitignore`，不会上传到仓库。

## 本地运行

```powershell
cd C:\Users\Administrator\Desktop\在线加密聊天网站
npm.cmd install
npm.cmd run build
npm.cmd start
```

打开 `http://127.0.0.1:3000/`。

## 检查与测试

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

## 部署说明

- 需要 Node.js `>=18`
- 启动命令：`npm start`
- 可选环境变量：
  - `PORT`
  - `HOST`
  - `DATA_DIR`
  - `TRUST_PROXY=1`
  - `TRUSTED_ORIGINS=https://你的域名`
- 生产环境必须使用 HTTPS，否则浏览器不会开放完整的 Web Crypto 安全上下文
- 该项目依赖 `server.js` 的 API 和 SSE，不能只部署到 GitHub Pages

## 服务器 + 域名 + Cloudflare 部署

下面以域名 `257823.xyz`、Cloudflare 和一台 Linux 服务器为例说明部署流程。

### 1. 服务器准备

1. 安装 Node.js `>=18` 和 Git。
2. 将项目克隆到服务器，例如：

```bash
git clone https://github.com/koajsj/onlieencryptedmsgweb.git
cd onlieencryptedmsgweb
npm install
npm run build
```

3. 先本地启动确认无误：

```bash
npm start
```

默认服务会监听 `3000` 端口。

### 2. 配置 Cloudflare 域名

1. 将 `257823.xyz` 添加到 Cloudflare。
2. 在域名注册商处把 NS 记录改为 Cloudflare 提供的名称服务器。
3. 在 Cloudflare 的 DNS 中新增记录：
   - `A` 记录：`@` -> 服务器公网 IP
   - `A` 记录：`www` -> 服务器公网 IP
4. 如果想让 Cloudflare 代理流量，可以把记录右侧的云朵打开。

### 3. 使用 Caddy 反向代理

推荐使用 Caddy 把 80/443 请求转发到 Node.js 的 `3000` 端口。Caddy 可以自动申请和续期 HTTPS 证书，配置也更简单。

安装好 Caddy 后，创建 `Caddyfile`：

```caddy
257823.xyz, www.257823.xyz {
  reverse_proxy 127.0.0.1:3000
}
```

如果你希望 Caddy 只处理回源代理，并且证书由 Cloudflare 接管，也可以在 Cloudflare 里把 SSL/TLS 模式设置为 **Full** 或 **Full (strict)**。

如果项目放在 Cloudflare 代理后面，建议在启动前设置：

```bash
export TRUST_PROXY=1
export TRUSTED_ORIGINS=https://257823.xyz,https://www.257823.xyz
```

如需指定监听地址和端口，也可以设置：

```bash
export HOST=127.0.0.1
export PORT=3000
```

### 4. HTTPS 与访问

1. 让 Caddy 自动申请证书，或使用 Cloudflare Origin Certificate 作为回源证书。
2. 完成后访问：
   - `https://257823.xyz`
   - `https://www.257823.xyz`

### 5. 建议使用进程守护

可以使用 PM2、systemd、Docker 或其他守护工具保持服务常驻。下面给出一个 systemd 示例，适合 Caddy + Node.js 的部署方式。

创建服务文件：

```bash
sudo nano /etc/systemd/system/secure-chat.service
```

写入内容：

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

然后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable secure-chat
sudo systemctl start secure-chat
sudo systemctl status secure-chat
```

如果你更习惯 PM2，也可以继续使用 PM2。

### 6. 日常维护：如何更新服务器上的代码？

当 GitHub 上有了最新的代码升级（比如修复 Bug 或增加新功能）时，你不需要重装系统或重头来过。只需用 SSH 登录服务器，分四步依次执行以下命令就能无缝升级：

```bash
# 1. 进入你当初下载代码的文件夹（如果你之前是在默认路径下载的）
cd ~/onlieencryptedmsgweb

# 2. 从 GitHub 上获取并同步最新代码
git pull

# 3. 安装可能新增的依赖库，并重新构建项目压缩包
npm install
npm run build

# 4. 让后台管理工具重启你的聊天室，使最新代码立即生效
pm2 restart secure-chat
```

几秒钟后，你的网站就已经变成最新版了！

## 目录结构

```text
public/
  app.js
  app.min.js
  index.html
  styles.css
  styles.min.css
tests/
  e2e.test.js
data/
  .gitkeep
server.js
```

## 安全边界

这个项目实现的是服务端自动加密存储，但它不是经过审计的安全产品。上线前至少还应补充：

- 更严格的账号风控和限流策略
- 更完整的异常监控和日志治理
- 会话过期和多设备策略
- 第三方安全审计
