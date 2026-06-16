"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { promisify } = require("node:util");
const { createAccessLogMiddleware } = require("./middleware/access-log");
const { createAccessLogStore } = require("./services/access-log-store");

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
const MESSAGES_LOG_FILE = path.join(DATA_DIR, "messages.jsonl");
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
const COOKIE_SECURE =
  process.env.COOKIE_SECURE === "1" || (process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "0");
const ENABLE_ACCESS_LOG = process.env.ENABLE_ACCESS_LOG !== "0";
const USER_SESSION_COOKIE = "secure_chat_session";
const ADMIN_SESSION_COOKIE = "secure_chat_admin_session";
const DEFAULT_ADMIN_USERNAME_VALUE = "admin";
const DEFAULT_ADMIN_PASSWORD_VALUE = "qwer@1234";
const ALLOW_INSECURE_DEFAULT_ADMIN = process.env.ALLOW_INSECURE_DEFAULT_ADMIN === "1";
const ADMIN_CONFIG_ENV_FILE = process.env.ADMIN_CONFIG_ENV_FILE || "/etc/default/secure-chat";
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
// AES-GCM ciphertext includes a 16-byte auth tag, so short plaintext messages
// can legitimately produce ciphertext as small as 16 bytes.
const MESSAGE_CIPHERTEXT_BYTES = { min: 16, max: 12288 };

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

const ADMIN_LOGIN_FAILURE_WINDOW_MS = Math.max(
  1000,
  Number.parseInt(process.env.ADMIN_LOGIN_FAILURE_WINDOW_MS || `${15 * 60 * 1000}`, 10) || 15 * 60 * 1000
);
const ADMIN_LOGIN_LOCKOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.ADMIN_LOGIN_LOCKOUT_MS || `${15 * 60 * 1000}`, 10) || 15 * 60 * 1000
);
const ADMIN_LOGIN_MAX_FAILURES = Math.max(
  1,
  Number.parseInt(process.env.ADMIN_LOGIN_MAX_FAILURES || "5", 10) || 5
);
const USER_LOGIN_FAILURE_WINDOW_MS = Math.max(
  1000,
  Number.parseInt(process.env.USER_LOGIN_FAILURE_WINDOW_MS || `${15 * 60 * 1000}`, 10) || 15 * 60 * 1000
);
const USER_LOGIN_LOCKOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.USER_LOGIN_LOCKOUT_MS || `${10 * 60 * 1000}`, 10) || 10 * 60 * 1000
);
const USER_LOGIN_MAX_FAILURES = Math.max(
  1,
  Number.parseInt(process.env.USER_LOGIN_MAX_FAILURES || "8", 10) || 8
);
const MAX_CONCURRENT_EVENT_CONNECTIONS_PER_USER = Math.max(
  1,
  Number.parseInt(process.env.MAX_CONCURRENT_EVENT_CONNECTIONS_PER_USER || "5", 10) || 5
);
const DUMMY_PASSWORD_HASH =
  "scrypt:" +
  "00000000000000000000000000000000" +
  ":" +
  "00000000000000000000000000000000" +
  "00000000000000000000000000000000" +
  "00000000000000000000000000000000" +
  "00000000000000000000000000000000";

const sessions = new Map();
const onlineConnections = new Map();
const rateBuckets = new Map();
const conversationRateBuckets = new Map();
const eventTickets = new Map();
const messageBuckets = new Map();
const messageIdIndex = new Map();
const messageClientIndex = new Map();
const usersByKey = new Map();
const adminLoginFailures = new Map();
const userLoginFailures = new Map();
const scryptAsync = promisify(crypto.scrypt);

let users = [];
let messages = [];
let adminAuditLastHash = "GENESIS";
const adminAuditEntries = [];
let pendingMessagesPersistTimer = null;
let messagesDirty = false;
let messagesRequireFullPersist = false;
const pendingMessageAppends = [];
const serverStartedAt = Date.now();

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, "[]\n", "utf8");
  }
  if (!fs.existsSync(MESSAGES_FILE)) {
    fs.writeFileSync(MESSAGES_FILE, "[]\n", "utf8");
  }
  if (!fs.existsSync(MESSAGES_LOG_FILE)) {
    fs.writeFileSync(MESSAGES_LOG_FILE, "", "utf8");
  }
  if (!fs.existsSync(ADMIN_AUDIT_FILE)) {
    fs.writeFileSync(ADMIN_AUDIT_FILE, "", "utf8");
  }
}

function findAdminAccount(username) {
  return username === adminConfig.username
    ? {
        username: adminConfig.username
      }
    : null;
}

function purgeStoredMessagePlaintext() {
  let changed = false;
  for (const message of messages) {
    if ("auditText" in message) {
      delete message.auditText;
      changed = true;
    }
  }
  if (changed) {
    schedulePersistMessages();
  }
}

const ADMIN_AUDIT_HMAC_ALGO = "hmac-sha256";
const ADMIN_AUDIT_SHA_ALGO = "sha256";
const ADMIN_AUDIT_HMAC_DOMAIN = "secure-chat/admin-audit-hmac-v1";
let adminConfig = readConfiguredAdminConfig();
validateConfiguredAdminConfig(adminConfig);
const adminAuditHmacKeyState = readAuditHmacKeyState(adminConfig.credential);
const accessLogStore = createAccessLogStore({
  dataDir: DATA_DIR,
  enabled: ENABLE_ACCESS_LOG,
  logger: (error) => {
    console.error(`[access-log] ${error instanceof Error ? error.message : String(error)}`);
  }
});
const accessLogMiddleware = createAccessLogMiddleware({
  enabled: ENABLE_ACCESS_LOG,
  store: accessLogStore,
  cookieSecure: COOKIE_SECURE,
  getClientAddress,
  getSession: getSessionFromRequest
});

function getAuditHmacKey() {
  return adminAuditHmacKeyState;
}

function computeAdminAuditEntryHash(prevHash, entryBase, algo, hmacKey) {
  const payload = `${prevHash}|${JSON.stringify(entryBase)}`;
  if (algo === ADMIN_AUDIT_HMAC_ALGO) {
    return crypto.createHmac("sha256", hmacKey).update(payload).digest("hex");
  }
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function entryBaseFromEntry(entry) {
  const { prevHash: _prev, hash: _hash, hashAlgo: _algo, ...rest } = entry;
  return rest;
}

function loadAdminAuditState() {
  ensureDataFiles();
  const entries = readJsonLinesFile(ADMIN_AUDIT_FILE);
  adminAuditEntries.length = 0;
  adminAuditEntries.push(...entries);
  if (adminAuditEntries.length === 0) {
    adminAuditLastHash = "GENESIS";
    return;
  }
  adminAuditLastHash = String(adminAuditEntries[adminAuditEntries.length - 1].hash || "GENESIS");
}

function appendAdminAuditEntry(entry) {
  const payload = JSON.stringify(entry);
  fs.appendFileSync(ADMIN_AUDIT_FILE, `${payload}\n`, "utf8");
  adminAuditEntries.push(entry);
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
  const { key: hmacKey } = getAuditHmacKey();
  const hash = computeAdminAuditEntryHash(
    adminAuditLastHash,
    entryBase,
    ADMIN_AUDIT_HMAC_ALGO,
    hmacKey
  );
  const entry = {
    ...entryBase,
    prevHash: adminAuditLastHash,
    hashAlgo: ADMIN_AUDIT_HMAC_ALGO,
    hash
  };
  appendAdminAuditEntry(entry);
  adminAuditLastHash = hash;
}

function verifyAdminAuditChain() {
  ensureDataFiles();
  const lines = fs.readFileSync(ADMIN_AUDIT_FILE, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return { ok: true, checked: 0, mismatches: [] };
  }
  const { key: hmacKey, source: hmacKeySource } = getAuditHmacKey();
  let prevHash = "GENESIS";
  const mismatches = [];
  let checked = 0;
  for (const [index, line] of lines.entries()) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      mismatches.push({ line: index + 1, reason: `invalid json: ${error.message}` });
      break;
    }
    const algo = entry.hashAlgo || ADMIN_AUDIT_SHA_ALGO;
    if (algo !== ADMIN_AUDIT_HMAC_ALGO && algo !== ADMIN_AUDIT_SHA_ALGO) {
      mismatches.push({ line: index + 1, reason: `unsupported hashAlgo: ${algo}` });
      break;
    }
    if (String(entry.prevHash || "") !== prevHash) {
      mismatches.push({ line: index + 1, reason: "prevHash mismatch" });
      break;
    }
    const entryBase = entryBaseFromEntry(entry);
    const expected = computeAdminAuditEntryHash(prevHash, entryBase, algo, hmacKey);
    if (algo === ADMIN_AUDIT_HMAC_ALGO) {
      if (!/^[a-f0-9]{64}$/i.test(String(entry.hash || "")) || expected !== String(entry.hash).toLowerCase()) {
        mismatches.push({ line: index + 1, reason: "hash mismatch" });
        break;
      }
    } else if (String(entry.hash || "").toLowerCase() !== expected) {
      mismatches.push({ line: index + 1, reason: "hash mismatch" });
      break;
    }
    prevHash = String(entry.hash);
    checked += 1;
  }
  return { ok: mismatches.length === 0, checked, mismatches, hmacKeySource };
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`failed to parse JSON file ${filePath}: ${error.message}`);
  }
}

function readJsonLinesFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const rows = [];
  const lines = raw.split(/\r?\n/).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`failed to parse JSON line ${index + 1} in ${filePath}: ${error.message}`);
    }
  }
  return rows;
}

function writeJsonFile(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function rewriteJsonLinesFile(filePath, rows) {
  const tempPath = `${filePath}.tmp`;
  const body = rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
  fs.writeFileSync(tempPath, body, "utf8");
  fs.renameSync(tempPath, filePath);
}

function loadData() {
  ensureDataFiles();
  const loadedUsers = readJsonFile(USERS_FILE);
  if (!Array.isArray(loadedUsers)) {
    throw new Error(`expected ${USERS_FILE} to contain a JSON array`);
  }
  users = loadedUsers.map((user) => ({
    ...user,
    id: String(user?.id || crypto.randomUUID()),
    usernameKey: String(user?.usernameKey || normalizeUsername(user?.username)?.key || ""),
    banned: Boolean(user?.banned),
    bannedReason: String(user?.bannedReason || ""),
    bannedAt: Number.parseInt(String(user?.bannedAt || "0"), 10) || 0
  }));
  rebuildUserIndex();

  const logStat = fs.statSync(MESSAGES_LOG_FILE);
  const loadedMessages = logStat.size > 0 ? readJsonLinesFile(MESSAGES_LOG_FILE) : readJsonFile(MESSAGES_FILE);
  if (!Array.isArray(loadedMessages)) {
    throw new Error(`expected ${MESSAGES_FILE} to contain a JSON array`);
  }
  messages = loadedMessages.map((message) => ({
    ...message,
    clientId: typeof message?.clientId === "string" ? message.clientId : ""
  }));
  messages.sort((left, right) => Number(left.createdAt) - Number(right.createdAt));
  rebuildMessageBuckets();
}

function persistUsers() {
  writeJsonFile(USERS_FILE, users);
  rebuildUserIndex();
}

function persistMessagesNow() {
  writeJsonFile(MESSAGES_FILE, messages);
  rewriteJsonLinesFile(MESSAGES_LOG_FILE, messages);
}

function persistMessageAppendsNow(rows) {
  if (rows.length === 0) {
    return;
  }
  fs.appendFileSync(MESSAGES_LOG_FILE, rows.map((row) => `${JSON.stringify(row)}\n`).join(""), "utf8");
}

function flushPendingMessagePersist() {
  if (pendingMessagesPersistTimer) {
    clearTimeout(pendingMessagesPersistTimer);
    pendingMessagesPersistTimer = null;
  }
  if (!messagesDirty) {
    return;
  }
  const appends = pendingMessageAppends.splice(0);
  const shouldFullPersist = messagesRequireFullPersist;
  messagesDirty = false;
  messagesRequireFullPersist = false;
  if (shouldFullPersist) {
    persistMessagesNow();
    return;
  }
  persistMessageAppendsNow(appends);
}

function schedulePersistMessages(message = null) {
  messagesDirty = true;
  if (message) {
    pendingMessageAppends.push(message);
  } else {
    messagesRequireFullPersist = true;
    pendingMessageAppends.length = 0;
  }
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
  messageIdIndex.clear();
  messageClientIndex.clear();
  for (const message of messages) {
    const key = conversationBucketKey(message.from, message.to);
    const bucket = messageBuckets.get(key) || [];
    bucket.push(message);
    messageBuckets.set(key, bucket);
    if (message.id) {
      messageIdIndex.set(message.id, message);
    }
    if (message.clientId) {
      messageClientIndex.set(`${message.from}\u0000${message.to}\u0000${message.clientId}`, message);
    }
  }
  for (const bucket of messageBuckets.values()) {
    bucket.sort((left, right) => left.createdAt - right.createdAt);
  }
}

function rebuildUserIndex() {
  usersByKey.clear();
  for (const user of users) {
    if (user?.usernameKey) {
      usersByKey.set(user.usernameKey, user);
    }
  }
}

function appendMessageBucket(message) {
  const key = conversationBucketKey(message.from, message.to);
  const bucket = messageBuckets.get(key) || [];
  bucket.push(message);
  messageBuckets.set(key, bucket);
  if (message.id) {
    messageIdIndex.set(message.id, message);
  }
  if (message.clientId) {
    messageClientIndex.set(`${message.from}\u0000${message.to}\u0000${message.clientId}`, message);
  }
}

function securityHeaders(extra = {}) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "X-DNS-Prefetch-Control": "off",
    "X-Permitted-Cross-Domain-Policies": "none",
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

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(
    status,
    securityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      ...extraHeaders
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

function normalizedRequestHost(req) {
  const forwardedHost = TRUST_PROXY ? String(req.headers["x-forwarded-host"] || "") : "";
  const rawHost = forwardedHost || String(req.headers.host || "");
  const primaryHost = rawHost.split(",")[0].trim().replace(/^https?:\/\//i, "");
  if (!primaryHost) {
    return "localhost";
  }
  try {
    return new URL(`http://${primaryHost}`).host || "localhost";
  } catch (error) {
    return "localhost";
  }
}

function parseRequestUrl(req) {
  const requestTarget = String(req.url || "/").trim() || "/";
  try {
    return new URL(requestTarget, `http://${normalizedRequestHost(req)}`);
  } catch (error) {
    return null;
  }
}

function isSameOriginRequest(req) {
  const origin = String(req.headers.origin || "");
  const referer = String(req.headers.referer || "");
  if (!origin && !referer) {
    return true;
  }
  try {
    if (origin) {
      if (TRUSTED_ORIGINS.has(origin)) {
        return true;
      }
      return new URL(origin).host === normalizedRequestHost(req);
    }
    const refererUrl = new URL(referer);
    if (TRUSTED_ORIGINS.has(refererUrl.origin)) {
      return true;
    }
    return refererUrl.host === normalizedRequestHost(req);
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

function loginFailureState(failureMap, key) {
  if (!key) {
    return null;
  }
  return failureMap.get(String(key).toLowerCase()) || null;
}

function loginFailureActive(state) {
  if (!state || !state.lockedUntil) {
    return false;
  }
  return state.lockedUntil > Date.now();
}

function recordLoginFailure(failureMap, key, maxFailures, failureWindowMs, lockoutMs) {
  const normalizedKey = String(key || "").toLowerCase();
  if (!normalizedKey) {
    return null;
  }
  const now = Date.now();
  const previous = failureMap.get(normalizedKey);
  const recentFailures = previous && now - (previous.lastFailedAt || 0) <= failureWindowMs
    ? previous.count
    : 0;
  const count = recentFailures + 1;
  const lockedUntil = count > maxFailures ? now + lockoutMs : 0;
  const next = { count, lockedUntil, lastFailedAt: now };
  failureMap.set(normalizedKey, next);
  return next;
}

function clearLoginFailures(failureMap, key) {
  if (!key) {
    return;
  }
  failureMap.delete(String(key).toLowerCase());
}

function cleanLoginFailuresMap(failureMap, failureWindowMs) {
  const now = Date.now();
  for (const [key, state] of failureMap) {
    if (!state) {
      failureMap.delete(key);
      continue;
    }
    const lastFailedAt = Number(state.lastFailedAt || 0);
    if (now - lastFailedAt > failureWindowMs && now > Number(state.lockedUntil || 0)) {
      failureMap.delete(key);
    }
  }
}

function adminLoginLockState(username) {
  return loginFailureState(adminLoginFailures, username);
}

function adminLoginLockActive(state) {
  return loginFailureActive(state);
}

function recordAdminLoginFailure(username) {
  return recordLoginFailure(
    adminLoginFailures,
    username,
    ADMIN_LOGIN_MAX_FAILURES,
    ADMIN_LOGIN_FAILURE_WINDOW_MS,
    ADMIN_LOGIN_LOCKOUT_MS
  );
}

function clearAdminLoginFailures(username) {
  clearLoginFailures(adminLoginFailures, username);
}

function cleanAdminLoginFailures() {
  cleanLoginFailuresMap(adminLoginFailures, ADMIN_LOGIN_FAILURE_WINDOW_MS);
}

function userLoginLockState(username) {
  return loginFailureState(userLoginFailures, username);
}

function userLoginLockActive(state) {
  return loginFailureActive(state);
}

function recordUserLoginFailure(username) {
  return recordLoginFailure(
    userLoginFailures,
    username,
    USER_LOGIN_MAX_FAILURES,
    USER_LOGIN_FAILURE_WINDOW_MS,
    USER_LOGIN_LOCKOUT_MS
  );
}

function clearUserLoginFailures(username) {
  clearLoginFailures(userLoginFailures, username);
}

function cleanUserLoginFailures() {
  cleanLoginFailuresMap(userLoginFailures, USER_LOGIN_FAILURE_WINDOW_MS);
}

function cacheControlForStaticFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") {
    return "no-store";
  }
  if ([".js", ".css", ".json"].includes(ext)) {
    return "public, max-age=0, must-revalidate";
  }
  return "public, max-age=86400";
}

function weakEtagForStat(stat) {
  return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
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

function isReservedUsernameKey(usernameKey) {
  return String(usernameKey || "").trim().toLowerCase() === String(adminConfig.username || "").trim().toLowerCase();
}

function normalizePassword(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeBoundedText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, maxLength);
}

function normalizeAuditReason(value, fallback) {
  const normalized = normalizeBoundedText(value, 120).replace(/\s+/g, " ");
  return normalized || fallback;
}

function readOptionalUsernameFilter(value) {
  const raw = normalizeBoundedText(value, 24);
  if (!raw) {
    return { ok: true, value: "" };
  }
  const normalized = normalizeUsername(raw);
  if (!normalized) {
    return { ok: false, value: "" };
  }
  return { ok: true, value: normalized.value };
}

function readSubmittedUsername(body) {
  if (!body || typeof body !== "object") {
    return "";
  }
  const account =
    body.username !== undefined
      ? body.username
      : body.account !== undefined
        ? body.account
        : body.email;
  return typeof account === "string" ? account.trim() : "";
}

function normalizeMessageText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function normalizeClientId(value) {
  if (typeof value !== "string") {
    return "";
  }
  const clientId = value.trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(clientId)) {
    return "";
  }
  return clientId;
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

function summarizeEncodedBlob(value) {
  const raw = String(value || "");
  const bytes = decodeBase64Blob(raw);
  return {
    present: raw.length > 0,
    bytes: bytes ? bytes.length : 0,
    preview: raw.length > 36 ? `${raw.slice(0, 16)}...${raw.slice(-12)}` : raw
  };
}

function makeAvatarSeed(username) {
  return crypto.createHash("sha1").update(username).digest("hex").slice(0, 8);
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

async function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split(":");
  const [salt, hash] = parts[0] === "scrypt" ? parts.slice(1) : parts;
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

function isPasswordHashFormat(value) {
  const parts = String(value || "").split(":");
  const [salt, hash] = parts[0] === "scrypt" ? parts.slice(1) : parts;
  return Boolean(salt) && /^[a-f0-9]{128}$/i.test(String(hash || ""));
}

function readConfiguredAdminUsername() {
  const fromEnv = normalizeUsername(process.env.ADMIN_USERNAME || readEnvFileValue("ADMIN_USERNAME"));
  if (fromEnv) {
    return fromEnv.value;
  }
  return DEFAULT_ADMIN_USERNAME_VALUE;
}

function readConfiguredAdminConfig() {
  return {
    username: readConfiguredAdminUsername(),
    credential: readConfiguredAdminCredential()
  };
}

function readConfiguredAdminCredential() {
  const fromEnv = normalizePassword(process.env.ADMIN_PASSWORD || readEnvFileValue("ADMIN_PASSWORD"));
  if (fromEnv.length >= 4 && fromEnv.length <= 72) {
    return {
      type: "plain",
      value: fromEnv
    };
  }

  const hash = String(process.env.ADMIN_PASSWORD_HASH || readEnvFileValue("ADMIN_PASSWORD_HASH")).trim();
  if (isPasswordHashFormat(hash)) {
    return {
      type: "hash",
      value: hash
    };
  }

  if (ALLOW_INSECURE_DEFAULT_ADMIN) {
    return {
      type: "plain",
      value: DEFAULT_ADMIN_PASSWORD_VALUE
    };
  }

  return {
    type: "missing",
    value: ""
  };
}

function validateConfiguredAdminConfig(config = adminConfig) {
  const credential = config?.credential;
  if (!credential || credential.type === "missing" || !credential.value) {
    throw new Error("admin credentials are not configured; set ADMIN_PASSWORD or ADMIN_PASSWORD_HASH");
  }
  if (
    credential.type === "plain" &&
    credential.value === DEFAULT_ADMIN_PASSWORD_VALUE &&
    !ALLOW_INSECURE_DEFAULT_ADMIN
  ) {
    throw new Error("insecure default admin password is disabled; set ADMIN_PASSWORD or ADMIN_PASSWORD_HASH");
  }
}

function readAuditHmacKeyState(credential) {
  const fromEnv = String(process.env.AUDIT_HMAC_KEY || "").trim();
  if (fromEnv) {
    const hexMatch = fromEnv.match(/^[a-f0-9]{32,128}$/i);
    if (hexMatch) {
      return { key: Buffer.from(fromEnv, "hex"), source: "env:hex" };
    }
    return { key: crypto.createHash("sha256").update(fromEnv, "utf8").digest(), source: "env:utf8" };
  }
  const derived = crypto
    .createHmac("sha256", ADMIN_AUDIT_HMAC_DOMAIN)
    .update(String(credential?.value || ""), "utf8")
    .digest();
  return { key: derived, source: `derived:${String(credential?.type || "plain")}` };
}

function verifyPlainSecret(password, expected) {
  const providedDigest = crypto.createHash("sha256").update(String(password || ""), "utf8").digest();
  const expectedDigest = crypto.createHash("sha256").update(String(expected || ""), "utf8").digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

function readEnvFileValue(key) {
  const envFilePath = String(ADMIN_CONFIG_ENV_FILE || "").trim();
  if (!envFilePath || !path.isAbsolute(envFilePath) || !fs.existsSync(envFilePath)) {
    return "";
  }
  try {
    const entries = parseEnvFile(fs.readFileSync(envFilePath, "utf8"));
    return String(entries.get(key) || "").trim();
  } catch (error) {
    return "";
  }
}

async function verifyConfiguredAdminPassword(password) {
  const credential = adminConfig.credential;
  if (credential.type === "hash") {
    return verifyPassword(password, credential.value);
  }
  return verifyPlainSecret(password, credential.value);
}

function verifyAdminUpdatePassphrase(passphrase) {
  const expected = normalizePassword(process.env.ADMIN_UPDATE_PASSPHRASE || readEnvFileValue("ADMIN_UPDATE_PASSPHRASE"));
  if (!expected) {
    return { ok: false, reason: "missing" };
  }
  return {
    ok: verifyPlainSecret(passphrase, expected),
    reason: "invalid"
  };
}

function parseEnvFile(content) {
  const entries = new Map();
  for (const line of String(content || "").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }
    entries.set(match[1], match[2]);
  }
  return entries;
}

function upsertEnvLines(lines, key, value) {
  const nextLine = `${key}=${value}`;
  let replaced = false;
  const nextLines = lines
    .filter((line) => !new RegExp(`^\\s*${key}=`).test(line))
    .map((line) => line);
  for (let index = 0; index < lines.length; index += 1) {
    if (new RegExp(`^\\s*${key}=`).test(lines[index])) {
      nextLines.splice(index, 0, nextLine);
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    nextLines.push(nextLine);
  }
  return nextLines;
}

function removeEnvKey(lines, key) {
  return lines.filter((line) => !new RegExp(`^\\s*${key}=`).test(line));
}

function persistAdminConfigToEnvironment(nextConfig) {
  const envFilePath = String(ADMIN_CONFIG_ENV_FILE || "").trim();
  if (!envFilePath || !path.isAbsolute(envFilePath)) {
    throw new Error("管理员配置文件路径无效");
  }
  const existingContent = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, "utf8") : "";
  let lines = String(existingContent || "").split(/\r?\n/).filter((line) => line.length > 0);
  lines = upsertEnvLines(lines, "ADMIN_USERNAME", nextConfig.username);
  if (nextConfig.credential.type === "plain") {
    lines = upsertEnvLines(lines, "ADMIN_PASSWORD", nextConfig.credential.value);
    lines = removeEnvKey(lines, "ADMIN_PASSWORD_HASH");
  } else {
    lines = upsertEnvLines(lines, "ADMIN_PASSWORD_HASH", nextConfig.credential.value);
    lines = removeEnvKey(lines, "ADMIN_PASSWORD");
  }
  if (!parseEnvFile(existingContent).has("AUDIT_HMAC_KEY")) {
    lines = upsertEnvLines(lines, "AUDIT_HMAC_KEY", adminAuditHmacKeyState.key.toString("hex"));
  }
  fs.mkdirSync(path.dirname(envFilePath), { recursive: true });
  fs.writeFileSync(envFilePath, `${lines.join("\n")}\n`, "utf8");
  try {
    fs.chmodSync(envFilePath, 0o600);
  } catch (error) {
    // Ignore permission update failures on non-Linux environments.
  }
}

function persistAdminConfigToEnvironmentSafe(nextConfig) {
  const envFilePath = String(ADMIN_CONFIG_ENV_FILE || "").trim();
  if (!envFilePath || !path.isAbsolute(envFilePath)) {
    throw new Error("管理员配置文件路径无效");
  }
  const existingContent = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, "utf8") : "";
  let lines = String(existingContent || "").split(/\r?\n/).filter((line) => line.length > 0);
  lines = upsertEnvLines(lines, "ADMIN_USERNAME", nextConfig.username);
  if (nextConfig.credential.type === "plain") {
    lines = upsertEnvLines(lines, "ADMIN_PASSWORD", nextConfig.credential.value);
    lines = removeEnvKey(lines, "ADMIN_PASSWORD_HASH");
  } else {
    lines = upsertEnvLines(lines, "ADMIN_PASSWORD_HASH", nextConfig.credential.value);
    lines = removeEnvKey(lines, "ADMIN_PASSWORD");
  }
  if (!parseEnvFile(existingContent).has("AUDIT_HMAC_KEY")) {
    lines = upsertEnvLines(lines, "AUDIT_HMAC_KEY", adminAuditHmacKeyState.key.toString("hex"));
  }
  fs.mkdirSync(path.dirname(envFilePath), { recursive: true });
  fs.writeFileSync(envFilePath, `${lines.join("\n")}\n`, "utf8");
  try {
    fs.chmodSync(envFilePath, 0o600);
  } catch (error) {
    // Ignore permission update failures on non-Linux environments.
  }
}

function syncRuntimeAdminConfigFromConfiguredSources() {
  const nextConfig = readConfiguredAdminConfig();
  validateConfiguredAdminConfig(nextConfig);
  if (
    nextConfig.username === adminConfig.username &&
    nextConfig.credential.type === adminConfig.credential.type &&
    nextConfig.credential.value === adminConfig.credential.value
  ) {
    return;
  }
  updateRuntimeAdminConfig(nextConfig);
}

function updateRuntimeAdminConfig(nextConfig) {
  adminConfig = {
    username: nextConfig.username,
    credential: nextConfig.credential
  };
  process.env.ADMIN_USERNAME = nextConfig.username;
  if (nextConfig.credential.type === "plain") {
    process.env.ADMIN_PASSWORD = nextConfig.credential.value;
    delete process.env.ADMIN_PASSWORD_HASH;
  } else {
    process.env.ADMIN_PASSWORD_HASH = nextConfig.credential.value;
    delete process.env.ADMIN_PASSWORD;
  }
}

function findUserByKey(usernameKey) {
  return usersByKey.get(usernameKey) || null;
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

function parseCookies(req) {
  const header = String(req.headers.cookie || "");
  const cookies = new Map();
  for (const item of header.split(";")) {
    const separatorIndex = item.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const name = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch (error) {
      cookies.set(name, value);
    }
  }
  return cookies;
}

function cookieAttributes(maxAgeSeconds, pathValue = "/") {
  return [
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    `Path=${pathValue}`,
    "HttpOnly",
    "SameSite=Lax",
    COOKIE_SECURE ? "Secure" : ""
  ]
    .filter(Boolean)
    .join("; ");
}

function sessionCookieHeader(name, token, maxAgeMs = SESSION_TTL_MS) {
  return `${name}=${encodeURIComponent(token)}; ${cookieAttributes(maxAgeMs / 1000)}`;
}

function clearSessionCookieHeader(name) {
  return `${name}=; ${cookieAttributes(0)}`;
}

function sessionCookieNameForPath(pathname) {
  return pathname.startsWith("/api/admin") ? ADMIN_SESSION_COOKIE : USER_SESSION_COOKIE;
}

function parseBearerToken(req) {
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) {
    return "";
  }
  return auth.slice(7).trim();
}

function getSessionFromRequest(req, url) {
  const cookies = parseCookies(req);
  const cookieToken = cookies.get(sessionCookieNameForPath(url.pathname)) || "";
  if (cookieToken) {
    const cookieSession = sessions.get(cookieToken);
    if (cookieSession) {
      return cookieSession;
    }
  }
  const bearerToken = parseBearerToken(req);
  if (!bearerToken) {
    return null;
  }
  return sessions.get(bearerToken) || null;
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
  if (session.role !== "admin") {
    sendJson(res, 403, { error: "admin required" });
    return null;
  }
  return session;
}

function requireAdminPermission(req, res, url) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return null;
  }
  return session;
}

function deleteSessionsForUsername(username, role = null) {
  let deleted = 0;
  for (const [token, session] of sessions) {
    if (!session) {
      continue;
    }
    if (session.username !== username) {
      continue;
    }
    if (role !== null && session.role !== role) {
      continue;
    }
    sessions.delete(token);
    deleted += 1;
  }
  return deleted;
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

function fileSizeBytes(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch (error) {
    return 0;
  }
}

function adminHealthSnapshot() {
  const accessLogHealth = accessLogStore.healthSnapshot();
  return {
    ok: true,
    startedAt: serverStartedAt,
    uptimeSeconds: Math.floor(process.uptime()),
    dataDir: DATA_DIR,
    files: {
      usersBytes: fileSizeBytes(USERS_FILE),
      messagesBytes: fileSizeBytes(MESSAGES_FILE),
      messagesLogBytes: fileSizeBytes(MESSAGES_LOG_FILE),
      adminAuditBytes: fileSizeBytes(ADMIN_AUDIT_FILE),
      accessLogDbBytes: Number(accessLogHealth.dbBytes || 0)
    },
    runtime: {
      users: users.length,
      messages: messages.length,
      sessions: sessions.size,
      onlineUsers: listOnlineUsers().length,
      pendingMessageAppends: pendingMessageAppends.length,
      messagesDirty,
      accessLogQueue: Number(accessLogHealth.pendingQueue || 0)
    },
    accessLogs: accessLogHealth
  };
}

function readRecentAdminAuditEntries(limit = 80) {
  return adminAuditEntries.slice(Math.max(0, adminAuditEntries.length - limit));
}

function listUserSessions(username) {
  return [...sessions.values()]
    .filter((sessionRecord) => sessionRecord.role === "user" && sessionRecord.username === username)
    .sort((left, right) => Number(right.lastSeenAt) - Number(left.lastSeenAt))
    .map((sessionRecord) => ({
      createdAt: Number(sessionRecord.createdAt || 0),
      lastSeenAt: Number(sessionRecord.lastSeenAt || 0),
      expiresAt: Number(sessionRecord.expiresAt || 0)
    }));
}

function buildUserMessageStats(username) {
  let sent = 0;
  let received = 0;
  let encrypted = 0;
  let legacyPlaintext = 0;
  let lastMessageAt = 0;
  let firstMessageAt = 0;
  const peers = new Set();
  for (const message of messages) {
    if (message.from !== username && message.to !== username) {
      continue;
    }
    if (message.from === username) {
      sent += 1;
      peers.add(message.to);
    }
    if (message.to === username) {
      received += 1;
      peers.add(message.from);
    }
    if (message.ciphertext) {
      encrypted += 1;
    } else if (typeof message.text === "string" && message.text) {
      legacyPlaintext += 1;
    }
    const createdAt = Number(message.createdAt || 0);
    if (!firstMessageAt || createdAt < firstMessageAt) {
      firstMessageAt = createdAt;
    }
    if (createdAt > lastMessageAt) {
      lastMessageAt = createdAt;
    }
  }
  return {
    sent,
    received,
    total: sent + received,
    encrypted,
    legacyPlaintext,
    peers: peers.size,
    firstMessageAt,
    lastMessageAt
  };
}

function adminUserMessageView(message, username) {
  const peer = message.from === username ? message.to : message.from;
  return {
    id: message.id,
    peer,
    direction: message.from === username ? "sent" : "received",
    from: message.from,
    to: message.to,
    text: typeof message.text === "string" && !message.ciphertext ? message.text : null,
    nonce: String(message.nonce || ""),
    ciphertext: String(message.ciphertext || ""),
    replyTo: normalizeReplyTargetView(message.replyTo) || resolveReplyTarget(message.from, message.to, message.replyToId),
    createdAt: Number(message.createdAt || 0)
  };
}

function listRecentMessagesForUser(username, limit = 40) {
  const rows = [];
  for (let index = messages.length - 1; index >= 0 && rows.length < limit; index -= 1) {
    const message = messages[index];
    if (message.from !== username && message.to !== username) {
      continue;
    }
    rows.push(adminUserMessageView(message, username));
  }
  return rows;
}

function listUserConversationDetails(username, limit = 12) {
  const rows = [];
  for (const [key, bucket] of messageBuckets.entries()) {
    const [leftUser, rightUser] = key.split("\u0000");
    if (leftUser !== username && rightUser !== username) {
      continue;
    }
    const peer = leftUser === username ? rightUser : leftUser;
    const latest = bucket.at(-1) || null;
    let sent = 0;
    let received = 0;
    for (const message of bucket) {
      if (message.from === username) {
        sent += 1;
      } else if (message.to === username) {
        received += 1;
      }
    }
    rows.push({
      username: peer,
      online: isUserOnline(peer),
      totalMessages: bucket.length,
      sentMessages: sent,
      receivedMessages: received,
      lastAt: Number(latest?.createdAt || 0),
      latestMessage: latest ? adminUserMessageView(latest, username) : null
    });
  }
  return rows
    .sort((left, right) => {
      if (right.lastAt !== left.lastAt) {
        return right.lastAt - left.lastAt;
      }
      return left.username.localeCompare(right.username);
    })
    .slice(0, limit);
}

function adminAuditTouchesUsername(entry, username) {
  const details = entry?.details;
  if (!details || typeof details !== "object") {
    return false;
  }
  if (String(details.target || "") === username) {
    return true;
  }
  if (String(details?.before?.username || "") === username || String(details?.after?.username || "") === username) {
    return true;
  }
  if (Array.isArray(details.usernames) && details.usernames.some((item) => String(item || "") === username)) {
    return true;
  }
  if (String(details.previousUsername || "") === username || String(details.nextUsername || "") === username) {
    return true;
  }
  return false;
}

function listRecentAdminAuditEntriesForUser(username, limit = 20) {
  const rows = [];
  for (let index = adminAuditEntries.length - 1; index >= 0 && rows.length < limit; index -= 1) {
    const entry = adminAuditEntries[index];
    if (adminAuditTouchesUsername(entry, username)) {
      rows.push(entry);
    }
  }
  return rows;
}

async function buildAdminUserDetail(user) {
  const sessionsList = listUserSessions(user.username);
  const accessProfile = await accessLogStore.getVisitorProfile({ userId: user.username });
  const accessLogs = await accessLogStore.getAccessLogs(
    {
      userId: user.username,
      page: 1,
      limit: 12
    },
    {
      exactIdentityMatch: true
    }
  );
  return {
    user: {
      ...adminPublicUser(user),
      online: isUserOnline(user.username),
      avatarSeed: makeAvatarSeed(user.username)
    },
    crypto: {
      publicKey: summarizeEncodedBlob(user.publicKey),
      privateKeySalt: summarizeEncodedBlob(user.privateKeySalt),
      privateKeyIv: summarizeEncodedBlob(user.privateKeyIv),
      encryptedPrivateKey: summarizeEncodedBlob(user.encryptedPrivateKey)
    },
    sessions: sessionsList,
    realtime: {
      eventConnections: Number(onlineConnections.get(user.username)?.size || 0)
    },
    messageStats: buildUserMessageStats(user.username),
    conversations: listUserConversationDetails(user.username),
    recentMessages: listRecentMessagesForUser(user.username),
    access: {
      profile: accessProfile,
      recentLogs: accessLogs.rows || [],
      totalLogs: Number(accessLogs.total || 0)
    },
    audit: listRecentAdminAuditEntriesForUser(user.username)
  };
}

function adminDashboardSnapshot(session, req) {
  const auditEntries = readRecentAdminAuditEntries(200);
  const recentLogins = auditEntries
    .filter((entry) => entry.action === "admin_login")
    .slice(-5)
    .reverse()
    .map((entry) => ({
      at: entry.at,
      ip: String(entry.ip || ""),
      username: String(entry.actor || session.username || "")
    }));
  const recentUsers = [...users]
    .sort((left, right) => Number(right.createdAt) - Number(left.createdAt))
    .slice(0, 5)
    .map((user) => ({
      username: user.username,
      createdAt: user.createdAt,
      banned: Boolean(user.banned)
    }));
  const health = adminHealthSnapshot();
  return {
    userTotal: users.length,
    activeUsers: listOnlineUsers().length,
    currentAdmin: {
      username: session.username,
      role: session.role
    },
    currentIp: getClientAddress(req),
    recentLogins,
    recentUsers,
    systemStatus: {
      ok: Boolean(health.ok),
      label: health.ok ? "正常" : "异常"
    }
  };
}

function adminMessageView(message) {
  return {
    id: message.id,
    from: message.from,
    to: message.to,
    nonce: message.nonce,
    ciphertext: message.ciphertext,
    auditText: null,
    replyTo: normalizeReplyTargetView(message.replyTo) || resolveReplyTarget(message.from, message.to, message.replyToId),
    createdAt: message.createdAt
  };
}

function normalizeReplyTargetView(replyTo) {
  if (!replyTo || !replyTo.id) {
    return null;
  }
  return {
    id: String(replyTo.id),
    from: String(replyTo.from || ""),
    text: typeof replyTo.text === "string" ? replyTo.text : "",
    createdAt: Number(replyTo.createdAt) || 0
  };
}

function messagesForPair(leftUser, rightUser) {
  const key = conversationBucketKey(leftUser, rightUser);
  return messageBuckets.get(key) || [];
}

function resolveReplyTarget(leftUser, rightUser, replyToId) {
  const id = String(replyToId || "").trim();
  if (!id) {
    return null;
  }
  const message = messageIdIndex.get(id);
  if (
    !message ||
    !(
      (message.from === leftUser && message.to === rightUser) ||
      (message.from === rightUser && message.to === leftUser)
    )
  ) {
    return null;
  }
  return normalizeReplyTargetView(message);
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
    clientId: String(message.clientId || ""),
    from: message.from,
    to: message.to,
    peer,
    mine: message.from === viewer,
    publicKey: peerUser?.publicKey || "",
    text: typeof message.text === "string" && !message.ciphertext ? message.text : null,
    replyTo: normalizeReplyTargetView(message.replyTo) || resolveReplyTarget(message.from, message.to, message.replyToId),
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
          text: typeof latest.text === "string" && !latest.ciphertext ? latest.text : null,
          replyTo: normalizeReplyTargetView(latest.replyTo) || resolveReplyTarget(latest.from, latest.to, latest.replyToId),
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
  return messageBuckets.get(key) || [];
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

function collectPagedMessages(sourceMessages, limit, beforeCursor, predicate = null) {
  let beforeIndex = sourceMessages.length;
  if (beforeCursor?.id) {
    const matchedIndex = sourceMessages.findIndex((message) => {
      if (predicate && !predicate(message)) {
        return false;
      }
      return message.id === beforeCursor.id;
    });
    if (matchedIndex >= 0) {
      beforeIndex = matchedIndex;
    }
  }

  const items = [];
  for (let index = beforeIndex - 1; index >= 0 && items.length <= limit; index -= 1) {
    const message = sourceMessages[index];
    if (predicate && !predicate(message)) {
      continue;
    }
    items.push(message);
  }

  const hasMore = items.length > limit;
  const pageItems = (hasMore ? items.slice(0, limit) : items).reverse();
  return {
    items: pageItems,
    hasMore,
    nextBefore: hasMore && pageItems.length > 0 ? encodeMessageCursor(pageItems[0]) : ""
  };
}

function pagedMessagesBetween(leftUser, rightUser, limit, beforeCursor) {
  return collectPagedMessages(messagesBetween(leftUser, rightUser), limit, beforeCursor);
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

function broadcastUserRename(previousUsername, nextUsername) {
  const payload = {
    previousUsername,
    username: nextUsername,
    at: Date.now()
  };
  for (const [, connections] of onlineConnections) {
    if (connections.size === 0) {
      continue;
    }
    for (const connection of connections) {
      writeSse(connection.res, "user-renamed", payload);
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
        const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
        if (contentType && contentType !== "application/json") {
          reject(new Error("unsupported media type"));
          return;
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        const parsed = raw ? JSON.parse(raw) : {};
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
          reject(new Error("invalid json"));
          return;
        }
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function sendJsonBodyError(res, error) {
  if (error?.message === "body too large") {
    sendJson(res, 413, { error: "body too large" });
    return;
  }
  if (error?.message === "unsupported media type") {
    sendJson(res, 415, { error: "content type must be application/json" });
    return;
  }
  sendJson(res, 400, { error: "invalid json" });
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
    sendJsonBodyError(res, error);
    return;
  }

  const normalizedUsername = normalizeUsername(readSubmittedUsername(body));
  const password = normalizePassword(body.password);
  if (!normalizedUsername) {
    sendJson(res, 400, { error: "username must be 3-24 characters using letters, numbers, or underscore" });
    return;
  }
  if (isReservedUsernameKey(normalizedUsername.key)) {
    sendJson(res, 409, { error: "username is reserved" });
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
  accessLogMiddleware.setUserId(req, user.username);
  sendJson(res, 201, {
    token,
    user: publicUser(user),
    keyBundle: keyBundleForUser(user)
  }, {
    "Set-Cookie": sessionCookieHeader(USER_SESSION_COOKIE, token)
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
    sendJsonBodyError(res, error);
    return;
  }

  const normalizedUsername = normalizeUsername(readSubmittedUsername(body));
  const password = normalizePassword(body.password);
  if (!normalizedUsername || !password) {
    sendJson(res, 400, { error: "username and password are required" });
    return;
  }

  const lockState = userLoginLockState(normalizedUsername.value);
  if (userLoginLockActive(lockState)) {
    sendJson(res, 429, { error: "too many failed attempts, try again later" });
    return;
  }

  const user = findUserByKey(normalizedUsername.key);
  const passwordOk = await verifyPassword(password, user?.passwordHash || DUMMY_PASSWORD_HASH);
  if (!user || !passwordOk) {
    const next = recordUserLoginFailure(normalizedUsername.value);
    const message = next && next.lockedUntil > Date.now()
      ? "too many failed attempts, try again later"
      : "invalid username or password";
    sendJson(res, next && next.lockedUntil > Date.now() ? 429 : 401, { error: message });
    return;
  }
  clearUserLoginFailures(user.username);
  if (user.banned) {
    sendJson(res, 403, { error: "account banned" });
    return;
  }
  if (!user.publicKey || !user.privateKeySalt || !user.privateKeyIv || !user.encryptedPrivateKey) {
    sendJson(res, 409, { error: "account key material is missing" });
    return;
  }

  const token = createSession(user.username);
  accessLogMiddleware.setUserId(req, user.username);
  sendJson(res, 200, {
    token,
    user: publicUser(user),
    keyBundle: keyBundleForUser(user)
  }, {
    "Set-Cookie": sessionCookieHeader(USER_SESSION_COOKIE, token)
  });
}

function handleLogout(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  sessions.delete(session.token);
  sendJson(res, 200, { ok: true }, {
    "Set-Cookie": clearSessionCookieHeader(USER_SESSION_COOKIE)
  });
}

function handleLogoutAll(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const revoked = deleteSessionsForUsername(session.username, session.role);
  sendJson(res, 200, {
    ok: true,
    revoked
  }, {
    "Set-Cookie": clearSessionCookieHeader(USER_SESSION_COOKIE)
  });
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
  try {
    syncRuntimeAdminConfigFromConfiguredSources();
  } catch (error) {
    sendJson(res, 503, { error: "admin credentials are not configured" });
    return;
  }
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
    sendJsonBodyError(res, error);
    return;
  }
  const username = readSubmittedUsername(body);
  const password = String(body.password || "");
  const lockState = adminLoginLockState(username);
  if (adminLoginLockActive(lockState)) {
    sendJson(res, 429, { error: "too many failed attempts, try again later" });
    return;
  }
  const account = findAdminAccount(username);
  const passwordOk = await verifyConfiguredAdminPassword(password);
  if (!account || !passwordOk) {
    const next = recordAdminLoginFailure(username);
    const message = next && next.lockedUntil > Date.now()
      ? "too many failed attempts, try again later"
      : "管理员账号或密码错误";
    sendJson(res, next && next.lockedUntil > Date.now() ? 429 : 401, { error: message });
    return;
  }
  clearAdminLoginFailures(account.username);
  const token = createSession(account.username, "admin");
  accessLogMiddleware.setUserId(req, account.username);
  recordAdminAction("admin_login", { username: account.username, role: "admin" }, req, {});
  sendJson(res, 200, {
    token,
    admin: {
      username: account.username,
      role: "admin"
    }
  }, {
    "Set-Cookie": sessionCookieHeader(ADMIN_SESSION_COOKIE, token)
  });
}

function normalizeClientMetaPayload(body) {
  return {
    language: String(body?.language || "").trim().slice(0, 24),
    screenResolution: String(body?.screenResolution || body?.screen_resolution || "").trim().slice(0, 32),
    timezone: String(body?.timezone || "").trim().slice(0, 64),
    platform: String(body?.platform || "").trim().slice(0, 48)
  };
}

function readAccessLogFilters(url) {
  return {
    ip: normalizeBoundedText(url.searchParams.get("ip") || "", 64),
    userId: normalizeBoundedText(url.searchParams.get("userId") || url.searchParams.get("user_id") || "", 64),
    sessionId: normalizeBoundedText(url.searchParams.get("sessionId") || url.searchParams.get("session_id") || "", 64),
    since: Number.parseInt(String(url.searchParams.get("since") || "0"), 10) || 0,
    until: Number.parseInt(String(url.searchParams.get("until") || "0"), 10) || 0
  };
}

async function handleAdminAccountReset(req, res) {
  try {
    syncRuntimeAdminConfigFromConfiguredSources();
  } catch (error) {
    sendJson(res, 503, { error: "admin credentials are not configured" });
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `auth:admin-account-reset:${address}`,
      Math.max(5, Math.floor(MAX_AUTH_REQUESTS_PER_WINDOW / 2)),
      "too many auth requests"
    )
  ) {
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJsonBodyError(res, error);
    return;
  }
  const passphraseResult = verifyAdminUpdatePassphrase(String(body.verificationPassphrase || body.passphrase || ""));
  if (!passphraseResult.ok) {
    sendJson(res, passphraseResult.reason === "missing" ? 503 : 403, {
      error: passphraseResult.reason === "missing" ? "管理员身份验证口令未配置" : "身份验证口令错误"
    });
    return;
  }

  const normalizedUsername = normalizeUsername(readSubmittedUsername(body));
  const password = normalizePassword(body.password);
  if (!normalizedUsername) {
    sendJson(res, 400, { error: "管理员账号格式无效" });
    return;
  }
  if (password.length < 4 || password.length > 72) {
    sendJson(res, 400, { error: "管理员密码必须为 4-72 位" });
    return;
  }

  const nextConfig = {
    username: normalizedUsername.value,
    credential: {
      type: "hash",
      value: await hashPassword(password)
    }
  };

  try {
    persistAdminConfigToEnvironmentSafe(nextConfig);
  } catch (error) {
    sendJson(res, 500, { error: "管理员配置写入失败" });
    return;
  }

  const previousUsername = adminConfig.username;
  updateRuntimeAdminConfig(nextConfig);
  clearAdminLoginFailures(previousUsername);
  clearAdminLoginFailures(nextConfig.username);
  for (const sessionRecord of sessions.values()) {
    if (sessionRecord.role === "admin") {
      sessionRecord.username = nextConfig.username;
    }
  }
  recordAdminAction("admin_account_reset", { username: nextConfig.username, role: "admin" }, req, {
    previousUsername,
    nextUsername: nextConfig.username
  });
  sendJson(res, 200, {
    ok: true,
    admin: {
      username: nextConfig.username,
      role: "admin"
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
  sendJson(res, 200, { ok: true }, {
    "Set-Cookie": clearSessionCookieHeader(ADMIN_SESSION_COOKIE)
  });
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
  const session = requireAdminPermission(req, res, url);
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

function handleAdminHealth(req, res, url) {
  const session = requireAdminPermission(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:health:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  sendJson(res, 200, {
    health: adminHealthSnapshot()
  });
}

function handleAdminDashboardStats(req, res, url) {
  const session = requireAdminPermission(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:dashboard-stats:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  sendJson(res, 200, {
    dashboard: adminDashboardSnapshot(session, req)
  });
}

function handleAdminUsers(req, res, url) {
  const session = requireAdminPermission(req, res, url);
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
  const query = normalizeBoundedText(url.searchParams.get("q") || "", 64).toLowerCase();
  const status = String(url.searchParams.get("status") || "all").trim().toLowerCase();
  const requestedSort = String(url.searchParams.get("sort") || "username").trim();
  const sortBy = requestedSort === "createdAt" ? "createdAt" : "username";
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

async function handleAdminUserDetail(req, res, url, pathname) {
  const session = requireAdminPermission(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:user-detail:${address}`,
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
  sendJson(res, 200, {
    detail: await buildAdminUserDetail(user)
  });
}

async function handleAdminUserPatch(req, res, url, pathname) {
  const session = requireAdminPermission(req, res, url);
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
    sendJsonBodyError(res, error);
    return;
  }

  const requestedName = normalizeBoundedText(body.username || "", 24);
  const oldState = adminPublicUser(user);
  if (requestedName) {
    const normalizedUsername = normalizeUsername(requestedName);
    if (!normalizedUsername) {
      sendJson(res, 400, { error: "username must be 3-24 characters using letters, numbers, or underscore" });
      return;
    }
    if (normalizedUsername.key !== user.usernameKey && isReservedUsernameKey(normalizedUsername.key)) {
      sendJson(res, 409, { error: "username is reserved" });
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
      if (message.replyTo?.from === previousUsername) {
        message.replyTo.from = user.username;
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
    broadcastUserRename(previousUsername, user.username);
  }

  if (Object.prototype.hasOwnProperty.call(body, "banned")) {
    if (typeof body.banned !== "boolean") {
      sendJson(res, 400, { error: "banned must be a boolean" });
      return;
    }
    const banned = body.banned;
    user.banned = banned;
    user.bannedReason = banned ? normalizeAuditReason(body.bannedReason, "admin action") : "";
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
  const session = requireAdminPermission(req, res, url);
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
    sendJsonBodyError(res, error);
    return;
  }
  const usernames = Array.isArray(body.usernames)
    ? [...new Set(body.usernames.map((item) => normalizeBoundedText(item, 24)).filter(Boolean))].slice(0, 200)
    : [];
  if (typeof body.banned !== "boolean") {
    sendJson(res, 400, { error: "banned must be a boolean" });
    return;
  }
  if (usernames.length === 0) {
    sendJson(res, 400, { error: "at least one username is required" });
    return;
  }
  if (usernames.some((username) => !normalizeUsername(username))) {
    sendJson(res, 400, { error: "invalid username in batch request" });
    return;
  }
  const banned = body.banned;
  const reason = normalizeAuditReason(body.bannedReason, "admin batch action");
  const requestedUsernames = new Set(usernames);
  const targetUsers = users.filter((user) => requestedUsernames.has(user.username)).slice(0, 200);
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
    usernames: targetUsers.map((user) => user.username),
    banned
  });
  sendJson(res, 200, {
    updated: targetUsers.length
  });
}

function handleAdminAuditLogs(req, res, url) {
  const session = requireAdminPermission(req, res, url);
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
  sendJson(res, 200, {
    logs: readRecentAdminAuditEntries(limit)
  });
}

function handleAdminExportMessages(req, res, url) {
  const session = requireAdminPermission(req, res, url);
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
  const reason = normalizeBoundedText(url.searchParams.get("reason") || "", 120);
  if (!reason) {
    sendJson(res, 400, { error: "export reason is required" });
    return;
  }
  const fromFilterResult = readOptionalUsernameFilter(url.searchParams.get("from"));
  const toFilterResult = readOptionalUsernameFilter(url.searchParams.get("to"));
  if (!fromFilterResult.ok || !toFilterResult.ok) {
    sendJson(res, 400, { error: "invalid message filters" });
    return;
  }
  const fromFilter = fromFilterResult.value;
  const toFilter = toFilterResult.value;
  const since = Number.parseInt(String(url.searchParams.get("since") || "0"), 10) || 0;
  const until = Number.parseInt(String(url.searchParams.get("until") || "0"), 10) || 0;
  const watermark = `EXPORT WATERMARK | admin=${session.username} | role=${session.role} | ip=${address} | at=${new Date().toISOString()} | reason=${reason}`;
  const matchesFilters = (message) =>
    (!fromFilter || message.from === fromFilter) &&
    (!toFilter || message.to === toFilter) &&
    (!since || Number(message.createdAt) >= since) &&
    (!until || Number(message.createdAt) <= until);
  const rows = collectPagedMessages(messages, 5000, null, matchesFilters).items;
  const contentRows = rows.map((message) =>
    [
      `[${new Date(message.createdAt).toISOString()}]`,
      `${message.from} -> ${message.to}`,
      `nonce=${message.nonce}`,
      `ciphertext=${message.ciphertext}`
    ].join(" ")
  );
  recordAdminAction("admin_messages_export", session, req, {
    reason,
    count: rows.length,
    filters: { fromFilter, toFilter, since, until }
  });
  sendJson(res, 200, {
    filename: `admin-export-${Date.now()}.txt`,
    watermark,
    content: [watermark, ...contentRows].join("\n")
  });
}

function handleAdminMessages(req, res, url) {
  const session = requireAdminPermission(req, res, url);
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
  const fromFilterResult = readOptionalUsernameFilter(url.searchParams.get("from"));
  const toFilterResult = readOptionalUsernameFilter(url.searchParams.get("to"));
  if (!fromFilterResult.ok || !toFilterResult.ok) {
    sendJson(res, 400, { error: "invalid message filters" });
    return;
  }
  const fromFilter = fromFilterResult.value;
  const toFilter = toFilterResult.value;
  const since = Number.parseInt(String(url.searchParams.get("since") || "0"), 10) || 0;
  const until = Number.parseInt(String(url.searchParams.get("until") || "0"), 10) || 0;
  const matchesFilters = (message) =>
    (!fromFilter || message.from === fromFilter) &&
    (!toFilter || message.to === toFilter) &&
    (!since || Number(message.createdAt) >= since) &&
    (!until || Number(message.createdAt) <= until);
  const page = collectPagedMessages(messages, limit, beforeCursor, matchesFilters);
  sendJson(res, 200, {
    messages: page.items.map((message) => adminMessageView(message)),
    hasMore: page.hasMore,
    nextBefore: page.nextBefore
  });
}

async function handleClientMeta(req, res, url) {
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:client-meta:${address}`,
      Math.max(30, Math.floor(MAX_API_REQUESTS_PER_WINDOW / 2)),
      "too many requests"
    )
  ) {
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJsonBodyError(res, error);
    return;
  }
  const meta = normalizeClientMetaPayload(body);
  const sessionId = accessLogMiddleware.getSessionId(req);
  if (sessionId && ENABLE_ACCESS_LOG) {
    accessLogStore.enqueueClientMeta(sessionId, meta);
  }
  const session = getSessionFromRequest(req, url);
  if (session?.username) {
    accessLogMiddleware.setUserId(req, session.username);
  }
  sendJson(res, 200, { ok: true });
}

async function handleAdminAccessSummary(req, res, url) {
  const session = requireAdminPermission(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:access-summary:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  sendJson(res, 200, {
    summary: await accessLogStore.getDashboardSummary()
  });
}

async function handleAdminAccessLogs(req, res, url) {
  const session = requireAdminPermission(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:access-logs:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const filters = readAccessLogFilters(url);
  const page = parsePositiveInteger(url.searchParams.get("page"), 1, 1, 99999);
  const limit = parsePositiveInteger(url.searchParams.get("limit"), 50, 1, 200);
  const payload = await accessLogStore.getAccessLogs({
    ...filters,
    page,
    limit
  });
  sendJson(res, 200, payload);
}

async function handleAdminAccessProfile(req, res, url) {
  const session = requireAdminPermission(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:access-profile:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const profile = await accessLogStore.getVisitorProfile(readAccessLogFilters(url));
  sendJson(res, 200, {
    profile
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
  const query = normalizeBoundedText(url.searchParams.get("q") || "", 64);
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
    sendJsonBodyError(res, error);
    return;
  }

  const peer = findUserByUsername(body.to);
  const nonce = String(body.nonce || "").trim();
  const ciphertext = String(body.ciphertext || "").trim();
  const clientId = normalizeClientId(body.clientId);
  const replyToId = String(body.replyToId || "").trim();
  if (!peer || peer.username === session.username) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  if (peer.banned) {
    sendJson(res, 403, { error: "peer is banned" });
    return;
  }
  if (clientId) {
    const existing = messageClientIndex.get(`${session.username}\u0000${peer.username}\u0000${clientId}`);
    if (existing) {
      sendJson(res, 200, {
        message: createMessageView(existing, session.username),
        conversation: buildConversationSummary(session.username, peer.username)
      });
      return;
    }
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
  const replyTo = resolveReplyTarget(session.username, peer.username, replyToId);
  if (replyToId && !replyTo) {
    sendJson(res, 400, { error: "reply target not found" });
    return;
  }

  const message = {
    id: crypto.randomUUID(),
    clientId,
    from: session.username,
    to: peer.username,
    nonce,
    ciphertext,
    createdAt: Date.now(),
    replyToId: replyTo?.id || "",
    replyTo
  };
  messages.push(message);
  appendMessageBucket(message);
  schedulePersistMessages(message);

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
  const activeConnections = (onlineConnections.get(session.username) || new Set()).size;
  if (activeConnections >= MAX_CONCURRENT_EVENT_CONNECTIONS_PER_USER) {
    sendJson(res, 429, { error: "too many concurrent connections" });
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
    const etag = weakEtagForStat(stat);
    const cacheControl = cacheControlForStaticFile(filePath);
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(
        304,
        securityHeaders({
          "Cache-Control": cacheControl,
          ETag: etag
        })
      );
      res.end();
      return;
    }
    res.writeHead(
      200,
      securityHeaders({
        "Content-Type": contentTypes[ext] || "application/octet-stream",
        "Content-Length": stat.size,
        "Cache-Control": cacheControl,
        ETag: etag
      })
    );
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

try {
  loadData();
  purgeStoredMessagePlaintext();
  loadAdminAuditState();
  void accessLogStore.ready.catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
  const auditCheck = verifyAdminAuditChain();
  if (!auditCheck.ok) {
    console.warn(
      `[audit] chain verification failed at line ${auditCheck.mismatches[0]?.line ?? "?"}: ${auditCheck.mismatches[0]?.reason ?? "unknown"}`
    );
  } else if (auditCheck.checked > 0) {
    console.log(`[audit] verified ${auditCheck.checked} entries (key source: ${auditCheck.hmacKeySource})`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
setInterval(cleanRateBuckets, RATE_WINDOW_MS).unref();
setInterval(cleanSessions, Math.min(5 * 60 * 1000, SESSION_TTL_MS)).unref();
setInterval(cleanEventTickets, EVENT_TICKET_TTL_MS).unref();
setInterval(cleanAdminLoginFailures, ADMIN_LOGIN_FAILURE_WINDOW_MS).unref();
setInterval(cleanUserLoginFailures, USER_LOGIN_FAILURE_WINDOW_MS).unref();
setInterval(purgeStoredMessagePlaintext, 60 * 60 * 1000).unref();

const server = http.createServer((req, res) => {
  if (String(req.url || "").length > 4096) {
    sendJson(res, 414, { error: "request url too long" });
    return;
  }
  const url = parseRequestUrl(req);
  if (!url) {
    sendJson(res, 400, { error: "invalid request url" });
    return;
  }
  accessLogMiddleware.begin(req, res, url);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/health") {
    const accessLogHealth = accessLogStore.healthSnapshot();
    sendJson(res, 200, {
      ok: true,
      users: users.length,
      messages: messages.length,
      onlineUsers: listOnlineUsers().length,
      sessions: sessions.size,
      accessLogs: {
        enabled: accessLogHealth.enabled,
        dbBytes: accessLogHealth.dbBytes,
        pendingQueue: accessLogHealth.pendingQueue
      }
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/client-meta") {
    void handleClientMeta(req, res, url);
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/login") {
    void handleAdminLogin(req, res);
    return;
  }
  if (req.method === "POST" && pathname === "/api/admin/account/reset") {
    void handleAdminAccountReset(req, res);
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
  if (req.method === "GET" && pathname === "/api/admin/health") {
    handleAdminHealth(req, res, url);
    return;
  }
  if (req.method === "GET" && pathname === "/api/admin/dashboard/stats") {
    handleAdminDashboardStats(req, res, url);
    return;
  }
  if (req.method === "GET" && pathname === "/api/admin/users") {
    handleAdminUsers(req, res, url);
    return;
  }
  if (req.method === "GET" && parseAdminUserPath(pathname)) {
    void handleAdminUserDetail(req, res, url, pathname);
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
  if (req.method === "GET" && pathname === "/api/admin/access/summary") {
    void handleAdminAccessSummary(req, res, url);
    return;
  }
  if (req.method === "GET" && pathname === "/api/admin/access/logs") {
    void handleAdminAccessLogs(req, res, url);
    return;
  }
  if (req.method === "GET" && pathname === "/api/admin/access/profile") {
    void handleAdminAccessProfile(req, res, url);
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
  if (req.method === "POST" && pathname === "/api/logout-all") {
    handleLogoutAll(req, res, url);
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
