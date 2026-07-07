"use strict";

const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_PATH = path.join(ROOT_DIR, "server.js");
const APP_SOURCE = path.join(ROOT_DIR, "public", "app.js");
const UI_UTILS_SOURCE = path.join(ROOT_DIR, "public", "ui-utils.js");
const ADMIN_SOURCE = path.join(ROOT_DIR, "public", "admin.js");
const ADMIN_USER_SOURCE = path.join(ROOT_DIR, "public", "admin-user.js");
const ACCOUNT_ROUTES_SOURCE = path.join(ROOT_DIR, "routes", "account-routes.js");
const ADMIN_ROUTES_SOURCE = path.join(ROOT_DIR, "routes", "admin-routes.js");
const CONTACT_ROUTES_SOURCE = path.join(ROOT_DIR, "routes", "contact-routes.js");
const EVENT_ROUTES_SOURCE = path.join(ROOT_DIR, "routes", "event-routes.js");
const MESSAGE_ROUTES_SOURCE = path.join(ROOT_DIR, "routes", "message-routes.js");
const SUPPORT_ROUTES_SOURCE = path.join(ROOT_DIR, "routes", "support-routes.js");
const INDEX_HTML = path.join(ROOT_DIR, "public", "index.html");
const ADMIN_HTML = path.join(ROOT_DIR, "public", "admin.html");
const ADMIN_USER_HTML = path.join(ROOT_DIR, "public", "admin-user.html");
const CONFIG_SOURCE = path.join(ROOT_DIR, "config.js");
const NORMALIZE_SOURCE = path.join(ROOT_DIR, "utils", "normalize.js");
const GITIGNORE_FILE = path.join(ROOT_DIR, ".gitignore");
const ACCESS_LOG_MIDDLEWARE = path.join(ROOT_DIR, "middleware", "access-log.js");
const REALTIME_HUB_SOURCE = path.join(ROOT_DIR, "services", "realtime-hub.js");
const MESSAGE_STORE_SOURCE = path.join(ROOT_DIR, "services", "message-store.js");
const DEPLOY_SCRIPT = path.join(ROOT_DIR, "scripts", "deploy-debian.sh");
const UPDATE_SCRIPT = path.join(ROOT_DIR, "scripts", "update-debian.sh");
const BOOTSTRAP_UPDATE_SCRIPT = path.join(ROOT_DIR, "scripts", "bootstrap-update-debian.sh");
const MESSAGE_KEY_INFO = "private-chat-message-key-v1";
const KEY_BUNDLE_ITERATIONS = 210000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const webcrypto = nodeCrypto.webcrypto;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function extractCookiePair(header, cookieName) {
  const value = String(header || "");
  const match = value.match(new RegExp(`${cookieName}=([^;]+)`));
  return match ? `${cookieName}=${match[1]}` : "";
}

async function waitForHealth(port, child, stdoutChunks, stderrChunks) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`server exited with code ${child.exitCode}\n${stderrChunks.join("") || stdoutChunks.join("")}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      // Keep polling until the process is ready or exits.
    }
    await delay(100);
  }
  throw new Error(`server did not become healthy\n${stderrChunks.join("") || stdoutChunks.join("")}`);
}

async function startServer(extraEnv = {}) {
  const port = await getFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "secure-chat-e2e-"));
  fs.writeFileSync(path.join(dataDir, "users.json"), "[]", "utf8");
  fs.writeFileSync(path.join(dataDir, "messages.json"), "[]", "utf8");
  fs.writeFileSync(path.join(dataDir, "messages.jsonl"), "", "utf8");
  fs.writeFileSync(path.join(dataDir, "admin_audit.jsonl"), "", "utf8");

  const stdoutChunks = [];
  const stderrChunks = [];
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_DIR: dataDir,
      ENABLE_ACCESS_LOG: "0",
      COOKIE_SECURE: "0",
      NODE_ENV: "test",
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => stdoutChunks.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));

  await waitForHealth(port, child, stdoutChunks, stderrChunks);

  return {
    port,
    dataDir,
    child,
    async stop() {
      if (child.exitCode !== null) {
        fs.rmSync(dataDir, { recursive: true, force: true });
        return;
      }
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

async function requestJson(port, pathname, { method = "GET", body, session, headers: extraHeaders } = {}) {
  const headers = {
    Accept: "application/json"
  };
  if (session?.cookie) {
    headers.Cookie = session.cookie;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (!["GET", "HEAD"].includes(method) && session?.csrfToken) {
    headers["X-CSRF-Token"] = session.csrfToken;
  }
  if (extraHeaders && typeof extraHeaders === "object") {
    Object.assign(headers, extraHeaders);
  }

  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  const nextSession = session ? { ...session } : { cookie: "", csrfToken: "" };
  const setCookie = response.headers.get("set-cookie") || "";
  const cookie = extractCookiePair(setCookie, "secure_chat_session") || extractCookiePair(setCookie, "secure_chat_admin_session");
  if (cookie) {
    nextSession.cookie = cookie;
  }
  if (typeof payload?.csrfToken === "string" && payload.csrfToken) {
    nextSession.csrfToken = payload.csrfToken;
  }
  return {
    status: response.status,
    json: payload,
    session: nextSession
  };
}

function parseSseBlock(block) {
  const lines = String(block || "").replace(/\r/g, "").split("\n");
  let event = "message";
  const dataLines = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim() || event;
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  const rawData = dataLines.join("\n");
  let data = rawData;
  try {
    data = JSON.parse(rawData);
  } catch (error) {
    // Keep non-JSON SSE payloads readable to assertions.
  }
  return { event, data };
}

async function openEventStream(port, session) {
  const ticketResponse = await requestJson(port, "/api/events/token", {
    method: "POST",
    session
  });
  assert.equal(ticketResponse.status, 200);
  assert.ok(ticketResponse.json.ticket);

  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${port}/api/events?ticket=${encodeURIComponent(ticketResponse.json.ticket)}`, {
    headers: { Accept: "text/event-stream" },
    signal: controller.signal
  });
  assert.equal(response.status, 200);
  assert.ok(response.body);

  const events = [];
  const waiters = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  function resolveWaiters(sseEvent) {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter.eventName !== sseEvent.event || !waiter.predicate(sseEvent.data)) {
        continue;
      }
      waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(sseEvent.data);
    }
  }

  const pump = (async () => {
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let delimiter = buffer.indexOf("\n\n");
        while (delimiter >= 0) {
          const parsed = parseSseBlock(buffer.slice(0, delimiter));
          buffer = buffer.slice(delimiter + 2);
          if (parsed) {
            events.push(parsed);
            resolveWaiters(parsed);
          }
          delimiter = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        throw error;
      }
    }
  })();

  return {
    events,
    waitForEvent(eventName, predicate = () => true, timeoutMs = 2000) {
      const existing = events.find((entry) => entry.event === eventName && predicate(entry.data));
      if (existing) {
        return Promise.resolve(existing.data);
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          eventName,
          predicate,
          resolve,
          reject,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) {
              waiters.splice(index, 1);
            }
            reject(new Error(`timed out waiting for ${eventName}`));
          }, timeoutMs)
        };
        waiters.push(waiter);
      });
    },
    async close() {
      controller.abort();
      try {
        await reader.cancel();
      } catch (error) {
        // The abort path may already have closed the stream.
      }
      await pump.catch(() => {});
    }
  };
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value) {
  return Buffer.from(value, "base64");
}

async function createIdentity() {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const publicKeyRaw = new Uint8Array(await webcrypto.subtle.exportKey("raw", keyPair.publicKey));
  const privateKeyPkcs8 = new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyBase64: bytesToBase64(publicKeyRaw),
    privateKeyPkcs8Base64: bytesToBase64(privateKeyPkcs8)
  };
}

async function createKeyBundle(identity, password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const material = await webcrypto.subtle.importKey(
    "raw",
    textEncoder.encode(String(password || "")),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await webcrypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: KEY_BUNDLE_ITERATIONS
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const ciphertext = await webcrypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv
    },
    key,
    base64ToBytes(identity.privateKeyPkcs8Base64)
  );
  return {
    version: 1,
    iterations: KEY_BUNDLE_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

async function decryptKeyBundle(keyBundle, password) {
  const material = await webcrypto.subtle.importKey(
    "raw",
    textEncoder.encode(String(password || "")),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await webcrypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64ToBytes(keyBundle.salt),
      iterations: keyBundle.iterations
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const plaintext = await webcrypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(keyBundle.iv)
    },
    key,
    base64ToBytes(keyBundle.ciphertext)
  );
  return bytesToBase64(new Uint8Array(plaintext));
}

