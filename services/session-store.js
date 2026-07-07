"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const UAParser = require("ua-parser-js");

function createSessionStore({
  sessionsFile,
  sessionSecretFile,
  sessionTtlMs,
  sessionAbsoluteTtlMs,
  eventTicketTtlMs,
  sessionPersistDebounceMs,
  sessionActivityPersistMs,
  userSessionCookie,
  adminSessionCookie,
  ensureDataFiles,
  readJsonFile,
  writeJsonFile,
  parseCookies,
  cookieAttributes,
  getClientAddress,
  isSameOriginRequest,
  sendJson,
  findUserByUsername,
  disconnectSessionRealtime
}) {
  const sessions = new Map();
  const eventTickets = new Map();
  const SESSION_TOKEN_VERSION = "v1";
  const SESSION_BINDING_DOMAIN = "secure-chat/session-binding-v1";
  const SESSION_SIGNING_DOMAIN = "secure-chat/session-signing-v1";
  let sessionsDirty = false;
  let pendingSessionsPersistTimer = null;

  function readOrCreateSessionSecret() {
    const configured = String(process.env.SESSION_SECRET || "").trim();
    if (configured) {
      return configured;
    }
    ensureDataFiles();
    if (fs.existsSync(sessionSecretFile)) {
      const persisted = String(fs.readFileSync(sessionSecretFile, "utf8") || "").trim();
      if (persisted) {
        return persisted;
      }
    }
    const generated = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(sessionSecretFile, `${generated}\n`, { encoding: "utf8", mode: 0o600 });
    return generated;
  }

  const sessionSecret = readOrCreateSessionSecret();

  function hashSessionValue(domain, value) {
    return crypto.createHmac("sha256", sessionSecret).update(`${domain}:${String(value || "")}`).digest("hex");
  }

  function sessionBindingHash(req) {
    const userAgent = String(req?.headers?.["user-agent"] || "").slice(0, 240);
    return hashSessionValue(SESSION_BINDING_DOMAIN, userAgent || "unknown");
  }

  function signSessionToken(sessionId) {
    const id = String(sessionId || "").trim();
    const signature = hashSessionValue(SESSION_SIGNING_DOMAIN, id);
    return `${SESSION_TOKEN_VERSION}.${id}.${signature}`;
  }

  function parseSignedSessionToken(token) {
    const value = String(token || "").trim();
    const parts = value.split(".");
    if (parts.length !== 3 || parts[0] !== SESSION_TOKEN_VERSION) {
      return null;
    }
    const sessionId = parts[1] || "";
    const signature = parts[2] || "";
    if (!sessionId || !signature) {
      return null;
    }
    const expected = hashSessionValue(SESSION_SIGNING_DOMAIN, sessionId);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (signatureBuffer.length !== expectedBuffer.length) {
      return null;
    }
    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer) ? sessionId : null;
  }

  function normalizeSessionRole(role) {
    const normalized = String(role || "user").trim().toLowerCase();
    return normalized === "admin" || normalized === "system" ? normalized : "user";
  }

  function normalizeSessionRecord(session) {
    const createdAt = Number.parseInt(String(session?.createdAt || "0"), 10) || Date.now();
    const absoluteExpiresAt = Number.parseInt(String(session?.absoluteExpiresAt || "0"), 10) || (createdAt + sessionAbsoluteTtlMs);
    const expiresAt = Number.parseInt(String(session?.expiresAt || "0"), 10) || Math.min(createdAt + sessionTtlMs, absoluteExpiresAt);
    return {
      id: String(session?.id || crypto.randomUUID()),
      username: String(session?.username || ""),
      role: normalizeSessionRole(session?.role),
      csrfToken: String(session?.csrfToken || crypto.randomBytes(24).toString("base64url")),
      bindingHash: String(session?.bindingHash || ""),
      createdAt,
      lastSeenAt: Number.parseInt(String(session?.lastSeenAt || createdAt), 10) || createdAt,
      expiresAt,
      absoluteExpiresAt,
      ip: String(session?.ip || ""),
      userAgent: String(session?.userAgent || ""),
      browser: String(session?.browser || ""),
      os: String(session?.os || ""),
      device: String(session?.device || ""),
      revokedAt: Number.parseInt(String(session?.revokedAt || "0"), 10) || 0,
      lastPersistedAt: Number.parseInt(String(session?.lastPersistedAt || createdAt), 10) || createdAt
    };
  }

  function persistedSessionSnapshot() {
    const now = Date.now();
    return [...sessions.values()]
      .filter((session) => session && !session.revokedAt && session.expiresAt > now && session.absoluteExpiresAt > now)
      .map((session) => ({
        id: session.id,
        username: session.username,
        role: session.role,
        csrfToken: session.csrfToken,
        bindingHash: session.bindingHash,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        ip: session.ip,
        userAgent: session.userAgent,
        browser: session.browser,
        os: session.os,
        device: session.device,
        revokedAt: 0,
        lastPersistedAt: session.lastPersistedAt
      }));
  }

  function persistSessionsNow() {
    writeJsonFile(sessionsFile, persistedSessionSnapshot());
  }

  function flushPendingSessionPersist() {
    if (pendingSessionsPersistTimer) {
      clearTimeout(pendingSessionsPersistTimer);
      pendingSessionsPersistTimer = null;
    }
    if (!sessionsDirty) {
      return;
    }
    sessionsDirty = false;
    persistSessionsNow();
  }

  function schedulePersistSessions(force = false) {
    sessionsDirty = true;
    if (force) {
      flushPendingSessionPersist();
      return;
    }
    if (pendingSessionsPersistTimer) {
      return;
    }
    pendingSessionsPersistTimer = setTimeout(() => {
      pendingSessionsPersistTimer = null;
      flushPendingSessionPersist();
    }, sessionPersistDebounceMs);
  }

  function loadSessionState() {
    ensureDataFiles();
    const loaded = readJsonFile(sessionsFile);
    if (!Array.isArray(loaded)) {
      throw new Error(`expected ${sessionsFile} to contain a JSON array`);
    }
    sessions.clear();
    const now = Date.now();
    for (const rawSession of loaded) {
      const session = normalizeSessionRecord(rawSession);
      if (!session.username || session.revokedAt || session.expiresAt <= now || session.absoluteExpiresAt <= now) {
        continue;
      }
      sessions.set(session.id, session);
    }
    schedulePersistSessions(true);
  }

  function findSessionByCookieToken(token) {
    const sessionId = parseSignedSessionToken(token);
    if (!sessionId) {
      return null;
    }
    return sessions.get(sessionId) || null;
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

  function issueSession(username, role = "user", req = null) {
    const now = Date.now();
    const meta = sessionClientMeta(req);
    const session = normalizeSessionRecord({
      id: crypto.randomUUID(),
      username,
      role,
      csrfToken: crypto.randomBytes(24).toString("base64url"),
      bindingHash: req ? sessionBindingHash(req) : "",
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + sessionTtlMs,
      absoluteExpiresAt: now + sessionAbsoluteTtlMs,
      ip: meta.ip,
      userAgent: meta.userAgent,
      browser: meta.browser,
      os: meta.os,
      device: meta.device,
      lastPersistedAt: now
    });
    sessions.set(session.id, session);
    schedulePersistSessions(true);
    return session;
  }

  function revokeSession(session) {
    if (!session?.id || !sessions.has(session.id)) {
      return false;
    }
    sessions.delete(session.id);
    schedulePersistSessions(true);
    return true;
  }

  function maybePersistSessionActivity(session) {
    const now = Date.now();
    if ((now - Number(session.lastPersistedAt || 0)) < sessionActivityPersistMs) {
      return;
    }
    session.lastPersistedAt = now;
    schedulePersistSessions();
  }

  function refreshSessionState(session) {
    const now = Date.now();
    session.lastSeenAt = now;
    session.expiresAt = Math.min(now + sessionTtlMs, Number(session.absoluteExpiresAt || now));
    maybePersistSessionActivity(session);
  }

  function sessionTokenValue(session) {
    return signSessionToken(session?.id || "");
  }

  function sessionResponseFields(session) {
    return {
      csrfToken: String(session?.csrfToken || ""),
      session: session
        ? {
            role: normalizeSessionRole(session.role),
            expiresAt: Number(session.expiresAt || 0),
            absoluteExpiresAt: Number(session.absoluteExpiresAt || 0)
          }
        : null
    };
  }

  function sessionCookieHeader(name, session, maxAgeMs = sessionTtlMs) {
    return `${name}=${encodeURIComponent(sessionTokenValue(session))}; ${cookieAttributes(maxAgeMs / 1000)}`;
  }

  function clearSessionCookieHeader(name) {
    return `${name}=; ${cookieAttributes(0)}`;
  }

  function sessionCookieNameForPath(pathname) {
    return pathname.startsWith("/api/admin") ? adminSessionCookie : userSessionCookie;
  }

  function csrfTokenFromRequest(req) {
    return String(req.headers["x-csrf-token"] || req.headers["x-echo-csrf"] || "").trim();
  }

  function getSessionFromRequest(req, url) {
    const cookies = parseCookies(req);
    const cookieToken = cookies.get(sessionCookieNameForPath(url.pathname)) || "";
    if (cookieToken) {
      const cookieSession = findSessionByCookieToken(cookieToken);
      if (cookieSession && !cookieSession.revokedAt) {
        return cookieSession;
      }
    }
    return null;
  }

  function purgeSessionEventTickets(sessionId) {
    if (!sessionId) {
      return;
    }
    for (const [ticket, record] of eventTickets) {
      if (record?.token === sessionId) {
        eventTickets.delete(ticket);
      }
    }
  }

  function purgeUserEventTickets(username) {
    for (const [ticket, record] of eventTickets) {
      if (record?.username === username) {
        eventTickets.delete(ticket);
      }
    }
  }

  function requireSession(req, res, url, allowedRoles = ["user", "admin", "system"]) {
    const session = getSessionFromRequest(req, url);
    if (!session) {
      sendJson(res, 401, { error: "unauthorized" });
      return null;
    }
    const now = Date.now();
    if (session.bindingHash && req && session.bindingHash !== sessionBindingHash(req)) {
      revokeSession(session);
      purgeSessionEventTickets(session.id);
      disconnectSessionRealtime(session.id, "session binding mismatch");
      req.pendingSessionCookie = clearSessionCookieHeader(sessionCookieNameForPath(url.pathname));
      sendJson(res, 401, { error: "unauthorized" });
      return null;
    }
    if (session.expiresAt <= now || session.absoluteExpiresAt <= now) {
      revokeSession(session);
      purgeSessionEventTickets(session.id);
      disconnectSessionRealtime(session.id, "session expired");
      req.pendingSessionCookie = clearSessionCookieHeader(sessionCookieNameForPath(url.pathname));
      sendJson(res, 401, { error: "session expired" });
      return null;
    }
    const allowedRoleSet = new Set((Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles]).map(normalizeSessionRole));
    if (!allowedRoleSet.has(normalizeSessionRole(session.role))) {
      sendJson(res, 403, { error: "forbidden" });
      return null;
    }
    if (session.role === "user") {
      const user = findUserByUsername(session.username);
      if (!user) {
        revokeSession(session);
        req.pendingSessionCookie = clearSessionCookieHeader(sessionCookieNameForPath(url.pathname));
        sendJson(res, 401, { error: "unauthorized" });
        return null;
      }
      if (user.banned) {
        revokeSession(session);
        req.pendingSessionCookie = clearSessionCookieHeader(sessionCookieNameForPath(url.pathname));
        sendJson(res, 403, { error: "account banned" });
        return null;
      }
      user.lastSeenAt = now;
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(String(req.method || "GET").toUpperCase())) {
      if (!isSameOriginRequest(req)) {
        sendJson(res, 403, { error: "forbidden origin" });
        return null;
      }
      const csrfToken = csrfTokenFromRequest(req);
      if (!csrfToken || csrfToken !== session.csrfToken) {
        sendJson(res, 403, { error: "invalid csrf token" });
        return null;
      }
    }
    refreshSessionState(session);
    req.pendingSessionCookie = sessionCookieHeader(sessionCookieNameForPath(url.pathname), session);
    req.authSession = session;
    return session;
  }

  function requireAdminSession(req, res, url) {
    const session = requireSession(req, res, url, ["admin", "system"]);
    if (!session) {
      return null;
    }
    if (session.role !== "admin" && session.role !== "system") {
      sendJson(res, 403, { error: "admin required" });
      return null;
    }
    return session;
  }

  function deleteSessionsForUsername(username, role = null) {
    let deleted = 0;
    for (const [sessionId, session] of sessions) {
      if (!session) {
        continue;
      }
      if (session.username !== username) {
        continue;
      }
      if (role !== null && session.role !== role) {
        continue;
      }
      sessions.delete(sessionId);
      deleted += 1;
    }
    if (deleted > 0) {
      schedulePersistSessions(true);
    }
    return deleted;
  }

  function eventTicketAgentHash(req) {
    return crypto
      .createHash("sha256")
      .update(String(req?.headers?.["user-agent"] || "").slice(0, 512))
      .digest("base64url");
  }

  function createEventTicketForSession(session, req) {
    const ticket = crypto.randomBytes(24).toString("base64url");
    eventTickets.set(ticket, {
      username: session.username,
      role: session.role,
      token: session.id,
      address: getClientAddress(req),
      agentHash: eventTicketAgentHash(req),
      issuedAt: Date.now(),
      expiresAt: Date.now() + eventTicketTtlMs
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

  function cleanSessions() {
    const now = Date.now();
    const expiredSessionIds = [];
    for (const [sessionId, session] of sessions) {
      if (!session || session.expiresAt <= now || session.absoluteExpiresAt <= now) {
        sessions.delete(sessionId);
        expiredSessionIds.push(sessionId);
      }
    }
    if (expiredSessionIds.length > 0) {
      schedulePersistSessions(true);
    }
    for (const sessionId of expiredSessionIds) {
      disconnectSessionRealtime(sessionId, "session expired");
      purgeSessionEventTickets(sessionId);
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

  return {
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
  };
}

module.exports = {
  createSessionStore
};
