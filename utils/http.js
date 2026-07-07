"use strict";

const path = require("node:path");
const {
  COOKIE_SECURE,
  HSTS_MAX_AGE_SECONDS,
  MAX_BODY_BYTES,
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
      "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; worker-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
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
    "SameSite=Strict",
    COOKIE_SECURE ? "Secure" : ""
  ]
    .filter(Boolean)
    .join("; ");
}

function normalizeSetCookieValues(value) {
  if (!value) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => String(item || "")).filter(Boolean);
}

function mergeSetCookieValues(...sources) {
  const merged = [];
  for (const source of sources) {
    for (const value of normalizeSetCookieValues(source)) {
      if (!merged.includes(value)) {
        merged.push(value);
      }
    }
  }
  return merged;
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

function readPathSuffix(pathname, prefix) {
  if (!pathname.startsWith(prefix)) {
    return "";
  }
  try {
    return decodeURIComponent(pathname.slice(prefix.length));
  } catch (error) {
    return "";
  }
}

function parsePositiveInteger(rawValue, fallback, min, max) {
  const parsed = Number.parseInt(String(rawValue || ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

module.exports = {
  securityHeaders,
  sendJson,
  readJsonBody,
  sendJsonBodyError,
  getClientAddress,
  normalizedRequestHost,
  normalizedRequestOrigin,
  parseRequestUrl,
  isSameOriginRequest,
  parseCookies,
  cookieAttributes,
  mergeSetCookieValues,
  cacheControlForStaticFile,
  weakEtagForStat,
  readPathSuffix,
  parsePositiveInteger
};