async function importPublicKey(publicKeyBase64) {
  return webcrypto.subtle.importKey(
    "raw",
    base64ToBytes(publicKeyBase64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
}

async function deriveMessageKey(selfIdentity, selfUsername, peerUsername, peerPublicKeyBase64) {
  const peerPublicKey = await importPublicKey(peerPublicKeyBase64);
  const sharedSecret = await webcrypto.subtle.deriveBits(
    { name: "ECDH", public: peerPublicKey },
    selfIdentity.privateKey,
    256
  );
  const hkdfKey = await webcrypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  const participants = [selfUsername, peerUsername].sort().join(":");
  const keyBinding = [selfIdentity.publicKeyBase64, peerPublicKeyBase64].sort().join(":");
  const salt = await webcrypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(`${participants}|${keyBinding}|private-chat-v1`)
  );
  return webcrypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: textEncoder.encode(MESSAGE_KEY_INFO)
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function aadBytes(from, to) {
  return textEncoder.encode(JSON.stringify({ from, to }));
}

async function encryptMessage(selfIdentity, selfUsername, peerUsername, peerPublicKeyBase64, plaintext, nonceFill = 7) {
  const key = await deriveMessageKey(selfIdentity, selfUsername, peerUsername, peerPublicKeyBase64);
  const nonce = new Uint8Array(12);
  nonce.fill(nonceFill);
  const ciphertext = await webcrypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: aadBytes(selfUsername, peerUsername)
    },
    key,
    textEncoder.encode(plaintext)
  );
  return {
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

async function decryptMessage(selfIdentity, selfUsername, peerUsername, peerPublicKeyBase64, payload) {
  const key = await deriveMessageKey(selfIdentity, selfUsername, peerUsername, peerPublicKeyBase64);
  const plaintext = await webcrypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(payload.nonce),
      additionalData: aadBytes(payload.from, payload.to)
    },
    key,
    base64ToBytes(payload.ciphertext)
  );
  return textDecoder.decode(plaintext);
}

test("browser client restores password-encrypted key bundles without reviving legacy private-key fields", () => {
  const appSource = fs.readFileSync(APP_SOURCE, "utf8");
  const adminUserSource = fs.readFileSync(ADMIN_USER_SOURCE, "utf8");
  const configSource = fs.readFileSync(CONFIG_SOURCE, "utf8");
  const accessLogMiddleware = fs.readFileSync(ACCESS_LOG_MIDDLEWARE, "utf8");
  const realtimeHubSource = fs.readFileSync(REALTIME_HUB_SOURCE, "utf8");
  const messageStoreSource = fs.readFileSync(MESSAGE_STORE_SOURCE, "utf8");
  const routeSources = [
    ACCOUNT_ROUTES_SOURCE,
    ADMIN_ROUTES_SOURCE,
    CONTACT_ROUTES_SOURCE,
    EVENT_ROUTES_SOURCE,
    MESSAGE_ROUTES_SOURCE,
    SUPPORT_ROUTES_SOURCE
  ].map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(appSource, /encryptedPrivateKey/);
  assert.doesNotMatch(appSource, /privateKeySalt/);
  assert.doesNotMatch(appSource, /privateKeyIv/);
  assert.match(appSource, /buildPortableKeyBundle/);
  assert.match(appSource, /restoreIdentityFromPortableBundle/);
  assert.match(appSource, /window\.indexedDB\.open/);
  assert.match(appSource, /writeDeviceVaultRecord/);
  assert.match(appSource, /privateKeyPkcs8Ciphertext/);
  assert.match(appSource, /encryptLocalPrivateKeyExport/);
  assert.match(appSource, /decryptLocalPrivateKeyExport/);
  assert.doesNotMatch(appSource, /privateKeyPkcs8Base64: String\(identity\.privateKeyPkcs8Base64/);
  assert.match(appSource, /\/api\/me\/key-bundle/);
  assert.match(appSource, /publicKey:\s*identity\.publicKeyBase64/);
  assert.match(appSource, /deleteScopedStorageRecord\(STORAGE\.deviceIdentities/);
  assert.match(appSource, /realtimeTakeoverPaused/);
  assert.match(appSource, /账号已在其他设备上线/);
  assert.doesNotMatch(appSource, /同一账号可多端进入/);
  assert.doesNotMatch(adminUserSource, /encryptedPrivateKey|privateKeySalt|privateKeyIv/);
  assert.match(adminUserSource, /privateKeyStoredOnServer/);
  assert.doesNotMatch(configSource, /PRIVATE_KEY_SALT_BYTES|PRIVATE_KEY_IV_BYTES|ENCRYPTED_PRIVATE_KEY_BYTES/);
  assert.match(configSource, /MAX_CONCURRENT_EVENT_CONNECTIONS_PER_USER \|\| "1"/);
  assert.match(accessLogMiddleware, /ACCESS_SESSION_MAX_AGE_SECONDS = 30 \* 24 \* 60 \* 60/);
  assert.match(realtimeHubSource, /signed in on another device/);
  assert.doesNotMatch(messageStoreSource, /text: typeof replyTo\.text === "string"/);
  assert.doesNotMatch(routeSources, /\$\{address\}/);
  assert.doesNotMatch(routeSources, /ticketRecord\.address/);
  assert.match(fs.readFileSync(path.join(ROOT_DIR, "utils", "data.js"), "utf8"), /mode: 0o600/);
  assert.match(fs.readFileSync(SERVER_PATH, "utf8"), /fs\.chmodSync\(DATA_DIR, 0o700\)/);
});

test("browser client keeps static HTML chrome readable", () => {
  const pages = [
    [INDEX_HTML, "进入私密会话"],
    [ADMIN_HTML, "管理员登录"],
    [ADMIN_USER_HTML, "用户详情"]
  ];
  const mojibakeMarkers = [
    "\ufffd",
    "\u951f\u65a4\u62f7",
    "\u9435",
    "\u95ab",
    "\u675e\u6d98",
    "\u7ee0\u6b12"
  ];
  for (const [file, expectedText] of pages) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, new RegExp(expectedText));
    for (const marker of mojibakeMarkers) {
      assert.equal(source.includes(marker), false, `${path.basename(file)} contains mojibake marker ${marker}`);
    }
  }
});

