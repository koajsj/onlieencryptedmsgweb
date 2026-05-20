"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");

const MAX_BODY_BYTES = 128 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const MAX_AUTH_REQUESTS_PER_WINDOW = 40;
const MAX_API_REQUESTS_PER_WINDOW = 240;
const HEARTBEAT_MS = 15000;
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const TRUSTED_ORIGINS = new Set(
  (process.env.TRUSTED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const PUBLIC_KEY_BYTES = { min: 65, max: 120 };
const PRIVATE_KEY_SALT_BYTES = { min: 16, max: 32 };
const PRIVATE_KEY_IV_BYTES = { min: 12, max: 24 };
const ENCRYPTED_PRIVATE_KEY_BYTES = { min: 96, max: 4096 };
const MESSAGE_NONCE_BYTES = { min: 12, max: 24 };
const MESSAGE_CIPHERTEXT_BYTES = { min: 24, max: 12288 };

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

const sessions = new Map();
const onlineConnections = new Map();
const rateBuckets = new Map();

let users = [];
let messages = [];

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, "[]\n", "utf8");
  }
  if (!fs.existsSync(MESSAGES_FILE)) {
    fs.writeFileSync(MESSAGES_FILE, "[]\n", "utf8");
  }
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function loadData() {
  ensureDataFiles();
  users = readJsonFile(USERS_FILE, []);
  messages = readJsonFile(MESSAGES_FILE, []);
}

function persistUsers() {
  writeJsonFile(USERS_FILE, users);
}

function persistMessages() {
  writeJsonFile(MESSAGES_FILE, messages);
}

function securityHeaders(extra = {}) {
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Origin-Agent-Cluster": "?1",
    "Content-Security-Policy":
      "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; worker-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    ...extra
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(
    status,
    securityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body)
    })
  );
  res.end(body);
}

function getClientAddress(req) {
  if (TRUST_PROXY) {
    const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwardedFor) {
      return forwardedFor;
    }
  }
  return req.socket.remoteAddress || "unknown";
}

function isSameOriginRequest(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) {
    return true;
  }
  if (TRUSTED_ORIGINS.has(origin)) {
    return true;
  }
  try {
    return new URL(origin).host === req.headers.host;
  } catch (error) {
    return false;
  }
}

function isRateLimited(key, limit) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt > RATE_WINDOW_MS) {
    rateBuckets.set(key, { count: 1, startedAt: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

function cleanRateBuckets() {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.startedAt > RATE_WINDOW_MS * 3) {
      rateBuckets.delete(key);
    }
  }
}

function rejectIfForbiddenOrLimited(req, res, key, limit, limitMessage) {
  if (!isSameOriginRequest(req)) {
    sendJson(res, 403, { error: "forbidden origin" });
    return true;
  }
  if (isRateLimited(key, limit)) {
    sendJson(res, 429, { error: limitMessage });
    return true;
  }
  return false;
}

function normalizeUsername(value) {
  if (typeof value !== "string") {
    return null;
  }
  const username = value.trim();
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
    return null;
  }
  return {
    value: username,
    key: username.toLowerCase()
  };
}

function normalizePassword(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function decodeBase64Blob(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || !/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    return null;
  }
  try {
    const bytes = Buffer.from(trimmed, "base64");
    return bytes.length > 0 ? bytes : null;
  } catch (error) {
    return null;
  }
}

function isBase64Blob(value, minBytes, maxBytes) {
  const bytes = decodeBase64Blob(value);
  if (!bytes) {
    return false;
  }
  return bytes.length >= minBytes && bytes.length <= maxBytes;
}

function publicUser(user) {
  return {
    username: user.username,
    createdAt: user.createdAt,
    publicKey: user.publicKey
  };
}

function keyBundleForUser(user) {
  return {
    publicKey: user.publicKey,
    privateKeySalt: user.privateKeySalt,
    privateKeyIv: user.privateKeyIv,
    encryptedPrivateKey: user.encryptedPrivateKey
  };
}

function makeAvatarSeed(username) {
  return crypto.createHash("sha1").update(username).digest("hex").slice(0, 8);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || "").split(":");
  if (!salt || !hash) {
    return false;
  }
  const computed = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), computed);
}

function findUserByKey(usernameKey) {
  return users.find((user) => user.usernameKey === usernameKey) || null;
}

function findUserByUsername(username) {
  const normalized = normalizeUsername(username);
  return normalized ? findUserByKey(normalized.key) : null;
}

function createSession(username) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    token,
    username,
    createdAt: Date.now()
  });
  return token;
}

