"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const { createAccessLogMiddleware } = require("./middleware/access-log");
const { createAccessLogStore } = require("./services/access-log-store");
const { createMessageStore } = require("./services/message-store");
const { createRealtimeHub } = require("./services/realtime-hub");
const { createSessionStore } = require("./services/session-store");
const { createStaticFileServer } = require("./services/static-file-server");
const { createAccountRoutes } = require("./routes/account-routes");
const { createAdminRoutes } = require("./routes/admin-routes");
const { createContactRoutes } = require("./routes/contact-routes");
const { createEventRoutes } = require("./routes/event-routes");
const { createMessageRoutes } = require("./routes/message-routes");
const { createSupportRoutes } = require("./routes/support-routes");
const {
  ADMIN_AUDIT_HMAC_ALGO, ADMIN_AUDIT_SHA_ALGO,
  readConfiguredAdminConfig, validateConfiguredAdminConfig, warnIfWeakAdminCredential,
  readAuditHmacKeyState, verifyAdminUpdatePassphrase,
  computeAdminAuditEntryHash, entryBaseFromEntry, persistAdminConfigToEnvFile
} = require("./services/admin-config");
const {
  securityHeaders, sendJson, getClientAddress, normalizedRequestHost,
  parseRequestUrl, isSameOriginRequest,
  parseCookies, cookieAttributes, mergeSetCookieValues, readPathSuffix, parsePositiveInteger,
  readJsonBody, sendJsonBodyError
} = require("./utils/http");
const {
  readJsonFile,
  readJsonLinesFile,
  writeJsonFile,
  rewriteJsonLinesFile,
  appendJsonLinesFile,
  appendTextFileSync
} = require("./utils/data");
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
  HOST, PORT, SESSION_TTL_MS, SESSION_ABSOLUTE_TTL_MS, PUBLIC_DIR, DATA_DIR,
  USERS_FILE, MESSAGES_FILE, MESSAGES_LOG_FILE, ADMIN_AUDIT_FILE, SESSIONS_FILE, ERROR_LOG_FILE, SESSION_SECRET_FILE,
  MAX_BODY_BYTES, MAX_MESSAGE_BODY_BYTES, RATE_WINDOW_MS, MAX_AUTH_REQUESTS_PER_WINDOW,
  MAX_API_REQUESTS_PER_WINDOW, MAX_MESSAGES_PER_CONVERSATION_WINDOW,
  HEARTBEAT_MS, EVENT_TICKET_TTL_MS, MESSAGE_PERSIST_DEBOUNCE_MS, MESSAGE_RECALL_WINDOW_MS,
  HSTS_MAX_AGE_SECONDS, COOKIE_SECURE, ENABLE_ACCESS_LOG,
  ACCESS_LOG_RETENTION_DAYS, ACCESS_LOG_MAX_QUEUE, ENABLE_IP_GEO,
  IP_GEO_TIMEOUT_MS, IP_GEO_CACHE_TTL_MS,
  USER_SESSION_COOKIE, ADMIN_SESSION_COOKIE,
  DEFAULT_ADMIN_USERNAME_VALUE,
  AUDIT_TEXT_RETENTION_DAYS, TRUST_PROXY, TRUSTED_ORIGINS,
  PUBLIC_KEY_BYTES, MESSAGE_NONCE_BYTES, MESSAGE_CIPHERTEXT_BYTES,
  ADMIN_LOGIN_FAILURE_WINDOW_MS, ADMIN_LOGIN_LOCKOUT_MS, ADMIN_LOGIN_MAX_FAILURES,
  USER_LOGIN_FAILURE_WINDOW_MS, USER_LOGIN_LOCKOUT_MS, USER_LOGIN_MAX_FAILURES,
  MAX_CONCURRENT_EVENT_CONNECTIONS_PER_USER, DUMMY_PASSWORD_HASH
} = require("./config");

const rateBuckets = new Map();
const conversationRateBuckets = new Map();
const usersByKey = new Map();
const adminLoginFailures = new Map();
const userLoginFailures = new Map();

let users = [];
let adminAuditLastHash = "GENESIS";
const adminAuditEntries = [];
const serverStartedAt = Date.now();
const serveStatic = createStaticFileServer(PUBLIC_DIR);
const SESSION_PERSIST_DEBOUNCE_MS = 150;
const SESSION_ACTIVITY_PERSIST_MS = 60 * 1000;
const KEY_BUNDLE_VERSION = 1;
const KEY_BUNDLE_MIN_ITERATIONS = 100000;
const KEY_BUNDLE_MAX_ITERATIONS = 1000000;
const KEY_BUNDLE_SALT_BYTES = 16;
const KEY_BUNDLE_IV_BYTES = 12;
const KEY_BUNDLE_CIPHERTEXT_BYTES = {
  min: 96,
  max: 512
};
const ERROR_LOG_SENSITIVE_KEYS = new Set([
  "password",
  "currentpassword",
  "newpassword",
  "token",
  "cookie",
  "authorization",
  "set-cookie",
  "session",
  "sessiontoken",
  "csrftoken",
  "keybundle",
  "encryptedprivatekey",
  "privatekeypkcs8base64"
]);

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
  if (!fs.existsSync(SESSIONS_FILE)) {
    fs.writeFileSync(SESSIONS_FILE, "[]\n", "utf8");
  }
  if (!fs.existsSync(ERROR_LOG_FILE)) {
    fs.writeFileSync(ERROR_LOG_FILE, "", "utf8");
  }
}

function redactSensitiveValue(value, depth = 0) {
  if (depth > 4) {
    return "[Truncated]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => redactSensitiveValue(entry, depth + 1));
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.length > 1024) {
      return `${value.slice(0, 1024)}...`;
    }
    return value;
  }
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    next[key] = ERROR_LOG_SENSITIVE_KEYS.has(normalizedKey)
      ? "[Redacted]"
      : redactSensitiveValue(entry, depth + 1);
  }
  return next;
}

function recordErrorLog(kind, error, req = null, details = {}) {
  const entry = {
    id: crypto.randomUUID(),
    at: Date.now(),
    kind: String(kind || "error"),
    message: error instanceof Error ? error.message : String(error || "unknown error"),
    stack: error instanceof Error ? String(error.stack || "").split("\n").slice(0, 12).join("\n") : "",
    request: req
      ? {
          method: String(req.method || ""),
          path: parseRequestUrl(req)?.pathname || String(req.url || ""),
          ip: getClientAddress(req),
          userAgent: String(req.headers["user-agent"] || "").slice(0, 240)
        }
      : null,
    details: redactSensitiveValue(details)
  };
  try {
    appendTextFileSync(ERROR_LOG_FILE, `${JSON.stringify(entry)}\n`);
  } catch (writeError) {
    console.error(`[error-log] ${writeError instanceof Error ? writeError.message : String(writeError)}`);
  }
}