test("client guards duplicate sends and mobile viewport resizing", () => {
  const appSource = fs.readFileSync(APP_SOURCE, "utf8");
  const uiUtilsSource = fs.readFileSync(UI_UTILS_SOURCE, "utf8");
  const adminSource = fs.readFileSync(ADMIN_SOURCE, "utf8");
  const adminUserSource = fs.readFileSync(ADMIN_USER_SOURCE, "utf8");
  const closeEventStreamBody = appSource.slice(
    appSource.indexOf("function closeEventStream"),
    appSource.indexOf("function clearSession")
  );
  assert.match(appSource, /function setSubmitInFlight/);
  assert.match(appSource, /outboundInFlight: new Set\(\)/);
  assert.match(appSource, /state\.outboundInFlight\.has\(tempId\)/);
  assert.match(appSource, /state\.outboundInFlight\.delete\(tempId\)/);
  assert.match(appSource, /state\.outboundInFlight\.clear\(\)/);
  assert.match(appSource, /pending\.sendStatus === "sending" \|\| state\.outboundInFlight\.has\(tempId\)/);
  assert.match(appSource, /state\.submitInFlight \|\| !state\.activePeer \|\| blocked/);
  assert.match(appSource, /setAttribute\("aria-busy", "true"\)/);
  assert.match(appSource, /setAttribute\("aria-label", "正在发送消息"\)/);
  assert.match(appSource, /\.finally\(\(\) => setSubmitInFlight\(false\)\)/);
  assert.doesNotMatch(appSource, /window\.setTimeout\(\(\) => \{\s*state\.submitInFlight = false/);
  assert.match(appSource, /function scheduleViewportOnlySync/);
  assert.match(appSource, /const viewportChanged = syncViewportHeight\(\);[\s\S]*if \(!viewportChanged\) \{[\s\S]*return;/);
  assert.match(appSource, /visualViewport\?\.\addEventListener\("resize", scheduleViewportOnlySync\)/);
  assert.match(appSource, /document\.activeElement !== elements\.messageInput/);
  assert.doesNotMatch(appSource, /document\.activeElement === elements\.messageInput && state\.activePeer\) \{\s*scrollMessagesToBottom\(false\)/);
  assert.doesNotMatch(closeEventStreamBody, /manualEventSourceClose = false/);
  assert.match(appSource, /setComposerBusy\(false\);\s*syncReplyState\(\);/);
  assert.match(appSource, /const preservePrependedMessages = scrollBehavior === "preserve-prepend";/);
  assert.match(appSource, /if \(virtualWindow\) \{\s*elements\.messageList\.scrollTop = preservePrependedMessages && previousScrollHeight > 0[\s\S]*updateScrollBottomButton\(\);\s*return;/);
  assert.match(appSource, /const sliceStart = virtualWindow \? virtualWindow\.start : 0;/);
  assert.match(appSource, /let prevMessage = sliceStart > 0 \? visibleMessages\[sliceStart - 1\] : null;/);
  assert.match(appSource, /STORAGE\.peerSecurityMeta,[\s\S]*STORAGE\.peerKeyPins[\s\S]*renameScopedStorageOwner/);
  assert.match(appSource, /state\.peerSecurityMeta\[nextUsername\] = state\.peerSecurityMeta\[previousUsername\];[\s\S]*savePeerSecurityMeta\(\);/);
  assert.match(appSource, /state\.pendingMessages\.clear\(\);\s*state\.outboundInFlight\.clear\(\);\s*state\.contacts = \[\];\s*syncPendingMessagesFromOutbox\(\);\s*hydratePendingMessagesIntoCache\(\);/);
  assert.match(appSource, /if \(event\.key === "Escape" && document\.activeElement === elements\.messageInput\) \{\s*elements\.messageInput\.blur\(\);\s*return;/);
  assert.match(appSource, /title: "删除消息",[\s\S]*删除后仅会从当前账号的会话视图中移除。/);
  assert.match(appSource, /Math\.hypot\(touch\.clientX - state\.longPressTouchX, touch\.clientY - state\.longPressTouchY\)/);
  assert.match(appSource, /bundle\.capabilities\.zeroKnowledgeMessages !== true/);
  assert.match(appSource, /return bytes;\s*\}\s*function renderAttachmentTransfers/);
  assert.match(appSource, /const bytes = await validateAttachmentFile\(file\);[\s\S]*buildAttachmentMessageText\(file, bytes\)/);
  assert.match(appSource, /const batchReplyTarget = state\.replyTarget \? \{ \.\.\.state\.replyTarget \} : null;/);
  assert.match(appSource, /const replyTo = batchReplyTarget \? \{ \.\.\.batchReplyTarget \} : null;/);
  assert.match(appSource, /MAX_ATTACHMENT_BATCH_BYTES = 8 \* 1024 \* 1024/);
  assert.match(appSource, /function isAllowedAttachmentType\(type, ext\)/);
  assert.match(appSource, /deleteScopedStorageRecord\(STORAGE\.peerSecurityMeta, owner\);/);
  assert.match(appSource, /deleteScopedStorageRecord\(STORAGE\.peerKeyPins, owner\);/);
  assert.match(appSource, /sendAttachmentFiles\(input\?\.files\)[\s\S]*input\.value = ""/);
  assert.match(uiUtilsSource, /CLIENT_META_REFRESH_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(uiUtilsSource, /setItem\(CLIENT_META_SENT_STORAGE_KEY, String\(now\)\)/);
  assert.doesNotMatch(uiUtilsSource, /getItem\(CLIENT_META_SENT_STORAGE_KEY\) === "1"/);
  assert.match(adminSource, /window\.clearTimeout\(state\.toastTimer\)/);
  assert.match(adminUserSource, /formatIpLocation\(sessionItem\)/);
  assert.match(adminUserSource, /window\.clearTimeout\(state\.toastTimer\)/);
  assert.match(appSource, /消息会在本页联网后自动发送，刷新页面会丢失/);
  assert.match(appSource, /Offline retries stay in-memory only to avoid persisting plaintext locally/);
  assert.doesNotMatch(appSource, /elements\.authPasswordInput\.value\.trim\(\)/);
  assert.doesNotMatch(appSource, /password\.length < 4|密码长度需为 4-72 位|新密码至少需要 4 个字符/);
  assert.doesNotMatch(fs.readFileSync(ACCOUNT_ROUTES_SOURCE, "utf8"), /password\.length < 4|password must be 4-72 characters/);
  assert.doesNotMatch(appSource, /clearNotificationBadge\(\)/);
  assert.match(appSource, /document\.title = total > 0 \? `\(\$\{total > 99 \? "99\+" : total\}\) Echo` : "Echo";/);
  assert.match(appSource, /renderSidebar\(\);\s*updateNotificationBadge\(\);\s*renderThread\(\{ scrollBehavior: "bottom" \}\);/);
  assert.match(appSource, /renderSidebar\(\);\s*updateNotificationBadge\(\);\s*if \(state\.activePeer === peer\) \{/);
  assert.match(appSource, /function closeNotificationPanel\(\)/);
  assert.match(appSource, /function toggleNotificationPanel\(force, anchor = elements\.notificationBellButton\)/);
  assert.match(appSource, /window\.visualViewport\?\.addEventListener\("scroll", scheduleViewportOnlySync\)/);
  assert.match(appSource, /elements\.notificationBellButton\?\.addEventListener\("click"/);
  assert.match(appSource, /const \{ escapeHtml, formatDateTime, isElementNode, scheduleClientMetaReport \} = window\.EchoUi;/);
  assert.match(fs.readFileSync(NORMALIZE_SOURCE, "utf8"), /function normalizePassword\(value\) \{[\s\S]*return value;[\s\S]*\}/);
  assert.match(fs.readFileSync(GITIGNORE_FILE, "utf8"), /data\/\*\.txt/);
});

test("browser client recall flow waits for the server and server source stays free of redaction mojibake", () => {
  const appSource = fs.readFileSync(APP_SOURCE, "utf8");
  const serverSource = fs.readFileSync(SERVER_PATH, "utf8");
  const messageRoutesSource = fs.readFileSync(MESSAGE_ROUTES_SOURCE, "utf8");
  assert.match(appSource, /async function recallMessageById/);
  assert.match(appSource, /await api\("\/api\/messages\/recall", \{ method: "POST", body: \{ messageId: serverId \} \}\);/);
  assert.match(appSource, /showToast\(error\.message \|\| "\\u64a4\\u56de\\u5931\\u8d25", "error"\)/);
  assert.doesNotMatch(appSource, /api\("\/api\/messages\/recall", \{ method: "POST", body: \{ messageId: serverId \} \}\)\.catch\(\(\) => \{\}\)/);
  assert.ok(serverSource.includes("${value.slice(0, 1024)}..."));
  assert.doesNotMatch(serverSource, /…/);
  assert.match(messageRoutesSource, /const target = messageIdIndex\.get\(messageId\);[\s\S]*target\.from !== session\.username/);
});

test("client guards keep older message history pagination ordered", async () => {
  const server = await startServer();
  try {
    const aliceIdentity = await createIdentity();
    const bobIdentity = await createIdentity();
    const aliceRegister = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "PagingAlice",
        password: "a",
        publicKey: aliceIdentity.publicKeyBase64,
        keyBundle: await createKeyBundle(aliceIdentity, "a")
      }
    });
    const bobRegister = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "PagingBob",
        password: "b",
        publicKey: bobIdentity.publicKeyBase64,
        keyBundle: await createKeyBundle(bobIdentity, "b")
      }
    });
    assert.equal(aliceRegister.status, 201);
    assert.equal(bobRegister.status, 201);

    const sentIds = [];
    for (let index = 0; index < 5; index += 1) {
      const encrypted = await encryptMessage(
        aliceIdentity,
        "PagingAlice",
        "PagingBob",
        bobIdentity.publicKeyBase64,
        `paging message ${index + 1}`,
        70 + index
      );
      const sent = await requestJson(server.port, "/api/messages", {
        method: "POST",
        session: aliceRegister.session,
        body: {
          to: "PagingBob",
          clientId: `paging-message-${index + 1}`,
          nonce: encrypted.nonce,
          ciphertext: encrypted.ciphertext
        }
      });
      assert.equal(sent.status, 201);
      sentIds.push(sent.json.message.id);
    }

    const firstPage = await requestJson(server.port, "/api/messages?with=PagingAlice&limit=2", {
      session: bobRegister.session
    });
    assert.equal(firstPage.status, 200);
    assert.deepEqual(firstPage.json.messages.map((message) => message.id), [sentIds[3], sentIds[4]]);
    assert.equal(firstPage.json.hasMore, true);
    assert.equal(firstPage.json.nextBefore, sentIds[3]);

    const secondPage = await requestJson(
      server.port,
      `/api/messages?with=PagingAlice&limit=2&before=${encodeURIComponent(firstPage.json.nextBefore)}`,
      { session: bobRegister.session }
    );
    assert.equal(secondPage.status, 200);
    assert.deepEqual(secondPage.json.messages.map((message) => message.id), [sentIds[1], sentIds[2]]);
    assert.equal(secondPage.json.hasMore, true);
    assert.equal(secondPage.json.nextBefore, sentIds[1]);

    const deletedCursor = await requestJson(server.port, "/api/messages/delete", {
      method: "POST",
      session: bobRegister.session,
      body: { messageId: firstPage.json.nextBefore }
    });
    assert.equal(deletedCursor.status, 200);

    const afterDeletedCursor = await requestJson(
      server.port,
      `/api/messages?with=PagingAlice&limit=2&before=${encodeURIComponent(firstPage.json.nextBefore)}`,
      { session: bobRegister.session }
    );
    assert.equal(afterDeletedCursor.status, 200);
    assert.deepEqual(afterDeletedCursor.json.messages.map((message) => message.id), [sentIds[1], sentIds[2]]);
    assert.equal(afterDeletedCursor.json.hasMore, true);
    assert.equal(afterDeletedCursor.json.nextBefore, sentIds[1]);

    const thirdPage = await requestJson(
      server.port,
      `/api/messages?with=PagingAlice&limit=2&before=${encodeURIComponent(secondPage.json.nextBefore)}`,
      { session: bobRegister.session }
    );
    assert.equal(thirdPage.status, 200);
    assert.deepEqual(thirdPage.json.messages.map((message) => message.id), [sentIds[0]]);
    assert.equal(thirdPage.json.hasMore, false);
    assert.equal(thirdPage.json.nextBefore, "");
  } finally {
    await server.stop();
  }
});

test("deployment scripts preserve generated assets and verify the build without rotating admin credentials by default", () => {
  const deployScript = fs.readFileSync(DEPLOY_SCRIPT, "utf8");
  const updateScript = fs.readFileSync(UPDATE_SCRIPT, "utf8");
  const bootstrapScript = fs.readFileSync(BOOTSTRAP_UPDATE_SCRIPT, "utf8");
  const configSource = fs.readFileSync(CONFIG_SOURCE, "utf8");
  assert.match(deployScript, /public\/ui-utils\.min\.js/);
  assert.match(updateScript, /public\/ui-utils\.min\.js/);
  assert.match(deployScript, /npm run lint/);
  assert.match(deployScript, /npm run verify:build/);
  assert.match(updateScript, /npm run lint/);
  assert.match(updateScript, /npm run verify:build/);
  assert.match(deployScript, /generate_secret\(\) \{[\s\S]*crypto\.randomBytes\(bytes\)\.toString\('hex'\)/);
  assert.match(updateScript, /generate_secret\(\) \{[\s\S]*crypto\.randomBytes\(bytes\)\.toString\('hex'\)/);
  assert.match(deployScript, /install -d -o www-data -g www-data -m 0700 "\$\{DATA_DIR\}"/);
  assert.match(deployScript, /find "\$\{DATA_DIR\}" -maxdepth 1 -type f -exec chmod 0600 \{\} \\;/);
  assert.match(updateScript, /read_env_value "ADMIN_PASSWORD_HASH"/);
  assert.match(updateScript, /PREVIOUS_REV="\$\{PREVIOUS_REV:-\}"/);
  assert.match(updateScript, /SKIP_REPOSITORY_UPDATE="\$\{SKIP_REPOSITORY_UPDATE:-0\}"/);
  assert.match(updateScript, /if \[ "\$\{SKIP_REPOSITORY_UPDATE\}" = "1" \]; then/);
  assert.match(updateScript, /wait_for_application_health/);
  assert.match(updateScript, /rollback_application/);
  assert.match(bootstrapScript, /BACKUP_ROOT="\$\{BACKUP_ROOT:-\/var\/backups\/\$\{APP_NAME\}-bootstrap\}"/);
  assert.match(bootstrapScript, /git -C "\$\{APP_DIR\}" reset --hard "origin\/\$\{APP_BRANCH\}"/);
  assert.match(bootstrapScript, /SKIP_REPOSITORY_UPDATE=1/);
  assert.match(bootstrapScript, /bash "\$\{APP_DIR\}\/scripts\/update-debian\.sh"/);
  assert.match(bootstrapScript, /tar --null -C "\$\{APP_DIR\}" -czf "\$\{backup_dir\}\/untracked-files\.tgz"/);
  assert.doesNotMatch(bootstrapScript, /git clean/);
  assert.match(deployScript, /public\/index\.html/);
  assert.match(updateScript, /public\/index\.html/);
  assert.doesNotMatch(updateScript, /ensure_line "ADMIN_PASSWORD_HASH" "\$\(hash_password "\$\{ADMIN_PASSWORD\}"\)"/);
  assert.match(deployScript, /AUDIT_HMAC_KEY/);
  assert.match(updateScript, /AUDIT_HMAC_KEY/);
  assert.match(configSource, /DEFAULT_DEV_DATA_DIR/);
  assert.match(configSource, /AUDIT_HMAC_KEY_FILE/);
  assert.doesNotMatch(configSource, /ADMIN_IP_ALLOWLIST/);
});

test("public auth endpoints reject cross-origin requests", async () => {
  const server = await startServer();
  try {
    const register = await requestJson(server.port, "/api/register", {
      method: "POST",
      headers: {
        Origin: "https://evil.example"
      },
      body: {
        username: "CrossOriginAlice",
        password: "hello1234",
        publicKey: Buffer.alloc(65, 9).toString("base64"),
        keyBundle: {
          version: 1,
          iterations: 210000,
          salt: Buffer.alloc(16, 1).toString("base64"),
          iv: Buffer.alloc(12, 2).toString("base64"),
          ciphertext: Buffer.alloc(128, 3).toString("base64")
        }
      }
    });
    assert.equal(register.status, 403);
    assert.equal(register.json.error, "forbidden origin");

    const login = await requestJson(server.port, "/api/login", {
      method: "POST",
      headers: {
        Origin: "https://evil.example"
      },
      body: {
        username: "admin",
        password: "hello1234"
      }
    });
    assert.equal(login.status, 403);
    assert.equal(login.json.error, "forbidden origin");

    const defaultReset = await requestJson(server.port, "/api/admin/account/reset", {
      method: "POST",
      body: {
        username: "admin",
        password: "next-admin-password",
        passphrase: "admin"
      }
    });
    assert.equal(defaultReset.status, 503);
    assert.match(defaultReset.json.error, /默认值/);

    const defaultAdminLogin = await requestJson(server.port, "/api/admin/login", {
      method: "POST",
      body: { username: "admin", password: "qwer@1234" }
    });
    assert.equal(defaultAdminLogin.status, 200);
  } finally {
    await server.stop();
  }
});

test("state-changing endpoints reject csrf bypasses and malformed patch payloads", async () => {
  const server = await startServer();
  try {
    const aliceIdentity = await createIdentity();
    const bobIdentity = await createIdentity();
    const aliceRegister = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "Alice",
        password: "hello1234",
        publicKey: aliceIdentity.publicKeyBase64,
        keyBundle: await createKeyBundle(aliceIdentity, "hello1234")
      }
    });
    const bobRegister = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "Bob",
        password: "world1234",
        publicKey: bobIdentity.publicKeyBase64,
        keyBundle: await createKeyBundle(bobIdentity, "world1234")
      }
    });
    assert.equal(aliceRegister.status, 201);
    assert.equal(bobRegister.status, 201);

    const missingCsrf = await fetch(`http://127.0.0.1:${server.port}/api/me/settings`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: aliceRegister.session.cookie
      },
      body: JSON.stringify({ showOnlineStatus: false })
    });
    assert.equal(missingCsrf.status, 403);
    assert.equal((await missingCsrf.json()).error, "invalid csrf token");

    const badSettings = await requestJson(server.port, "/api/me/settings", {
      method: "PATCH",
      session: aliceRegister.session,
      body: { showOnlineStatus: false, unexpected: true }
    });
    assert.equal(badSettings.status, 400);
    assert.equal(badSettings.json.error, "unknown request fields");

    const badTyping = await requestJson(server.port, "/api/messages/typing", {
      method: "POST",
      session: aliceRegister.session,
      body: { to: "Bob", typing: "yes" }
    });
    assert.equal(badTyping.status, 400);
    assert.equal(badTyping.json.error, "typing must be a boolean");

    const badMessage = await requestJson(server.port, "/api/messages", {
      method: "POST",
      session: aliceRegister.session,
      body: {
        to: "Bob",
        clientId: "extra-field-message",
        nonce: Buffer.alloc(12, 12).toString("base64"),
        ciphertext: Buffer.alloc(32, 13).toString("base64"),
        text: "plaintext should not be accepted"
      }
    });
    assert.equal(badMessage.status, 400);
    assert.equal(badMessage.json.error, "unknown request fields");

    const adminLogin = await requestJson(server.port, "/api/admin/login", {
      method: "POST",
      body: { username: "admin", password: "qwer@1234" }
    });
    assert.equal(adminLogin.status, 200);

    const inconsistentAdminPatch = await requestJson(server.port, "/api/admin/users/Bob", {
      method: "PATCH",
      session: adminLogin.session,
      body: { bannedReason: "no-op" }
    });
    assert.equal(inconsistentAdminPatch.status, 400);
    assert.equal(inconsistentAdminPatch.json.error, "bannedReason requires banned");
  } finally {
    await server.stop();
  }
});

