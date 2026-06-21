"use strict";

const path = require("node:path");
const {
  HSTS_MAX_AGE_SECONDS,
  TRUST_PROXY,
  TRUSTED_ORIGINS,
  TRUSTED_PROXY_ADDRESSES
} = require("../config");

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
  if (isTrustedProxyRequest(req)) {
    const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwardedFor) {
      return forwardedFor;
    }
  }
  return req.socket.remoteAddress || "unknown";
}

function isTrustedProxyRequest(req) {
  if (!TRUST_PROXY) {
    return false;
  }
  const remoteAddress = String(req.socket.remoteAddress || "").trim().toLowerCase();
  return TRUSTED_PROXY_ADDRESSES.has(remoteAddress);
}

function normalizedRequestHost(req) {
  const forwardedHost = isTrustedProxyRequest(req) ? String(req.headers["x-forwarded-host"] || "") : "";
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

function normalizedRequestOrigin(req) {
  const forwardedProto = isTrustedProxyRequest(req)
    ? String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase()
    : "";
  const protocol = forwardedProto === "https" || forwardedProto === "http"
    ? forwardedProto
    : req.socket.encrypted
      ? "https"
      : "http";
  return `${protocol}://${normalizedRequestHost(req)}`;
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
      return new URL(origin).origin === normalizedRequestOrigin(req);
    }
    const refererUrl = new URL(referer);
    if (TRUSTED_ORIGINS.has(refererUrl.origin)) {
      return true;
    }
    return refererUrl.origin === normalizedRequestOrigin(req);
  } catch (error) {
    return false;
  }
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

module.exports = {
  securityHeaders,
  sendJson,
  getClientAddress,
  normalizedRequestHost,
  normalizedRequestOrigin,
  parseRequestUrl,
  isSameOriginRequest,
  cacheControlForStaticFile,
  weakEtagForStat
};
