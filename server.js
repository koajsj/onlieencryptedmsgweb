"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const PUBLIC_DIR = path.join(__dirname, "public");

const MAX_BODY_BYTES = 1200 * 1024;
const MAX_SIGNAL_PAYLOAD_BYTES = 1150 * 1024;
const MAX_ROOM_CLIENTS = 2;
const HEARTBEAT_MS = 15000;
const ROOM_IDLE_TTL_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const MAX_SIGNAL_REQUESTS_PER_WINDOW = 120;
const MAX_EVENT_REQUESTS_PER_WINDOW = 30;
const ALLOWED_SIGNAL_TYPES = new Set(["hello", "chat", "typing", "read", "edit", "delete", "status"]);
const SECURE_SIGNAL_TYPES = new Set(["chat", "typing", "read", "edit", "delete", "status"]);
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const TRUSTED_ORIGINS = new Set(
  (process.env.TRUSTED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const rooms = new Map();
const rateBuckets = new Map();
const metrics = {
  signalRejected: 0,
  eventRejected: 0,
  invalidSignals: 0,
  reconnects: 0
};

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

function securityHeaders(extra = {}, options = {}) {
  const allowFrameEmbedding = Boolean(options.allowFrameEmbedding);
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": allowFrameEmbedding ? "SAMEORIGIN" : "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Origin-Agent-Cluster": "?1",
    "Content-Security-Policy":
      `default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; media-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; frame-ancestors ${
        allowFrameEmbedding ? "'self'" : "'none'"
      }; form-action 'none'`,
    ...extra
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, securityHeaders({ "Content-Type": "application/json; charset=utf-8" }));
  res.end(body);
}

function normalizeRoom(value) {
  if (typeof value !== "string") {
    return "";
  }
  const room = value.trim().slice(0, 80);
  return /^[A-Za-z0-9_-]{3,80}$/.test(room) ? room : "";
}

function normalizeClientId(value) {
  if (typeof value !== "string") {
    return "";
  }
  return /^[a-f0-9]{24,64}$/i.test(value) ? value : "";
}

function getRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      clients: new Map(),
      updatedAt: Date.now()
    };
    rooms.set(roomId, room);
  }
  room.updatedAt = Date.now();
  return room;
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
    const originUrl = new URL(origin);
    return originUrl.host === req.headers.host;
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

function rejectIfOriginOrRateLimited(req, res, key, limit, metricField, limitMsg = "too many requests", originMsg = "forbidden origin") {
  if (!isSameOriginRequest(req)) {
    if (metrics && typeof metrics[metricField] === "number") {
      metrics[metricField] += 1;
    }
    sendJson(res, 403, { error: originMsg });
    return true;
  }

  if (isRateLimited(key, limit)) {
    if (metrics && typeof metrics[metricField] === "number") {
      metrics[metricField] += 1;
    }
    sendJson(res, 429, { error: limitMsg });
    return true;
  }

  return false;
}

function cleanRateBuckets() {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.startedAt > RATE_WINDOW_MS * 3) {
      rateBuckets.delete(key);
    }
  }
}

function estimateJsonBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch (error) {
    return MAX_SIGNAL_PAYLOAD_BYTES + 1;
  }
}

function isSafeBase64(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && /^[A-Za-z0-9+/=_-]+$/.test(value);
}

function validateSignalPayload(type, payload, roomId, clientId) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  if (estimateJsonBytes(payload) > MAX_SIGNAL_PAYLOAD_BYTES) {
    return false;
  }

  if (type === "hello") {
    return (
      typeof payload.name === "string" &&
      payload.name.trim().length > 0 &&
      payload.name.length <= 24 &&
      isSafeBase64(payload.publicKey, 256)
    );
  }

  if (!SECURE_SIGNAL_TYPES.has(type)) {
    return false;
  }

  return (
    payload.v === 1 &&
    payload.room === roomId &&
    payload.from === clientId &&
    payload.type === type &&
    /^[a-f0-9]{24}$/i.test(payload.id || "") &&
    Number.isFinite(Number(payload.sentAt)) &&
    (payload.refId === undefined || typeof payload.refId === "string") &&
    isSafeBase64(payload.nonce, 64) &&
    isSafeBase64(payload.ciphertext, MAX_SIGNAL_PAYLOAD_BYTES)
  );
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(roomId, event, data, exceptClientId = "") {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  room.updatedAt = Date.now();
  for (const [clientId, client] of room.clients) {
    if (clientId === exceptClientId) {
      continue;
    }
    writeSse(client.res, event, data);
  }
}

function broadcastPresence(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }
  broadcast(roomId, "presence", {
    count: room.clients.size,
    capacity: MAX_ROOM_CLIENTS
  });
}