test("state-changing endpoints preserve per-user deleted message state across admin rename", async () => {
  const server = await startServer();
  let bobStream = null;
  try {
    const aliceIdentity = await createIdentity();
    const bobIdentity = await createIdentity();
    const aliceRegister = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "RenameAlice",
        password: "hello1234",
        publicKey: aliceIdentity.publicKeyBase64,
        keyBundle: await createKeyBundle(aliceIdentity, "hello1234")
      }
    });
    const bobRegister = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "RenameBob",
        password: "world1234",
        publicKey: bobIdentity.publicKeyBase64,
        keyBundle: await createKeyBundle(bobIdentity, "world1234")
      }
    });
    assert.equal(aliceRegister.status, 201);
    assert.equal(bobRegister.status, 201);

    const encrypted = await encryptMessage(
      aliceIdentity,
      "RenameAlice",
      "RenameBob",
      bobIdentity.publicKeyBase64,
      "rename delete-state regression",
      41
    );
    const sent = await requestJson(server.port, "/api/messages", {
      method: "POST",
      session: aliceRegister.session,
      body: {
        to: "RenameBob",
        clientId: "rename-delete-state-0001",
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext
      }
    });
    assert.equal(sent.status, 201);

    const deletedForBob = await requestJson(server.port, "/api/messages/delete", {
      method: "POST",
      session: bobRegister.session,
      body: {
        messageId: sent.json.message.id
      }
    });
    assert.equal(deletedForBob.status, 200);

    const beforeRenameHistory = await requestJson(server.port, "/api/messages?with=RenameAlice", {
      session: bobRegister.session
    });
    assert.equal(beforeRenameHistory.status, 200);
    assert.equal(beforeRenameHistory.json.messages.length, 0);

    const adminLogin = await requestJson(server.port, "/api/admin/login", {
      method: "POST",
      body: { username: "admin", password: "qwer@1234" }
    });
    assert.equal(adminLogin.status, 200);

    bobStream = await openEventStream(server.port, bobRegister.session);
    assert.equal((await bobStream.waitForEvent("ready")).me, "RenameBob");

    const renamed = await requestJson(server.port, "/api/admin/users/RenameBob", {
      method: "PATCH",
      session: adminLogin.session,
      body: { username: "RenameBobNext" }
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.json.user.username, "RenameBobNext");
    assert.equal(
      (await bobStream.waitForEvent("user-renamed", (payload) => payload.previousUsername === "RenameBob")).username,
      "RenameBobNext"
    );

    const detailWithStream = await requestJson(server.port, "/api/admin/users/RenameBobNext", {
      session: adminLogin.session
    });
    assert.equal(detailWithStream.status, 200);
    assert.equal(detailWithStream.json.detail.realtime.eventConnections, 1);

    await bobStream.close();
    bobStream = null;
    await delay(20);

    const detailAfterStreamClose = await requestJson(server.port, "/api/admin/users/RenameBobNext", {
      session: adminLogin.session
    });
    assert.equal(detailAfterStreamClose.status, 200);
    assert.equal(detailAfterStreamClose.json.detail.realtime.eventConnections, 0);

    const newNameLogin = await requestJson(server.port, "/api/login", {
      method: "POST",
      body: { username: "RenameBobNext", password: "world1234" }
    });
    assert.equal(newNameLogin.status, 200);
    assert.equal(newNameLogin.json.user.username, "RenameBobNext");

    const oldNameLogin = await requestJson(server.port, "/api/login", {
      method: "POST",
      body: { username: "RenameBob", password: "world1234" }
    });
    assert.equal(oldNameLogin.status, 401);

    const meAfterRename = await requestJson(server.port, "/api/me", {
      session: bobRegister.session
    });
    assert.equal(meAfterRename.status, 200);
    assert.equal(meAfterRename.json.user.username, "RenameBobNext");

    const afterRenameHistory = await requestJson(server.port, "/api/messages?with=RenameAlice", {
      session: bobRegister.session
    });
    assert.equal(afterRenameHistory.status, 200);
    assert.equal(afterRenameHistory.json.messages.length, 0);
  } finally {
    if (bobStream) {
      await bobStream.close();
    }
    await server.stop();
  }
});

