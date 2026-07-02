"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { UAParser } = require("ua-parser-js");

let sqlite3Module = null;
let sqlite3LoadError = null;

function getSqlite3() {
  if (sqlite3Module) {
    return sqlite3Module;
  }
  if (sqlite3LoadError) {
    throw sqlite3LoadError;
  }
  try {
    sqlite3Module = require("sqlite3");
    return sqlite3Module;
  } catch (error) {
    sqlite3LoadError = error;
    throw error;
  }
}

const ACCESS_DB_FILE = "access_logs.sqlite";
const DEFAULT_BATCH_SIZE = 80;
const CLIENT_META_CACHE_LIMIT = 2000;
const RETENTION_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const IP_GEO_PROVIDER_URL = "https://ipwho.is";

function normalizeText(value, maxLength = 255) {
  return String(value || "").trim().slice(0, maxLength);
}

function parseBooleanFlag(value, fallback = true) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function inferDeviceType(result) {
  const raw = String(result?.device?.type || "").trim().toLowerCase();
  if (raw === "mobile" || raw === "tablet") {
    return raw;
  }
  return "desktop";
}

function buildAgentLabel(name, version) {
  const normalizedName = normalizeText(name, 80);
  const normalizedVersion = normalizeText(version, 40);
  return [normalizedName, normalizedVersion].filter(Boolean).join(" ").trim();
}

function analyzeUserAgent(userAgent) {
  const parser = new UAParser(userAgent || "");
  const result = parser.getResult();
  return {
    browser: buildAgentLabel(result.browser?.name, result.browser?.version),
    os: buildAgentLabel(result.os?.name, result.os?.version),
    deviceType: inferDeviceType(result)
  };
}

function ipAttribute(ip) {
  const value = String(ip || "").trim().toLowerCase();
  if (!value || value === "unknown") {
    return "未知";
  }
  if (value === "::1" || value === "127.0.0.1" || value === "localhost") {
    return "本机";
  }
  if (value.includes(":")) {
    if (/^f[cd][0-9a-f]{0,2}:/.test(value)) {
      return "内网";
    }
    return "IPv6";
  }
  const ipv4Match = value.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (ipv4Match) {
    const first = Number(ipv4Match[1]);
    const second = Number(ipv4Match[2]);
    if (
      first === 10 ||
      (first === 192 && second === 168) ||
      (first === 172 && second >= 16 && second <= 31) ||
      first === 127
    ) {
      return "内网";
    }
  }
  return "IPv4";
}

function isPrivateIp(ip) {
  const value = String(ip || "").trim().toLowerCase();
  if (!value || value === "unknown" || value === "localhost" || value === "::1") {
    return true;
  }
  const ipv4 = value.startsWith("::ffff:") ? value.slice(7) : value;
  const ipv4Match = ipv4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const first = Number(ipv4Match[1]);
    const second = Number(ipv4Match[2]);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  return value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:");
}

function normalizeIpGeoText(value, maxLength = 80) {
  return normalizeText(value, maxLength).replace(/[<>]/g, "");
}

function buildIpLocationLabel(location) {
  const country = normalizeIpGeoText(location?.country);
  const region = normalizeIpGeoText(location?.region);
  const city = normalizeIpGeoText(location?.city);
  const parts = [country, region, city].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "";
}

function localIpLocation(ip) {
  const fallback = ipAttribute(ip);
  return {
    ipCountry: "",
    ipRegion: "",
    ipCity: "",
    ipLocation: fallback
  };
}

function dayStartTimestamp(daysAgo = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.getTime();
}

