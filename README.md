# 在线加密聊天网站

轻量的浏览器端到端加密聊天，服务端只提供静态页面、SSE 长连接和密文转发，不保存聊天记录，也不接触明文。

## 运行

```powershell
cd C:\Users\Administrator\Desktop\在线加密聊天网站
npm.cmd start
```

打开 `http://localhost:3000`。同一房间最多 2 人，双方输入相同房间号和口令后进入，并核对安全码。

## 验证

```powershell
npm.cmd run check
npm.cmd test
```

## 说明

- 浏览器端使用 ECDH P-256、PBKDF2、HKDF 和 AES-256-GCM。
- 聊天、编辑、删除、已读、输入状态和在线状态均走加密认证信令。
- 本地记录以口令派生密钥加密后保存。
- 外网或手机访问必须使用 HTTPS；GitHub Pages 不能单独运行实时聊天，因为需要 `server.js`。

## 极简自建部署指南（拥有自己的服务器和域名）

如果你拥有自己的服务器和域名，但觉得手动配置 Nginx 和申请 HTTPS 证书太长、太复杂，强烈推荐使用 **Caddy** 替代 Nginx。

**Caddy 是什么？** 它是目前最适合小白的 Web 服务器，能**全自动为你申请和续期 HTTPS 证书**，而且天生支持实时长连接，完全不需要写一堆复杂的配置代码！

### 1. 准备工作

- 把你的域名 `257823.xyz` 在 DNS 里解析（添加 A 记录）到你云服务器的 IP 地址。
- 用 SSH 登录到你的云服务器（Debian / Ubuntu）。

### 2. 下载代码并后台运行

复制执行以下命令来安装 Node 运行环境并启动代码：

```bash
# 1. 安装 Node.js 和后台管理工具 PM2
sudo apt update
sudo apt install nodejs npm -y
sudo npm install -g pm2

# 2. 进入你上传代码的目录（假设你传到了 /var/www/secure-chat）
cd /var/www/secure-chat

# 3. 安装依赖并构建压缩文件
npm install
npm run build

# 4. 让聊天室在后台永久运行
pm2 start server.js --name "secure-chat"
pm2 save
pm2 startup
```

### 3. 安装 Caddy 并自动配置 HTTPS

执行官方这三段命令来安装 Caddy：

```bash
# 安装基础依赖
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https

# 添加 Caddy 下载源
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list

# 安装 Caddy
sudo apt update && sudo apt install caddy
```

### 4. 三行配置搞定外网访问！

使用简单编辑器打开 Caddy 的配置文件：
```bash
sudo nano /etc/caddy/Caddyfile
```
**清空里面的所有内容**，只写下面这三行：
```text
257823.xyz {
    reverse_proxy localhost:3000
}
```
保存并退出（按 `Ctrl+X`，按 `Y`，再按 `Enter`）。

最后，重启 Caddy 让配置生效：
```bash
sudo systemctl restart caddy
```

**恭喜你，大功告成！🎉** 
现在 Caddy 已经在后台秒速帮你申请好了免费的绿色安全锁（HTTPS），直接在浏览器打开 `https://257823.xyz` 就可以和朋友进行安全加密聊天了！

### 附：如何将域名托管到 Cloudflare（强烈推荐）

不管你在哪里买的域名（阿里云、腾讯云、NameSilo 等），都非常建议将域名的 DNS 解析托管给 **Cloudflare**（全球最大的免费网络服务商），解析生效极快且免费防攻击。流程如下：

1. **注册账号**：访问 [Cloudflare](https://www.cloudflare.com/zh-cn/) 注册一个免费账号。
2. **添加站点**：登录后，点击 **添加站点 (Add a Site)**，填入你的域名 `257823.xyz`，然后选择最底下的 **Free（免费）计划**。
3. **添加解析记录 (A记录)**：
   - 类型 (Type)：选 `A`
   - 名称 (Name)：填 `@` （代表 `257823.xyz` 本身）
   - IPv4 地址：填你云服务器的公网 IP。
   - **⚠️ 关键一步：** 代理状态 (Proxy status) 默认是一朵亮起的黄色的云（Proxied）。请**点击它变成灰色的云 (DNS Only)**。因为我们的 Caddy 会自动申请 HTTPS 证书，如果不把它点灰，两边都搞加密会产生冲突。
   - 点击保存。
4. **修改域名服务器 (Nameservers)**：
   Cloudflare 此时会提供给你两个 DNS 服务器地址（比如 `ella.ns.cloudflare.com` 和 `adam.ns.cloudflare.com`）。
   - 登录你**买域名的地方**（比如阿里云后台）。
   - 找到关于 `257823.xyz` 的“去更改 DNS 服务器 / 自定义 DNS”设置。
   - 把原来的 DNS 删掉，替换成 Cloudflare 给你的这两个地址。
5. **等待生效**：在这个页面点击“检查名称服务器”，一般十几分钟内就会收到邮件提示托管成功！

> **小白提示**：如果你对命令行存在恐惧，不介意多耗费一点服务器资源的话，最简单的方式是直接给服务器安装一个可视化管理面板（比如 [宝塔面板](https://www.bt.cn/) 或 [1Panel](https://1panel.cn/) ），只需要在浏览器里点点鼠标，就可以建站、代理、申请证书了。

## 更简单的方法：使用云平台（零服务器零配置）

如果你不想弄服务器，也不想搞命令行、装 Nginx、申请域名证书等这些繁琐的步骤。最简单的方法是使用能够直接托管 GitHub 代码的 **PaaS 云平台**（比如 Render、Koyeb、Railway 等）。它们会**自动**分配免费域名并自带 HTTPS 加密。

这里以 **Render** 为例（完全免费，极其适合新手）：

1. **准备代码**：确保你已经把这个仓库 `fork` （派生）到了你自己的 GitHub 账号下。
2. **注册账号**：访问 [Render.com](https://render.com/)，使用你的 GitHub 账号一键授权登录。
3. **新建服务**：点击面板右上角的 `New` -> 选择 `Web Service`。
4. **连接仓库**：在列表中找到你刚才放到自己账号下的那个聊天室仓库，点击 `Connect`。
5. **填写简单配置**：
   - Name: 随便起个名字 (比如 `my-secure-chat`)
   - Environment: 选 `Node`
   - Build Command (构建命令): 填 `npm install && npm run build`
   - Start Command (启动命令): 填 `npm start`
6. **点击部署**：选免费套餐 (Free tier)，点击 `Deploy Web Service`。

**只要等 1-2 分钟代码自动构建完毕，Render 就会在左上角提供给你一个免费自带 HTTPS 的网址（比如 `https://my-secure-chat.onrender.com`），发给朋友直接就能用啦！** 完全不需要懂修电脑和敲命令行！