function parseBearerToken(req) {
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) {
    return "";
  }
  return auth.slice(7).trim();
}

function getSessionFromRequest(req, url) {
  const token = parseBearerToken(req) || String(url.searchParams.get("token") || "");
  if (!token) {
    return null;
  }
  return sessions.get(token) || null;
}

function requireSession(req, res, url) {
  const session = getSessionFromRequest(req, url);
  if (!session) {
    sendJson(res, 401, { error: "unauthorized" });
    return null;
  }
  return session;
}

function isUserOnline(username) {
  return Boolean(onlineConnections.get(username)?.size);
}

function listOnlineUsers() {
  return [...onlineConnections.entries()]
    .filter(([, connections]) => connections.size > 0)
    .map(([username]) => username)
    .sort((left, right) => left.localeCompare(right));
}

function createMessageView(message, viewer) {
  const peer = message.from === viewer ? message.to : message.from;
  const peerUser = findUserByUsername(peer);
  return {
    id: message.id,
    from: message.from,
    to: message.to,
    peer,
    mine: message.from === viewer,
    publicKey: peerUser?.publicKey || "",
    nonce: message.nonce,
    ciphertext: message.ciphertext,
    createdAt: message.createdAt
  };
}

function buildConversationSummary(viewer, peer) {
  const peerUser = findUserByUsername(peer);
  if (!peerUser) {
    return null;
  }

  let latest = null;
  for (const message of messages) {
    if (
      (message.from === viewer && message.to === peer) ||
      (message.from === peer && message.to === viewer)
    ) {
      if (!latest || message.createdAt > latest.createdAt) {
        latest = message;
      }
    }
  }

  return {
    username: peer,
    online: isUserOnline(peer),
    avatarSeed: makeAvatarSeed(peer),
    publicKey: peerUser.publicKey,
    latestMessage: latest
      ? {
          id: latest.id,
          from: latest.from,
          to: latest.to,
          nonce: latest.nonce,
          ciphertext: latest.ciphertext,
          createdAt: latest.createdAt
        }
      : null,
    lastAt: latest ? latest.createdAt : 0
  };
}

function listConversationsFor(username) {
  const peers = new Set();
  for (const message of messages) {
    if (message.from === username) {
      peers.add(message.to);
    } else if (message.to === username) {
      peers.add(message.from);
    }
  }
  return [...peers]
    .map((peer) => buildConversationSummary(username, peer))
    .filter(Boolean)
    .sort((left, right) => {
      if (right.lastAt !== left.lastAt) {
        return right.lastAt - left.lastAt;
      }
      return left.username.localeCompare(right.username);
    });
}

function listUsersForSearch(viewer, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  return users
    .filter((user) => user.username !== viewer)
    .filter((user) => !normalizedQuery || user.usernameKey.includes(normalizedQuery))
    .sort((left, right) => {
      const onlineDelta = Number(isUserOnline(right.username)) - Number(isUserOnline(left.username));
      if (onlineDelta !== 0) {
        return onlineDelta;
      }
      return left.username.localeCompare(right.username);
    })
    .slice(0, 24)
    .map((user) => ({
      username: user.username,
      online: isUserOnline(user.username),
      avatarSeed: makeAvatarSeed(user.username),
      publicKey: user.publicKey
    }));
}

function messagesBetween(leftUser, rightUser) {
  return messages
    .filter(
      (message) =>
        (message.from === leftUser && message.to === rightUser) ||
        (message.from === rightUser && message.to === leftUser)
    )
    .sort((left, right) => left.createdAt - right.createdAt);
}

function writeSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function pushEventToUser(username, event, payload) {
  const connections = onlineConnections.get(username);
  if (!connections || connections.size === 0) {
    return;
  }
  for (const connection of connections) {
    writeSse(connection.res, event, payload);
  }
}

function pushPresence(username, online) {
  const payload = { username, online };
  for (const [, connections] of onlineConnections) {
    if (connections.size === 0) {
      continue;
    }
    for (const connection of connections) {
      writeSse(connection.res, "presence", payload);
    }
  }
}

function attachConnection(username, res) {
  const heartbeat = setInterval(() => {
    writeSse(res, "heartbeat", { at: Date.now() });
  }, HEARTBEAT_MS);

  const connection = { res, heartbeat };
  const bucket = onlineConnections.get(username) || new Set();
  const wasOnline = bucket.size > 0;
  bucket.add(connection);
  onlineConnections.set(username, bucket);
  if (!wasOnline) {
    pushPresence(username, true);
  }
  return connection;
}