test("event stream tickets are one-time use", async () => {
  const server = await startServer();
  try {
    const identity = await createIdentity();
    const registered = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "TicketUser",
        password: "ticket123",
        publicKey: identity.publicKeyBase64,
        keyBundle: await createKeyBundle(identity, "ticket123")
      }
    });
    assert.equal(registered.status, 201);

    const ticketResponse = await requestJson(server.port, "/api/events/token", {
      method: "POST",
      session: registered.session
    });
    assert.equal(ticketResponse.status, 200);
    assert.ok(ticketResponse.json.ticket);

    const first = await fetch(`http://127.0.0.1:${server.port}/api/events?ticket=${encodeURIComponent(ticketResponse.json.ticket)}`, {
      headers: { Accept: "text/event-stream" }
    });
    assert.equal(first.status, 200);
    await first.body?.cancel();

    const second = await fetch(`http://127.0.0.1:${server.port}/api/events?ticket=${encodeURIComponent(ticketResponse.json.ticket)}`, {
      headers: { Accept: "text/event-stream" }
    });
    assert.equal(second.status, 401);
    assert.equal((await second.json()).error, "unauthorized");
  } finally {
    await server.stop();
  }
});

test("new realtime connection replaces the previous online device for the same user", async () => {
  const server = await startServer();
  let firstStream = null;
  let secondStream = null;
  try {
    const identity = await createIdentity();
    const registered = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "SingleOnlineUser",
        password: "single123",
        publicKey: identity.publicKeyBase64,
        keyBundle: await createKeyBundle(identity, "single123")
      }
    });
    assert.equal(registered.status, 201);

    firstStream = await openEventStream(server.port, registered.session);
    assert.equal((await firstStream.waitForEvent("ready")).me, "SingleOnlineUser");

    secondStream = await openEventStream(server.port, registered.session);
    assert.equal((await secondStream.waitForEvent("ready")).me, "SingleOnlineUser");
    const takeover = await firstStream.waitForEvent("system", (payload) => payload.reason === "signed in on another device");
    assert.equal(takeover.reason, "signed in on another device");
  } finally {
    if (firstStream) {
      await firstStream.close();
    }
    if (secondStream) {
      await secondStream.close();
    }
    await server.stop();
  }
});

test("runtime data files are created with owner-only permissions", async () => {
  const server = await startServer();
  try {
    const directoryMode = fs.statSync(server.dataDir).mode & 0o777;
    assert.equal(directoryMode, 0o700);
    for (const fileName of ["users.json", "messages.json", "messages.jsonl", "admin_audit.jsonl", "sessions.json", "errors.log"]) {
      const fileMode = fs.statSync(path.join(server.dataDir, fileName)).mode & 0o777;
      assert.equal(fileMode, 0o600, fileName);
    }
  } finally {
    await server.stop();
  }
});