function findAdminAccount(username) {
  return username === adminConfig.username
    ? {
        username: adminConfig.username
      }
    : null;
}

function purgeStoredLegacyUserKeyMaterial() {
  let changed = false;
  for (const user of users) {
    if (user.__legacyKeyMaterialDetected) {
      delete user.__legacyKeyMaterialDetected;
      changed = true;
    }
    for (const key of ["privateKeySalt", "privateKeyIv", "encryptedPrivateKey"]) {
      if (key in user) {
        delete user[key];
        changed = true;
      }
    }
  }
  if (changed) {
    persistUsers();
  }
}

let adminConfig = readConfiguredAdminConfig();
validateConfiguredAdminConfig(adminConfig);
warnIfWeakAdminCredential(adminConfig);
const adminAuditHmacKeyState = readAuditHmacKeyState(adminConfig.credential);
const accessLogStore = createAccessLogStore({
  dataDir: DATA_DIR,
  enabled: ENABLE_ACCESS_LOG,
  retentionDays: ACCESS_LOG_RETENTION_DAYS,
  maxQueueSize: ACCESS_LOG_MAX_QUEUE,
  enableIpGeo: ENABLE_IP_GEO,
  ipGeoTimeoutMs: IP_GEO_TIMEOUT_MS,
  ipGeoCacheTtlMs: IP_GEO_CACHE_TTL_MS,
  logger: (error) => {
    recordErrorLog("access_log_store", error);
    console.error(`[access-log] ${error instanceof Error ? error.message : String(error)}`);
  }
});
const sessionStore = createSessionStore({
  sessionsFile: SESSIONS_FILE,
  sessionSecretFile: SESSION_SECRET_FILE,
  sessionTtlMs: SESSION_TTL_MS,
  sessionAbsoluteTtlMs: SESSION_ABSOLUTE_TTL_MS,
  eventTicketTtlMs: EVENT_TICKET_TTL_MS,
  sessionPersistDebounceMs: SESSION_PERSIST_DEBOUNCE_MS,
  sessionActivityPersistMs: SESSION_ACTIVITY_PERSIST_MS,
  userSessionCookie: USER_SESSION_COOKIE,
  adminSessionCookie: ADMIN_SESSION_COOKIE,
  ensureDataFiles,
  readJsonFile,
  writeJsonFile,
  parseCookies,
  cookieAttributes,
  getClientAddress,
  isSameOriginRequest,
  sendJson,
  findUserByUsername,
  disconnectSessionRealtime: (token, reason) => disconnectSessionRealtime(token, reason)
});
const {
  sessions,
  normalizeSessionRole,
  loadSessionState,
  flushPendingSessionPersist,
  schedulePersistSessions,
  issueSession,
  revokeSession,
  sessionResponseFields,
  sessionCookieHeader,
  clearSessionCookieHeader,
  getSessionFromRequest,
  requireSession,
  requireAdminSession,
  deleteSessionsForUsername,
  purgeSessionEventTickets,
  purgeUserEventTickets,
  eventTicketAgentHash,
  createEventTicketForSession,
  consumeEventTicket,
  cleanSessions,
  cleanEventTickets
} = sessionStore;
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
  appendTextFileSync(ADMIN_AUDIT_FILE, `${payload}\n`);
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
  users = loadedUsers.map((user) => {
    const {
      privateKeySalt: legacyPrivateKeySalt,
      privateKeyIv: legacyPrivateKeyIv,
      encryptedPrivateKey: legacyEncryptedPrivateKey,
      ...safeUser
    } = user || {};
    void legacyPrivateKeySalt;
    void legacyPrivateKeyIv;
    void legacyEncryptedPrivateKey;
    return {
      ...safeUser,
      id: String(user?.id || crypto.randomUUID()),
      usernameKey: String(user?.usernameKey || normalizeUsername(user?.username)?.key || ""),
      publicKey: String(user?.publicKey || ""),
      keyBundle: normalizeKeyBundle(user?.keyBundle),
      __legacyKeyMaterialDetected: Boolean(
        user && (
          Object.prototype.hasOwnProperty.call(user, "privateKeySalt") ||
          Object.prototype.hasOwnProperty.call(user, "privateKeyIv") ||
          Object.prototype.hasOwnProperty.call(user, "encryptedPrivateKey")
        )
      ),
      banned: Boolean(user?.banned),
      bannedReason: String(user?.bannedReason || ""),
      bannedAt: Number.parseInt(String(user?.bannedAt || "0"), 10) || 0,
      showOnlineStatus: user?.showOnlineStatus !== false,
      allowUserSearch: user?.allowUserSearch !== false,
      blockedUsers: normalizeUserList(user?.blockedUsers),
      contacts: normalizeUserContacts(user?.contacts),
      lastSeenAt: Number.parseInt(String(user?.lastSeenAt || "0"), 10) || 0,
      lastLoginAt: Number.parseInt(String(user?.lastLoginAt || "0"), 10) || 0
    };
  });
  rebuildUserIndex();

  messageStore.loadMessages();
}

function persistUsers() {
  writeJsonFile(USERS_FILE, users);
  rebuildUserIndex();
}

function rebuildUserIndex() {
  usersByKey.clear();
  for (const user of users) {
    if (user?.usernameKey) {
      usersByKey.set(user.usernameKey, user);
    }
  }
}

