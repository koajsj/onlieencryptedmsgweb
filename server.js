"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { promisify } = require("node:util");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const SESSION_TTL_MS = Math.max(
  1000,
  Number.parseInt(process.env.SESSION_TTL_MS || `${7 * 24 * 60 * 60 * 1000}`, 10) || 7 * 24 * 60 * 60 * 1000
);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const ADMIN_AUDIT_FILE = path.join(DATA_DIR, "admin_audit.jsonl");

const MAX_BODY_BYTES = 128 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const MAX_AUTH_REQUESTS_PER_WINDOW = 40;
const MAX_API_REQUESTS_PER_WINDOW = 240;
const MAX_MESSAGES_PER_CONVERSATION_WINDOW = Math.max(
  1,
  Number.parseInt(process.env.MAX_MESSAGES_PER_CONVERSATION_WINDOW || "60", 10) || 60
);
const HEARTBEAT_MS = 15000;
const EVENT_TICKET_TTL_MS = 15000;
const MESSAGE_PERSIST_DEBOUNCE_MS = Math.max(
  10,
  Number.parseInt(process.env.MESSAGE_PERSIST_DEBOUNCE_MS || "180", 10) || 180
);
const HSTS_MAX_AGE_SECONDS = Math.max(0, Number.parseInt(process.env.HSTS_MAX_AGE_SECONDS || "0", 10) || 0);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "qwer@1234";
const ADMIN_ACCOUNTS = String(
  process.env.ADMIN_ACCOUNTS || `${ADMIN_USERNAME}:${ADMIN_PASSWORD}:superadmin`
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const AUDIT_TEXT_RETENTION_DAYS = Math.max(1, Number.parseInt(process.env.AUDIT_TEXT_RETENTION_DAYS || "30", 10) || 30);
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
const conversationRateBuckets = new Map();
const eventTickets = new Map();
const messageBuckets = new Map();
const scryptAsync = promisify(crypto.scrypt);

let users = [];
let messages = [];
let adminAuditLastHash = "GENESIS";
let pendingMessagesPersistTimer = null;
let messagesDirty = false;

const ADMIN_ROLE_PERMISSIONS = {
  superadmin: new Set([
    "admin:read",
    "admin:user:update",
    "admin:user:batch",
    "admin:messages:read",
    "admin:messages:export",
    "admin:audit:read"
  ]),
  operator: new Set(["admin:read", "admin:user:update", "admin:user:batch", "admin:messages:read", "admin:messages:export"]),
  readonly: new Set(["admin:read", "admin:messages:read", "admin:audit:read"])
};

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, "[]\n", "utf8");
  }
  if (!fs.existsSync(MESSAGES_FILE)) {
    fs.writeFileSync(MESSAGES_FILE, "[]\n", "utf8");
  }
  if (!fs.existsSync(ADMIN_AUDIT_FILE)) {
    fs.writeFileSync(ADMIN_AUDIT_FILE, "", "utf8");
  }
}

function parseAdminAccounts() {
  const accounts = [];
  for (const item of ADMIN_ACCOUNTS) {
    const [username, password, roleRaw] = item.split(":");
    const role = String(roleRaw || "readonly").trim().toLowerCase();
    if (!username || !password || !ADMIN_ROLE_PERMISSIONS[role]) {
      continue;
    }
    accounts.push({
      username: username.trim(),
      password: String(password),
      role
    });
  }
  return accounts;
}

const adminAccounts = parseAdminAccounts();

function findAdminAccount(username) {
  return adminAccounts.find((account) => account.username === username) || null;
}

function sessionHasPermission(session, permission) {
  if (!session || session.role === "admin") {
    return true;
  }
  const granted = ADMIN_ROLE_PERMISSIONS[session.role];
  return Boolean(granted?.has(permission));
}

function applyAuditTextRetention() {
  const cutoff = Date.now() - AUDIT_TEXT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const message of messages) {
    if (!message.auditText) {
      continue;
    }
    if (Number(message.createdAt) < cutoff) {
      message.auditText = "";
      changed = true;
    }
  }
  if (changed) {
    schedulePersistMessages();
  }
}

function loadAdminAuditState() {
  ensureDataFiles();
  try {
    const lines = fs.readFileSync(ADMIN_AUDIT_FILE, "utf8").split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) {
      adminAuditLastHash = "GENESIS";
      return;
    }
    const last = JSON.parse(lines[lines.length - 1]);
    adminAuditLastHash = String(last.hash || "GENESIS");
  } catch (error) {
    adminAuditLastHash = "GENESIS";
  }
}

