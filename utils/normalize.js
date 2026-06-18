"use strict";

function normalizeUsername(value) {
  if (typeof value !== "string") {
    return null;
  }
  const username = value.trim();
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
    return null;
  }
  return {
    value: username,
    key: username.toLowerCase()
  };
}

function normalizePassword(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeBoundedText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, maxLength);
}

function normalizeAuditReason(value, fallback) {
  const normalized = normalizeBoundedText(value, 120).replace(/\s+/g, " ");
  return normalized || fallback;
}

function normalizeUserList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean))];
}

function normalizeUserContacts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const normalized = {};
  for (const [username, entry] of Object.entries(value)) {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) {
      continue;
    }
    const note = normalizeBoundedText(entry?.note || "", 32);
    normalized[normalizedUsername.value] = {
      note,
      createdAt: Number.parseInt(String(entry?.createdAt || "0"), 10) || 0,
      updatedAt: Number.parseInt(String(entry?.updatedAt || "0"), 10) || 0,
      removedAt: Number.parseInt(String(entry?.removedAt || "0"), 10) || 0
    };
  }
  return normalized;
}

function readOptionalUsernameFilter(value) {
  const raw = normalizeBoundedText(value, 24);
  if (!raw) {
    return { ok: true, value: "" };
  }
  const normalized = normalizeUsername(raw);
  if (!normalized) {
    return { ok: false, value: "" };
  }
  return { ok: true, value: normalized.value };
}

function readSubmittedUsername(body) {
  if (!body || typeof body !== "object") {
    return "";
  }
  const account =
    body.username !== undefined
      ? body.username
      : body.account !== undefined
        ? body.account
        : body.email;
  return typeof account === "string" ? account.trim() : "";
}

module.exports = {
  normalizeUsername,
  normalizePassword,
  normalizeBoundedText,
  normalizeAuditReason,
  normalizeUserList,
  normalizeUserContacts,
  readOptionalUsernameFilter,
  readSubmittedUsername
};
