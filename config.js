"use strict";

// Centralized runtime configuration. All values are derived from environment
// variables (or sensible defaults) at process start, exactly as before; this
// module only relocates the constants out of server.js without changing them.

const path = require("node:path");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const SESSION_TTL_MS = Math.max(
  1000,
  Number.parseInt(process.env.SESSION_TTL_MS || `${7 * 24 * 60 * 60 * 1000}`, 10) || 7 * 24 * 60 * 60 * 1000
);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const MESSAGES_LOG_FILE = path.join(DATA_DIR, "messages.jsonl");
const ADMIN_AUDIT_FILE = path.join(DATA_DIR, "admin_audit.jsonl");

const MAX_BODY_BYTES = 128 * 1024;
const MAX_MESSAGE_BODY_BYTES = 8 * 1024 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const MAX_AUTH_REQUESTS_PER_WINDOW = 40;
const MAX_API_REQUESTS_PER_WINDOW = 240;
const MAX_MESSAGES_PER_CONVERSATION_WINDOW = Math.max(
  1,
  Number.parseInt(process.env.MAX_MESSAGES_PER_CONVERSATION_WINDOW || "60", 10) || 60
);
const HEARTBEAT_MS = 15000;
const EVENT_TICKET_TTL_MS = 15000;
const MESSAGE_PERSIST_DEBOUNCE_MS = Math.max(
  10,
  Number.parseInt(process.env.MESSAGE_PERSIST_DEBOUNCE_MS || "180", 10) || 180
);
const HSTS_MAX_AGE_SECONDS = Math.max(0, Number.parseInt(process.env.HSTS_MAX_AGE_SECONDS || "0", 10) || 0);
const COOKIE_SECURE =
  process.env.COOKIE_SECURE === "1" || (process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "0");
const ENABLE_ACCESS_LOG = process.env.ENABLE_ACCESS_LOG !== "0";
const ACCESS_LOG_RETENTION_DAYS = Math.max(
  1,
  Number.parseInt(process.env.ACCESS_LOG_RETENTION_DAYS || "30", 10) || 30
);
const ACCESS_LOG_MAX_QUEUE = Math.max(
  100,
  Number.parseInt(process.env.ACCESS_LOG_MAX_QUEUE || "10000", 10) || 10000
);
const ALLOW_BEARER_AUTH = process.env.ALLOW_BEARER_AUTH === "1";
const USER_SESSION_COOKIE = "secure_chat_session";
const ADMIN_SESSION_COOKIE = "secure_chat_admin_session";
const DEFAULT_ADMIN_USERNAME_VALUE = "admin";
const DEFAULT_ADMIN_PASSWORD_VALUE = "qwer@1234";
const ALLOW_INSECURE_DEFAULT_ADMIN = process.env.ALLOW_INSECURE_DEFAULT_ADMIN === "1";
const ADMIN_CONFIG_ENV_FILE = process.env.ADMIN_CONFIG_ENV_FILE || "/etc/default/secure-chat";
const AUDIT_TEXT_RETENTION_DAYS = Math.max(1, Number.parseInt(process.env.AUDIT_TEXT_RETENTION_DAYS || "30", 10) || 30);
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const TRUSTED_PROXY_ADDRESSES = new Set(
  (process.env.TRUSTED_PROXY_ADDRESSES || "127.0.0.1,::1,::ffff:127.0.0.1")
    .split(",")
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean)
);
const TRUSTED_ORIGINS = new Set(
  (process.env.TRUSTED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const PUBLIC_KEY_BYTES = { min: 65, max: 120 };
const PRIVATE_KEY_SALT_BYTES = { min: 16, max: 32 };
const PRIVATE_KEY_IV_BYTES = { min: 12, max: 24 };
const ENCRYPTED_PRIVATE_KEY_BYTES = { min: 96, max: 4096 };
const MESSAGE_NONCE_BYTES = { min: 12, max: 24 };
// AES-GCM ciphertext includes a 16-byte auth tag, so short plaintext messages
// can legitimately produce ciphertext as small as 16 bytes.
const MESSAGE_CIPHERTEXT_BYTES = { min: 16, max: 11 * 1024 * 1024 };

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

const ADMIN_LOGIN_FAILURE_WINDOW_MS = Math.max(
  1000,
  Number.parseInt(process.env.ADMIN_LOGIN_FAILURE_WINDOW_MS || `${15 * 60 * 1000}`, 10) || 15 * 60 * 1000
);
const ADMIN_LOGIN_LOCKOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.ADMIN_LOGIN_LOCKOUT_MS || `${15 * 60 * 1000}`, 10) || 15 * 60 * 1000
);
const ADMIN_LOGIN_MAX_FAILURES = Math.max(
  1,
  Number.parseInt(process.env.ADMIN_LOGIN_MAX_FAILURES || "5", 10) || 5
);
const USER_LOGIN_FAILURE_WINDOW_MS = Math.max(
  1000,
  Number.parseInt(process.env.USER_LOGIN_FAILURE_WINDOW_MS || `${15 * 60 * 1000}`, 10) || 15 * 60 * 1000
);
const USER_LOGIN_LOCKOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.USER_LOGIN_LOCKOUT_MS || `${10 * 60 * 1000}`, 10) || 10 * 60 * 1000
);
const USER_LOGIN_MAX_FAILURES = Math.max(
  1,
  Number.parseInt(process.env.USER_LOGIN_MAX_FAILURES || "8", 10) || 8
);
const MAX_CONCURRENT_EVENT_CONNECTIONS_PER_USER = Math.max(
  1,
  Number.parseInt(process.env.MAX_CONCURRENT_EVENT_CONNECTIONS_PER_USER || "5", 10) || 5
);
const DUMMY_PASSWORD_HASH =
  "scrypt:" +
  "00000000000000000000000000000000" +
  ":" +
  "00000000000000000000000000000000" +
  "00000000000000000000000000000000" +
  "00000000000000000000000000000000" +
  "00000000000000000000000000000000";