function appendAdminAuditEntry(entry) {
  const payload = JSON.stringify(entry);
  fs.appendFileSync(ADMIN_AUDIT_FILE, `${payload}\n`, "utf8");
}

function recordAdminAction(action, session, req, details = {}) {
  const entryBase = {
    id: crypto.randomUUID(),
    at: Date.now(),
    action,
    actor: session?.username || "unknown",
    role: session?.role || "unknown",
    ip: getClientAddress(req),
    details
  };
  const hash = crypto
    .createHash("sha256")
    .update(`${adminAuditLastHash}|${JSON.stringify(entryBase)}`)
    .digest("hex");
  const entry = {
    ...entryBase,
    prevHash: adminAuditLastHash,
    hash
  };
  appendAdminAuditEntry(entry);
  adminAuditLastHash = hash;
}

function maskAuditText(value) {
  const text = String(value || "");
  if (!text) {
    return "";
  }
  if (text.length <= 4) {
    return "*".repeat(text.length);
  }
  const start = text.slice(0, 2);
  const end = text.slice(-2);
  return `${start}${"*".repeat(Math.max(2, text.length - 4))}${end}`;
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
  users = readJsonFile(USERS_FILE, []).map((user) => ({
    ...user,
    banned: Boolean(user?.banned),
    bannedReason: String(user?.bannedReason || ""),
    bannedAt: Number.parseInt(String(user?.bannedAt || "0"), 10) || 0
  }));
  messages = readJsonFile(MESSAGES_FILE, []).map((message) => ({
    ...message,
    auditText: typeof message?.auditText === "string" ? message.auditText : ""
  }));
  rebuildMessageBuckets();
}

function persistUsers() {
  writeJsonFile(USERS_FILE, users);
}

function persistMessagesNow() {
  writeJsonFile(MESSAGES_FILE, messages);
}

function flushPendingMessagePersist() {
  if (pendingMessagesPersistTimer) {
    clearTimeout(pendingMessagesPersistTimer);
    pendingMessagesPersistTimer = null;
  }
  if (!messagesDirty) {
    return;
  }
  messagesDirty = false;
  persistMessagesNow();
}

function schedulePersistMessages() {
  messagesDirty = true;
  if (pendingMessagesPersistTimer) {
    return;
  }
  pendingMessagesPersistTimer = setTimeout(() => {
    pendingMessagesPersistTimer = null;
    flushPendingMessagePersist();
  }, MESSAGE_PERSIST_DEBOUNCE_MS);
}

function conversationBucketKey(leftUser, rightUser) {
  return leftUser.localeCompare(rightUser) <= 0
    ? `${leftUser}\u0000${rightUser}`
    : `${rightUser}\u0000${leftUser}`;
}

function rebuildMessageBuckets() {
  messageBuckets.clear();
  for (const message of messages) {
    const key = conversationBucketKey(message.from, message.to);
    const bucket = messageBuckets.get(key) || [];
    bucket.push(message);
    messageBuckets.set(key, bucket);
  }
}

function appendMessageBucket(message) {
  const key = conversationBucketKey(message.from, message.to);
  const bucket = messageBuckets.get(key) || [];
  bucket.push(message);
  messageBuckets.set(key, bucket);
}

