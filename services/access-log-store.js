"use strict";

const fs = require("node:fs");
const path = require("node:path");
const sqlite3 = require("sqlite3");
const { UAParser } = require("ua-parser-js");

const ACCESS_DB_FILE = "access_logs.sqlite";
const DEFAULT_BATCH_SIZE = 80;
const CLIENT_META_CACHE_LIMIT = 2000;

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

function dayStartTimestamp(daysAgo = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.getTime();
}

function createEmptySummary() {
  return {
    enabled: false,
    totals: {
      pageViews: 0,
      uniqueVisitors: 0,
      pageViews24h: 0,
      uniqueVisitors24h: 0,
      logRows: 0
    },
    trend: [],
    topPages: [],
    topIps: []
  };
}

class AccessLogStore {
  constructor(options = {}) {
    this.enabled = parseBooleanFlag(options.enabled, true);
    this.dataDir = options.dataDir || process.cwd();
    this.dbFile = path.join(this.dataDir, ACCESS_DB_FILE);
    this.logger = typeof options.logger === "function" ? options.logger : () => {};
    this.db = null;
    this.ready = this.enabled ? this.initialize() : Promise.resolve();
    this.queue = [];
    this.processing = false;
    this.clientMetaBySession = new Map();
  }

  async initialize() {
    if (!this.enabled) {
      return;
    }
    fs.mkdirSync(this.dataDir, { recursive: true });
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
    await this.execImmediate("PRAGMA synchronous = NORMAL;");
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
        created_at INTEGER NOT NULL
      );
    `);
    await this.execImmediate("CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id);");
    await this.execImmediate("CREATE INDEX IF NOT EXISTS idx_access_logs_ip ON access_logs(ip);");
    await this.execImmediate("CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at);");
    await this.execImmediate("CREATE INDEX IF NOT EXISTS idx_access_logs_session_id ON access_logs(session_id);");
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
    if (!this.enabled) {
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
    if (!this.enabled || !sessionId) {
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
    } catch (error) {
      this.logger(error);
    } finally {
      this.processing = false;
      if (this.queue.length > 0) {
        this.scheduleQueue();
      }
    }
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

  async insertLogBatch(rows) {
    if (!rows.length || !this.db) {
      return;
    }
    await this.ready;
    const db = this.db;
    await this.runImmediate("BEGIN TRANSACTION");
    try {
      const stmt = await new Promise((resolve, reject) => {
        const prepared = db.prepare(
          `INSERT INTO access_logs (
            user_id, session_id, ip, user_agent, browser, os, device_type, method, path, referer,
            request_time_ms, status_code, request_kind, language, screen_resolution, timezone, platform, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        for (const row of rows) {
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

  async getDashboardSummary() {
    if (!this.enabled) {
      return createEmptySummary();
    }
    await this.ready;
    const today = Date.now() - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = dayStartTimestamp(6);
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
    const trend = await this.all(
      `SELECT
        strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS label,
        COUNT(*) AS pv,
        COUNT(DISTINCT session_id) AS uv
      FROM access_logs
      WHERE request_kind = 'page' AND created_at >= ?
      GROUP BY label
      ORDER BY label ASC`,
      [sevenDaysAgo]
    );
    const topPages = await this.all(
      `SELECT path, COUNT(*) AS pv
      FROM access_logs
      WHERE request_kind = 'page'
      GROUP BY path
      ORDER BY pv DESC, path ASC
      LIMIT 8`
    );
    const topIps = await this.all(
      `SELECT ip, COUNT(*) AS hits, COUNT(DISTINCT session_id) AS uv
      FROM access_logs
      GROUP BY ip
      ORDER BY hits DESC, ip ASC
      LIMIT 8`
    );
    return {
      enabled: true,
      totals: {
        pageViews: Number(totalsRow?.page_views || 0),
        uniqueVisitors: Number(totalsRow?.unique_visitors || 0),
        pageViews24h: Number(totalsRow?.page_views_24h || 0),
        uniqueVisitors24h: Number(totalsRow?.unique_visitors_24h || 0),
        logRows: Number(totalsRow?.log_rows || 0)
      },
      trend: trend.map((row) => ({
        label: String(row.label || ""),
        pv: Number(row.pv || 0),
        uv: Number(row.uv || 0)
      })),
      topPages: topPages.map((row) => ({
        path: String(row.path || "/"),
        pv: Number(row.pv || 0)
      })),
      topIps: topIps.map((row) => ({
        ip: String(row.ip || "unknown"),
        hits: Number(row.hits || 0),
        uv: Number(row.uv || 0),
        attribution: ipAttribute(row.ip)
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
        request_time_ms, status_code, request_kind, language, screen_resolution, timezone, platform, created_at
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
        ipAttribution: ipAttribute(row.ip),
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
      `SELECT language, screen_resolution, timezone, platform, browser, os, device_type
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
      ipAttribution: ipAttribute(summary.ip),
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
      pendingQueue: this.queue.length
    };
  }
}

function createAccessLogStore(options) {
  return new AccessLogStore(options);
}

module.exports = {
  createAccessLogStore
};
