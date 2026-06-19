"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const UAParser = require("ua-parser-js");
const { createAccessLogMiddleware } = require("./middleware/access-log");
const { createAccessLogStore } = require("./services/access-log-store");
const {
  ADMIN_AUDIT_HMAC_ALGO, ADMIN_AUDIT_SHA_ALGO,
  readConfiguredAdminConfig, validateConfiguredAdminConfig, warnIfWeakAdminCredential,
  readAuditHmacKeyState, verifyAdminUpdatePassphrase,
  computeAdminAuditEntryHash, entryBaseFromEntry, persistAdminConfigToEnvFile
} = require("./services/admin-config");
const {
  securityHeaders, sendJson, getClientAddress, normalizedRequestHost,
  parseRequestUrl, isSameOriginRequest, cacheControlForStaticFile, weakEtagForStat
} = require("./utils/http");
const { readJsonFile, readJsonLinesFile, writeJsonFile, rewriteJsonLinesFile } = require("./utils/data");
const {
  normalizeUsername, normalizePassword, normalizeBoundedText, normalizeAuditReason,
  normalizeUserList, normalizeUserContacts, readOptionalUsernameFilter, readSubmittedUsername
} = require("./utils/normalize");
const {
  isRateLimited, cleanRateBucketMap, loginFailureState, loginFailureActive,
  recordLoginFailure, clearLoginFailures, cleanLoginFailuresMap
} = require("./utils/rate-limit");
const {
  hashPassword, verifyPassword, verifyPlainSecret,
  decodeBase64Blob, isBase64Blob, makeAvatarSeed
} = require("./utils/crypto");

const {
  HOST, PORT, SESSION_TTL_MS, PUBLIC_DIR, DATA_DIR,
  USERS_FILE, MESSAGES_FILE, MESSAGES_LOG_FILE, ADMIN_AUDIT_FILE,
  MAX_BODY_BYTES, MAX_MESSAGE_BODY_BYTES, RATE_WINDOW_MS, MAX_AUTH_REQUESTS_PER_WINDOW,
  MAX_API_REQUESTS_PER_WINDOW, MAX_MESSAGES_PER_CONVERSATION_WINDOW,
  HEARTBEAT_MS, EVENT_TICKET_TTL_MS, MESSAGE_PERSIST_DEBOUNCE_MS,
  HSTS_MAX_AGE_SECONDS, COOKIE_SECURE, ENABLE_ACCESS_LOG,
  USER_SESSION_COOKIE, ADMIN_SESSION_COOKIE,
  DEFAULT_ADMIN_USERNAME_VALUE,
  AUDIT_TEXT_RETENTION_DAYS, TRUST_PROXY, TRUSTED_ORIGINS,
  PUBLIC_KEY_BYTES, PRIVATE_KEY_SALT_BYTES, PRIVATE_KEY_IV_BYTES,
  ENCRYPTED_PRIVATE_KEY_BYTES, MESSAGE_NONCE_BYTES, MESSAGE_CIPHERTEXT_BYTES,
  contentTypes,
  ADMIN_LOGIN_FAILURE_WINDOW_MS, ADMIN_LOGIN_LOCKOUT_MS, ADMIN_LOGIN_MAX_FAILURES,
  USER_LOGIN_FAILURE_WINDOW_MS, USER_LOGIN_LOCKOUT_MS, USER_LOGIN_MAX_FAILURES,
  MAX_CONCURRENT_EVENT_CONNECTIONS_PER_USER, DUMMY_PASSWORD_HASH
} = require("./config");

const sessions = new Map();
const onlineConnections = new Map();
const rateBuckets = new Map();
const conversationRateBuckets = new Map();
const eventTickets = new Map();
const messageBuckets = new Map();
const messageIdIndex = new Map();
const messageClientIndex = new Map();
const userPeersIndex = new Map();
const usersByKey = new Map();
const adminLoginFailures = new Map();
const userLoginFailures = new Map();

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

