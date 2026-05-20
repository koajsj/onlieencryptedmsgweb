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