test("server stores only public keys and ciphertext while clients can decrypt each other", async () => {
  const server = await startServer();
  try {
    const aliceIdentity = await createIdentity();
    const bobIdentity = await createIdentity();
    const charlieIdentity = await createIdentity();

    const aliceRegister = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "Alice",
        password: "hello123",
        publicKey: aliceIdentity.publicKeyBase64,
        keyBundle: await createKeyBundle(aliceIdentity, "hello123")
      }
    });
    assert.equal(aliceRegister.status, 201);
    assert.equal(aliceRegister.json.user.publicKey, aliceIdentity.publicKeyBase64);
    assert.ok(aliceRegister.json.keyBundle);

    const bobRegister = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "Bob",
        password: "world123",
        publicKey: bobIdentity.publicKeyBase64,
        keyBundle: await createKeyBundle(bobIdentity, "world123")
      }
    });
    assert.equal(bobRegister.status, 201);
    assert.equal(bobRegister.json.user.publicKey, bobIdentity.publicKeyBase64);
    assert.ok(bobRegister.json.keyBundle);

    const charlieRegister = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "Charlie",
        password: "earth123",
        publicKey: charlieIdentity.publicKeyBase64,
        keyBundle: await createKeyBundle(charlieIdentity, "earth123")
      }
    });
    assert.equal(charlieRegister.status, 201);

    const aliceLogin = await requestJson(server.port, "/api/login", {
      method: "POST",
      body: { username: "Alice", password: "hello123" }
    });
    const bobLogin = await requestJson(server.port, "/api/login", {
      method: "POST",
      body: { username: "Bob", password: "world123" }
    });
    assert.equal(aliceLogin.status, 200);
    assert.equal(bobLogin.status, 200);
    assert.equal(await decryptKeyBundle(aliceLogin.json.keyBundle, "hello123"), aliceIdentity.privateKeyPkcs8Base64);
    assert.equal(await decryptKeyBundle(bobLogin.json.keyBundle, "world123"), bobIdentity.privateKeyPkcs8Base64);

    const prekey = await requestJson(server.port, "/prekey-bundle/Bob", {
      session: aliceLogin.session
    });
    assert.equal(prekey.status, 200);
    assert.equal(prekey.json.identityKey, bobIdentity.publicKeyBase64);
    assert.equal(prekey.json.privateKeyStoredOnServer, false);
    assert.equal(prekey.json.capabilities.zeroKnowledgeMessages, true);
    assert.equal(prekey.json.capabilities.encryptedAttachments, true);
    assert.equal(prekey.json.capabilities.oneTimePreKeys, false);
    assert.equal(prekey.json.capabilities.multiDeviceKeyBundles, true);
    assert.equal(prekey.json.capabilities.passwordEncryptedIdentityBundles, true);
    assert.equal(prekey.json.preKeyModel, "identity-key-compat-v1");
    assert.equal(prekey.json.signedPreKey.signature, null);
    assert.deepEqual(prekey.json.oneTimePreKeys, []);
    assert.match(prekey.json.limitations.join(" "), /password-encrypted identity bundle/);
    assert.equal(prekey.json.encryptedPrivateKey, undefined);

    const plaintext = "zero knowledge plaintext";
    const encrypted = await encryptMessage(aliceIdentity, "Alice", "Bob", bobIdentity.publicKeyBase64, plaintext, 11);

    const malformedNonce = await requestJson(server.port, "/api/messages", {
      method: "POST",
      session: aliceLogin.session,
      body: {
        to: "Bob",
        clientId: "test-message-bad1",
        nonce: `${encrypted.nonce}=`,
        ciphertext: encrypted.ciphertext
      }
    });
    assert.equal(malformedNonce.status, 400);
    assert.equal(malformedNonce.json.error, "invalid message payload");

    const missingClientId = await requestJson(server.port, "/api/messages", {
      method: "POST",
      session: aliceLogin.session,
      body: {
        to: "Bob",
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext
      }
    });
    assert.equal(missingClientId.status, 400);
    assert.equal(missingClientId.json.error, "clientId required");

    const sent = await requestJson(server.port, "/api/messages", {
      method: "POST",
      session: aliceLogin.session,
      body: {
        to: "Bob",
        clientId: "test-message-0001",
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext
      }
    });
    assert.equal(sent.status, 201);
    assert.equal(sent.json.message.text, null);
    assert.equal(sent.json.message.ciphertext, encrypted.ciphertext);
    assert.equal(sent.json.message.nonce, encrypted.nonce);
    assert.equal(sent.json.message.publicKey, bobIdentity.publicKeyBase64);

    const duplicateAttempt = await requestJson(server.port, "/api/messages", {
      method: "POST",
      session: aliceLogin.session,
      body: {
        to: "Bob",
        clientId: sent.json.message.clientId,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext
      }
    });
    assert.equal(duplicateAttempt.status, 200);
    assert.equal(duplicateAttempt.json.message.id, sent.json.message.id);

    const nonceReplay = await requestJson(server.port, "/api/messages", {
      method: "POST",
      session: aliceLogin.session,
      body: {
        to: "Bob",
        clientId: "test-message-0002",
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext
      }
    });
    assert.equal(nonceReplay.status, 409);
    assert.equal(nonceReplay.json.error, "duplicate message nonce");

    const encryptedForCharlie = await encryptMessage(
      aliceIdentity,
      "Alice",
      "Charlie",
      charlieIdentity.publicKeyBase64,
      "same sender nonce replay",
      11
    );
    const crossPeerNonceReplay = await requestJson(server.port, "/api/messages", {
      method: "POST",
      session: aliceLogin.session,
      body: {
        to: "Charlie",
        clientId: "test-message-0003",
        nonce: encryptedForCharlie.nonce,
        ciphertext: encryptedForCharlie.ciphertext
      }
    });
    assert.equal(crossPeerNonceReplay.status, 409);
    assert.equal(crossPeerNonceReplay.json.error, "duplicate message nonce");

    const attachmentPlaintext = '[[echo-attachment-v1]]{"name":"report.txt","type":"text/plain","size":5,"data":"aGVsbG8="}';
    const encryptedAttachment = await encryptMessage(
      aliceIdentity,
      "Alice",
      "Bob",
      bobIdentity.publicKeyBase64,
      attachmentPlaintext,
      12
    );
    const sentAttachment = await requestJson(server.port, "/api/messages/attachment", {
      method: "POST",
      session: aliceLogin.session,
      body: {
        to: "Bob",
        clientId: "test-attachment-0001",
        nonce: encryptedAttachment.nonce,
        ciphertext: encryptedAttachment.ciphertext
      }
    });
    assert.equal(sentAttachment.status, 201);
    assert.equal(sentAttachment.json.message.text, null);
    assert.equal(sentAttachment.json.message.ciphertext, encryptedAttachment.ciphertext);

    const plaintextOnly = await requestJson(server.port, "/api/messages", {
      method: "POST",
      session: aliceLogin.session,
      body: {
        to: "Bob",
        clientId: "test-message-plain1",
        text: plaintext
      }
    });
    assert.equal(plaintextOnly.status, 400);
    assert.equal(plaintextOnly.json.error, "unknown request fields");

    const history = await requestJson(server.port, "/api/messages?with=Alice", {
      session: bobLogin.session
    });
    assert.equal(history.status, 200);
    assert.equal(history.json.messages.length, 2);
    assert.equal(history.json.messages[0].text, null);
    assert.equal(history.json.messages[0].ciphertext, encrypted.ciphertext);
    assert.equal(history.json.messages[0].nonce, encrypted.nonce);
    assert.equal(history.json.messages[0].publicKey, aliceIdentity.publicKeyBase64);
    assert.equal(history.json.messages[1].text, null);

    const decrypted = await decryptMessage(
      bobIdentity,
      "Bob",
      "Alice",
      aliceIdentity.publicKeyBase64,
      history.json.messages[0]
    );
    assert.equal(decrypted, plaintext);
    const decryptedAttachment = await decryptMessage(
      bobIdentity,
      "Bob",
      "Alice",
      aliceIdentity.publicKeyBase64,
      history.json.messages[1]
    );
    assert.equal(decryptedAttachment, attachmentPlaintext);

    const keyBundle = await requestJson(server.port, "/api/me/key-bundle", {
      session: aliceLogin.session
    });
    assert.equal(keyBundle.status, 200);
    assert.equal(await decryptKeyBundle(keyBundle.json.keyBundle, "hello123"), aliceIdentity.privateKeyPkcs8Base64);

    await delay(300);
    const usersJson = fs.readFileSync(path.join(server.dataDir, "users.json"), "utf8");
    const messagesJson = fs.readFileSync(path.join(server.dataDir, "messages.json"), "utf8");
    const messagesLog = fs.readFileSync(path.join(server.dataDir, "messages.jsonl"), "utf8");
    const storedMessages = `${messagesJson}\n${messagesLog}`;
    assert.match(usersJson, new RegExp(aliceIdentity.publicKeyBase64.replace(/[+/=]/g, "\\$&")));
    assert.doesNotMatch(usersJson, /encryptedPrivateKey|privateKeySalt|privateKeyIv|privateKeyPkcs8/i);
    assert.doesNotMatch(storedMessages, /zero knowledge plaintext/);
    assert.doesNotMatch(storedMessages, /report\.txt|aGVsbG8=/);
    assert.doesNotMatch(messagesLog, /zero knowledge plaintext/);
    assert.match(storedMessages, new RegExp(encrypted.ciphertext.replace(/[+/=]/g, "\\$&")));
    assert.match(storedMessages, new RegExp(encryptedAttachment.ciphertext.replace(/[+/=]/g, "\\$&")));
  } finally {
    await server.stop();
  }
});