module.exports = {
  HOST,
  PORT,
  SESSION_TTL_MS,
  PUBLIC_DIR,
  DATA_DIR,
  USERS_FILE,
  MESSAGES_FILE,
  MESSAGES_LOG_FILE,
  ADMIN_AUDIT_FILE,
  MAX_BODY_BYTES,
  MAX_MESSAGE_BODY_BYTES,
  RATE_WINDOW_MS,
  MAX_AUTH_REQUESTS_PER_WINDOW,
  MAX_API_REQUESTS_PER_WINDOW,
  MAX_MESSAGES_PER_CONVERSATION_WINDOW,
  HEARTBEAT_MS,
  EVENT_TICKET_TTL_MS,
  MESSAGE_PERSIST_DEBOUNCE_MS,
  HSTS_MAX_AGE_SECONDS,
  COOKIE_SECURE,
  ENABLE_ACCESS_LOG,
  ACCESS_LOG_RETENTION_DAYS,
  ACCESS_LOG_MAX_QUEUE,
  ALLOW_BEARER_AUTH,
  USER_SESSION_COOKIE,
  ADMIN_SESSION_COOKIE,
  DEFAULT_ADMIN_USERNAME_VALUE,
  DEFAULT_ADMIN_PASSWORD_VALUE,
  ALLOW_INSECURE_DEFAULT_ADMIN,
  ADMIN_CONFIG_ENV_FILE,
  AUDIT_TEXT_RETENTION_DAYS,
  TRUST_PROXY,
  TRUSTED_PROXY_ADDRESSES,
  TRUSTED_ORIGINS,
  PUBLIC_KEY_BYTES,
  PRIVATE_KEY_SALT_BYTES,
  PRIVATE_KEY_IV_BYTES,
  ENCRYPTED_PRIVATE_KEY_BYTES,
  MESSAGE_NONCE_BYTES,
  MESSAGE_CIPHERTEXT_BYTES,
  contentTypes,
  ADMIN_LOGIN_FAILURE_WINDOW_MS,
  ADMIN_LOGIN_LOCKOUT_MS,
  ADMIN_LOGIN_MAX_FAILURES,
  USER_LOGIN_FAILURE_WINDOW_MS,
  USER_LOGIN_LOCKOUT_MS,
  USER_LOGIN_MAX_FAILURES,
  MAX_CONCURRENT_EVENT_CONNECTIONS_PER_USER,
  DUMMY_PASSWORD_HASH
};
