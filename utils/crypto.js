"use strict";

const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scryptAsync = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

async function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split(":");
  const [salt, hash] = parts[0] === "scrypt" ? parts.slice(1) : parts;
  if (!salt || !hash || !/^[a-f0-9]{128}$/i.test(hash)) {
    return false;
  }
  try {
    const expected = Buffer.from(hash, "hex");
    const computed = await scryptAsync(password, salt, expected.length);
    return crypto.timingSafeEqual(expected, computed);
  } catch (error) {
    return false;
  }
}

function isPasswordHashFormat(value) {
  const parts = String(value || "").split(":");
  const [salt, hash] = parts[0] === "scrypt" ? parts.slice(1) : parts;
  return Boolean(salt) && /^[a-f0-9]{128}$/i.test(String(hash || ""));
}

function verifyPlainSecret(password, expected) {
  const providedDigest = crypto.createHash("sha256").update(String(password || ""), "utf8").digest();
  const expectedDigest = crypto.createHash("sha256").update(String(expected || ""), "utf8").digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

function decodeBase64Blob(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(trimmed)
  ) {
    return null;
  }
  try {
    const bytes = Buffer.from(trimmed, "base64");
    if (bytes.length === 0 || bytes.toString("base64") !== trimmed) {
      return null;
    }
    return bytes;
  } catch (error) {
    return null;
  }
}

function isBase64Blob(value, minBytes, maxBytes) {
  const bytes = decodeBase64Blob(value);
  if (!bytes) {
    return false;
  }
  return bytes.length >= minBytes && bytes.length <= maxBytes;
}

function makeAvatarSeed(username) {
  return crypto.createHash("sha1").update(username).digest("hex").slice(0, 8);
}

module.exports = {
  hashPassword,
  verifyPassword,
  isPasswordHashFormat,
  verifyPlainSecret,
  decodeBase64Blob,
  isBase64Blob,
  makeAvatarSeed
};