test("recalled messages stay single after append log reload", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "secure-chat-recall-"));
  fs.writeFileSync(path.join(dataDir, "users.json"), "[]", "utf8");
  fs.writeFileSync(path.join(dataDir, "messages.json"), "[]", "utf8");
  fs.writeFileSync(path.join(dataDir, "messages.jsonl"), "", "utf8");
  fs.writeFileSync(path.join(dataDir, "admin_audit.jsonl"), "", "utf8");

  let server = await startServer({ DATA_DIR: dataDir });
  try {
    const aliceIdentity = await createIdentity();
    const bobIdentity = await createIdentity();
    const aliceRegister = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "RecallAlice",
        password: "hello123",
        publicKey: aliceIdentity.publicKeyBase64,
        keyBundle: await createKeyBundle(aliceIdentity, "hello123")
      }
    });
    assert.equal(aliceRegister.status, 201);

    const bobRegister = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "RecallBob",
        password: "world123",
        publicKey: bobIdentity.publicKeyBase64,
        keyBundle: await createKeyBundle(bobIdentity, "world123")
      }
    });
    assert.equal(bobRegister.status, 201);

    const encrypted = await encryptMessage(
      aliceIdentity,
      "RecallAlice",
      "RecallBob",
      bobIdentity.publicKeyBase64,
      "recall persistence probe",
      21
    );
    const sent = await requestJson(server.port, "/api/messages", {
      method: "POST",
      session: aliceRegister.session,
      body: {
        to: "RecallBob",
        clientId: "recall-message-0001",
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext
      }
    });
    assert.equal(sent.status, 201);

    const recalled = await requestJson(server.port, "/api/messages/recall", {
      method: "POST",
      session: aliceRegister.session,
      body: {
        messageId: sent.json.message.id
      }
    });
    assert.equal(recalled.status, 200);
    await delay(350);
    await server.stop();

    server = await startServer({ DATA_DIR: dataDir });
    const bobLogin = await requestJson(server.port, "/api/login", {
      method: "POST",
      body: {
        username: "RecallBob",
        password: "world123"
      }
    });
    assert.equal(bobLogin.status, 200);
    const aliceReplayLogin = await requestJson(server.port, "/api/login", {
      method: "POST",
      body: {
        username: "RecallAlice",
        password: "hello123"
      }
    });
    assert.equal(aliceReplayLogin.status, 200);

    const history = await requestJson(server.port, "/api/messages?with=RecallAlice", {
      session: bobLogin.session
    });
    assert.equal(history.status, 200);
    assert.equal(history.json.messages.length, 1);
    assert.equal(history.json.messages[0].id, sent.json.message.id);
    assert.equal(history.json.messages[0].recalled, true);
    assert.equal(history.json.messages[0].ciphertext, "");
    assert.equal(history.json.messages[0].nonce, "");

    const replayAfterRecall = await requestJson(server.port, "/api/messages", {
      method: "POST",
      session: aliceReplayLogin.session,
      body: {
        to: "RecallBob",
        clientId: "recall-message-0001-replay",
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext
      }
    });
    assert.equal(replayAfterRecall.status, 409);
    assert.equal(replayAfterRecall.json.error, "duplicate message nonce");
  } finally {
    if (server?.child?.exitCode === null) {
      await server.stop();
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("message lifecycle events stay consistent across realtime streams and history views", async () => {
  const server = await startServer();
  let aliceStream = null;
  let bobStream = null;
  try {
    const aliceIdentity = await createIdentity();
    const bobIdentity = await createIdentity();
    const aliceRegister = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "LifeAlice",
        password: "hello123",
        publicKey: aliceIdentity.publicKeyBase64,
        keyBundle: await createKeyBundle(aliceIdentity, "hello123")
      }
    });
    assert.equal(aliceRegister.status, 201);

    const bobRegister = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "LifeBob",
        password: "world123",
        publicKey: bobIdentity.publicKeyBase64,
        keyBundle: await createKeyBundle(bobIdentity, "world123")
      }
    });
    assert.equal(bobRegister.status, 201);

    aliceStream = await openEventStream(server.port, aliceRegister.session);
    bobStream = await openEventStream(server.port, bobRegister.session);
    assert.equal((await aliceStream.waitForEvent("ready")).me, "LifeAlice");
    assert.equal((await bobStream.waitForEvent("ready")).me, "LifeBob");

    const firstEncrypted = await encryptMessage(
      aliceIdentity,
      "LifeAlice",
      "LifeBob",
      bobIdentity.publicKeyBase64,
      "lifecycle recall probe",
      31
    );
    const firstSent = await requestJson(server.port, "/api/messages", {
      method: "POST",
      session: aliceRegister.session,
      body: {
        to: "LifeBob",
        clientId: "lifecycle-message-0001",
        nonce: firstEncrypted.nonce,
        ciphertext: firstEncrypted.ciphertext
      }
    });
    assert.equal(firstSent.status, 201);

    const firstMessageId = firstSent.json.message.id;
    assert.equal((await bobStream.waitForEvent("message", (payload) => payload.id === firstMessageId)).peer, "LifeAlice");
    assert.equal((await aliceStream.waitForEvent("message", (payload) => payload.id === firstMessageId)).mine, true);

    const recalled = await requestJson(server.port, "/api/messages/recall", {
      method: "POST",
      session: aliceRegister.session,
      body: { messageId: firstMessageId }
    });
    assert.equal(recalled.status, 200);
    assert.equal((await aliceStream.waitForEvent("message-recalled", (payload) => payload.messageId === firstMessageId)).peer, "LifeBob");
    assert.equal((await bobStream.waitForEvent("message-recalled", (payload) => payload.messageId === firstMessageId)).peer, "LifeAlice");

    const secondEncrypted = await encryptMessage(
      aliceIdentity,
      "LifeAlice",
      "LifeBob",
      bobIdentity.publicKeyBase64,
      "lifecycle delete probe",
      32
    );
    const secondSent = await requestJson(server.port, "/api/messages", {
      method: "POST",
      session: aliceRegister.session,
      body: {
        to: "LifeBob",
        clientId: "lifecycle-message-0002",
        nonce: secondEncrypted.nonce,
        ciphertext: secondEncrypted.ciphertext
      }
    });
    assert.equal(secondSent.status, 201);
    const secondMessageId = secondSent.json.message.id;
    assert.equal((await bobStream.waitForEvent("message", (payload) => payload.id === secondMessageId)).peer, "LifeAlice");

    const deleted = await requestJson(server.port, "/api/messages/delete", {
      method: "POST",
      session: bobRegister.session,
      body: { messageId: secondMessageId }
    });
    assert.equal(deleted.status, 200);
    assert.equal((await bobStream.waitForEvent("message-deleted", (payload) => payload.messageId === secondMessageId)).peer, "LifeAlice");
    await assert.rejects(
      aliceStream.waitForEvent("message-deleted", (payload) => payload.messageId === secondMessageId, 250),
      /timed out waiting for message-deleted/
    );

    const bobHistory = await requestJson(server.port, "/api/messages?with=LifeAlice", {
      session: bobRegister.session
    });
    assert.equal(bobHistory.status, 200);
    assert.deepEqual(
      bobHistory.json.messages.map((message) => message.id),
      [firstMessageId]
    );
    assert.equal(bobHistory.json.messages[0].recalled, true);
    assert.equal(bobHistory.json.messages[0].ciphertext, "");
    assert.equal(bobHistory.json.messages[0].nonce, "");

    const aliceHistory = await requestJson(server.port, "/api/messages?with=LifeBob", {
      session: aliceRegister.session
    });
    assert.equal(aliceHistory.status, 200);
    assert.deepEqual(
      aliceHistory.json.messages.map((message) => message.id),
      [firstMessageId, secondMessageId]
    );
  } finally {
    await aliceStream?.close();
    await bobStream?.close();
    await server.stop();
  }
});

