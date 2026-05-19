"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const PUBLIC_DIR = path.join(__dirname, "public");

const MAX_BODY_BYTES = 512 * 1024;
const MAX_ROOM_CLIENTS = 2;
const HEARTBEAT_MS = 15000;
const ROOM_IDLE_TTL_MS = 10 * 60 * 1000;
const ALLOWED_SIGNAL_TYPES = new Set(["hello", "chat", "typing", "read", "edit", "delete", "status", "file"]);

const rooms = new Map();

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
      "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; media-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
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
  return value.trim().slice(0, 80);
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

  if (!roomId || !clientId || !ALLOWED_SIGNAL_TYPES.has(type)) {
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

  if (!filePath.startsWith(PUBLIC_DIR)) {
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

function cleanupRooms() {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (room.clients.size === 0 && now - room.updatedAt > ROOM_IDLE_TTL_MS) {
      rooms.delete(roomId);
    }
  }
}

setInterval(cleanupRooms, 60 * 1000).unref();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, rooms: rooms.size });
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
  console.log(`Secure E2E chat is running at http://${HOST}:${PORT}`);
});
