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

## Debian 服务器 + 域名 部署指南（大白话版）

想让任何人在外网通过手机或电脑访问这个聊天室，你需要一台云服务器和一个绑定好 HTTPS 的域名（因为苹果和安卓手机要求必须有 HTTPS，否则没法使用加密功能）。

下面这是给新手看的简易教程：

### 1. 准备工作

- **一台云服务器**：系统选择 `Debian`（Ubuntu 也可以）。
- **一个域名**：在域名提供商那里，把你的域名（比如 `chat.yourdomain.com`）解析（A记录）到这台云服务器的 IP 地址。
- 用 SSH 登录到你的云服务器。

### 2. 安装必要环境 (Node.js 和 Nginx)

在服务器命令行里一行行复制执行：

```bash
# 更新系统软件源
sudo apt update

# 安装 Nginx (用来做反向代理和 HTTPS，也就是外网网关)
sudo apt install nginx -y

# 安装 Node.js (用来跑我们这个聊天室的 server.js)
sudo apt install nodejs npm -y

# 安装 PM2 (一个后台运行工具，保证聊天室即便你关了命令行也不会停止)
sudo npm install -g pm2
```

### 3. 上传代码并启动聊天室

把这个项目的文件上传到服务器（比如传到 `/var/www/secure-chat` 文件夹中），然后在那个文件夹下操作：

```bash
# 进入代码目录
cd /var/www/secure-chat

# 安装所需要的依赖包然后进行构建 (也就是生成 min js/css)
npm install
npm run build

# 使用 PM2 启动服务（在后台跑起来，端口默认 3000）
pm2 start server.js --name "secure-chat"

# 保存 PM2 状态，让它开机自启
pm2 save
pm2 startup
```

### 4. 给域名配置 Nginx 并加锁 (HTTPS)

如果不用 HTTPS 是没法聊天的，最稳妥的是用 `Certbot` 来自动申请免费的安全证书。

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx -y
```

接着，我们要告诉 Nginx，把访问 `chat.yourdomain.com` 的请求全部交给里面的 3000 端口（我们的聊天室）：

```bash
# 创建或者编辑 Nginx 配置
sudo nano /etc/nginx/sites-available/secure-chat
```
粘贴下面的内容进去（**别忘了把 `chat.yourdomain.com` 换成你自己的域名**）：
```nginx
server {
    listen 80;
    server_name chat.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # 支持长连接 (SSE 必须需要这些配置)
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;
        proxy_buffering off;
        proxy_cache off;
    }
}
```
保存并退出配置后（按 `Ctrl+X`, 再按 `Y`, 然后回车确认）。

然后执行下面几个命令激活配置：
```bash
# 激活你的配置
sudo ln -s /etc/nginx/sites-available/secure-chat /etc/nginx/sites-enabled/

# 测试一下 Nginx 配置有没有写错
sudo nginx -t

# 重新加载 Nginx
sudo systemctl reload nginx
```

### 5. 申请免费域名的 HTTPS 证书

配置好上面的之后，执行这一句“一键加密”命令：
```bash
sudo certbot --nginx -d chat.yourdomain.com
```
它会问你邮箱用来接收证书到期提醒，并问你是否强制将 HTTP 跳转 HTTPS（选 2 强制跳转即可）。

**搞定！** 现在你就可以在浏览器里访问 `https://chat.yourdomain.com`，拉上小伙伴愉快地加密聊天了。

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