function cleanRateBuckets() {
  cleanRateBucketMap(rateBuckets, RATE_WINDOW_MS);
  cleanRateBucketMap(conversationRateBuckets, RATE_WINDOW_MS);
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

function normalizeKeyBundle(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const version = Number.parseInt(String(value.version || KEY_BUNDLE_VERSION), 10) || 0;
  const iterations = Number.parseInt(String(value.iterations || "0"), 10) || 0;
  const salt = String(value.salt || "").trim();
  const iv = String(value.iv || "").trim();
  const ciphertext = String(value.ciphertext || "").trim();
  if (version !== KEY_BUNDLE_VERSION) {
    return null;
  }
  if (iterations < KEY_BUNDLE_MIN_ITERATIONS || iterations > KEY_BUNDLE_MAX_ITERATIONS) {
    return null;
  }
  if (!isBase64Blob(salt, KEY_BUNDLE_SALT_BYTES, KEY_BUNDLE_SALT_BYTES)) {
    return null;
  }
  if (!isBase64Blob(iv, KEY_BUNDLE_IV_BYTES, KEY_BUNDLE_IV_BYTES)) {
    return null;
  }
  if (!isBase64Blob(ciphertext, KEY_BUNDLE_CIPHERTEXT_BYTES.min, KEY_BUNDLE_CIPHERTEXT_BYTES.max)) {
    return null;
  }
  return {
    version,
    iterations,
    salt,
    iv,
    ciphertext
  };
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

function accountKeyBundleView(user) {
  return normalizeKeyBundle(user?.keyBundle);
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

function isBlockedBetween(leftUsername, rightUsername) {
  const leftUser = findUserByUsername(leftUsername);
  const rightUser = findUserByUsername(rightUsername);
  return Boolean(
    leftUser &&
    rightUser &&
    (isUserBlocked(leftUser, rightUser.username) || isUserBlocked(rightUser, leftUser.username))
  );
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

function normalizeRelationshipStateValue(value) {
  const normalized = String(value || "normal").trim().toLowerCase();
  if (normalized === "blocked" || normalized === "muted") {
    return normalized;
  }
  return "normal";
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
    relationshipState: normalizeRelationshipStateValue(
      patch.relationshipState === undefined ? existing.relationshipState : patch.relationshipState
    ),
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

function relationshipStateFor(owner, peerUsername) {
  if (!owner || !peerUsername) {
    return "normal";
  }
  if (isUserBlocked(owner, peerUsername)) {
    return "blocked";
  }
  const entry = contactEntryFor(owner, peerUsername);
  if (!entry) {
    return "normal";
  }
  if (normalizeRelationshipStateValue(entry.relationshipState) === "muted" || Boolean(entry.muted)) {
    return "muted";
  }
  return "normal";
}

function setRelationshipState(owner, peerUsername, nextState, patch = {}) {
  if (!owner || !peerUsername) {
    return null;
  }
  const normalizedState = normalizeRelationshipStateValue(nextState);
  const blockedUsers = new Set(normalizeUserList(owner.blockedUsers));
  if (normalizedState === "blocked") {
    blockedUsers.add(peerUsername);
  } else {
    blockedUsers.delete(peerUsername);
  }
  owner.blockedUsers = [...blockedUsers];
  return upsertUserContact(owner, peerUsername, {
    ...patch,
    muted: normalizedState === "muted",
    relationshipState: normalizedState
  });
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
  const relationshipState = relationshipStateFor(owner, peerUser.username);
  return {
    username: peerUser.username,
    usernameKey: peerUser.usernameKey,
    note: entry?.note || "",
    blocked: relationshipState === "blocked",
    blockedByPeer: isUserBlocked(peerUser, ownerUsername),
    pinned: Boolean(entry?.pinned),
    muted: relationshipState === "muted",
    relationshipState,
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

function publicKeyBundleForUser(user) {
  const publicKeyBytes = decodeBase64Blob(user.publicKey);
  const fingerprint = publicKeyBytes
    ? crypto.createHash("sha256").update(publicKeyBytes).digest("hex")
    : "";
  return {
    userId: user.username,
    username: user.username,
    usernameKey: user.usernameKey,
    algorithm: "ECDH-P256+HKDF-SHA256+AES-256-GCM",
    keyAgreement: "identity-key-ecdh-v1",
    identityKey: user.publicKey,
    publicKey: user.publicKey,
    fingerprint,
    privateKeyStoredOnServer: false,
    capabilities: {
      zeroKnowledgeMessages: true,
      encryptedAttachments: true,
      signedPreKeys: false,
      oneTimePreKeys: false,
      multiDeviceKeyBundles: true,
      passwordEncryptedIdentityBundles: true
    }
  };
}

function prekeyBundleForUser(user) {
  return {
    ...publicKeyBundleForUser(user),
    preKeyBundleVersion: 2,
    preKeyModel: "identity-key-compat-v1",
    signedPreKey: {
      keyId: `identity:${user.usernameKey}`,
      publicKey: user.publicKey,
      signature: null,
      signatureVerified: false
    },
    oneTimePreKeys: [],
    limitations: [
      "Signal Double Ratchet and one-time prekey pools are not enabled in this build; multi-device recovery uses an owner-only password-encrypted identity bundle, and the server never decrypts or generates session keys."
    ]
  };
}

function summarizeEncodedBlob(value) {
  const raw = String(value || "");
  const bytes = decodeBase64Blob(raw);
  return {
    present: raw.length > 0,
    bytes: bytes ? bytes.length : 0,
    sha256: bytes ? crypto.createHash("sha256").update(bytes).digest("hex") : "",
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

function requirePublicWriteOrigin(req, res) {
  if (isSameOriginRequest(req)) {
    return true;
  }
  sendJson(res, 403, { error: "forbidden origin" });
  return false;
}

const messageStore = createMessageStore({
  messagesFile: MESSAGES_FILE,
  messagesLogFile: MESSAGES_LOG_FILE,
  messagePersistDebounceMs: MESSAGE_PERSIST_DEBOUNCE_MS,
  readJsonFile,
  readJsonLinesFile,
  writeJsonFile,
  rewriteJsonLinesFile,
  appendJsonLinesFile,
  findUserByUsername,
  userShowsPresence,
  isUserBlocked,
  isBlockedBetween,
  isPresenceVisibleTo,
  makeAvatarSeed
});
const {
  messages,
  messageBuckets,
  messageIdIndex,
  messageClientIndex,
  messageNonceIndex,
  userPeersIndex,
  schedulePersistMessages,
  flushPendingMessagePersist,
  purgeStoredMessagePlaintext,
  rebuildMessageBuckets,
  appendMessageBucket,
  messageNonceReplayKey,
  normalizeReplyTargetView,
  resolveReplyTarget,
  isMessageDeletedFor,
  messagesBetween,
  createMessageView,
  buildConversationSummary,
  listConversationsFor,
  parseMessageCursor,
  collectPagedMessages,
  pagedMessagesBetween,
  getNextMessageSequence
} = messageStore;

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

function parseAdminDashboardDays(url) {
  const days = Number.parseInt(String(url.searchParams.get("days") || "7"), 10) || 7;
  if (days <= 7) {
    return 7;
  }
  if (days <= 14) {
    return 14;
  }
  return 30;
}

function localDateLabel(timestamp) {
  const time = Number(timestamp);
  const date = new Date(Number.isFinite(time) ? time : Date.now());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDayStart(timestamp = Date.now()) {
  const time = Number(timestamp);
  const date = new Date(Number.isFinite(time) ? time : Date.now());
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function buildDashboardDayRows(days) {
  const todayStart = localDayStart();
  return Array.from({ length: days }, (_, index) => {
    const at = todayStart - (days - index - 1) * 24 * 60 * 60 * 1000;
    return {
      label: localDateLabel(at),
      users: 0,
      messages: 0,
      activeUsers: 0,
      failedLogins: 0,
      requests: 0,
      errors: 0,
      avgRequestTimeMs: 0
    };
  });
}

function incrementDashboardDay(rowsByLabel, timestamp, key, value = 1) {
  const time = Number(timestamp || 0);
  if (!time) {
    return;
  }
  const label = localDateLabel(time);
  const row = rowsByLabel.get(label);
  if (row) {
    row[key] = Number(row[key] || 0) + value;
  }
}

function buildUserDistribution(dayAgo) {
  let banned = 0;
  let active = 0;
  let inactive = 0;
  for (const user of users) {
    if (user.banned) {
      banned += 1;
    } else if (Number(user.lastSeenAt || 0) >= dayAgo) {
      active += 1;
    } else {
      inactive += 1;
    }
  }
  return [
    { label: "24h 活跃", value: active },
    { label: "未活跃", value: inactive },
    { label: "已封禁", value: banned }
  ];
}

function buildMessageSecurityDistribution() {
  let encrypted = 0;
  let invalid = 0;
  let recalled = 0;
  for (const message of messages) {
    if (message.recalled) {
      recalled += 1;
    } else if (message.ciphertext) {
      encrypted += 1;
    } else {
      invalid += 1;
    }
  }
  return {
    encrypted,
    invalid,
    recalled,
    distribution: [
      { label: "端到端密文", value: encrypted },
      { label: "结构异常", value: invalid },
      { label: "已撤回", value: recalled }
    ]
  };
}

function messageDeliveryState(message) {
  if (message?.recalled) {
    return "recalled";
  }
  if (Number(message?.readAt || 0) > 0) {
    return "read";
  }
  if (Number(message?.deliveredAt || 0) > 0) {
    return "delivered";
  }
  return "pending";
}

function buildMessageDeliveryStats() {
  const stats = {
    total: messages.length,
    pending: 0,
    delivered: 0,
    read: 0,
    recalled: 0,
    deletedForViewer: 0
  };
  for (const message of messages) {
    const state = messageDeliveryState(message);
    stats[state] = Number(stats[state] || 0) + 1;
    if (Array.isArray(message.deletedFor) && message.deletedFor.length > 0) {
      stats.deletedForViewer += 1;
    }
  }
  return stats;
}

function buildDashboardTrends(days, auditEntries, accessSummary) {
  const rows = buildDashboardDayRows(days);
  const rowsByLabel = new Map(rows.map((row) => [row.label, row]));
  for (const user of users) {
    incrementDashboardDay(rowsByLabel, Number(user.createdAt || 0), "users");
    incrementDashboardDay(rowsByLabel, Number(user.lastSeenAt || 0), "activeUsers");
  }
  for (const message of messages) {
    incrementDashboardDay(rowsByLabel, Number(message.createdAt || 0), "messages");
  }
  for (const entry of auditEntries) {
    if (entry.action === "admin_login_failed" || entry.action === "user_login_failed") {
      incrementDashboardDay(rowsByLabel, Number(entry.at || 0), "failedLogins");
    }
  }
  for (const row of accessSummary?.requestTrend || []) {
    const target = rowsByLabel.get(String(row.label || ""));
    if (!target) {
      continue;
    }
    target.requests = Number(row.requests || 0);
    target.errors = Number(row.errors || 0);
    target.avgRequestTimeMs = Number(row.avgRequestTimeMs || 0);
  }
  return rows;
}

function buildSecurityAlerts({ accessSummary, auditEntries, health, messageSecurity, deliveryStats }) {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const failedLogins24h = auditEntries.filter(
    (entry) =>
      Number(entry.at || 0) >= dayAgo &&
      (entry.action === "admin_login_failed" || entry.action === "user_login_failed")
  ).length;
  const adminFailed24h = auditEntries.filter(
    (entry) => Number(entry.at || 0) >= dayAgo && entry.action === "admin_login_failed"
  ).length;
  const errorsInRange = Number(accessSummary?.totals?.errorsInRange || 0);
  const errorRate = Number(accessSummary?.totals?.errorRate || 0);
  const alerts = [];
  if (messageSecurity.invalid > 0) {
    alerts.push({
      level: "high",
      title: "消息结构异常",
      detail: `检测到 ${messageSecurity.invalid} 条没有密文载荷的历史消息，系统已停止展示明文并建议尽快完成数据清理。`
    });
  }
  if (Number(deliveryStats?.pending || 0) > 0) {
    alerts.push({
      level: "medium",
      title: "存在待投递消息",
      detail: `当前还有 ${deliveryStats.pending} 条消息等待接收方重新上线投递，建议关注离线用户与连接稳定性。`
    });
  }
  if (adminFailed24h > 0) {
    alerts.push({
      level: "high",
      title: "管理员登录失败",
      detail: `近 24 小时有 ${adminFailed24h} 次管理员登录失败，建议核查来源 IP 与账号口令。`
    });
  }
  if (failedLogins24h > 0) {
    alerts.push({
      level: "medium",
      title: "登录异常尝试",
      detail: `近 24 小时累计 ${failedLogins24h} 次登录失败，已纳入速率限制与锁定策略。`
    });
  }
  if (errorsInRange > 0 || errorRate >= 0.01) {
    alerts.push({
      level: errorRate >= 0.05 ? "high" : "medium",
      title: "服务错误率上升",
      detail: `当前时间范围内 ${errorsInRange} 个错误请求，错误率 ${(errorRate * 100).toFixed(2)}%。`
    });
  }
  if (Number(health?.runtime?.accessLogQueue || 0) > 0) {
    alerts.push({
      level: "low",
      title: "访问日志仍在写入",
      detail: `访问日志队列还有 ${health.runtime.accessLogQueue} 条待处理记录。`
    });
  }
  if (Number(health?.accessLogs?.droppedRows || 0) > 0) {
    alerts.push({
      level: "medium",
      title: "访问日志发生丢弃",
      detail: `访问日志队列曾丢弃 ${health.accessLogs.droppedRows} 条记录，建议调大 ACCESS_LOG_MAX_QUEUE 或检查磁盘/SQLite 写入性能。`
    });
  }
  if (!COOKIE_SECURE) {
    alerts.push({
      level: "medium",
      title: "Secure Cookie 未启用",
      detail: "生产环境应通过 HTTPS 设置 COOKIE_SECURE=1，避免 Cookie 在非 TLS 通道发送。"
    });
  }
  if (alerts.length === 0) {
    alerts.push({
      level: "ok",
      title: "未发现高优先级告警",
      detail: "当前时间范围内未发现后台登录、服务错误或消息加密方面的突出异常。"
    });
  }
  return alerts.slice(0, 6);
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
  const messageHealth = messageStore.healthSnapshot();
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
      pendingMessageAppends: messageHealth.pendingMessageAppends,
      messagesDirty: messageHealth.messagesDirty,
      accessLogQueue: Number(accessLogHealth.pendingQueue || 0)
    },
    accessLogs: accessLogHealth
  };
}

function readRecentAdminAuditEntries(limit = 80) {
  return adminAuditEntries.slice(Math.max(0, adminAuditEntries.length - limit));
}

function listUserSessions(username, currentSessionId = "") {
  return [...sessions.values()]
    .filter((sessionRecord) => sessionRecord.role === "user" && sessionRecord.username === username)
    .sort((left, right) => Number(right.lastSeenAt) - Number(left.lastSeenAt))
    .map((sessionRecord) => ({
      id: String(sessionRecord.id || ""),
      current: Boolean(currentSessionId) && sessionRecord.id === currentSessionId,
      createdAt: Number(sessionRecord.createdAt || 0),
      lastSeenAt: Number(sessionRecord.lastSeenAt || 0),
      expiresAt: Number(sessionRecord.expiresAt || 0),
      browser: String(sessionRecord.browser || ""),
      os: String(sessionRecord.os || ""),
      device: String(sessionRecord.device || ""),
      ip: String(sessionRecord.ip || "")
    }));
}

function basicIpAttribution(ip) {
  const value = String(ip || "").trim().toLowerCase();
  if (!value || value === "unknown") {
    return "未知";
  }
  if (value === "::1" || value === "127.0.0.1" || value === "localhost") {
    return "本机";
  }
  if (value.includes(":")) {
    return /^f[cd][0-9a-f]{0,2}:/.test(value) || value.startsWith("fe80:") ? "内网" : "IPv6";
  }
  const match = value.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!match) {
    return "未知";
  }
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  ) {
    return "内网";
  }
  return "IPv4";
}

function sessionIpAttribution(ip, accessProfile, accessLogs) {
  const normalizedIp = String(ip || "").trim();
  if (!normalizedIp) {
    return "";
  }
  const exactLog = (Array.isArray(accessLogs) ? accessLogs : []).find(
    (row) => String(row?.ip || "").trim() === normalizedIp && String(row?.ipAttribution || row?.ipLocation || "").trim()
  );
  if (exactLog) {
    return String(exactLog.ipAttribution || exactLog.ipLocation || "").trim();
  }
  if (String(accessProfile?.ip || "").trim() === normalizedIp) {
    return String(accessProfile?.ipAttribution || accessProfile?.ipLocation || "").trim() || basicIpAttribution(normalizedIp);
  }
  return basicIpAttribution(normalizedIp);
}

function enrichSessionsWithAccessLocations(sessionsList, accessProfile, accessLogs) {
  return sessionsList.map((sessionRecord) => {
    const ipAttribution = sessionIpAttribution(sessionRecord.ip, accessProfile, accessLogs);
    return {
      ...sessionRecord,
      ipAttribution,
      ipLocation: ipAttribution
    };
  });
}

function buildUserMessageStats(username) {
  let sent = 0;
  let received = 0;
  let encrypted = 0;
  let invalid = 0;
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
    } else {
      invalid += 1;
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
    invalid,
    peers: peers.size,
    firstMessageAt,
    lastMessageAt
  };
}

function deliveryStateLabel(state) {
  if (state === "read") {
    return "已读";
  }
  if (state === "delivered") {
    return "已投递";
  }
  if (state === "recalled") {
    return "已撤回";
  }
  return "待投递";
}

function messageAuditLabel(message) {
  if (message?.recalled) {
    return "消息已撤回，后台不可读取原文";
  }
  if (message?.ciphertext) {
    return "端到端加密密文，后台不可读取明文";
  }
  return "消息缺少密文载荷，已按异常历史数据处理";
}

function ciphertextAdminMetadata(value) {
  const raw = String(value || "");
  const bytes = decodeBase64Blob(raw);
  if (!bytes) {
    return {
      bytes: 0,
      sha256: ""
    };
  }
  return {
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex")
  };
}

function adminUserMessageView(message, username) {
  const peer = message.from === username ? message.to : message.from;
  const deliveryState = messageDeliveryState(message);
  const redacted = Boolean(message.recalled);
  const ciphertextMeta = ciphertextAdminMetadata(redacted ? "" : message.ciphertext);
  return {
    id: message.id,
    peer,
    direction: message.from === username ? "sent" : "received",
    from: message.from,
    to: message.to,
    encrypted: Boolean(!redacted && message.ciphertext),
    deliveryState,
    deliveryLabel: deliveryStateLabel(deliveryState),
    auditLabel: messageAuditLabel(message),
    nonce: redacted ? "" : String(message.nonce || ""),
    ciphertextBytes: ciphertextMeta.bytes,
    ciphertextSha256: ciphertextMeta.sha256,
    recalled: Boolean(message.recalled),
    replyToId: String(message.replyToId || ""),
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
      privateKeyStoredOnServer: false
    },
    sessions: enrichSessionsWithAccessLocations(sessionsList, accessProfile, accessLogs.rows || []),
    realtime: {
      eventConnections: Number(activeConnectionCount(user.username))
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

async function adminDashboardSnapshot(session, req, options = {}) {
  const rangeDays = Math.max(7, Math.min(30, Number(options.days) || 7));
  const basicStats = adminBasicStats();
  const auditEntries = readRecentAdminAuditEntries(1000);
  const accessSummary = await accessLogStore.getDashboardSummary({ days: rangeDays });
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
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const messageSecurity = buildMessageSecurityDistribution();
  const deliveryStats = buildMessageDeliveryStats();
  const trends = buildDashboardTrends(rangeDays, auditEntries, accessSummary);
  const requestTotals = accessSummary?.totals || {};
  return {
    generatedAt: Date.now(),
    rangeDays,
    stats: basicStats,
    health,
    accessSummary,
    userTotal: basicStats.users,
    activeUsers: basicStats.activeUsers,
    onlineUsers: basicStats.onlineUsers,
    sessions: basicStats.sessions,
    messages: basicStats.messages,
    messagesToday: basicStats.messagesToday,
    deliveryStats,
    conversations: messageBuckets.size,
    errorRate: Number(requestTotals.errorRate || 0),
    securityAlerts: buildSecurityAlerts({ accessSummary, auditEntries, health, messageSecurity, deliveryStats }),
    charts: {
      trends,
      userDistribution: buildUserDistribution(dayAgo),
      messageSecurity: messageSecurity.distribution,
      deliveryDistribution: [
        { label: "待投递", value: deliveryStats.pending },
        { label: "已投递", value: deliveryStats.delivered },
        { label: "已读", value: deliveryStats.read },
        { label: "已撤回", value: deliveryStats.recalled }
      ],
      deviceBreakdown: accessSummary?.deviceBreakdown || [],
      statusBreakdown: accessSummary?.statusBreakdown || []
    },
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
  const deliveryState = messageDeliveryState(message);
  const redacted = Boolean(message.recalled);
  const ciphertextMeta = ciphertextAdminMetadata(redacted ? "" : message.ciphertext);
  return {
    id: message.id,
    from: message.from,
    to: message.to,
    nonce: redacted ? "" : message.nonce,
    ciphertextBytes: ciphertextMeta.bytes,
    ciphertextSha256: ciphertextMeta.sha256,
    encrypted: Boolean(!redacted && message.ciphertext),
    recalled: Boolean(message.recalled),
    deliveryState,
    deliveryLabel: deliveryStateLabel(deliveryState),
    auditLabel: messageAuditLabel(message),
    auditText: null,
    replyTo: normalizeReplyTargetView(message.replyTo) || resolveReplyTarget(message.from, message.to, message.replyToId),
    createdAt: message.createdAt
  };
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

const realtimeHub = createRealtimeHub({
  heartbeatMs: HEARTBEAT_MS,
  messages,
  schedulePersistMessages,
  isPresenceVisibleTo,
  isMessageDeletedFor,
  isBlockedBetween
});
const {
  writeSse,
  pushEventToUser,
  isUserOnline,
  listOnlineUsers,
  activeConnectionCount,
  pushPresence,
  markPendingDeliveries,
  broadcastUserRename,
  attachConnection,
  detachConnection,
  renameUserConnections,
  disconnectUserRealtime,
  disconnectAllRealtime,
  disconnectSessionRealtime
} = realtimeHub;

function runAsyncRoute(promise, res) {
  Promise.resolve(promise).catch((error) => {
    recordErrorLog("route_handler", error);
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    if (res.headersSent || res.writableEnded) {
      res.destroy(error instanceof Error ? error : undefined);
      return;
    }
    sendJson(res, 500, { error: "internal server error" });
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

try {
  loadData();
  loadSessionState();
  purgeStoredLegacyUserKeyMaterial();
  purgeStoredMessagePlaintext();
  loadAdminAuditState();
  void accessLogStore.ready.catch((error) => {
    recordErrorLog("access_log_startup", error);
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
  recordErrorLog("startup", error);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
setInterval(cleanRateBuckets, RATE_WINDOW_MS).unref();
setInterval(cleanSessions, Math.min(5 * 60 * 1000, SESSION_TTL_MS)).unref();
setInterval(cleanEventTickets, EVENT_TICKET_TTL_MS).unref();
setInterval(cleanAdminLoginFailures, ADMIN_LOGIN_FAILURE_WINDOW_MS).unref();
setInterval(cleanUserLoginFailures, USER_LOGIN_FAILURE_WINDOW_MS).unref();
setInterval(purgeStoredMessagePlaintext, 60 * 60 * 1000).unref();

const supportRoutes = createSupportRoutes({
  getClientAddress,
  requirePublicWriteOrigin,
  rejectIfForbiddenOrLimited,
  readJsonBody,
  sendJsonBodyError,
  normalizeClientMetaPayload,
  accessLogMiddleware,
  accessLogStore,
  getSessionFromRequest,
  sendJson,
  requireSession,
  normalizeBoundedText,
  listUsersForSearch,
  ENABLE_ACCESS_LOG,
  MAX_API_REQUESTS_PER_WINDOW
});

const adminRoutes = createAdminRoutes({
  syncRuntimeAdminConfigFromConfiguredSources,
  sendJson,
  getClientAddress,
  requirePublicWriteOrigin,
  rejectIfForbiddenOrLimited,
  readJsonBody,
  sendJsonBodyError,
  readSubmittedUsername,
  adminLoginLockState,
  adminLoginLockActive,
  findAdminAccount,
  verifyConfiguredAdminPassword,
  recordAdminLoginFailure,
  recordAdminAction,
  issueSession,
  accessLogMiddleware,
  clearAdminLoginFailures,
  sessionResponseFields,
  sessionCookieHeader,
  clearSessionCookieHeader,
  verifyAdminUpdatePassphrase,
  normalizeUsername,
  normalizePassword,
  hashPassword,
  persistAdminConfigToEnvironmentSafe,
  getAdminUsername: () => adminConfig.username,
  updateRuntimeAdminConfig,
  sessions,
  schedulePersistSessions,
  requireAdminSession,
  revokeSession,
  purgeSessionEventTickets,
  disconnectSessionRealtime,
  adminBasicStats,
  adminHealthSnapshot,
  parseAdminDashboardDays,
  adminDashboardSnapshot,
  normalizeBoundedText,
  parsePositiveInteger,
  users,
  adminPublicUser,
  parseAdminUserPath,
  findUserByUsername,
  buildAdminUserDetail,
  isReservedUsernameKey,
  findUserByKey,
  rebuildUserIndex,
  messages,
  rebuildMessageBuckets,
  renameUserConnections,
  purgeUserEventTickets,
  accessLogStore,
  broadcastUserRename,
  normalizeAuditReason,
  persistUsers,
  deleteSessionsForUsername,
  disconnectUserRealtime,
  schedulePersistMessages,
  readRecentAdminAuditEntries,
  parseMessageCursor,
  readOptionalUsernameFilter,
  collectPagedMessages,
  adminMessageView,
  readAccessLogFilters,
  ADMIN_SESSION_COOKIE,
  MAX_AUTH_REQUESTS_PER_WINDOW,
  MAX_API_REQUESTS_PER_WINDOW
});

const accountRoutes = createAccountRoutes({
  getClientAddress,
  requirePublicWriteOrigin,
  rejectIfForbiddenOrLimited,
  readJsonBody,
  sendJsonBodyError,
  normalizeUsername,
  readSubmittedUsername,
  normalizePassword,
  sendJson,
  isReservedUsernameKey,
  findUserByKey,
  normalizeKeyBundle,
  isBase64Blob,
  hashPassword,
  users,
  persistUsers,
  recordAdminAction,
  issueSession,
  accessLogMiddleware,
  publicUser,
  accountKeyBundleView,
  sessionResponseFields,
  sessionCookieHeader,
  userLoginLockState,
  userLoginLockActive,
  verifyPassword,
  recordUserLoginFailure,
  clearUserLoginFailures,
  touchUserLogin,
  requireSession,
  revokeSession,
  purgeSessionEventTickets,
  disconnectSessionRealtime,
  clearSessionCookieHeader,
  deleteSessionsForUsername,
  purgeUserEventTickets,
  disconnectUserRealtime,
  findUserByUsername,
  publicKeyBundleForUser,
  prekeyBundleForUser,
  decodeBase64Blob,
  normalizeUserList,
  pushPresence,
  isUserOnline,
  sessions,
  normalizeBoundedText,
  listUserSessions,
  USER_SESSION_COOKIE,
  MAX_AUTH_REQUESTS_PER_WINDOW,
  MAX_API_REQUESTS_PER_WINDOW,
  PUBLIC_KEY_BYTES,
  DUMMY_PASSWORD_HASH
});

const contactRoutes = createContactRoutes({
  requireSession,
  sendJson,
  listContactsFor,
  getClientAddress,
  rejectIfForbiddenOrLimited,
  readJsonBody,
  sendJsonBodyError,
  findUserByUsername,
  readSubmittedUsername,
  isUserBlocked,
  contactEntryFor,
  upsertUserContact,
  persistUsers,
  publicContactView,
  parseContactPath,
  relationshipStateFor,
  setRelationshipState,
  removeUserContact,
  pushPresence,
  isUserOnline,
  pushEventToUser,
  MAX_API_REQUESTS_PER_WINDOW
});

const messageRoutes = createMessageRoutes({
  requireSession,
  getClientAddress,
  rejectIfForbiddenOrLimited,
  sendJson,
  sendJsonBodyError,
  readJsonBody,
  normalizeClientId,
  parsePositiveInteger,
  parseMessageCursor,
  findUserByUsername,
  userShowsPresence,
  isUserBlocked,
  isBlockedBetween,
  isPresenceVisibleTo,
  isUserOnline,
  isBase64Blob,
  isRateLimited,
  messageNonceReplayKey,
  makeAvatarSeed,
  contactEntryFor,
  upsertUserContact,
  persistUsers,
  appendMessageBucket,
  schedulePersistMessages,
  messagesBetween,
  pagedMessagesBetween,
  isMessageDeletedFor,
  createMessageView,
  buildConversationSummary,
  resolveReplyTarget,
  listConversationsFor,
  pushEventToUser,
  recordAdminAction,
  nextMessageSequence: getNextMessageSequence,
  messages,
  messageClientIndex,
  messageNonceIndex,
  messageIdIndex,
  conversationRateBuckets,
  limits: {
    MAX_BODY_BYTES,
    MAX_MESSAGE_BODY_BYTES,
    MAX_API_REQUESTS_PER_WINDOW,
    MAX_MESSAGES_PER_CONVERSATION_WINDOW,
    RATE_WINDOW_MS,
    MESSAGE_RECALL_WINDOW_MS,
    MESSAGE_NONCE_BYTES,
    MESSAGE_CIPHERTEXT_BYTES
  }
});

const eventRoutes = createEventRoutes({
  requireSession,
  getClientAddress,
  eventTicketAgentHash,
  isSameOriginRequest,
  rejectIfForbiddenOrLimited,
  sendJson,
  activeConnectionCount,
  createEventTicketForSession,
  consumeEventTicket,
  sessions,
  findUserByUsername,
  securityHeaders,
  attachConnection,
  writeSse,
  listOnlineUsers,
  isPresenceVisibleTo,
  markPendingDeliveries,
  detachConnection,
  MAX_API_REQUESTS_PER_WINDOW,
  MAX_CONCURRENT_EVENT_CONNECTIONS_PER_USER,
  EVENT_TICKET_TTL_MS
});

const exactRoutes = [
  { method: "GET", path: "/health", handler: (req, res) => sendJson(res, 200, { ok: true }) },
  { method: "POST", path: "/api/client-meta", async: true, handler: supportRoutes.handleClientMeta },
  { method: "POST", path: "/api/admin/login", async: true, handler: adminRoutes.handleAdminLogin },
  { method: "POST", path: "/api/admin/account/reset", async: true, handler: adminRoutes.handleAdminAccountReset },
  { method: "POST", path: "/api/admin/logout", handler: adminRoutes.handleAdminLogout },
  { method: "GET", path: "/api/admin/me", handler: adminRoutes.handleAdminMe },
  { method: "GET", path: "/api/admin/stats", handler: adminRoutes.handleAdminStats },
  { method: "GET", path: "/api/admin/health", handler: adminRoutes.handleAdminHealth },
  { method: "GET", path: "/api/admin/dashboard/stats", async: true, handler: adminRoutes.handleAdminDashboardStats },
  { method: "GET", path: "/api/admin/users", handler: adminRoutes.handleAdminUsers },
  { method: "POST", path: "/api/admin/users/batch", async: true, handler: adminRoutes.handleAdminUsersBatch },
  { method: "GET", path: "/api/admin/messages", handler: adminRoutes.handleAdminMessages },
  { method: "GET", path: "/api/admin/audit", handler: adminRoutes.handleAdminAuditLogs },
  { method: "GET", path: "/api/admin/access/summary", async: true, handler: adminRoutes.handleAdminAccessSummary },
  { method: "GET", path: "/api/admin/access/logs", async: true, handler: adminRoutes.handleAdminAccessLogs },
  { method: "GET", path: "/api/admin/access/profile", async: true, handler: adminRoutes.handleAdminAccessProfile },
  { method: "POST", path: "/api/register", async: true, handler: accountRoutes.handleRegister },
  { method: "POST", path: "/api/login", async: true, handler: accountRoutes.handleLogin },
  { method: "POST", path: "/api/logout", handler: accountRoutes.handleLogout },
  { method: "POST", path: "/api/logout-all", handler: accountRoutes.handleLogoutAll },
  { method: "GET", path: "/api/me", handler: accountRoutes.handleMe },
  { method: "GET", path: "/api/me/key-bundle", handler: accountRoutes.handleMeKeyBundle },
  { method: "POST", path: "/api/me/key-bundle", async: true, handler: accountRoutes.handleMeKeyBundlePatch },
  { method: "POST", path: "/upload-public-key", async: true, handler: accountRoutes.handleUploadPublicKey },
  { method: "GET", path: "/api/me/settings", handler: accountRoutes.handleMeSettings },
  { method: "PATCH", path: "/api/me/settings", async: true, handler: accountRoutes.handleMeSettingsPatch },
  { method: "POST", path: "/api/me/password", async: true, handler: accountRoutes.handleMePassword },
  { method: "GET", path: "/api/me/sessions", handler: accountRoutes.handleMeSessions },
  { method: "POST", path: "/api/me/sessions/revoke", async: true, handler: accountRoutes.handleMeSessionRevoke },
  { method: "GET", path: "/api/contacts", handler: contactRoutes.handleContacts },
  { method: "POST", path: "/api/contacts", async: true, handler: contactRoutes.handleContactCreate },
  { method: "GET", path: "/api/users", handler: supportRoutes.handleUsers },
  { method: "GET", path: "/api/conversations", handler: messageRoutes.handleConversations },
  { method: "GET", path: "/api/messages", handler: messageRoutes.handleMessages },
  { method: "POST", path: "/api/messages", async: true, handler: messageRoutes.handleSendMessage },
  { method: "POST", path: "/api/messages/attachment", async: true, handler: messageRoutes.handleSendMessage },
  { method: "POST", path: "/api/messages/recall", async: true, handler: messageRoutes.handleRecallMessage },
  { method: "POST", path: "/api/messages/delete", async: true, handler: messageRoutes.handleDeleteMessage },
  { method: "POST", path: "/api/messages/read", async: true, handler: messageRoutes.handleMarkRead },
  { method: "POST", path: "/api/messages/typing", async: true, handler: messageRoutes.handleTypingSignal },
  { method: "POST", path: "/api/events/token", handler: eventRoutes.handleCreateEventTicket },
  { method: "GET", path: "/api/events", handler: eventRoutes.handleEvents }
];

function dispatchExactRoute(req, res, url) {
  const route = exactRoutes.find((entry) => entry.method === req.method && entry.path === url.pathname);
  if (!route) {
    return false;
  }
  const result = route.handler(req, res, url);
  if (route.async) {
    runAsyncRoute(result, res);
  }
  return true;
}

const server = http.createServer((req, res) => {
  const originalWriteHead = res.writeHead;
  res.writeHead = function patchedWriteHead(statusCode, ...rest) {
    const refreshCookie = req.pendingSessionCookie;
    const existingCookie = res.getHeader("Set-Cookie");
    const trailingHeaders = rest[rest.length - 1];
    if (trailingHeaders && typeof trailingHeaders === "object" && !Array.isArray(trailingHeaders)) {
      const responseCookies = mergeSetCookieValues(
        existingCookie,
        trailingHeaders["Set-Cookie"],
        trailingHeaders["set-cookie"],
        refreshCookie
      );
      if (responseCookies.length > 0) {
        delete trailingHeaders["Set-Cookie"];
        delete trailingHeaders["set-cookie"];
        trailingHeaders["Set-Cookie"] = responseCookies;
      }
    } else {
      const responseCookies = mergeSetCookieValues(existingCookie, refreshCookie);
      if (responseCookies.length > 0) {
        res.setHeader("Set-Cookie", responseCookies);
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
  const publicKeyUserId = readPathSuffix(pathname, "/public-key/");
  const prekeyBundleUserId = readPathSuffix(pathname, "/prekey-bundle/");

  if (dispatchExactRoute(req, res, url)) {
    return;
  }

  const adminUserPath = parseAdminUserPath(pathname);
  if (req.method === "GET" && adminUserPath) {
    runAsyncRoute(adminRoutes.handleAdminUserDetail(req, res, url, pathname), res);
    return;
  }
  if (req.method === "PATCH" && adminUserPath) {
    runAsyncRoute(adminRoutes.handleAdminUserPatch(req, res, url, pathname), res);
    return;
  }
  if (req.method === "GET" && publicKeyUserId) {
    accountRoutes.handlePublicKeyLookup(req, res, url, publicKeyUserId);
    return;
  }
  if (req.method === "GET" && prekeyBundleUserId) {
    accountRoutes.handlePrekeyBundleLookup(req, res, url, prekeyBundleUserId);
    return;
  }

  const contactPath = parseContactPath(pathname);
  if (contactPath && req.method === "PATCH" && !contactPath.action) {
    runAsyncRoute(contactRoutes.handleContactPatch(req, res, url, pathname), res);
    return;
  }
  if (contactPath && req.method === "DELETE" && !contactPath.action) {
    contactRoutes.handleContactDelete(req, res, url, pathname);
    return;
  }
  if (contactPath && req.method === "POST" && contactPath.action === "block") {
    runAsyncRoute(contactRoutes.handleContactBlock(req, res, url, pathname), res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res, url);
    return;
  }

  sendJson(res, 405, { error: "method not allowed" });
});

server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 65000;
server.maxHeadersCount = 64;
server.maxRequestsPerSocket = 1000;

process.on("beforeExit", () => {
  flushPendingMessagePersist();
  flushPendingSessionPersist();
});
process.on("exit", () => {
  flushPendingMessagePersist();
  flushPendingSessionPersist();
});
let shutdownPromise = null;

function closeHttpServer() {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function shutdown(signal) {
  if (shutdownPromise) {
    return shutdownPromise;
  }
  shutdownPromise = (async () => {
    console.log(`[shutdown] ${signal} received`);
    disconnectAllRealtime();
    const forceCloseTimer = setTimeout(() => {
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
    }, 10000);
    forceCloseTimer.unref();
    try {
      await closeHttpServer();
      flushPendingMessagePersist();
      flushPendingSessionPersist();
      await accessLogStore.close();
    } finally {
      clearTimeout(forceCloseTimer);
    }
  })().catch((error) => {
    recordErrorLog("shutdown", error);
    console.error(`[shutdown] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
  return shutdownPromise;
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

server.listen(PORT, HOST, () => {});