function localDateLabel(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dashboardDays(options) {
  const days = Number(options?.days) || 7;
  return Math.max(1, Math.min(30, Math.floor(days)));
}

function fillDailyRows(days, rows, buildRow) {
  const byLabel = new Map(rows.map((row) => [String(row.label || ""), row]));
  return Array.from({ length: days }, (_, index) => {
    const label = localDateLabel(dayStartTimestamp(days - index - 1));
    return buildRow(label, byLabel.get(label) || null);
  });
}

function createEmptySummary(days = 7) {
  return {
    enabled: false,
    days,
    totals: {
      pageViews: 0,
      uniqueVisitors: 0,
      pageViews24h: 0,
      uniqueVisitors24h: 0,
      logRows: 0,
      requestsInRange: 0,
      errorsInRange: 0,
      avgRequestTimeMs: 0,
      errorRate: 0
    },
    trend: [],
    requestTrend: [],
    topPages: [],
    topIps: [],
    deviceBreakdown: [],
    statusBreakdown: []
  };
}

class AccessLogStore {
  constructor(options = {}) {
    this.enabled = parseBooleanFlag(options.enabled, true);
    this.dataDir = options.dataDir || process.cwd();
    this.dbFile = path.join(this.dataDir, ACCESS_DB_FILE);
    this.logger = typeof options.logger === "function" ? options.logger : () => {};
    this.retentionDays = Math.max(1, Number(options.retentionDays) || 30);
    this.maxQueueSize = Math.max(100, Number(options.maxQueueSize) || 10000);
    this.enableIpGeo = options.enableIpGeo !== false;
    this.ipGeoTimeoutMs = Math.max(300, Number(options.ipGeoTimeoutMs) || 1500);
    this.ipGeoCacheTtlMs = Math.max(60 * 1000, Number(options.ipGeoCacheTtlMs) || 24 * 60 * 60 * 1000);
    this.droppedRows = 0;
    this.lastPrunedAt = 0;
    this.db = null;
    this.queue = [];
    this.processing = false;
    this.closing = false;
    this.clientMetaBySession = new Map();
    this.ipLocationCache = new Map();
    if (this.enabled) {
      try {
        getSqlite3();
      } catch (error) {
        this.enabled = false;
        this.logger(`[access-log] sqlite3 unavailable, access logs disabled: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.ready = this.enabled ? this.initialize() : Promise.resolve();
  }

  async initialize() {
    if (!this.enabled) {
      return;
    }
    fs.mkdirSync(this.dataDir, { recursive: true });
    const sqlite3 = getSqlite3();
    this.db = await new Promise((resolve, reject) => {
      const db = new sqlite3.Database(this.dbFile, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(db);
      });
    });
    await this.execImmediate("PRAGMA journal_mode = WAL;");
    await this.execImmediate("PRAGMA synchronous = FULL;");
    await this.execImmediate(`
      CREATE TABLE IF NOT EXISTS access_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        session_id TEXT NOT NULL,
        ip TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        browser TEXT,
        os TEXT,
        device_type TEXT,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        referer TEXT,
        request_time_ms INTEGER NOT NULL DEFAULT 0,
        status_code INTEGER NOT NULL DEFAULT 0,
        request_kind TEXT NOT NULL DEFAULT 'other',
        language TEXT,
        screen_resolution TEXT,
        timezone TEXT,
        platform TEXT,
        ip_country TEXT,
        ip_region TEXT,
        ip_city TEXT,
        ip_location TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    await this.execImmediate("CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id);");
    await this.execImmediate("CREATE INDEX IF NOT EXISTS idx_access_logs_ip ON access_logs(ip);");
    await this.execImmediate("CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at);");
    await this.execImmediate("CREATE INDEX IF NOT EXISTS idx_access_logs_session_id ON access_logs(session_id);");
    await this.ensureIpLocationColumns();
    await this.pruneExpiredLogs(true);
  }

  async ensureIpLocationColumns() {
    if (!this.db) {
      return;
    }
    const columns = await this.allImmediate("PRAGMA table_info(access_logs)");
    const existing = new Set(columns.map((column) => String(column.name || "")));
    for (const column of ["ip_country", "ip_region", "ip_city", "ip_location"]) {
      if (!existing.has(column)) {
        await this.runImmediate(`ALTER TABLE access_logs ADD COLUMN ${column} TEXT`);
      }
    }
  }

  async exec(sql) {
    await this.ready;
    return this.execImmediate(sql);
  }

  async execImmediate(sql) {
    if (!this.db) {
      return;
    }
    await new Promise((resolve, reject) => {
      this.db.exec(sql, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async run(sql, params = []) {
    await this.ready;
    return this.runImmediate(sql, params);
  }

  async runImmediate(sql, params = []) {
    if (!this.db) {
      return { changes: 0, lastID: 0 };
    }
    return await new Promise((resolve, reject) => {
      this.db.run(sql, params, function onRun(error) {
        if (error) {
          reject(error);
          return;
        }
        resolve({
          changes: Number(this.changes || 0),
          lastID: Number(this.lastID || 0)
        });
      });
    });
  }

  async get(sql, params = []) {
    await this.ready;
    return this.getImmediate(sql, params);
  }

  async getImmediate(sql, params = []) {
    if (!this.db) {
      return null;
    }
    return await new Promise((resolve, reject) => {
      this.db.get(sql, params, (error, row) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(row || null);
      });
    });
  }

  async all(sql, params = []) {
    await this.ready;
    return this.allImmediate(sql, params);
  }

  async allImmediate(sql, params = []) {
    if (!this.db) {
      return [];
    }
    return await new Promise((resolve, reject) => {
      this.db.all(sql, params, (error, rows) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(Array.isArray(rows) ? rows : []);
      });
    });
  }

  enqueueAccessLog(record) {
    if (!this.enabled || this.closing) {
      return;
    }
    if (this.queue.length >= this.maxQueueSize) {
      this.droppedRows += 1;
      return;
    }
    const sessionMeta = this.clientMetaBySession.get(String(record.sessionId || "")) || {};
    this.queue.push({
      type: "log",
      row: this.normalizeAccessRow({
        ...record,
        ...sessionMeta
      })
    });
    this.scheduleQueue();
  }

  enqueueClientMeta(sessionId, meta) {
    if (!this.enabled || this.closing || !sessionId) {
      return;
    }
    if (this.queue.length >= this.maxQueueSize) {
      this.droppedRows += 1;
      return;
    }
    const normalizedMeta = this.normalizeClientMeta(meta);
    const key = String(sessionId);
    // Cap the in-memory client-meta cache so it doesn't grow unbounded
    // as new visitor sessions arrive. LRU-ish: drop the oldest entry on overflow.
    if (this.clientMetaBySession.has(key)) {
      this.clientMetaBySession.delete(key);
    } else if (this.clientMetaBySession.size >= CLIENT_META_CACHE_LIMIT) {
      const oldestKey = this.clientMetaBySession.keys().next().value;
      if (oldestKey !== undefined) {
        this.clientMetaBySession.delete(oldestKey);
      }
    }
    this.clientMetaBySession.set(key, normalizedMeta);
    this.queue.push({
      type: "client-meta",
      sessionId: key,
      meta: normalizedMeta
    });
    this.scheduleQueue();
  }

  scheduleQueue() {
    if (this.processing) {
      return;
    }
    this.processing = true;
    setImmediate(() => {
      void this.flushQueue();
    });
  }

  async flushQueue() {
    try {
      await this.ready;
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, DEFAULT_BATCH_SIZE);
        const logs = batch.filter((item) => item.type === "log").map((item) => item.row);
        const metas = batch.filter((item) => item.type === "client-meta");
        if (logs.length > 0) {
          await this.insertLogBatch(logs);
        }
        for (const item of metas) {
          await this.applyClientMeta(item.sessionId, item.meta);
        }
      }
      await this.pruneExpiredLogs();
    } catch (error) {
      this.logger(error);
    } finally {
      this.processing = false;
      if (this.queue.length > 0) {
        this.scheduleQueue();
      }
    }
  }

  async pruneExpiredLogs(force = false) {
    const now = Date.now();
    if (!this.db || (!force && now - this.lastPrunedAt < RETENTION_PRUNE_INTERVAL_MS)) {
      return 0;
    }
    this.lastPrunedAt = now;
    const cutoff = now - this.retentionDays * 24 * 60 * 60 * 1000;
    const result = await this.runImmediate("DELETE FROM access_logs WHERE created_at < ?", [cutoff]);
    return Number(result?.changes || 0);
  }

  normalizeClientMeta(meta) {
    return {
      language: normalizeText(meta?.language, 24),
      screenResolution: normalizeText(meta?.screenResolution, 32),
      timezone: normalizeText(meta?.timezone, 64),
      platform: normalizeText(meta?.platform, 48)
    };
  }

  normalizeAccessRow(record) {
    const userAgent = normalizeText(record.userAgent, 400);
    const agent = analyzeUserAgent(userAgent);
    return {
      userId: normalizeText(record.userId, 64),
      sessionId: normalizeText(record.sessionId, 64),
      ip: normalizeText(record.ip, 64) || "unknown",
      userAgent,
      browser: agent.browser,
      os: agent.os,
      deviceType: agent.deviceType,
      method: normalizeText(record.method, 16).toUpperCase() || "GET",
      path: normalizeText(record.path, 240) || "/",
      referer: normalizeText(record.referer, 240),
      requestTimeMs: Math.max(0, Number(record.requestTimeMs) || 0),
      statusCode: Math.max(0, Number(record.statusCode) || 0),
      requestKind: normalizeText(record.requestKind, 24) || "other",
      language: normalizeText(record.language, 24),
      screenResolution: normalizeText(record.screenResolution, 32),
      timezone: normalizeText(record.timezone, 64),
      platform: normalizeText(record.platform, 48),
      createdAt: Math.max(0, Number(record.createdAt) || Date.now())
    };
  }

  async resolveIpLocation(ip) {
    const normalizedIp = normalizeText(ip, 64) || "unknown";
    if (!this.enableIpGeo || isPrivateIp(normalizedIp) || typeof fetch !== "function") {
      return localIpLocation(normalizedIp);
    }
    const now = Date.now();
    const cached = this.ipLocationCache.get(normalizedIp);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.ipGeoTimeoutMs);
    try {
      const response = await fetch(`${IP_GEO_PROVIDER_URL}/${encodeURIComponent(normalizedIp)}?fields=success,country,region,city,message`, {
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`ip geo lookup failed: ${response.status}`);
      }
      const payload = await response.json();
      const value = payload?.success === false
        ? localIpLocation(normalizedIp)
        : {
            ipCountry: normalizeIpGeoText(payload?.country),
            ipRegion: normalizeIpGeoText(payload?.region),
            ipCity: normalizeIpGeoText(payload?.city),
            ipLocation: buildIpLocationLabel(payload) || ipAttribute(normalizedIp)
          };
      this.ipLocationCache.set(normalizedIp, {
        value,
        expiresAt: now + this.ipGeoCacheTtlMs
      });
      return value;
    } catch (error) {
      const value = localIpLocation(normalizedIp);
      this.ipLocationCache.set(normalizedIp, {
        value,
        expiresAt: now + Math.min(this.ipGeoCacheTtlMs, 10 * 60 * 1000)
      });
      return value;
    } finally {
      clearTimeout(timer);
    }
  }

  async enrichRowsWithIpLocation(rows) {
    const byIp = new Map();
    for (const row of rows) {
      const ip = normalizeText(row.ip, 64) || "unknown";
      if (!byIp.has(ip)) {
        byIp.set(ip, await this.resolveIpLocation(ip));
      }
    }
    return rows.map((row) => ({
      ...row,
      ...(byIp.get(normalizeText(row.ip, 64) || "unknown") || localIpLocation(row.ip))
    }));
  }

  async insertLogBatch(rows) {
    if (!rows.length || !this.db) {
      return;
    }
    await this.ready;
    const enrichedRows = await this.enrichRowsWithIpLocation(rows);
    const db = this.db;
    await this.runImmediate("BEGIN TRANSACTION");
    try {
      const stmt = await new Promise((resolve, reject) => {
        const prepared = db.prepare(
          `INSERT INTO access_logs (
            user_id, session_id, ip, user_agent, browser, os, device_type, method, path, referer,
            request_time_ms, status_code, request_kind, language, screen_resolution, timezone, platform,
            ip_country, ip_region, ip_city, ip_location, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(prepared);
          }
        );
      });
      try {
        for (const row of enrichedRows) {
          await new Promise((resolve, reject) => {
            stmt.run(
              [
                row.userId || null,
                row.sessionId,
                row.ip,
                row.userAgent,
                row.browser || null,
                row.os || null,
                row.deviceType || null,
                row.method,
                row.path,
                row.referer || null,
                row.requestTimeMs,
                row.statusCode,
                row.requestKind,
                row.language || null,
                row.screenResolution || null,
                row.timezone || null,
                row.platform || null,
                row.ipCountry || null,
                row.ipRegion || null,
                row.ipCity || null,
                row.ipLocation || ipAttribute(row.ip),
                row.createdAt
              ],
              (error) => {
                if (error) {
                  reject(error);
                  return;
                }
                resolve();
              }
            );
          });
        }
      } finally {
        await new Promise((resolve) => stmt.finalize(() => resolve()));
      }
      await this.runImmediate("COMMIT");
    } catch (error) {
      await this.runImmediate("ROLLBACK").catch(() => {});
      throw error;
    }
  }

  async applyClientMeta(sessionId, meta) {
    await this.run(
      `UPDATE access_logs
        SET language = COALESCE(NULLIF(language, ''), ?),
            screen_resolution = COALESCE(NULLIF(screen_resolution, ''), ?),
            timezone = COALESCE(NULLIF(timezone, ''), ?),
            platform = COALESCE(NULLIF(platform, ''), ?)
      WHERE session_id = ?`,
      [meta.language || null, meta.screenResolution || null, meta.timezone || null, meta.platform || null, sessionId]
    );
  }

  async renameUserId(previousUserId, nextUserId) {
    const previous = normalizeText(previousUserId, 64);
    const next = normalizeText(nextUserId, 64);
    if (!this.enabled || !previous || !next || previous === next) {
      return 0;
    }
    for (const item of this.queue) {
      if (item?.type === "log" && item.row && item.row.userId === previous) {
        item.row.userId = next;
      }
    }
    const result = await this.run("UPDATE access_logs SET user_id = ? WHERE user_id = ?", [next, previous]);
    return Number(result?.changes || 0);
  }

  async getDashboardSummary(options = {}) {
    const days = dashboardDays(options);
    if (!this.enabled) {
      return createEmptySummary(days);
    }
    await this.ready;
    const today = Date.now() - 24 * 60 * 60 * 1000;
    const rangeStart = dayStartTimestamp(days - 1);
    const totalsRow = await this.get(
      `SELECT
        SUM(CASE WHEN request_kind = 'page' THEN 1 ELSE 0 END) AS page_views,
        COUNT(DISTINCT CASE WHEN request_kind = 'page' THEN session_id END) AS unique_visitors,
        SUM(CASE WHEN request_kind = 'page' AND created_at >= ? THEN 1 ELSE 0 END) AS page_views_24h,
        COUNT(DISTINCT CASE WHEN request_kind = 'page' AND created_at >= ? THEN session_id END) AS unique_visitors_24h,
        COUNT(*) AS log_rows
      FROM access_logs`,
      [today, today]
    );
    const rangeTotalsRow = await this.get(
      `SELECT
        COUNT(*) AS requests,
        SUM(CASE WHEN status_code >= 500 OR status_code = 0 THEN 1 ELSE 0 END) AS errors,
        AVG(CASE WHEN request_time_ms > 0 THEN request_time_ms ELSE NULL END) AS avg_request_time_ms
      FROM access_logs
      WHERE created_at >= ?`,
      [rangeStart]
    );
    const trend = await this.all(
      `SELECT
        strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS label,
        COUNT(*) AS pv,
        COUNT(DISTINCT session_id) AS uv
      FROM access_logs
      WHERE request_kind = 'page' AND created_at >= ?
      GROUP BY label
      ORDER BY label ASC`,
      [rangeStart]
    );
    const requestTrend = await this.all(
      `SELECT
        strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS label,
        COUNT(*) AS requests,
        SUM(CASE WHEN status_code >= 500 OR status_code = 0 THEN 1 ELSE 0 END) AS errors,
        AVG(CASE WHEN request_time_ms > 0 THEN request_time_ms ELSE NULL END) AS avg_request_time_ms
      FROM access_logs
      WHERE created_at >= ?
      GROUP BY label
      ORDER BY label ASC`,
      [rangeStart]
    );
    const topPages = await this.all(
      `SELECT path, COUNT(*) AS pv
      FROM access_logs
      WHERE request_kind = 'page' AND created_at >= ?
      GROUP BY path
      ORDER BY pv DESC, path ASC
      LIMIT 8`,
      [rangeStart]
    );
    const topIps = await this.all(
      `SELECT ip, COUNT(*) AS hits, COUNT(DISTINCT session_id) AS uv, MAX(ip_location) AS ip_location
      FROM access_logs
      WHERE created_at >= ?
      GROUP BY ip
      ORDER BY hits DESC, ip ASC
      LIMIT 8`,
      [rangeStart]
    );
    const deviceBreakdown = await this.all(
      `SELECT COALESCE(NULLIF(device_type, ''), 'unknown') AS label, COUNT(*) AS hits, COUNT(DISTINCT session_id) AS sessions
      FROM access_logs
      WHERE created_at >= ?
      GROUP BY label
      ORDER BY hits DESC, label ASC
      LIMIT 6`,
      [rangeStart]
    );
    const statusBreakdown = await this.all(
      `SELECT
        CASE
          WHEN status_code >= 500 OR status_code = 0 THEN '5xx'
          WHEN status_code >= 400 THEN '4xx'
          WHEN status_code >= 300 THEN '3xx'
          WHEN status_code >= 200 THEN '2xx'
          ELSE 'other'
        END AS label,
        COUNT(*) AS hits
      FROM access_logs
      WHERE created_at >= ?
      GROUP BY label
      ORDER BY label ASC`,
      [rangeStart]
    );
    const requestsInRange = Number(rangeTotalsRow?.requests || 0);
    const errorsInRange = Number(rangeTotalsRow?.errors || 0);
    return {
      enabled: true,
      days,
      totals: {
        pageViews: Number(totalsRow?.page_views || 0),
        uniqueVisitors: Number(totalsRow?.unique_visitors || 0),
        pageViews24h: Number(totalsRow?.page_views_24h || 0),
        uniqueVisitors24h: Number(totalsRow?.unique_visitors_24h || 0),
        logRows: Number(totalsRow?.log_rows || 0),
        requestsInRange,
        errorsInRange,
        avgRequestTimeMs: Math.round(Number(rangeTotalsRow?.avg_request_time_ms || 0)),
        errorRate: requestsInRange > 0 ? errorsInRange / requestsInRange : 0
      },
      trend: fillDailyRows(days, trend, (label, row) => ({
        label: String(row?.label || label),
        pv: Number(row?.pv || 0),
        uv: Number(row?.uv || 0)
      })).map((row) => ({ ...row, label: row.label || "" })),
      requestTrend: fillDailyRows(days, requestTrend, (label, row) => ({
        label,
        requests: Number(row?.requests || 0),
        errors: Number(row?.errors || 0),
        avgRequestTimeMs: Math.round(Number(row?.avg_request_time_ms || 0))
      })),
      topPages: topPages.map((row) => ({
        path: String(row.path || "/"),
        pv: Number(row.pv || 0)
      })),
      topIps: topIps.map((row) => ({
        ip: String(row.ip || "unknown"),
        hits: Number(row.hits || 0),
        uv: Number(row.uv || 0),
        attribution: String(row.ip_location || "") || ipAttribute(row.ip)
      })),
      deviceBreakdown: deviceBreakdown.map((row) => ({
        label: String(row.label || "unknown"),
        hits: Number(row.hits || 0),
        sessions: Number(row.sessions || 0)
      })),
      statusBreakdown: statusBreakdown.map((row) => ({
        label: String(row.label || "other"),
        hits: Number(row.hits || 0)
      }))
    };
  }

  buildAccessLogWhere(filters = {}, options = {}) {
    const exactIdentityMatch = Boolean(options.exactIdentityMatch);
    const clauses = [];
    const params = [];
    if (filters.ip) {
      clauses.push(exactIdentityMatch ? "ip = ?" : "ip LIKE ?");
      params.push(exactIdentityMatch ? String(filters.ip).trim() : `%${String(filters.ip).trim()}%`);
    }
    if (filters.userId) {
      clauses.push(exactIdentityMatch ? "user_id = ?" : "user_id LIKE ?");
      params.push(exactIdentityMatch ? String(filters.userId).trim() : `%${String(filters.userId).trim()}%`);
    }
    if (filters.sessionId) {
      clauses.push(exactIdentityMatch ? "session_id = ?" : "session_id LIKE ?");
      params.push(exactIdentityMatch ? String(filters.sessionId).trim() : `%${String(filters.sessionId).trim()}%`);
    }
    if (filters.since) {
      clauses.push("created_at >= ?");
      params.push(Number(filters.since));
    }
    if (filters.until) {
      clauses.push("created_at <= ?");
      params.push(Number(filters.until));
    }
    return {
      whereSql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
      params
    };
  }

  async getAccessLogs(filters = {}, options = {}) {
    if (!this.enabled) {
      return { rows: [], total: 0, page: 1, limit: 50 };
    }
    await this.ready;
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.max(1, Math.min(200, Number(filters.limit) || 50));
    const offset = (page - 1) * limit;
    const { whereSql, params } = this.buildAccessLogWhere(filters, options);
    const totalRow = await this.get(`SELECT COUNT(*) AS total FROM access_logs ${whereSql}`, params);
    const rows = await this.all(
      `SELECT
        id, user_id, session_id, ip, user_agent, browser, os, device_type, method, path, referer,
        request_time_ms, status_code, request_kind, language, screen_resolution, timezone, platform,
        ip_country, ip_region, ip_city, ip_location, created_at
      FROM access_logs
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return {
      rows: rows.map((row) => ({
        id: Number(row.id || 0),
        userId: String(row.user_id || ""),
        sessionId: String(row.session_id || ""),
        ip: String(row.ip || "unknown"),
        ipCountry: String(row.ip_country || ""),
        ipRegion: String(row.ip_region || ""),
        ipCity: String(row.ip_city || ""),
        ipLocation: String(row.ip_location || ""),
        ipAttribution: String(row.ip_location || "") || buildIpLocationLabel({
          country: row.ip_country,
          region: row.ip_region,
          city: row.ip_city
        }) || ipAttribute(row.ip),
        userAgent: String(row.user_agent || ""),
        browser: String(row.browser || ""),
        os: String(row.os || ""),
        deviceType: String(row.device_type || ""),
        method: String(row.method || ""),
        path: String(row.path || "/"),
        referer: String(row.referer || ""),
        requestTimeMs: Number(row.request_time_ms || 0),
        statusCode: Number(row.status_code || 0),
        requestKind: String(row.request_kind || "other"),
        language: String(row.language || ""),
        screenResolution: String(row.screen_resolution || ""),
        timezone: String(row.timezone || ""),
        platform: String(row.platform || ""),
        createdAt: Number(row.created_at || 0)
      })),
      total: Number(totalRow?.total || 0),
      page,
      limit
    };
  }

  async getVisitorProfile(filters = {}) {
    if (!this.enabled) {
      return null;
    }
    await this.ready;
    const hasIdentityFilter = Boolean(filters.ip || filters.userId || filters.sessionId);
    if (!hasIdentityFilter) {
      return null;
    }
    const { whereSql, params } = this.buildAccessLogWhere(filters, { exactIdentityMatch: true });
    if (!whereSql) {
      return null;
    }
    const summary = await this.get(
      `SELECT
        MIN(created_at) AS first_visit,
        MAX(created_at) AS last_visit,
        COUNT(*) AS visits,
        MAX(user_id) AS user_id,
        MAX(session_id) AS session_id,
        MAX(ip) AS ip
      FROM access_logs
      ${whereSql}`,
      params
    );
    if (!summary || Number(summary.visits || 0) === 0) {
      return null;
    }
    const topPages = await this.all(
      `SELECT path, COUNT(*) AS hits
      FROM access_logs
      ${whereSql}
      GROUP BY path
      ORDER BY hits DESC, path ASC
      LIMIT 5`,
      params
    );
    const latestMeta = await this.get(
      `SELECT language, screen_resolution, timezone, platform, browser, os, device_type,
        ip_country, ip_region, ip_city, ip_location
      FROM access_logs
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
      params
    );
    return {
      userId: String(summary.user_id || ""),
      sessionId: String(summary.session_id || ""),
      ip: String(summary.ip || ""),
      ipCountry: String(latestMeta?.ip_country || ""),
      ipRegion: String(latestMeta?.ip_region || ""),
      ipCity: String(latestMeta?.ip_city || ""),
      ipLocation: String(latestMeta?.ip_location || ""),
      ipAttribution: String(latestMeta?.ip_location || "") || buildIpLocationLabel({
        country: latestMeta?.ip_country,
        region: latestMeta?.ip_region,
        city: latestMeta?.ip_city
      }) || ipAttribute(summary.ip),
      firstVisitAt: Number(summary.first_visit || 0),
      lastVisitAt: Number(summary.last_visit || 0),
      visits: Number(summary.visits || 0),
      topPages: topPages.map((row) => ({
        path: String(row.path || "/"),
        hits: Number(row.hits || 0)
      })),
      clientMeta: {
        language: String(latestMeta?.language || ""),
        screenResolution: String(latestMeta?.screen_resolution || ""),
        timezone: String(latestMeta?.timezone || ""),
        platform: String(latestMeta?.platform || ""),
        browser: String(latestMeta?.browser || ""),
        os: String(latestMeta?.os || ""),
        deviceType: String(latestMeta?.device_type || "")
      }
    };
  }

  healthSnapshot() {
    return {
      enabled: this.enabled,
      dbFile: this.dbFile,
      dbBytes: this.enabled && fs.existsSync(this.dbFile) ? fs.statSync(this.dbFile).size : 0,
      pendingQueue: this.queue.length,
      droppedRows: this.droppedRows,
      retentionDays: this.retentionDays,
      ipGeoEnabled: this.enableIpGeo,
      ipGeoCacheSize: this.ipLocationCache.size
    };
  }

  async close() {
    if (!this.enabled || this.closing) {
      return;
    }
    this.closing = true;
    await this.ready;
    while (this.processing) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (this.queue.length > 0) {
      await this.flushQueue();
    }
    if (!this.db) {
      return;
    }
    const db = this.db;
    this.db = null;
    await new Promise((resolve, reject) => {
      db.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

function createAccessLogStore(options) {
  return new AccessLogStore(options);
}

module.exports = {
  createAccessLogStore
};
