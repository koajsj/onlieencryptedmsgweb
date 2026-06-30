"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  ADMIN_CONFIG_ENV_FILE,
  DEFAULT_ADMIN_USERNAME_VALUE,
  DEFAULT_ADMIN_PASSWORD_VALUE,
  DEFAULT_ADMIN_UPDATE_PASSPHRASE_VALUE
} = require("../config");
const { normalizeUsername, normalizePassword } = require("../utils/normalize");
const { isPasswordHashFormat, verifyPlainSecret } = require("../utils/crypto");

const ADMIN_AUDIT_HMAC_ALGO = "hmac-sha256";
const ADMIN_AUDIT_SHA_ALGO = "sha256";
const ADMIN_AUDIT_HMAC_DOMAIN = "secure-chat/admin-audit-hmac-v1";

function parseEnvFile(content) {
  const entries = new Map();
  for (const line of String(content || "").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }
    entries.set(match[1], match[2]);
  }
  return entries;
}

function upsertEnvLines(lines, key, value) {
  const nextLine = `${key}=${value}`;
  let replaced = false;
  const nextLines = lines
    .filter((line) => !new RegExp(`^\\s*${key}=`).test(line))
    .map((line) => line);
  for (let index = 0; index < lines.length; index += 1) {
    if (new RegExp(`^\\s*${key}=`).test(lines[index])) {
      nextLines.splice(index, 0, nextLine);
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    nextLines.push(nextLine);
  }
  return nextLines;
}

function removeEnvKey(lines, key) {
  return lines.filter((line) => !new RegExp(`^\\s*${key}=`).test(line));
}

function readEnvFileValue(key) {
  const envFilePath = String(ADMIN_CONFIG_ENV_FILE || "").trim();
  if (!envFilePath || !path.isAbsolute(envFilePath) || !fs.existsSync(envFilePath)) {
    return "";
  }
  try {
    const entries = parseEnvFile(fs.readFileSync(envFilePath, "utf8"));
    return String(entries.get(key) || "").trim();
  } catch (error) {
    return "";
  }
}

function readConfiguredAdminUsername() {
  const fromEnv = normalizeUsername(process.env.ADMIN_USERNAME || readEnvFileValue("ADMIN_USERNAME"));
  if (fromEnv) {
    return fromEnv.value;
  }
  return DEFAULT_ADMIN_USERNAME_VALUE;
}

function readConfiguredAdminCredential() {
  const fromEnv = normalizePassword(process.env.ADMIN_PASSWORD || readEnvFileValue("ADMIN_PASSWORD"));
  if (fromEnv.length >= 4 && fromEnv.length <= 72) {
    return {
      type: "plain",
      value: fromEnv,
      source: "configured"
    };
  }

  const hash = String(process.env.ADMIN_PASSWORD_HASH || readEnvFileValue("ADMIN_PASSWORD_HASH")).trim();
  if (isPasswordHashFormat(hash)) {
    return {
      type: "hash",
      value: hash,
      source: "configured"
    };
  }

  return {
    type: "plain",
    value: DEFAULT_ADMIN_PASSWORD_VALUE,
    source: "fallback"
  };
}

function readConfiguredAdminConfig() {
  return {
    username: readConfiguredAdminUsername(),
    credential: readConfiguredAdminCredential()
  };
}

function validateConfiguredAdminConfig(config) {
  const credential = config?.credential;
  if (!credential || credential.type === "missing" || !credential.value) {
    throw new Error("admin credentials are not configured; set ADMIN_PASSWORD or ADMIN_PASSWORD_HASH");
  }
}

function warnIfWeakAdminCredential(config) {
  const credential = config?.credential;
  if (
    credential &&
    credential.type === "plain" &&
    credential.value === DEFAULT_ADMIN_PASSWORD_VALUE
  ) {
    console.warn("[security] legacy admin password is still set to the historical default; rotate ADMIN_PASSWORD or ADMIN_PASSWORD_HASH");
  }
}

function readAuditHmacKeyState(credential) {
  const fromEnv = String(process.env.AUDIT_HMAC_KEY || "").trim();
  if (fromEnv) {
    const hexMatch = fromEnv.match(/^[a-f0-9]{32,128}$/i);
    if (hexMatch) {
      return { key: Buffer.from(fromEnv, "hex"), source: "env:hex" };
    }
    return { key: crypto.createHash("sha256").update(fromEnv, "utf8").digest(), source: "env:utf8" };
  }
  const derived = crypto
    .createHmac("sha256", ADMIN_AUDIT_HMAC_DOMAIN)
    .update(String(credential?.value || ""), "utf8")
    .digest();
  return { key: derived, source: `derived:${String(credential?.type || "plain")}` };
}

function verifyAdminUpdatePassphrase(passphrase) {
  const expected = normalizePassword(
    process.env.ADMIN_UPDATE_PASSPHRASE ||
    readEnvFileValue("ADMIN_UPDATE_PASSPHRASE") ||
    DEFAULT_ADMIN_UPDATE_PASSPHRASE_VALUE
  );
  if (!expected) {
    return { ok: false, reason: "missing" };
  }
  return {
    ok: verifyPlainSecret(passphrase, expected),
    reason: "invalid"
  };
}

function computeAdminAuditEntryHash(prevHash, entryBase, algo, hmacKey) {
  const payload = `${prevHash}|${JSON.stringify(entryBase)}`;
  if (algo === ADMIN_AUDIT_HMAC_ALGO) {
    return crypto.createHmac("sha256", hmacKey).update(payload).digest("hex");
  }
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function entryBaseFromEntry(entry) {
  const { prevHash: _prev, hash: _hash, hashAlgo: _algo, ...rest } = entry;
  return rest;
}

function persistAdminConfigToEnvFile(nextConfig, hmacKeyState) {
  const envFilePath = String(ADMIN_CONFIG_ENV_FILE || "").trim();
  if (!envFilePath || !path.isAbsolute(envFilePath)) {
    throw new Error("admin config env file path is invalid");
  }
  const existingContent = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, "utf8") : "";
  let lines = String(existingContent || "").split(/\r?\n/).filter((line) => line.length > 0);
  lines = upsertEnvLines(lines, "ADMIN_USERNAME", nextConfig.username);
  if (nextConfig.credential.type === "plain") {
    lines = upsertEnvLines(lines, "ADMIN_PASSWORD", nextConfig.credential.value);
    lines = removeEnvKey(lines, "ADMIN_PASSWORD_HASH");
  } else {
    lines = upsertEnvLines(lines, "ADMIN_PASSWORD_HASH", nextConfig.credential.value);
    lines = removeEnvKey(lines, "ADMIN_PASSWORD");
  }
  if (!parseEnvFile(existingContent).has("AUDIT_HMAC_KEY")) {
    lines = upsertEnvLines(lines, "AUDIT_HMAC_KEY", hmacKeyState.key.toString("hex"));
  }
  fs.mkdirSync(path.dirname(envFilePath), { recursive: true });
  fs.writeFileSync(envFilePath, `${lines.join("\n")}\n`, "utf8");
  try {
    fs.chmodSync(envFilePath, 0o600);
  } catch (error) {
    // Ignore permission update failures on non-Linux environments.
  }
}

module.exports = {
  ADMIN_AUDIT_HMAC_ALGO,
  ADMIN_AUDIT_SHA_ALGO,
  ADMIN_AUDIT_HMAC_DOMAIN,
  parseEnvFile,
  upsertEnvLines,
  removeEnvKey,
  readEnvFileValue,
  readConfiguredAdminConfig,
  validateConfiguredAdminConfig,
  warnIfWeakAdminCredential,
  readAuditHmacKeyState,
  verifyAdminUpdatePassphrase,
  computeAdminAuditEntryHash,
  entryBaseFromEntry,
  persistAdminConfigToEnvFile
};