function detachConnection(username, connection) {
  const bucket = onlineConnections.get(username);
  if (!bucket) {
    return;
  }
  clearInterval(connection.heartbeat);
  bucket.delete(connection);
  if (bucket.size === 0) {
    onlineConnections.delete(username);
    pushPresence(username, false);
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

async function handleRegister(req, res) {
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `auth:${address}`,
      MAX_AUTH_REQUESTS_PER_WINDOW,
      "too many auth requests"
    )
  ) {
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, error?.message === "body too large" ? 413 : 400, {
      error: error?.message === "body too large" ? "body too large" : "invalid json"
    });
    return;
  }

  const normalizedUsername = normalizeUsername(body.username);
  const password = normalizePassword(body.password);
  if (!normalizedUsername) {
    sendJson(res, 400, { error: "username must be 3-24 characters using letters, numbers, or underscore" });
    return;
  }
  if (password.length < 4 || password.length > 72) {
    sendJson(res, 400, { error: "password must be 4-72 characters" });
    return;
  }
  if (findUserByKey(normalizedUsername.key)) {
    sendJson(res, 409, { error: "username already exists" });
    return;
  }

  const publicKey = String(body.publicKey || "").trim();
  const privateKeySalt = String(body.privateKeySalt || "").trim();
  const privateKeyIv = String(body.privateKeyIv || "").trim();
  const encryptedPrivateKey = String(body.encryptedPrivateKey || "").trim();

  if (!isBase64Blob(publicKey, PUBLIC_KEY_BYTES.min, PUBLIC_KEY_BYTES.max)) {
    sendJson(res, 400, { error: "invalid public key bundle" });
    return;
  }
  if (!isBase64Blob(privateKeySalt, PRIVATE_KEY_SALT_BYTES.min, PRIVATE_KEY_SALT_BYTES.max)) {
    sendJson(res, 400, { error: "invalid private key bundle" });
    return;
  }
  if (!isBase64Blob(privateKeyIv, PRIVATE_KEY_IV_BYTES.min, PRIVATE_KEY_IV_BYTES.max)) {
    sendJson(res, 400, { error: "invalid private key bundle" });
    return;
  }
  if (
    !isBase64Blob(
      encryptedPrivateKey,
      ENCRYPTED_PRIVATE_KEY_BYTES.min,
      ENCRYPTED_PRIVATE_KEY_BYTES.max
    )
  ) {
    sendJson(res, 400, { error: "invalid private key bundle" });
    return;
  }

  const user = {
    id: crypto.randomUUID(),
    username: normalizedUsername.value,
    usernameKey: normalizedUsername.key,
    passwordHash: hashPassword(password),
    publicKey,
    privateKeySalt,
    privateKeyIv,
    encryptedPrivateKey,
    createdAt: Date.now()
  };
  users.push(user);
  persistUsers();

  const token = createSession(user.username);
  sendJson(res, 201, {
    token,
    user: publicUser(user),
    keyBundle: keyBundleForUser(user)
  });
}

async function handleLogin(req, res) {
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `auth:${address}`,
      MAX_AUTH_REQUESTS_PER_WINDOW,
      "too many auth requests"
    )
  ) {
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, error?.message === "body too large" ? 413 : 400, {
      error: error?.message === "body too large" ? "body too large" : "invalid json"
    });
    return;
  }

  const normalizedUsername = normalizeUsername(body.username);
  const password = normalizePassword(body.password);
  if (!normalizedUsername || !password) {
    sendJson(res, 400, { error: "username and password are required" });
    return;
  }

  const user = findUserByKey(normalizedUsername.key);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    sendJson(res, 401, { error: "invalid username or password" });
    return;
  }
  if (!user.publicKey || !user.privateKeySalt || !user.privateKeyIv || !user.encryptedPrivateKey) {
    sendJson(res, 409, { error: "account key material is missing" });
    return;
  }

  const token = createSession(user.username);
  sendJson(res, 200, {
    token,
    user: publicUser(user),
    keyBundle: keyBundleForUser(user)
  });
}

function handleLogout(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  sessions.delete(session.token);
  sendJson(res, 200, { ok: true });
}