function securityHeaders(extra = {}) {
  const headers = {
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
  if (HSTS_MAX_AGE_SECONDS > 0) {
    headers["Strict-Transport-Security"] = `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains; preload`;
  }
  return headers;
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

function isRateLimited(bucketMap, key, limit, windowMs = RATE_WINDOW_MS) {
  const now = Date.now();
  const bucket = bucketMap.get(key);
  if (!bucket || now - bucket.startedAt > windowMs) {
    bucketMap.set(key, { count: 1, startedAt: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

function cleanRateBucketMap(bucketMap, windowMs = RATE_WINDOW_MS) {
  const now = Date.now();
  for (const [key, bucket] of bucketMap) {
    if (now - bucket.startedAt > windowMs * 3) {
      bucketMap.delete(key);
    }
  }
}

function cleanRateBuckets() {
  cleanRateBucketMap(rateBuckets, RATE_WINDOW_MS);
  cleanRateBucketMap(conversationRateBuckets, RATE_WINDOW_MS);
}

function cleanSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (!session || session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

function cleanEventTickets() {
  const now = Date.now();
  for (const [ticket, record] of eventTickets) {
    if (!record || record.expiresAt <= now) {
      eventTickets.delete(ticket);
    }
  }
}

function rejectIfForbiddenOrLimited(req, res, key, limit, limitMessage) {
  if (!isSameOriginRequest(req)) {
    sendJson(res, 403, { error: "forbidden origin" });
    return true;
  }
  if (isRateLimited(rateBuckets, key, limit, RATE_WINDOW_MS)) {
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

function normalizeMessageText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
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
    publicKey: user.publicKey,
    banned: Boolean(user.banned),
    bannedReason: String(user.bannedReason || ""),
    bannedAt: Number.parseInt(String(user.bannedAt || "0"), 10) || 0
  };
}

function adminPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    usernameKey: user.usernameKey,
    createdAt: user.createdAt,
    banned: Boolean(user.banned),
    bannedReason: String(user.bannedReason || ""),
    bannedAt: Number.parseInt(String(user.bannedAt || "0"), 10) || 0
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

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)).toString("hex");
  return `${salt}:${hash}`;
}

async function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || "").split(":");
  if (!salt || !hash || !/^[a-f0-9]{128}$/i.test(hash)) {
    return false;
  }
  try {
    const expected = Buffer.from(hash, "hex");
    const computed = await scryptAsync(password, salt, expected.length);
    return crypto.timingSafeEqual(expected, computed);
  } catch (error) {
    return false;
  }
}

function findUserByKey(usernameKey) {
  return users.find((user) => user.usernameKey === usernameKey) || null;
}

function findUserByUsername(username) {
  const normalized = normalizeUsername(username);
  return normalized ? findUserByKey(normalized.key) : null;
}

function createSession(username, role = "user") {
  const token = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  sessions.set(token, {
    token,
    username,
    role,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + SESSION_TTL_MS
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
  const token = parseBearerToken(req);
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
  const now = Date.now();
  if (session.expiresAt <= now) {
    sessions.delete(session.token);
    sendJson(res, 401, { error: "session expired" });
    return null;
  }
  if (session.role === "user") {
    const user = findUserByUsername(session.username);
    if (!user) {
      sessions.delete(session.token);
      sendJson(res, 401, { error: "unauthorized" });
      return null;
    }
    if (user.banned) {
      sessions.delete(session.token);
      sendJson(res, 403, { error: "account banned" });
      return null;
    }
  }
  session.lastSeenAt = now;
  session.expiresAt = now + SESSION_TTL_MS;
  return session;
}

function requireAdminSession(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return null;
  }
  if (!ADMIN_ROLE_PERMISSIONS[session.role]) {
    sendJson(res, 403, { error: "admin required" });
    return null;
  }
  return session;
}

function requireAdminPermission(req, res, url, permission) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return null;
  }
  if (!sessionHasPermission(session, permission)) {
    sendJson(res, 403, { error: "permission denied" });
    return null;
  }
  return session;
}

function createEventTicketForSession(session) {
  const ticket = crypto.randomBytes(24).toString("base64url");
  eventTickets.set(ticket, {
    username: session.username,
    issuedAt: Date.now(),
    expiresAt: Date.now() + EVENT_TICKET_TTL_MS
  });
  return ticket;
}

function consumeEventTicket(ticket) {
  const record = eventTickets.get(ticket);
  eventTickets.delete(ticket);
  if (!record) {
    return null;
  }
  if (record.expiresAt <= Date.now()) {
    return null;
  }
  return record;
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

function parseAdminUserPath(pathname) {
  const match = pathname.match(/^\/api\/admin\/users\/([A-Za-z0-9_]{3,24})$/);
  if (!match) {
    return "";
  }
  return match[1] || "";
}

function adminBasicStats() {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  return {
    users: users.length,
    bannedUsers: users.filter((user) => user.banned).length,
    onlineUsers: listOnlineUsers().length,
    sessions: sessions.size,
    messages: messages.length,
    messages24h: messages.filter((message) => Number(message.createdAt) >= dayAgo).length
  };
}

function adminMessageView(message) {
  return {
    id: message.id,
    from: message.from,
    to: message.to,
    nonce: message.nonce,
    ciphertext: message.ciphertext,
    auditText: String(message.auditText || ""),
    createdAt: message.createdAt
  };
}

function listAdminMessagesPage(limit, beforeCursor) {
  const all = [...messages].sort((left, right) => left.createdAt - right.createdAt);
  let cutoffIndex = all.length;
  if (beforeCursor?.id) {
    const foundIndex = all.findIndex((item) => item.id === beforeCursor.id);
    if (foundIndex >= 0) {
      cutoffIndex = foundIndex;
    }
  }
  const filtered = all.slice(0, cutoffIndex);
  const hasMore = filtered.length > limit;
  const items = hasMore ? filtered.slice(filtered.length - limit) : filtered;
  const nextBefore = hasMore && items.length > 0 ? encodeMessageCursor(items[0]) : "";
  return {
    items,
    hasMore,
    nextBefore
  };
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
    text: typeof message.text === "string" ? message.text : null,
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

  const conversationMessages = messagesBetween(viewer, peer);
  const latest = conversationMessages.at(-1) || null;

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
          text: typeof latest.text === "string" ? latest.text : null,
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
  for (const key of messageBuckets.keys()) {
    const [leftUser, rightUser] = key.split("\u0000");
    if (leftUser === username) {
      peers.add(rightUser);
    } else if (rightUser === username) {
      peers.add(leftUser);
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
  const key = conversationBucketKey(leftUser, rightUser);
  const bucket = messageBuckets.get(key) || [];
  return [...bucket].sort((left, right) => left.createdAt - right.createdAt);
}

function encodeMessageCursor(message) {
  return String(message.id || "");
}

function parseMessageCursor(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return null;
  }
  return { id: value };
}

function parsePositiveInteger(rawValue, fallback, min, max) {
  const parsed = Number.parseInt(String(rawValue || ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function pagedMessagesBetween(leftUser, rightUser, limit, beforeCursor) {
  const allMessages = messagesBetween(leftUser, rightUser);
  let cutoffIndex = allMessages.length;
  if (beforeCursor?.id) {
    const foundIndex = allMessages.findIndex((item) => item.id === beforeCursor.id);
    if (foundIndex >= 0) {
      cutoffIndex = foundIndex;
    }
  }
  const filtered = allMessages.slice(0, cutoffIndex);
  const hasMore = filtered.length > limit;
  const items = hasMore ? filtered.slice(filtered.length - limit) : filtered;
  const nextBefore = hasMore && items.length > 0 ? encodeMessageCursor(items[0]) : "";
  return {
    items,
    hasMore,
    nextBefore
  };
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

function disconnectUserRealtime(username, reason = "admin action") {
  const bucket = onlineConnections.get(username);
  if (!bucket || bucket.size === 0) {
    return;
  }
  for (const connection of bucket) {
    try {
      writeSse(connection.res, "system", { reason, at: Date.now() });
      connection.res.end();
    } catch (error) {
      // ignore close errors
    }
    clearInterval(connection.heartbeat);
  }
  onlineConnections.delete(username);
  pushPresence(username, false);
}

function purgeUserEventTickets(username) {
  for (const [ticket, record] of eventTickets) {
    if (record?.username === username) {
      eventTickets.delete(ticket);
    }
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];

    req.on("data", (chunk) => {
      if (tooLarge) {
        return;
      }
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        req.resume();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (tooLarge) {
        reject(new Error("body too large"));
        return;
      }
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
      `auth:register:${address}`,
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
    passwordHash: await hashPassword(password),
    publicKey,
    privateKeySalt,
    privateKeyIv,
    encryptedPrivateKey,
    banned: false,
    bannedReason: "",
    bannedAt: 0,
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
      `auth:login:${address}`,
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
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    sendJson(res, 401, { error: "invalid username or password" });
    return;
  }
  if (user.banned) {
    sendJson(res, 403, { error: "account banned" });
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

function handleMeKeyBundle(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:me:key-bundle:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const user = findUserByUsername(session.username);
  if (!user) {
    sessions.delete(session.token);
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  sendJson(res, 200, {
    user: publicUser(user),
    keyBundle: keyBundleForUser(user)
  });
}

async function handleAdminLogin(req, res) {
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `auth:admin:${address}`,
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
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const account = findAdminAccount(username);
  if (!account || account.password !== password) {
    sendJson(res, 401, { error: "invalid admin credentials" });
    return;
  }
  const token = createSession(account.username, account.role);
  recordAdminAction("admin_login", { username: account.username, role: account.role }, req, {});
  sendJson(res, 200, {
    token,
    admin: {
      username: account.username,
      role: account.role
    }
  });
}

function handleAdminLogout(req, res, url) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return;
  }
  recordAdminAction("admin_logout", session, req, {});
  sessions.delete(session.token);
  sendJson(res, 200, { ok: true });
}

function handleAdminMe(req, res, url) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return;
  }
  sendJson(res, 200, {
    admin: {
      username: session.username,
      role: session.role
    }
  });
}

function handleAdminStats(req, res, url) {
  const session = requireAdminPermission(req, res, url, "admin:read");
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:stats:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  sendJson(res, 200, {
    stats: adminBasicStats()
  });
}

function handleAdminUsers(req, res, url) {
  const session = requireAdminPermission(req, res, url, "admin:read");
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:users:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const status = String(url.searchParams.get("status") || "all").trim().toLowerCase();
  const sortBy = String(url.searchParams.get("sort") || "username").trim();
  const order = String(url.searchParams.get("order") || "asc").trim().toLowerCase() === "desc" ? "desc" : "asc";
  const page = parsePositiveInteger(url.searchParams.get("page"), 1, 1, 99999);
  const limit = parsePositiveInteger(url.searchParams.get("limit"), 50, 1, 200);
  const filtered = users.filter((user) => {
    if (query && !user.usernameKey.includes(query)) {
      return false;
    }
    if (status === "banned" && !user.banned) {
      return false;
    }
    if (status === "active" && user.banned) {
      return false;
    }
    return true;
  });
  filtered.sort((left, right) => {
    const l = sortBy === "createdAt" ? Number(left.createdAt) : String(left.username).toLowerCase();
    const r = sortBy === "createdAt" ? Number(right.createdAt) : String(right.username).toLowerCase();
    if (l === r) {
      return 0;
    }
    if (order === "desc") {
      return l < r ? 1 : -1;
    }
    return l > r ? 1 : -1;
  });
  const offset = (page - 1) * limit;
  const rows = filtered.slice(offset, offset + limit).map((user) => adminPublicUser(user));
  sendJson(res, 200, {
    users: rows,
    page,
    limit,
    total: filtered.length
  });
}

async function handleAdminUserPatch(req, res, url, pathname) {
  const session = requireAdminPermission(req, res, url, "admin:user:update");
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:user-patch:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const targetUsername = parseAdminUserPath(pathname);
  if (!targetUsername) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  const user = findUserByUsername(targetUsername);
  if (!user) {
    sendJson(res, 404, { error: "user not found" });
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

  const requestedName = String(body.username || "").trim();
  const oldState = adminPublicUser(user);
  if (requestedName) {
    const normalizedUsername = normalizeUsername(requestedName);
    if (!normalizedUsername) {
      sendJson(res, 400, { error: "username must be 3-24 characters using letters, numbers, or underscore" });
      return;
    }
    if (normalizedUsername.key !== user.usernameKey && findUserByKey(normalizedUsername.key)) {
      sendJson(res, 409, { error: "username already exists" });
      return;
    }
    const previousUsername = user.username;
    user.username = normalizedUsername.value;
    user.usernameKey = normalizedUsername.key;
    for (const message of messages) {
      if (message.from === previousUsername) {
        message.from = user.username;
      }
      if (message.to === previousUsername) {
        message.to = user.username;
      }
    }
    rebuildMessageBuckets();
    for (const sessionRecord of sessions.values()) {
      if (sessionRecord.role === "user" && sessionRecord.username === previousUsername) {
        sessionRecord.username = user.username;
      }
    }
    const connections = onlineConnections.get(previousUsername);
    if (connections) {
      onlineConnections.delete(previousUsername);
      onlineConnections.set(user.username, connections);
    }
    purgeUserEventTickets(previousUsername);
  }

  if (Object.prototype.hasOwnProperty.call(body, "banned")) {
    const banned = Boolean(body.banned);
    user.banned = banned;
    user.bannedReason = banned ? String(body.bannedReason || "admin action").slice(0, 120) : "";
    user.bannedAt = banned ? Date.now() : 0;
    if (banned) {
      for (const [token, sessionRecord] of sessions) {
        if (sessionRecord.role === "user" && sessionRecord.username === user.username) {
          sessions.delete(token);
        }
      }
      disconnectUserRealtime(user.username, "account banned by admin");
      purgeUserEventTickets(user.username);
    }
  }

  if (typeof body.password === "string" && body.password.trim()) {
    const nextPassword = normalizePassword(body.password);
    if (nextPassword.length < 4 || nextPassword.length > 72) {
      sendJson(res, 400, { error: "password must be 4-72 characters" });
      return;
    }
    user.passwordHash = await hashPassword(nextPassword);
  }

  persistUsers();
  schedulePersistMessages();
  recordAdminAction("admin_user_patch", session, req, {
    target: targetUsername,
    before: oldState,
    after: adminPublicUser(user)
  });
  sendJson(res, 200, {
    user: adminPublicUser(user)
  });
}

async function handleAdminUsersBatch(req, res, url) {
  const session = requireAdminPermission(req, res, url, "admin:user:batch");
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:users:batch:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
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
  const usernames = Array.isArray(body.usernames) ? body.usernames.map((item) => String(item || "").trim()) : [];
  const banned = Boolean(body.banned);
  const reason = String(body.bannedReason || "admin batch action").slice(0, 120);
  const targetUsers = users.filter((user) => usernames.includes(user.username)).slice(0, 200);
  for (const user of targetUsers) {
    user.banned = banned;
    user.bannedReason = banned ? reason : "";
    user.bannedAt = banned ? Date.now() : 0;
    if (banned) {
      for (const [token, sessionRecord] of sessions) {
        if (sessionRecord.role === "user" && sessionRecord.username === user.username) {
          sessions.delete(token);
        }
      }
      disconnectUserRealtime(user.username, "account banned by admin");
      purgeUserEventTickets(user.username);
    }
  }
  persistUsers();
  recordAdminAction("admin_users_batch", session, req, {
    targets: targetUsers.map((user) => user.username),
    banned
  });
  sendJson(res, 200, {
    updated: targetUsers.length
  });
}

function handleAdminAuditLogs(req, res, url) {
  const session = requireAdminPermission(req, res, url, "admin:audit:read");
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:audit:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const limit = parsePositiveInteger(url.searchParams.get("limit"), 100, 1, 300);
  const lines = fs.readFileSync(ADMIN_AUDIT_FILE, "utf8").split(/\r?\n/).filter(Boolean);
  const items = lines
    .slice(Math.max(0, lines.length - limit))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
  sendJson(res, 200, {
    logs: items
  });
}

function handleAdminExportMessages(req, res, url) {
  const session = requireAdminPermission(req, res, url, "admin:messages:export");
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:messages:export:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const reason = String(url.searchParams.get("reason") || "").trim();
  if (!reason) {
    sendJson(res, 400, { error: "export reason is required" });
    return;
  }
  const fromFilter = String(url.searchParams.get("from") || "").trim();
  const toFilter = String(url.searchParams.get("to") || "").trim();
  const keyword = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const since = Number.parseInt(String(url.searchParams.get("since") || "0"), 10) || 0;
  const until = Number.parseInt(String(url.searchParams.get("until") || "0"), 10) || 0;
  const watermark = `EXPORT WATERMARK | admin=${session.username} | role=${session.role} | ip=${address} | at=${new Date().toISOString()} | reason=${reason}`;
  const rows = messages
    .filter((message) => (!fromFilter || message.from === fromFilter) && (!toFilter || message.to === toFilter))
    .filter((message) => (!since || Number(message.createdAt) >= since) && (!until || Number(message.createdAt) <= until))
    .filter((message) => !keyword || String(message.auditText || "").toLowerCase().includes(keyword))
    .slice(-5000);
  const contentRows = rows.map((message) => {
    const text = session.role === "superadmin" ? String(message.auditText || "") : maskAuditText(message.auditText || "");
    return `[${new Date(message.createdAt).toISOString()}] ${message.from} -> ${message.to} : ${text}`;
  });
  recordAdminAction("admin_messages_export", session, req, {
    reason,
    count: rows.length,
    filters: { fromFilter, toFilter, keyword, since, until }
  });
  sendJson(res, 200, {
    filename: `admin-export-${Date.now()}.txt`,
    watermark,
    content: [watermark, ...contentRows].join("\n")
  });
}

function handleAdminMessages(req, res, url) {
  const session = requireAdminPermission(req, res, url, "admin:messages:read");
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:messages:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const limit = parsePositiveInteger(url.searchParams.get("limit"), 100, 1, 300);
  const beforeCursor = parseMessageCursor(url.searchParams.get("before"));
  const fromFilter = String(url.searchParams.get("from") || "").trim();
  const toFilter = String(url.searchParams.get("to") || "").trim();
  const keyword = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const since = Number.parseInt(String(url.searchParams.get("since") || "0"), 10) || 0;
  const until = Number.parseInt(String(url.searchParams.get("until") || "0"), 10) || 0;
  const mask = session.role === "superadmin" ? String(url.searchParams.get("mask") || "1") !== "0" : true;
  const allMessages = [...messages]
    .filter((message) => (!fromFilter || message.from === fromFilter) && (!toFilter || message.to === toFilter))
    .filter((message) => (!since || Number(message.createdAt) >= since) && (!until || Number(message.createdAt) <= until))
    .filter((message) => !keyword || String(message.auditText || "").toLowerCase().includes(keyword))
    .sort((left, right) => left.createdAt - right.createdAt);
  let cutoffIndex = allMessages.length;
  if (beforeCursor?.id) {
    const foundIndex = allMessages.findIndex((item) => item.id === beforeCursor.id);
    if (foundIndex >= 0) {
      cutoffIndex = foundIndex;
    }
  }
  const filtered = allMessages.slice(0, cutoffIndex);
  const hasMore = filtered.length > limit;
  const items = hasMore ? filtered.slice(filtered.length - limit) : filtered;
  const nextBefore = hasMore && items.length > 0 ? encodeMessageCursor(items[0]) : "";
  sendJson(res, 200, {
    messages: items.map((message) => {
      const row = adminMessageView(message);
      row.auditText = mask ? maskAuditText(row.auditText) : row.auditText;
      return row;
    }),
    hasMore,
    nextBefore
  });
}

function handleUsers(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (rejectIfForbiddenOrLimited(req, res, `api:users:${address}`, MAX_API_REQUESTS_PER_WINDOW, "too many requests")) {
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
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:conversations:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
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
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:messages:get:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }

  const peer = findUserByUsername(url.searchParams.get("with"));
  if (!peer || peer.username === session.username) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  const limit = parsePositiveInteger(url.searchParams.get("limit"), 50, 1, 100);
  const beforeCursor = parseMessageCursor(url.searchParams.get("before"));
  const page = pagedMessagesBetween(session.username, peer.username, limit, beforeCursor);

  sendJson(res, 200, {
    peer: {
      username: peer.username,
      online: isUserOnline(peer.username),
      avatarSeed: makeAvatarSeed(peer.username),
      publicKey: peer.publicKey
    },
    messages: page.items.map((message) => createMessageView(message, session.username)),
    hasMore: page.hasMore,
    nextBefore: page.nextBefore
  });
}

async function handleSendMessage(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:messages:post:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
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

  const peer = findUserByUsername(body.to);
  const nonce = String(body.nonce || "").trim();
  const ciphertext = String(body.ciphertext || "").trim();
  const auditText = normalizeMessageText(body.text);
  if (!peer || peer.username === session.username) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  if (peer.banned) {
    sendJson(res, 403, { error: "peer is banned" });
    return;
  }
  if (
    isRateLimited(
      conversationRateBuckets,
      `msg:${session.username}\u0000${peer.username}`,
      MAX_MESSAGES_PER_CONVERSATION_WINDOW,
      RATE_WINDOW_MS
    )
  ) {
    sendJson(res, 429, { error: "too many messages sent" });
    return;
  }
  if (!isBase64Blob(nonce, MESSAGE_NONCE_BYTES.min, MESSAGE_NONCE_BYTES.max)) {
    sendJson(res, 400, { error: "invalid message payload" });
    return;
  }
  if (!isBase64Blob(ciphertext, MESSAGE_CIPHERTEXT_BYTES.min, MESSAGE_CIPHERTEXT_BYTES.max)) {
    sendJson(res, 400, { error: "invalid message payload" });
    return;
  }
  if (auditText.length > 4000) {
    sendJson(res, 400, { error: "message text too long" });
    return;
  }

  const message = {
    id: crypto.randomUUID(),
    from: session.username,
    to: peer.username,
    nonce,
    ciphertext,
    auditText,
    createdAt: Date.now()
  };
  messages.push(message);
  appendMessageBucket(message);
  schedulePersistMessages();

  const senderView = createMessageView(message, session.username);
  const recipientView = createMessageView(message, peer.username);
  pushEventToUser(session.username, "message", senderView);
  pushEventToUser(peer.username, "message", recipientView);

  sendJson(res, 201, {
    message: senderView,
    conversation: buildConversationSummary(session.username, peer.username)
  });
}

function handleCreateEventTicket(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `events:ticket:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  sendJson(res, 200, {
    ticket: createEventTicketForSession(session),
    expiresInMs: EVENT_TICKET_TTL_MS
  });
}

function handleEvents(req, res, url) {
  const ticket = String(url.searchParams.get("ticket") || "").trim();
  if (!ticket) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  const ticketRecord = consumeEventTicket(ticket);
  if (!ticketRecord) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  const user = findUserByUsername(ticketRecord.username);
  if (!user || user.banned) {
    sendJson(res, 403, { error: "account banned" });
    return;
  }

  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `events:${ticketRecord.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many event connections"
    )
  ) {
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

  const connection = attachConnection(ticketRecord.username, res);
  writeSse(res, "ready", {
    me: ticketRecord.username,
    onlineUsers: listOnlineUsers()
  });

  req.on("close", () => {
    detachConnection(ticketRecord.username, connection);
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
applyAuditTextRetention();
loadAdminAuditState();
setInterval(cleanRateBuckets, RATE_WINDOW_MS).unref();
setInterval(cleanSessions, Math.min(5 * 60 * 1000, SESSION_TTL_MS)).unref();
setInterval(cleanEventTickets, EVENT_TICKET_TTL_MS).unref();
setInterval(applyAuditTextRetention, 60 * 60 * 1000).unref();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      users: users.length,
      messages: messages.length,
      onlineUsers: listOnlineUsers().length,
      sessions: sessions.size
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/login") {
    void handleAdminLogin(req, res);
    return;
  }
  if (req.method === "POST" && pathname === "/api/admin/logout") {
    handleAdminLogout(req, res, url);
    return;
  }
  if (req.method === "GET" && pathname === "/api/admin/me") {
    handleAdminMe(req, res, url);
    return;
  }
  if (req.method === "GET" && pathname === "/api/admin/stats") {
    handleAdminStats(req, res, url);
    return;
  }
  if (req.method === "GET" && pathname === "/api/admin/users") {
    handleAdminUsers(req, res, url);
    return;
  }
  if (req.method === "POST" && pathname === "/api/admin/users/batch") {
    void handleAdminUsersBatch(req, res, url);
    return;
  }
  if (req.method === "PATCH" && parseAdminUserPath(pathname)) {
    void handleAdminUserPatch(req, res, url, pathname);
    return;
  }
  if (req.method === "GET" && pathname === "/api/admin/messages") {
    handleAdminMessages(req, res, url);
    return;
  }
  if (req.method === "GET" && pathname === "/api/admin/messages/export") {
    handleAdminExportMessages(req, res, url);
    return;
  }
  if (req.method === "GET" && pathname === "/api/admin/audit") {
    handleAdminAuditLogs(req, res, url);
    return;
  }

  if (req.method === "POST" && pathname === "/api/register") {
    void handleRegister(req, res);
    return;
  }
  if (req.method === "POST" && pathname === "/api/login") {
    void handleLogin(req, res);
    return;
  }
  if (req.method === "POST" && pathname === "/api/logout") {
    handleLogout(req, res, url);
    return;
  }
  if (req.method === "GET" && pathname === "/api/me") {
    handleMe(req, res, url);
    return;
  }
  if (req.method === "GET" && pathname === "/api/me/key-bundle") {
    handleMeKeyBundle(req, res, url);
    return;
  }
  if (req.method === "GET" && pathname === "/api/users") {
    handleUsers(req, res, url);
    return;
  }
  if (req.method === "GET" && pathname === "/api/conversations") {
    handleConversations(req, res, url);
    return;
  }
  if (req.method === "GET" && pathname === "/api/messages") {
    handleMessages(req, res, url);
    return;
  }
  if (req.method === "POST" && pathname === "/api/messages") {
    void handleSendMessage(req, res, url);
    return;
  }
  if (req.method === "POST" && pathname === "/api/events/token") {
    handleCreateEventTicket(req, res, url);
    return;
  }
  if (req.method === "GET" && pathname === "/api/events") {
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

process.on("beforeExit", flushPendingMessagePersist);
process.on("exit", flushPendingMessagePersist);
process.on("SIGINT", () => {
  flushPendingMessagePersist();
  process.exit(0);
});
process.on("SIGTERM", () => {
  flushPendingMessagePersist();
  process.exit(0);
});

server.listen(PORT, HOST, () => {});