let adminConfig = readConfiguredAdminConfig();
validateConfiguredAdminConfig(adminConfig);
warnIfWeakAdminCredential(adminConfig);
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
    bannedAt: Number.parseInt(String(user?.bannedAt || "0"), 10) || 0,
    showOnlineStatus: user?.showOnlineStatus !== false,
    allowUserSearch: user?.allowUserSearch !== false,
    blockedUsers: normalizeUserList(user?.blockedUsers),
    contacts: normalizeUserContacts(user?.contacts),
    lastSeenAt: Number.parseInt(String(user?.lastSeenAt || "0"), 10) || 0,
    lastLoginAt: Number.parseInt(String(user?.lastLoginAt || "0"), 10) || 0
  }));
  rebuildUserIndex();

  const logStat = fs.statSync(MESSAGES_LOG_FILE);
  const loadedMessages = logStat.size > 0 ? readJsonLinesFile(MESSAGES_LOG_FILE) : readJsonFile(MESSAGES_FILE);
  if (!Array.isArray(loadedMessages)) {
    throw new Error(`expected ${MESSAGES_FILE} to contain a JSON array`);
  }
  messages = loadedMessages.map((message) => ({
    ...message,
    clientId: typeof message?.clientId === "string" ? message.clientId : "",
    deletedFor: Array.isArray(message?.deletedFor)
      ? message.deletedFor
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
      : []
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

function recordUserPeer(username, peer) {
  if (!username || !peer || username === peer) {
    return;
  }
  const peers = userPeersIndex.get(username) || new Set();
  peers.add(peer);
  userPeersIndex.set(username, peers);
}

function rebuildMessageBuckets() {
  messageBuckets.clear();
  messageIdIndex.clear();
  messageClientIndex.clear();
  userPeersIndex.clear();
  for (const message of messages) {
    recordUserPeer(message.from, message.to);
    recordUserPeer(message.to, message.from);
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
  recordUserPeer(message.from, message.to);
  recordUserPeer(message.to, message.from);
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


function isReservedUsernameKey(usernameKey) {
  return String(usernameKey || "").trim().toLowerCase() === String(adminConfig.username || "").trim().toLowerCase();
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


function publicUser(user) {
  return {
    username: user.username,
    usernameKey: user.usernameKey,
    createdAt: user.createdAt,
    publicKey: user.publicKey,
    banned: Boolean(user.banned),
    bannedReason: String(user.bannedReason || ""),
    bannedAt: Number.parseInt(String(user.bannedAt || "0"), 10) || 0,
    lastSeenAt: Number.parseInt(String(user.lastSeenAt || "0"), 10) || 0,
    lastLoginAt: Number.parseInt(String(user.lastLoginAt || "0"), 10) || 0,
    settings: {
      showOnlineStatus: userShowsPresence(user),
      allowUserSearch: userAllowsSearch(user)
    }
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
    bannedAt: Number.parseInt(String(user.bannedAt || "0"), 10) || 0,
    online: isUserOnline(user.username),
    lastSeenAt: Number.parseInt(String(user.lastSeenAt || "0"), 10) || 0,
    lastLoginAt: Number.parseInt(String(user.lastLoginAt || "0"), 10) || 0
  };
}

function touchUserActivity(username, persist = false, at = Date.now()) {
  const user = findUserByUsername(username);
  if (!user) {
    return null;
  }
  user.lastSeenAt = Number(at) || Date.now();
  if (persist) {
    persistUsers();
  }
  return user;
}

function touchUserLogin(username, at = Date.now()) {
  const user = findUserByUsername(username);
  if (!user) {
    return null;
  }
  user.lastLoginAt = Number(at) || Date.now();
  user.lastSeenAt = user.lastLoginAt;
  persistUsers();
  return user;
}

function userAllowsSearch(user) {
  return user?.allowUserSearch !== false;
}

function userShowsPresence(user) {
  return user?.showOnlineStatus !== false;
}

function isUserBlocked(user, candidateUsername) {
  return Boolean(user && candidateUsername && Array.isArray(user.blockedUsers) && user.blockedUsers.includes(candidateUsername));
}

function isPresenceVisibleTo(viewerUsername, targetUsername) {
  if (!targetUsername) {
    return false;
  }
  if (viewerUsername === targetUsername) {
    return isUserOnline(targetUsername);
  }
  const targetUser = findUserByUsername(targetUsername);
  const viewerUser = findUserByUsername(viewerUsername);
  if (!targetUser || !userShowsPresence(targetUser)) {
    return false;
  }
  if (viewerUser && isUserBlocked(viewerUser, targetUsername)) {
    return false;
  }
  if (isUserBlocked(targetUser, viewerUsername)) {
    return false;
  }
  return isUserOnline(targetUsername);
}

function canSearchUser(viewerUsername, targetUser) {
  if (!targetUser || targetUser.username === viewerUsername) {
    return false;
  }
  const viewerUser = findUserByUsername(viewerUsername);
  if (!userAllowsSearch(targetUser) || isUserBlocked(targetUser, viewerUsername)) {
    return false;
  }
  if (viewerUser && isUserBlocked(viewerUser, targetUser.username)) {
    return false;
  }
  return true;
}

function contactEntryFor(user, username) {
  if (!user?.contacts || !username) {
    return null;
  }
  return user.contacts[username] || null;
}

function upsertUserContact(user, username, patch = {}) {
  if (!user || !username) {
    return null;
  }
  const existing = contactEntryFor(user, username) || {
    note: "",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  const next = {
    ...existing,
    ...patch,
    note: normalizeBoundedText(patch.note === undefined ? existing.note : patch.note, 32),
    pinned: patch.pinned === undefined ? Boolean(existing.pinned) : Boolean(patch.pinned),
    muted: patch.muted === undefined ? Boolean(existing.muted) : Boolean(patch.muted),
    prefsVersion: patch.pinned === undefined && patch.muted === undefined
      ? Number(existing.prefsVersion || 0)
      : 1,
    removedAt: 0,
    updatedAt: Date.now()
  };
  if (!user.contacts || typeof user.contacts !== "object" || Array.isArray(user.contacts)) {
    user.contacts = {};
  }
  user.contacts[username] = next;
  return next;
}

function removeUserContact(user, username) {
  if (!user || !username) {
    return false;
  }
  if (!user.contacts || typeof user.contacts !== "object" || Array.isArray(user.contacts)) {
    user.contacts = {};
  }
  const existing = user.contacts[username] || {
    note: "",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  user.contacts[username] = {
    ...existing,
    updatedAt: Date.now(),
    removedAt: Date.now()
  };
  return true;
}

function publicContactView(ownerUsername, peerUser) {
  const owner = findUserByUsername(ownerUsername);
  const entry = contactEntryFor(owner, peerUser.username);
  return {
    username: peerUser.username,
    usernameKey: peerUser.usernameKey,
    note: entry?.note || "",
    blocked: Boolean(owner && isUserBlocked(owner, peerUser.username)),
    blockedByPeer: isUserBlocked(peerUser, ownerUsername),
    pinned: Boolean(entry?.pinned),
    muted: Boolean(entry?.muted),
    prefsVersion: Number(entry?.prefsVersion || 0),
    online: isPresenceVisibleTo(ownerUsername, peerUser.username),
    lastSeenAt: userShowsPresence(peerUser) && !isUserBlocked(peerUser, ownerUsername)
      ? Number.parseInt(String(peerUser.lastSeenAt || "0"), 10) || 0
      : 0
  };
}

function listContactsFor(ownerUsername) {
  const owner = findUserByUsername(ownerUsername);
  if (!owner) {
    return [];
  }
  const peerNames = new Set([
    ...Object.keys(owner.contacts || {}),
    ...(userPeersIndex.get(ownerUsername) || [])
  ]);
  return [...peerNames]
    .map((username) => findUserByUsername(username))
    .filter(Boolean)
    .filter((peerUser) => peerUser.username !== ownerUsername)
    .filter((peerUser) => Number(contactEntryFor(owner, peerUser.username)?.removedAt || 0) === 0)
    .map((peerUser) => publicContactView(ownerUsername, peerUser))
    .sort((left, right) => {
      const leftPinned = Number(Boolean(left.pinned));
      const rightPinned = Number(Boolean(right.pinned));
      if (rightPinned !== leftPinned) {
        return rightPinned - leftPinned;
      }
      if (Number(right.online) !== Number(left.online)) {
        return Number(right.online) - Number(left.online);
      }
      return left.username.localeCompare(right.username);
    });
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
    preview: raw.length > 0 ? "[hidden]" : ""
  };
}


async function verifyConfiguredAdminPassword(password) {
  const credential = adminConfig.credential;
  if (credential.type === "hash") {
    return verifyPassword(password, credential.value);
  }
  return verifyPlainSecret(password, credential.value);
}

function persistAdminConfigToEnvironmentSafe(nextConfig) {
  persistAdminConfigToEnvFile(nextConfig, adminAuditHmacKeyState);
}

function syncRuntimeAdminConfigFromConfiguredSources() {
  const nextConfig = readConfiguredAdminConfig();
  validateConfiguredAdminConfig(nextConfig);
  warnIfWeakAdminCredential(nextConfig);
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

function sessionClientMeta(req) {
  const userAgent = String(req?.headers?.["user-agent"] || "").slice(0, 240);
  const parser = new UAParser(userAgent);
  const parsed = parser.getResult();
  return {
    ip: req ? getClientAddress(req) : "",
    userAgent,
    browser: [parsed.browser?.name, parsed.browser?.version].filter(Boolean).join(" ").trim(),
    os: [parsed.os?.name, parsed.os?.version].filter(Boolean).join(" ").trim(),
    device: parsed.device?.model || parsed.device?.type || "Desktop"
  };
}

function createSession(username, role = "user", req = null) {
  const token = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  const meta = sessionClientMeta(req);
  sessions.set(token, {
    token,
    username,
    role,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + SESSION_TTL_MS,
    ip: meta.ip,
    userAgent: meta.userAgent,
    browser: meta.browser,
    os: meta.os,
    device: meta.device
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
    user.lastSeenAt = now;
  }
  session.lastSeenAt = now;
  session.expiresAt = now + SESSION_TTL_MS;
  req.pendingSessionCookie = sessionCookieHeader(sessionCookieNameForPath(url.pathname), session.token);
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

function parseContactPath(pathname) {
  const match = pathname.match(/^\/api\/contacts\/([A-Za-z0-9_]{3,24})(?:\/(block))?$/);
  if (!match) {
    return null;
  }
  return {
    username: match[1] || "",
    action: match[2] || ""
  };
}

function adminBasicStats() {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartAt = todayStart.getTime();
  return {
    users: users.length,
    usersToday: users.filter((user) => Number(user.createdAt || 0) >= todayStartAt).length,
    bannedUsers: users.filter((user) => user.banned).length,
    onlineUsers: listOnlineUsers().length,
    activeUsers: users.filter((user) => Number(user.lastSeenAt || 0) >= dayAgo).length,
    sessions: sessions.size,
    messages: messages.length,
    messages24h: messages.filter((message) => Number(message.createdAt) >= dayAgo).length,
    messagesToday: messages.filter((message) => Number(message.createdAt) >= todayStartAt).length
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
      expiresAt: Number(sessionRecord.expiresAt || 0),
      browser: String(sessionRecord.browser || ""),
      os: String(sessionRecord.os || ""),
      device: String(sessionRecord.device || ""),
      ip: String(sessionRecord.ip || "")
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
    recalled: Boolean(message.recalled),
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
  const basicStats = adminBasicStats();
  const auditEntries = readRecentAdminAuditEntries(200);
  const recentLogins = auditEntries
    .filter((entry) => entry.action === "admin_login" || entry.action === "user_login")
    .slice(-5)
    .reverse()
    .map((entry) => ({
      at: entry.at,
      ip: String(entry.ip || ""),
      username: String(entry.actor || session.username || ""),
      role: String(entry.role || "user")
    }));
  const abnormalLogins = auditEntries
    .filter((entry) => entry.action === "admin_login_failed" || entry.action === "user_login_failed")
    .slice(-5)
    .reverse()
    .map((entry) => ({
      at: entry.at,
      ip: String(entry.ip || ""),
      username: String(entry.actor || "unknown"),
      role: String(entry.role || "user")
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
    userTotal: basicStats.users,
    activeUsers: basicStats.activeUsers,
    currentAdmin: {
      username: session.username,
      role: session.role
    },
    currentIp: getClientAddress(req),
    recentLogins,
    abnormalLogins,
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
    recalled: Boolean(message.recalled),
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

function isMessageDeletedFor(message, viewer) {
  if (!message || !viewer) {
    return false;
  }
  return Array.isArray(message.deletedFor) && message.deletedFor.includes(viewer);
}

function visibleMessagesBetween(viewer, peer) {
  return messagesBetween(viewer, peer).filter((message) => !isMessageDeletedFor(message, viewer));
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
    recalled: Boolean(message.recalled),
    replyTo: normalizeReplyTargetView(message.replyTo) || resolveReplyTarget(message.from, message.to, message.replyToId),
    nonce: message.nonce,
    ciphertext: message.ciphertext,
    createdAt: message.createdAt,
    deliveredAt: Number.parseInt(String(message.deliveredAt || "0"), 10) || 0,
    readAt: Number.parseInt(String(message.readAt || "0"), 10) || 0
  };
}

function buildConversationSummary(viewer, peer) {
  const peerUser = findUserByUsername(peer);
  if (!peerUser) {
    return null;
  }

  const conversationMessages = visibleMessagesBetween(viewer, peer);
  const latest = conversationMessages.at(-1) || null;

  return {
    username: peer,
    online: isPresenceVisibleTo(viewer, peer),
    avatarSeed: makeAvatarSeed(peer),
    publicKey: peerUser.publicKey,
    usernameKey: peerUser.usernameKey,
    lastSeenAt: userShowsPresence(peerUser) && !isUserBlocked(peerUser, viewer)
      ? Number.parseInt(String(peerUser.lastSeenAt || "0"), 10) || 0
      : 0,
    unread: conversationMessages.filter((message) => message.to === viewer && !message.readAt && !message.recalled).length,
    latestMessage: latest
      ? {
          id: latest.id,
          from: latest.from,
          to: latest.to,
          text: typeof latest.text === "string" && !latest.ciphertext ? latest.text : null,
          recalled: Boolean(latest.recalled),
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
  const peers = userPeersIndex.get(username);
  if (!peers || peers.size === 0) {
    return [];
  }
  return [...peers]
    .map((peer) => buildConversationSummary(username, peer))
    .filter((conversation) => conversation && conversation.lastAt > 0)
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
    .filter((user) => canSearchUser(viewer, user))
    .filter((user) => !normalizedQuery || user.usernameKey.includes(normalizedQuery))
    .sort((left, right) => {
      const onlineDelta = Number(isPresenceVisibleTo(viewer, right.username)) - Number(isPresenceVisibleTo(viewer, left.username));
      if (onlineDelta !== 0) {
        return onlineDelta;
      }
      return left.username.localeCompare(right.username);
    })
    .slice(0, 24)
    .map((user) => ({
      username: user.username,
      usernameKey: user.usernameKey,
      online: isPresenceVisibleTo(viewer, user.username),
      avatarSeed: makeAvatarSeed(user.username),
      publicKey: user.publicKey,
      lastSeenAt: userShowsPresence(user) && !isUserBlocked(user, viewer)
        ? Number.parseInt(String(user.lastSeenAt || "0"), 10) || 0
        : 0
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
  return collectPagedMessages(visibleMessagesBetween(leftUser, rightUser), limit, beforeCursor);
}

function writeSse(res, event, payload) {
  if (!res || res.writableEnded || res.destroyed) {
    return false;
  }
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch (error) {
    return false;
  }
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

function isUserOnline(username) {
  const connections = onlineConnections.get(username);
  return Boolean(connections && connections.size > 0);
}

function markPendingDeliveries(recipient) {
  const now = Date.now();
  const bySender = new Map();
  for (const message of messages) {
    if (message.to !== recipient || message.deliveredAt || message.recalled) {
      continue;
    }
    if (isMessageDeletedFor(message, recipient)) {
      continue;
    }
    message.deliveredAt = now;
    const ids = bySender.get(message.from) || [];
    ids.push(message.id);
    bySender.set(message.from, ids);
  }
  if (bySender.size === 0) {
    return;
  }
  schedulePersistMessages();
  for (const [sender, messageIds] of bySender) {
    pushEventToUser(sender, "message-delivered", { peer: recipient, messageIds, deliveredAt: now });
  }
}

function pushPresence(username, online) {
  const payload = { username, online };
  for (const connections of onlineConnections.values()) {
    if (connections.size === 0) {
      continue;
    }
    for (const connection of connections) {
      if (!isPresenceVisibleTo(connection.username, username)) {
        writeSse(connection.res, "presence", { username, online: false });
        continue;
      }
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
  for (const connections of onlineConnections.values()) {
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

  const connection = { res, heartbeat, username };
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

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];

    req.on("data", (chunk) => {
      if (tooLarge) {
        return;
      }
      size += chunk.length;
      if (size > maxBytes) {
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
    showOnlineStatus: true,
    allowUserSearch: true,
    blockedUsers: [],
    contacts: {},
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    lastLoginAt: Date.now()
  };
  users.push(user);
  persistUsers();

  recordAdminAction("user_register", { username: user.username, role: "user" }, req, {});
  const token = createSession(user.username, "user", req);
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
    recordAdminAction("user_login_failed", { username: normalizedUsername.value, role: "user" }, req, {
      exists: Boolean(user)
    });
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

  touchUserLogin(user.username, Date.now());
  recordAdminAction("user_login", { username: user.username, role: "user" }, req, {});
  const token = createSession(user.username, "user", req);
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
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:logout:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
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
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:logout-all:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
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

function handleMeSettings(req, res, url) {
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
    settings: publicUser(user).settings,
    blockedUsers: normalizeUserList(user.blockedUsers)
  });
}

async function handleMeSettingsPatch(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:me:settings:${session.username}:${address}`,
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
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJsonBodyError(res, error);
    return;
  }
  if (Object.prototype.hasOwnProperty.call(body, "showOnlineStatus")) {
    if (typeof body.showOnlineStatus !== "boolean") {
      sendJson(res, 400, { error: "showOnlineStatus must be a boolean" });
      return;
    }
    user.showOnlineStatus = body.showOnlineStatus;
  }
  if (Object.prototype.hasOwnProperty.call(body, "allowUserSearch")) {
    if (typeof body.allowUserSearch !== "boolean") {
      sendJson(res, 400, { error: "allowUserSearch must be a boolean" });
      return;
    }
    user.allowUserSearch = body.allowUserSearch;
  }
  persistUsers();
  pushPresence(user.username, isUserOnline(user.username));
  sendJson(res, 200, {
    settings: publicUser(user).settings,
    blockedUsers: normalizeUserList(user.blockedUsers)
  });
}

async function handleMePassword(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:me:password:${session.username}:${address}`,
      MAX_AUTH_REQUESTS_PER_WINDOW,
      "too many auth requests"
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
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJsonBodyError(res, error);
    return;
  }
  const currentPassword = normalizePassword(body.currentPassword);
  const nextPassword = normalizePassword(body.newPassword);
  if (!currentPassword || !nextPassword) {
    sendJson(res, 400, { error: "currentPassword and newPassword are required" });
    return;
  }
  if (nextPassword.length < 4 || nextPassword.length > 72) {
    sendJson(res, 400, { error: "password must be 4-72 characters" });
    return;
  }
  const currentOk = await verifyPassword(currentPassword, user.passwordHash || DUMMY_PASSWORD_HASH);
  if (!currentOk) {
    sendJson(res, 403, { error: "current password invalid" });
    return;
  }
  user.passwordHash = await hashPassword(nextPassword);
  persistUsers();
  const revoked = deleteSessionsForUsername(user.username, "user");
  purgeUserEventTickets(user.username);
  disconnectUserRealtime(user.username, "password updated");
  const token = createSession(user.username, "user", req);
  sendJson(res, 200, {
    ok: true,
    revoked,
    token
  }, {
    "Set-Cookie": sessionCookieHeader(USER_SESSION_COOKIE, token)
  });
}

function handleMeSessions(req, res, url) {
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
    sessions: listUserSessions(user.username)
  });
}

function handleContacts(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  sendJson(res, 200, {
    contacts: listContactsFor(session.username)
  });
}

async function handleContactCreate(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (rejectIfForbiddenOrLimited(
    req,
    res,
    `api:contacts:create:${session.username}:${address}`,
    MAX_API_REQUESTS_PER_WINDOW,
    "too many requests"
  )) {
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJsonBodyError(res, error);
    return;
  }
  const peer = findUserByUsername(readSubmittedUsername(body));
  const owner = findUserByUsername(session.username);
  if (!peer || peer.username === session.username) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  if (!owner) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  if (Object.prototype.hasOwnProperty.call(body, "note") && typeof body.note !== "string") {
    sendJson(res, 400, { error: "note must be a string" });
    return;
  }
  if (isUserBlocked(owner, peer.username)) {
    sendJson(res, 409, { error: "you blocked peer" });
    return;
  }
  if (isUserBlocked(peer, owner.username)) {
    sendJson(res, 403, { error: "blocked by peer" });
    return;
  }
  const existing = contactEntryFor(owner, peer.username);
  if (existing && !existing.removedAt) {
    sendJson(res, 409, { error: "already a contact" });
    return;
  }
  upsertUserContact(owner, peer.username, { note: body.note || "" });
  persistUsers();
  sendJson(res, 201, { contact: publicContactView(owner.username, peer) });
}

async function handleContactPatch(req, res, url, pathname) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:contacts:patch:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const parsed = parseContactPath(pathname);
  const peer = parsed?.username ? findUserByUsername(parsed.username) : null;
  if (!peer || peer.username === session.username) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  const owner = findUserByUsername(session.username);
  if (!owner) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJsonBodyError(res, error);
    return;
  }
  if (Object.prototype.hasOwnProperty.call(body, "note") && typeof body.note !== "string") {
    sendJson(res, 400, { error: "note must be a string" });
    return;
  }
  if (Object.prototype.hasOwnProperty.call(body, "pinned") && typeof body.pinned !== "boolean") {
    sendJson(res, 400, { error: "pinned must be a boolean" });
    return;
  }
  if (Object.prototype.hasOwnProperty.call(body, "muted") && typeof body.muted !== "boolean") {
    sendJson(res, 400, { error: "muted must be a boolean" });
    return;
  }
  const entry = upsertUserContact(owner, peer.username, {
    ...(Object.prototype.hasOwnProperty.call(body, "note") ? { note: body.note } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, "pinned") ? { pinned: body.pinned } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, "muted") ? { muted: body.muted } : {})
  });
  persistUsers();
  sendJson(res, 200, {
    contact: publicContactView(session.username, peer),
    entry
  });
}

function handleContactDelete(req, res, url, pathname) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:contacts:delete:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const parsed = parseContactPath(pathname);
  const peer = parsed?.username ? findUserByUsername(parsed.username) : null;
  if (!peer || peer.username === session.username) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  const owner = findUserByUsername(session.username);
  if (!owner) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  removeUserContact(owner, peer.username);
  persistUsers();
  sendJson(res, 200, { ok: true });
}

async function handleContactBlock(req, res, url, pathname) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:contacts:block:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const parsed = parseContactPath(pathname);
  const peer = parsed?.username ? findUserByUsername(parsed.username) : null;
  if (!peer || peer.username === session.username) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  const owner = findUserByUsername(session.username);
  if (!owner) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJsonBodyError(res, error);
    return;
  }
  if (typeof body.blocked !== "boolean") {
    sendJson(res, 400, { error: "blocked must be a boolean" });
    return;
  }
  const blockedUsers = new Set(normalizeUserList(owner.blockedUsers));
  if (body.blocked) {
    blockedUsers.add(peer.username);
  } else {
    blockedUsers.delete(peer.username);
  }
  owner.blockedUsers = [...blockedUsers];
  upsertUserContact(owner, peer.username, {});
  persistUsers();
  pushPresence(owner.username, isUserOnline(owner.username));
  pushEventToUser(peer.username, "contact-blocked", {
    username: owner.username,
    blocked: body.blocked
  });
  sendJson(res, 200, {
    contact: publicContactView(session.username, peer),
    blockedUsers: owner.blockedUsers
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
    recordAdminAction("admin_login_failed", { username: username || "admin", role: "admin" }, req, {});
    const message = next && next.lockedUntil > Date.now()
      ? "too many failed attempts, try again later"
      : "管理员账号或密码错误";
    sendJson(res, next && next.lockedUntil > Date.now() ? 429 : 401, { error: message });
    return;
  }
  clearAdminLoginFailures(account.username);
  const token = createSession(account.username, "admin", req);
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
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:logout:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
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
  const session = requireAdminSession(req, res, url);
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
  const session = requireAdminSession(req, res, url);
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
  const session = requireAdminSession(req, res, url);
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
  const session = requireAdminSession(req, res, url);
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
  const session = requireAdminSession(req, res, url);
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
  const session = requireAdminSession(req, res, url);
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
    // Re-point other users' block lists and contact entries at the new username so a
    // rename can't be used to slip past an existing block or orphan saved contacts.
    for (const otherUser of users) {
      if (otherUser === user) {
        continue;
      }
      if (Array.isArray(otherUser.blockedUsers) && otherUser.blockedUsers.includes(previousUsername)) {
        otherUser.blockedUsers = [
          ...new Set(otherUser.blockedUsers.map((name) => (name === previousUsername ? user.username : name)))
        ];
      }
      if (otherUser.contacts && typeof otherUser.contacts === "object" && otherUser.contacts[previousUsername]) {
        const movedEntry = otherUser.contacts[previousUsername];
        delete otherUser.contacts[previousUsername];
        otherUser.contacts[user.username] = otherUser.contacts[user.username] || movedEntry;
      }
    }
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
    await accessLogStore.renameUserId(previousUsername, user.username);
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
  const session = requireAdminSession(req, res, url);
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
  const session = requireAdminSession(req, res, url);
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

function handleAdminMessages(req, res, url) {
  const session = requireAdminSession(req, res, url);
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
  const session = requireAdminSession(req, res, url);
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
  const session = requireAdminSession(req, res, url);
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
  const session = requireAdminSession(req, res, url);
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
  if (!query) {
    sendJson(res, 200, { users: [] });
    return;
  }
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
      usernameKey: peer.usernameKey,
      online: isPresenceVisibleTo(session.username, peer.username),
      lastSeenAt: userShowsPresence(peer) && !isUserBlocked(peer, session.username)
        ? Number.parseInt(String(peer.lastSeenAt || "0"), 10) || 0
        : 0,
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
    body = await readJsonBody(req, url.pathname === "/api/messages/attachment" ? MAX_MESSAGE_BODY_BYTES : MAX_BODY_BYTES);
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
  const senderUser = findUserByUsername(session.username);
  if (isUserBlocked(senderUser, peer.username)) {
    sendJson(res, 403, { error: "you blocked peer" });
    return;
  }
  if (isUserBlocked(peer, session.username)) {
    sendJson(res, 403, { error: "blocked by peer" });
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
    replyTo,
    deletedFor: []
  };
  let contactsChanged = false;
  if (senderUser && !contactEntryFor(senderUser, peer.username)) {
    upsertUserContact(senderUser, peer.username, {});
    contactsChanged = true;
  }
  if (!contactEntryFor(peer, session.username)) {
    upsertUserContact(peer, session.username, {});
    contactsChanged = true;
  }
  if (contactsChanged) {
    persistUsers();
  }
  messages.push(message);
  appendMessageBucket(message);
  const recipientOnline = isUserOnline(peer.username);
  if (recipientOnline) {
    message.deliveredAt = Date.now();
  }
  schedulePersistMessages(message);

  const senderView = createMessageView(message, session.username);
  const recipientView = createMessageView(message, peer.username);
  pushEventToUser(session.username, "message", senderView);
  pushEventToUser(peer.username, "message", recipientView);
  if (recipientOnline) {
    pushEventToUser(session.username, "message-delivered", {
      peer: peer.username,
      messageIds: [message.id],
      deliveredAt: message.deliveredAt
    });
  }

  sendJson(res, 201, {
    message: senderView,
    conversation: buildConversationSummary(session.username, peer.username)
  });
}

async function handleRecallMessage(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:messages:recall:${session.username}:${address}`,
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
  const messageId = String(body.messageId || "").trim();
  if (!messageId) {
    sendJson(res, 400, { error: "messageId required" });
    return;
  }
  const target = messages.find((m) => m.id === messageId && m.from === session.username);
  if (!target) {
    sendJson(res, 404, { error: "message not found or not yours" });
    return;
  }
  target.recalled = true;
  target.ciphertext = "";
  target.nonce = "";
  schedulePersistMessages(target);
  const peer = target.to === session.username ? target.from : target.to;
  pushEventToUser(session.username, "message-recalled", { messageId, by: session.username, peer });
  pushEventToUser(peer, "message-recalled", { messageId, by: session.username, peer: session.username });
  sendJson(res, 200, { ok: true });
}

async function handleDeleteMessage(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:messages:delete:${session.username}:${address}`,
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

  const messageId = String(body.messageId || "").trim();
  if (!messageId) {
    sendJson(res, 400, { error: "messageId required" });
    return;
  }

  const target = messageIdIndex.get(messageId);
  if (!target || (target.from !== session.username && target.to !== session.username)) {
    sendJson(res, 404, { error: "message not found" });
    return;
  }

  const deletedFor = Array.isArray(target.deletedFor) ? target.deletedFor : [];
  if (!deletedFor.includes(session.username)) {
    deletedFor.push(session.username);
    target.deletedFor = deletedFor;
    schedulePersistMessages();
  }

  const peer = target.from === session.username ? target.to : target.from;
  pushEventToUser(session.username, "message-deleted", { messageId, peer });
  sendJson(res, 200, { ok: true });
}

async function handleMarkRead(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:messages:read:${session.username}:${address}`,
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

  const peer = findUserByUsername(body.peer);
  if (!peer || peer.username === session.username) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }

  const now = Date.now();
  const messageIds = [];
  for (const message of messagesBetween(session.username, peer.username)) {
    if (message.from !== peer.username || message.recalled || message.readAt) {
      continue;
    }
    if (isMessageDeletedFor(message, session.username)) {
      continue;
    }
    if (!message.deliveredAt) {
      message.deliveredAt = now;
    }
    message.readAt = now;
    messageIds.push(message.id);
  }

  if (messageIds.length > 0) {
    schedulePersistMessages();
    pushEventToUser(peer.username, "message-read", { peer: session.username, messageIds, readAt: now });
    pushEventToUser(session.username, "conversation-read", { peer: peer.username, messageIds, readAt: now });
  }

  sendJson(res, 200, { ok: true, count: messageIds.length });
}

async function handleTypingSignal(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:typing:${session.username}:${address}`,
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
  // Typing is best-effort and ephemeral; always answer 200 so a caller can't probe
  // block/online state, but only forward the signal when neither side is blocked.
  if (peer && peer.username !== session.username && !peer.banned) {
    const senderUser = findUserByUsername(session.username);
    if (!isUserBlocked(senderUser, peer.username) && !isUserBlocked(peer, session.username)) {
      pushEventToUser(peer.username, "typing", {
        peer: session.username,
        typing: Boolean(body.typing)
      });
    }
  }
  sendJson(res, 200, { ok: true });
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
    onlineUsers: listOnlineUsers().filter((username) => isPresenceVisibleTo(ticketRecord.username, username))
  });
  markPendingDeliveries(ticketRecord.username);

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
  const originalWriteHead = res.writeHead;
  res.writeHead = function patchedWriteHead(statusCode, ...rest) {
    const refreshCookie = req.pendingSessionCookie;
    if (refreshCookie) {
      const trailingHeaders = rest[rest.length - 1];
      if (trailingHeaders && typeof trailingHeaders === "object" && !Array.isArray(trailingHeaders)) {
        if (
          !Object.prototype.hasOwnProperty.call(trailingHeaders, "Set-Cookie") &&
          !Object.prototype.hasOwnProperty.call(trailingHeaders, "set-cookie")
        ) {
          trailingHeaders["Set-Cookie"] = refreshCookie;
        }
      } else if (!res.hasHeader("Set-Cookie")) {
        res.setHeader("Set-Cookie", refreshCookie);
      }
    }
    return originalWriteHead.call(this, statusCode, ...rest);
  };
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
  if (req.method === "GET" && pathname === "/api/me/settings") {
    handleMeSettings(req, res, url);
    return;
  }
  if (req.method === "PATCH" && pathname === "/api/me/settings") {
    void handleMeSettingsPatch(req, res, url);
    return;
  }
  if (req.method === "POST" && pathname === "/api/me/password") {
    void handleMePassword(req, res, url);
    return;
  }
  if (req.method === "GET" && pathname === "/api/me/sessions") {
    handleMeSessions(req, res, url);
    return;
  }
  const contactPath = parseContactPath(pathname);
  if (req.method === "GET" && pathname === "/api/contacts") {
    handleContacts(req, res, url);
    return;
  }
  if (req.method === "POST" && pathname === "/api/contacts") {
    void handleContactCreate(req, res, url);
    return;
  }
  if (contactPath && req.method === "PATCH" && !contactPath.action) {
    void handleContactPatch(req, res, url, pathname);
    return;
  }
  if (contactPath && req.method === "DELETE" && !contactPath.action) {
    handleContactDelete(req, res, url, pathname);
    return;
  }
  if (contactPath && req.method === "POST" && contactPath.action === "block") {
    void handleContactBlock(req, res, url, pathname);
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
  if (req.method === "POST" && pathname === "/api/messages/attachment") {
    void handleSendMessage(req, res, url);
    return;
  }
  if (req.method === "POST" && pathname === "/api/messages/recall") {
    void handleRecallMessage(req, res, url);
    return;
  }
  if (req.method === "POST" && pathname === "/api/messages/delete") {
    void handleDeleteMessage(req, res, url);
    return;
  }
  if (req.method === "POST" && pathname === "/api/messages/read") {
    void handleMarkRead(req, res, url);
    return;
  }
  if (req.method === "POST" && pathname === "/api/messages/typing") {
    void handleTypingSignal(req, res, url);
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

server.requestTimeout = 30000;
server.headersTimeout = 31000;
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