function handleMe(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const user = findUserByUsername(session.username);
  if (!user) {
    sessions.delete(session.token);
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  sendJson(res, 200, {
    user: publicUser(user)
  });
}

function handleUsers(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (rejectIfForbiddenOrLimited(req, res, `api:${address}`, MAX_API_REQUESTS_PER_WINDOW, "too many requests")) {
    return;
  }
  const query = String(url.searchParams.get("q") || "");
  sendJson(res, 200, {
    users: listUsersForSearch(session.username, query)
  });
}

function handleConversations(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (rejectIfForbiddenOrLimited(req, res, `api:${address}`, MAX_API_REQUESTS_PER_WINDOW, "too many requests")) {
    return;
  }
  sendJson(res, 200, {
    conversations: listConversationsFor(session.username)
  });
}

function handleMessages(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (rejectIfForbiddenOrLimited(req, res, `api:${address}`, MAX_API_REQUESTS_PER_WINDOW, "too many requests")) {
    return;
  }

  const peer = findUserByUsername(url.searchParams.get("with"));
  if (!peer || peer.username === session.username) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }

  sendJson(res, 200, {
    peer: {
      username: peer.username,
      online: isUserOnline(peer.username),
      avatarSeed: makeAvatarSeed(peer.username),
      publicKey: peer.publicKey
    },
    messages: messagesBetween(session.username, peer.username).map((message) =>
      createMessageView(message, session.username)
    )
  });
}

async function handleSendMessage(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (rejectIfForbiddenOrLimited(req, res, `api:${address}`, MAX_API_REQUESTS_PER_WINDOW, "too many requests")) {
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, error?.message === "body too large" ? 413 : 400, {
      error: error?.message === "body too large" ? "body too large" : "invalid json"
    });
    return;
  }

  const peer = findUserByUsername(body.to);
  const nonce = String(body.nonce || "").trim();
  const ciphertext = String(body.ciphertext || "").trim();
  if (!peer || peer.username === session.username) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  if (!isBase64Blob(nonce, MESSAGE_NONCE_BYTES.min, MESSAGE_NONCE_BYTES.max)) {
    sendJson(res, 400, { error: "message must be encrypted before sending" });
    return;
  }
  if (!isBase64Blob(ciphertext, MESSAGE_CIPHERTEXT_BYTES.min, MESSAGE_CIPHERTEXT_BYTES.max)) {
    sendJson(res, 400, { error: "message must be encrypted before sending" });
    return;
  }

  const message = {
    id: crypto.randomUUID(),
    from: session.username,
    to: peer.username,
    nonce,
    ciphertext,
    createdAt: Date.now()
  };
  messages.push(message);
  persistMessages();

  const senderView = createMessageView(message, session.username);
  const recipientView = createMessageView(message, peer.username);
  pushEventToUser(session.username, "message", senderView);
  pushEventToUser(peer.username, "message", recipientView);

  sendJson(res, 201, {
    message: senderView,
    conversation: buildConversationSummary(session.username, peer.username)
  });
}

function handleEvents(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (rejectIfForbiddenOrLimited(req, res, `events:${address}`, MAX_API_REQUESTS_PER_WINDOW, "too many event connections")) {
    return;
  }

  res.writeHead(
    200,
    securityHeaders({
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    })
  );
  res.write(": connected\n\n");

  const connection = attachConnection(session.username, res);
  writeSse(res, "ready", {
    me: session.username,
    onlineUsers: listOnlineUsers()
  });

  req.on("close", () => {
    detachConnection(session.username, connection);
  });
}

function serveStatic(req, res, url) {
  let requestPath;
  try {
    requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  } catch (error) {
    sendJson(res, 400, { error: "invalid path" });
    return;
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, requestPath));
  const relativePath = path.relative(PUBLIC_DIR, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(
      200,
      securityHeaders({
        "Content-Type": contentTypes[ext] || "application/octet-stream",
        "Content-Length": stat.size
      })
    );
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

loadData();
setInterval(cleanRateBuckets, RATE_WINDOW_MS).unref();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      users: users.length,
      messages: messages.length,
      onlineUsers: listOnlineUsers().length,
      sessions: sessions.size
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    void handleRegister(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/login") {
    void handleLogin(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/logout") {
    handleLogout(req, res, url);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/me") {
    handleMe(req, res, url);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/users") {
    handleUsers(req, res, url);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/conversations") {
    handleConversations(req, res, url);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/messages") {
    handleMessages(req, res, url);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/messages") {
    void handleSendMessage(req, res, url);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/events") {
    handleEvents(req, res, url);
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res, url);
    return;
  }

  sendJson(res, 405, { error: "method not allowed" });
});

server.requestTimeout = 15000;
server.headersTimeout = 16000;
server.keepAliveTimeout = 65000;

server.listen(PORT, HOST, () => {});
