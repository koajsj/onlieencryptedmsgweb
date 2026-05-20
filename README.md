# 私聊消息

一个基于 Node.js 和浏览器 Web Crypto 的一对一私聊站点。用户只输入唯一用户名和密码即可注册或登录，密钥生成、私钥加密保存、消息加密、消息解密都由程序自动完成。

## 当前功能

- 用户名 + 密码注册
- 用户名唯一校验
- 登录后搜索任意用户并发起私聊
- 聊天列表、在线状态、实时消息推送
- 桌面端和手机端适配
- 浏览器端自动端到端加密

## 端到端加密设计

1. 注册时，浏览器自动生成一组 `ECDH P-256` 密钥。
2. 私钥不会明文上传。浏览器会先用用户密码经 `PBKDF2-SHA-256` 派生出的密钥，将私钥用 `AES-256-GCM` 加密后再上传。
3. 服务端只保存：
   - 账号名
   - 密码哈希
   - 公钥
   - 加密后的私钥包
   - 加密后的消息信封
4. 私聊时，浏览器根据双方公私钥自动协商共享密钥，再用 `HKDF-SHA-256` 派生聊天密钥。
5. 消息正文在浏览器内使用 `AES-256-GCM` 加密后才发送，服务端不会接触消息明文。

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

这个项目实现的是浏览器侧自动端到端加密，但它不是经过审计的安全产品。上线前至少还应补充：

- 更严格的账号风控和限流策略
- 更完整的异常监控和日志治理
- 会话过期和多设备策略
- 第三方安全审计
