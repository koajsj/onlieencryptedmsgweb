"use strict";

const crypto = require("node:crypto");
const { parseCookies } = require("../utils/http");

const ACCESS_SESSION_COOKIE = "secure_chat_visit";
const ACCESS_SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

function buildCookieHeader(name, value, secure) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${ACCESS_SESSION_MAX_AGE_SECONDS}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : ""
  ]
    .filter(Boolean)
    .join("; ");
}

function mergeSetCookieHeader(res, cookieValue) {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", [cookieValue]);
    return;
  }
  if (Array.isArray(existing)) {
    if (!existing.includes(cookieValue)) {
      res.setHeader("Set-Cookie", [...existing, cookieValue]);
    }
    return;
  }
  if (String(existing) !== cookieValue) {
    res.setHeader("Set-Cookie", [String(existing), cookieValue]);
  }
}

function randomSessionId() {
  return crypto.randomBytes(24).toString("hex");
}

function classifyRequestPath(pathname) {
  const path = String(pathname || "/");
  if (path.startsWith("/api/")) {
    return "api";
  }
  if (path === "/" || path.endsWith(".html") || !/\.[A-Za-z0-9]+$/.test(path)) {
    return "page";
  }
  return "asset";
}

function createAccessLogMiddleware(options = {}) {
  const enabled = Boolean(options.enabled);
  const store = options.store;
  const cookieSecure = Boolean(options.cookieSecure);
  const getClientAddress = options.getClientAddress;
  const getSession = options.getSession;

  function begin(req, res, url) {
    const cookies = parseCookies(req);
    const sessionId = String(cookies.get(ACCESS_SESSION_COOKIE) || "").trim() || randomSessionId();
    const hadSessionCookie = Boolean(cookies.get(ACCESS_SESSION_COOKIE));
    req.accessLogContext = {
      sessionId,
      userId: "",
      startedAt: Date.now()
    };
    if (!hadSessionCookie) {
      mergeSetCookieHeader(res, buildCookieHeader(ACCESS_SESSION_COOKIE, sessionId, cookieSecure));
    }
    if (!enabled || !store) {
      return req.accessLogContext;
    }
    res.on("finish", () => {
      const resolvedSession = typeof getSession === "function" ? getSession(req, url) : null;
      const userId = String(req.accessLogContext?.userId || resolvedSession?.username || "").trim();
      store.enqueueAccessLog({
        sessionId,
        userId,
        ip: typeof getClientAddress === "function" ? getClientAddress(req) : req.socket.remoteAddress || "unknown",
        userAgent: String(req.headers["user-agent"] || ""),
        method: String(req.method || "GET"),
        path: String(url?.pathname || "/"),
        referer: String(req.headers.referer || ""),
        requestTimeMs: Date.now() - Number(req.accessLogContext?.startedAt || Date.now()),
        statusCode: Number(res.statusCode || 0),
        requestKind: classifyRequestPath(url?.pathname || "/"),
        createdAt: Date.now()
      });
    });
    return req.accessLogContext;
  }

  function setUserId(req, userId) {
    if (!req.accessLogContext) {
      return;
    }
    req.accessLogContext.userId = String(userId || "").trim();
  }

  function getSessionId(req) {
    return String(req.accessLogContext?.sessionId || "").trim();
  }

  return {
    begin,
    setUserId,
    getSessionId
  };
}

module.exports = {
  createAccessLogMiddleware
};
