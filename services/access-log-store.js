"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { UAParser } = require("ua-parser-js");

const ACCESS_LOG_FILE = "access_logs.jsonl";
const DEFAULT_BATCH_SIZE = 80;
const CLIENT_META_CACHE_LIMIT = 2000;
// Bound in-memory rows and the on-disk JSONL so a long-running instance does
// not grow without limit. Oldest rows are dropped first.
const MAX_ROWS = 50000;

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

function localDateLabel(timestamp) {
  const date = new Date(Number(timestamp) || 0);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function maxString(values) {
  let result = "";
  for (const value of values) {
    const text = String(value || "");
    if (text > result) {
      result = text;
    }
  }
  return result;
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
    this.logFile = path.join(this.dataDir, ACCESS_LOG_FILE);
    this.logger = typeof options.logger === "function" ? options.logger : () => {};
    this.rows = [];
    this.nextId = 1;
    this.queue = [];
    this.processing = false;
    this.clientMetaBySession = new Map();
    this.pendingAppends = [];
    this.needsRewrite = false;
    this.ready = this.enabled ? this.initialize() : Promise.resolve();
  }

  async initialize() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.logFile)) {
      return;
    }
    const content = fs.readFileSync(this.logFile, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        this.rows.push(JSON.parse(trimmed));
      } catch (error) {
        // Skip corrupt lines rather than failing startup.
      }
    }
    if (this.rows.length > MAX_ROWS) {
      this.rows = this.rows.slice(this.rows.length - MAX_ROWS);
      this.needsRewrite = true;
    }
    this.nextId = this.rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
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
    // Cap the in-memory client-meta cache so it doesn't grow unbounded as new
    // visitor sessions arrive. LRU-ish: drop the oldest entry on overflow.
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
        for (const item of batch) {
          if (item.type === "log") {
            const row = { id: this.nextId++, ...item.row };
            this.rows.push(row);
            this.pendingAppends.push(row);
          } else if (item.type === "client-meta") {
            this.applyClientMeta(item.sessionId, item.meta);
          }
        }
        this.enforceRowCap();
        this.persist();
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

  enforceRowCap() {
    if (this.rows.length > MAX_ROWS) {
      this.rows.splice(0, this.rows.length - MAX_ROWS);
      this.needsRewrite = true;
    }
  }

  persist() {
    try {
      if (this.needsRewrite) {
        const data = this.rows.map((row) => JSON.stringify(row)).join("\n");
        fs.writeFileSync(this.logFile, data ? `${data}\n` : "");
        this.pendingAppends = [];
        this.needsRewrite = false;
      } else if (this.pendingAppends.length > 0) {
        const data = `${this.pendingAppends.map((row) => JSON.stringify(row)).join("\n")}\n`;
        fs.appendFileSync(this.logFile, data);
        this.pendingAppends = [];
      }
    } catch (error) {
      this.logger(error);
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

  applyClientMeta(sessionId, meta) {
    let changed = false;
    for (const row of this.rows) {
      if (row.sessionId !== sessionId) {
        continue;
      }
      if (!row.language && meta.language) {
        row.language = meta.language;
        changed = true;
      }
      if (!row.screenResolution && meta.screenResolution) {
        row.screenResolution = meta.screenResolution;
        changed = true;
      }
      if (!row.timezone && meta.timezone) {
        row.timezone = meta.timezone;
        changed = true;
      }
      if (!row.platform && meta.platform) {
        row.platform = meta.platform;
        changed = true;
      }
    }
    if (changed) {
      this.needsRewrite = true;
    }
  }

  async renameUserId(previousUserId, nextUserId) {
    const previous = normalizeText(previousUserId, 64);
    const next = normalizeText(nextUserId, 64);
    if (!this.enabled || !previous || !next || previous === next) {
      return 0;
    }
    await this.ready;
    for (const item of this.queue) {
      if (item?.type === "log" && item.row && item.row.userId === previous) {
        item.row.userId = next;
      }
    }
    let changes = 0;
    for (const row of this.rows) {
      if (row.userId === previous) {
        row.userId = next;
        changes += 1;
      }
    }
    if (changes > 0) {
      this.needsRewrite = true;
      this.persist();
    }
    return changes;
  }

  matchRow(row, filters, exact) {
    if (filters.ip) {
      const target = String(filters.ip).trim();
      if (exact ? row.ip !== target : !String(row.ip).includes(target)) {
        return false;
      }
    }
    if (filters.userId) {
      const target = String(filters.userId).trim();
      if (exact ? row.userId !== target : !String(row.userId).includes(target)) {
        return false;
      }
    }
    if (filters.sessionId) {
      const target = String(filters.sessionId).trim();
      if (exact ? row.sessionId !== target : !String(row.sessionId).includes(target)) {
        return false;
      }
    }
    if (filters.since && row.createdAt < Number(filters.since)) {
      return false;
    }
    if (filters.until && row.createdAt > Number(filters.until)) {
      return false;
    }
    return true;
  }

  async getDashboardSummary() {
    if (!this.enabled) {
      return createEmptySummary();
    }
    await this.ready;
    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
    const trendCutoff = dayStartTimestamp(6);

    const pageSessions = new Set();
    const pageSessions24h = new Set();
    let pageViews = 0;
    let pageViews24h = 0;

    const trendMap = new Map();
    const pagePathHits = new Map();
    const ipHits = new Map();

    for (const row of this.rows) {
      const isPage = row.requestKind === "page";
      if (isPage) {
        pageViews += 1;
        pageSessions.add(row.sessionId);
        if (row.createdAt >= cutoff24h) {
          pageViews24h += 1;
          pageSessions24h.add(row.sessionId);
        }
        if (row.createdAt >= trendCutoff) {
          const label = localDateLabel(row.createdAt);
          const bucket = trendMap.get(label) || { pv: 0, sessions: new Set() };
          bucket.pv += 1;
          bucket.sessions.add(row.sessionId);
          trendMap.set(label, bucket);
        }
        pagePathHits.set(row.path, (pagePathHits.get(row.path) || 0) + 1);
      }
      const ipBucket = ipHits.get(row.ip) || { hits: 0, sessions: new Set() };
      ipBucket.hits += 1;
      ipBucket.sessions.add(row.sessionId);
      ipHits.set(row.ip, ipBucket);
    }

    const trend = [...trendMap.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([label, bucket]) => ({ label, pv: bucket.pv, uv: bucket.sessions.size }));

    const topPages = [...pagePathHits.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 8)
      .map(([pagePath, pv]) => ({ path: pagePath, pv }));

    const topIps = [...ipHits.entries()]
      .sort((left, right) => right[1].hits - left[1].hits || left[0].localeCompare(right[0]))
      .slice(0, 8)
      .map(([ip, bucket]) => ({
        ip: ip || "unknown",
        hits: bucket.hits,
        uv: bucket.sessions.size,
        attribution: ipAttribute(ip)
      }));

    return {
      enabled: true,
      totals: {
        pageViews,
        uniqueVisitors: pageSessions.size,
        pageViews24h,
        uniqueVisitors24h: pageSessions24h.size,
        logRows: this.rows.length
      },
      trend,
      topPages,
      topIps
    };
  }

  async getAccessLogs(filters = {}, options = {}) {
    if (!this.enabled) {
      return { rows: [], total: 0, page: 1, limit: 50 };
    }
    await this.ready;
    const exact = Boolean(options.exactIdentityMatch);
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.max(1, Math.min(200, Number(filters.limit) || 50));
    const offset = (page - 1) * limit;
    const matched = this.rows.filter((row) => this.matchRow(row, filters, exact));
    matched.sort((left, right) => right.createdAt - left.createdAt || right.id - left.id);
    const pageRows = matched.slice(offset, offset + limit);
    return {
      rows: pageRows.map((row) => ({
        id: Number(row.id || 0),
        userId: String(row.userId || ""),
        sessionId: String(row.sessionId || ""),
        ip: String(row.ip || "unknown"),
        ipAttribution: ipAttribute(row.ip),
        userAgent: String(row.userAgent || ""),
        browser: String(row.browser || ""),
        os: String(row.os || ""),
        deviceType: String(row.deviceType || ""),
        method: String(row.method || ""),
        path: String(row.path || "/"),
        referer: String(row.referer || ""),
        requestTimeMs: Number(row.requestTimeMs || 0),
        statusCode: Number(row.statusCode || 0),
        requestKind: String(row.requestKind || "other"),
        language: String(row.language || ""),
        screenResolution: String(row.screenResolution || ""),
        timezone: String(row.timezone || ""),
        platform: String(row.platform || ""),
        createdAt: Number(row.createdAt || 0)
      })),
      total: matched.length,
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
    const matched = this.rows.filter((row) => this.matchRow(row, filters, true));
    if (matched.length === 0) {
      return null;
    }

    let firstVisit = Infinity;
    let lastVisit = 0;
    const pathHits = new Map();
    for (const row of matched) {
      firstVisit = Math.min(firstVisit, row.createdAt);
      lastVisit = Math.max(lastVisit, row.createdAt);
      pathHits.set(row.path, (pathHits.get(row.path) || 0) + 1);
    }

    const latest = matched
      .slice()
      .sort((left, right) => right.createdAt - left.createdAt || right.id - left.id)[0];

    const topPages = [...pathHits.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([pagePath, hits]) => ({ path: pagePath, hits }));

    return {
      userId: maxString(matched.map((row) => row.userId)),
      sessionId: maxString(matched.map((row) => row.sessionId)),
      ip: maxString(matched.map((row) => row.ip)),
      ipAttribution: ipAttribute(maxString(matched.map((row) => row.ip))),
      firstVisitAt: Number(firstVisit) || 0,
      lastVisitAt: Number(lastVisit) || 0,
      visits: matched.length,
      topPages,
      clientMeta: {
        language: String(latest?.language || ""),
        screenResolution: String(latest?.screenResolution || ""),
        timezone: String(latest?.timezone || ""),
        platform: String(latest?.platform || ""),
        browser: String(latest?.browser || ""),
        os: String(latest?.os || ""),
        deviceType: String(latest?.deviceType || "")
      }
    };
  }

  healthSnapshot() {
    return {
      enabled: this.enabled,
      dbFile: this.logFile,
      dbBytes: this.enabled && fs.existsSync(this.logFile) ? fs.statSync(this.logFile).size : 0,
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