test("startup strips legacy server-side private key material from user records", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "secure-chat-legacy-"));
  const legacyUser = {
    id: "legacy-user",
    username: "Legacy",
    usernameKey: "legacy",
    passwordHash: "scrypt:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000",
    publicKey: Buffer.alloc(65, 8).toString("base64"),
    privateKeySalt: Buffer.alloc(16, 9).toString("base64"),
    privateKeyIv: Buffer.alloc(12, 10).toString("base64"),
    encryptedPrivateKey: Buffer.alloc(160, 11).toString("base64"),
    createdAt: Date.now()
  };
  fs.writeFileSync(path.join(dataDir, "users.json"), JSON.stringify([legacyUser], null, 2), "utf8");
  fs.writeFileSync(path.join(dataDir, "messages.json"), "[]", "utf8");
  fs.writeFileSync(path.join(dataDir, "messages.jsonl"), "", "utf8");
  fs.writeFileSync(path.join(dataDir, "admin_audit.jsonl"), "", "utf8");

  const server = await startServer({ DATA_DIR: dataDir });
  try {
    await delay(200);
    const persisted = fs.readFileSync(path.join(dataDir, "users.json"), "utf8");
    assert.doesNotMatch(persisted, /encryptedPrivateKey|privateKeySalt|privateKeyIv/);
    assert.match(persisted, /"publicKey":/);
  } finally {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("password change rotates the password hash while keeping the encrypted key bundle recoverable", async () => {
  const server = await startServer();
  try {
    const identity = await createIdentity();
    const register = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "Changer",
        password: "x",
        publicKey: identity.publicKeyBase64,
        keyBundle: await createKeyBundle(identity, "x")
      }
    });
    assert.equal(register.status, 201);

    const changed = await requestJson(server.port, "/api/me/password", {
      method: "POST",
      session: register.session,
      body: {
        currentPassword: "x",
        newPassword: "y",
        keyBundle: await createKeyBundle(identity, "y")
      }
    });
    assert.equal(changed.status, 200);

    const oldLogin = await requestJson(server.port, "/api/login", {
      method: "POST",
      body: {
        username: "Changer",
        password: "x"
      }
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await requestJson(server.port, "/api/login", {
      method: "POST",
      body: {
        username: "Changer",
        password: "y"
      }
    });
    assert.equal(newLogin.status, 200);
    assert.equal(await decryptKeyBundle(newLogin.json.keyBundle, "y"), identity.privateKeyPkcs8Base64);
  } finally {
    await server.stop();
  }
});

test("session management can revoke another active device without logging out the current one", async () => {
  const server = await startServer();
  try {
    const identity = await createIdentity();
    const register = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "SessionRevokeUser",
        password: "hello123",
        publicKey: identity.publicKeyBase64,
        keyBundle: await createKeyBundle(identity, "hello123")
      }
    });
    assert.equal(register.status, 201);

    const secondLogin = await requestJson(server.port, "/api/login", {
      method: "POST",
      body: {
        username: "SessionRevokeUser",
        password: "hello123"
      }
    });
    assert.equal(secondLogin.status, 200);

    const sessionsBefore = await requestJson(server.port, "/api/me/sessions", {
      session: register.session
    });
    assert.equal(sessionsBefore.status, 200);
    assert.equal(sessionsBefore.json.sessions.length, 2);
    assert.equal(sessionsBefore.json.sessions.filter((item) => item.current).length, 1);

    const otherSession = sessionsBefore.json.sessions.find((item) => !item.current);
    assert.ok(otherSession?.id);

    const revoked = await requestJson(server.port, "/api/me/sessions/revoke", {
      method: "POST",
      session: register.session,
      body: {
        sessionId: otherSession.id
      }
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.json.revokedSessionId, otherSession.id);
    assert.equal(revoked.json.sessions.length, 1);
    assert.equal(revoked.json.sessions[0].current, true);

    const currentStillWorks = await requestJson(server.port, "/api/me", {
      session: register.session
    });
    assert.equal(currentStillWorks.status, 200);

    const revokedSession = await requestJson(server.port, "/api/me", {
      session: secondLogin.session
    });
    assert.equal(revokedSession.status, 401);
  } finally {
    await server.stop();
  }
});

test("public key upload is idempotent and refuses identity key rotation", async () => {
  const server = await startServer();
  try {
    const identity = await createIdentity();
    const nextIdentity = await createIdentity();
    const register = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "Rotator",
        password: "hello123",
        publicKey: identity.publicKeyBase64,
        keyBundle: await createKeyBundle(identity, "hello123")
      }
    });
    assert.equal(register.status, 201);

    const upload = await requestJson(server.port, "/upload-public-key", {
      method: "POST",
      session: register.session,
      body: {
        publicKey: identity.publicKeyBase64
      }
    });
    assert.equal(upload.status, 200);
    assert.equal(upload.json.ok, true);
    assert.equal(upload.json.publicKey.identityKey, identity.publicKeyBase64);
    assert.equal(upload.json.keyBundle, undefined);

    const rotation = await requestJson(server.port, "/upload-public-key", {
      method: "POST",
      session: register.session,
      body: {
        publicKey: nextIdentity.publicKeyBase64
      }
    });
    assert.equal(rotation.status, 409);
    assert.equal(rotation.json.error, "identity public key already registered");

    await delay(200);
    const usersJson = fs.readFileSync(path.join(server.dataDir, "users.json"), "utf8");
    assert.match(usersJson, new RegExp(identity.publicKeyBase64.replace(/[+/=]/g, "\\$&")));
    assert.doesNotMatch(usersJson, new RegExp(nextIdentity.publicKeyBase64.replace(/[+/=]/g, "\\$&")));
    assert.doesNotMatch(usersJson, /encryptedPrivateKey|privateKeySalt|privateKeyIv/);
  } finally {
    await server.stop();
  }
});

test("authenticated users can rotate to a new password-encrypted identity bundle for device recovery", async () => {
  const server = await startServer();
  try {
    const identity = await createIdentity();
    const nextIdentity = await createIdentity();
    const register = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "RecoveryUser",
        password: "hello123",
        publicKey: identity.publicKeyBase64,
        keyBundle: await createKeyBundle(identity, "hello123")
      }
    });
    assert.equal(register.status, 201);

    const missingPasswordRotation = await requestJson(server.port, "/api/me/key-bundle", {
      method: "POST",
      session: register.session,
      body: {
        publicKey: nextIdentity.publicKeyBase64,
        keyBundle: await createKeyBundle(nextIdentity, "hello123"),
        rotateIdentity: true
      }
    });
    assert.equal(missingPasswordRotation.status, 403);
    assert.equal(missingPasswordRotation.json.error, "current password invalid");

    const rotated = await requestJson(server.port, "/api/me/key-bundle", {
      method: "POST",
      session: register.session,
      body: {
        publicKey: nextIdentity.publicKeyBase64,
        keyBundle: await createKeyBundle(nextIdentity, "hello123"),
        rotateIdentity: true,
        currentPassword: "hello123"
      }
    });
    assert.equal(rotated.status, 200);
    assert.equal(rotated.json.user.publicKey, nextIdentity.publicKeyBase64);

    const login = await requestJson(server.port, "/api/login", {
      method: "POST",
      body: {
        username: "RecoveryUser",
        password: "hello123"
      }
    });
    assert.equal(login.status, 200);
    assert.equal(login.json.user.publicKey, nextIdentity.publicKeyBase64);
    assert.equal(await decryptKeyBundle(login.json.keyBundle, "hello123"), nextIdentity.privateKeyPkcs8Base64);
  } finally {
    await server.stop();
  }
});