function getRoomClientCount() {
  let clients = 0;
  for (const room of rooms.values()) {
    clients += room.clients.size;
  }
  return clients;
}

function removeClient(roomId, clientId) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }
  const client = room.clients.get(clientId);
  if (client?.heartbeat) {
    clearInterval(client.heartbeat);
  }
  room.clients.delete(clientId);
  room.updatedAt = Date.now();
  broadcastPresence(roomId);
}

function handleEvents(req, res, url) {
  const address = getClientAddress(req);
  if (rejectIfOriginOrRateLimited(req, res, `events:${address}`, MAX_EVENT_REQUESTS_PER_WINDOW, "eventRejected", "too many event connections", "forbidden origin")) {
    return;
  }

  const roomId = normalizeRoom(url.searchParams.get("room"));
  const clientId = normalizeClientId(url.searchParams.get("client"));

  if (!roomId || !clientId) {
    sendJson(res, 400, { error: "invalid room or client" });
    return;
  }

  const room = getRoom(roomId);
  const existingClient = room.clients.get(clientId);
  if (!existingClient && room.clients.size >= MAX_ROOM_CLIENTS) {
    res.writeHead(
      200,
      securityHeaders({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Connection": "close",
        "X-Accel-Buffering": "no"
      })
    );
    writeSse(res, "room-full", { capacity: MAX_ROOM_CLIENTS });
    res.end();
    return;
  }

  if (existingClient) {
    metrics.reconnects += 1;
    clearInterval(existingClient.heartbeat);
    existingClient.res.end();
  }

  res.writeHead(
    200,
    securityHeaders({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    })
  );
  res.write(": connected\n\n");

  const heartbeat = setInterval(() => {
    writeSse(res, "heartbeat", { at: Date.now() });
  }, HEARTBEAT_MS);

  room.clients.set(clientId, {
    res,
    connectedAt: Date.now(),
    heartbeat
  });

  writeSse(res, "ready", {
    clientId,
    count: room.clients.size,
    capacity: MAX_ROOM_CLIENTS
  });
  broadcastPresence(roomId);

  req.on("close", () => {
    removeClient(roomId, clientId);
  });
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

async function handleSignal(req, res) {
  const address = getClientAddress(req);
  if (rejectIfOriginOrRateLimited(req, res, `signal:${address}`, MAX_SIGNAL_REQUESTS_PER_WINDOW, "signalRejected", "too many requests", "forbidden origin")) {
    return;
  }

  const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    sendJson(res, 415, { error: "content type must be application/json" });
    return;
  }

  const declaredLength = Number.parseInt(req.headers["content-length"] || "0", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    sendJson(res, 413, { error: "body too large" });
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

  const roomId = normalizeRoom(body.room);
  const clientId = normalizeClientId(body.clientId);
  const type = typeof body.type === "string" ? body.type.slice(0, 32) : "";
  const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

  if (!roomId || !clientId || !ALLOWED_SIGNAL_TYPES.has(type) || !validateSignalPayload(type, payload, roomId, clientId)) {
    metrics.invalidSignals += 1;
    sendJson(res, 400, { error: "invalid signal" });
    return;
  }

  const room = rooms.get(roomId);
  if (!room || !room.clients.has(clientId)) {
    sendJson(res, 409, { error: "client is not connected" });
    return;
  }

  broadcast(
    roomId,
    "signal",
    {
      from: clientId,
      type,
      payload,
      at: Date.now()
    },
    clientId
  );

  sendJson(res, 202, { ok: true });
}

function serveStatic(req, res, url) {
  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestPath));
  const relativePath = path.relative(PUBLIC_DIR, filePath);
  const allowFrameEmbedding = url.searchParams.get("embed") === "1";

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
      securityHeaders(
        {
        "Content-Type": contentTypes[ext] || "application/octet-stream",
        "Content-Length": stat.size
        },
        { allowFrameEmbedding }
      )
    );
    if (req.method === "HEAD") {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
  });
}

function cleanupRooms() {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (room.clients.size === 0 && now - room.updatedAt > ROOM_IDLE_TTL_MS) {
      rooms.delete(roomId);
    }
  }
}

setInterval(cleanupRooms, 60 * 1000).unref();
setInterval(cleanRateBuckets, RATE_WINDOW_MS).unref();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      rooms: rooms.size,
      clients: getRoomClientCount(),
      rateBuckets: rateBuckets.size,
      metrics
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    handleEvents(req, res, url);
    return;
  }

  if (req.method === "POST" && url.pathname === "/signal") {
    handleSignal(req, res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res, url);
    return;
  }

  sendJson(res, 405, { error: "method not allowed" });
});

server.listen(PORT, HOST, () => {
});

