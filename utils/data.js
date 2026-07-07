"use strict";

const fs = require("node:fs");

function chmodOwnerReadWrite(filePath) {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    // Ignore chmod failures on filesystems that do not support POSIX modes.
  }
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`failed to parse JSON file ${filePath}: ${error.message}`);
  }
}

function readJsonLinesFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const rows = [];
  const lines = raw.split(/\r?\n/).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`failed to parse JSON line ${index + 1} in ${filePath}: ${error.message}`);
    }
  }
  return rows;
}

function writeJsonFile(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodOwnerReadWrite(tempPath);
  fs.renameSync(tempPath, filePath);
  chmodOwnerReadWrite(filePath);
}

function rewriteJsonLinesFile(filePath, rows) {
  const tempPath = `${filePath}.tmp`;
  const body = rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
  fs.writeFileSync(tempPath, body, { encoding: "utf8", mode: 0o600 });
  chmodOwnerReadWrite(tempPath);
  fs.renameSync(tempPath, filePath);
  chmodOwnerReadWrite(filePath);
}

function appendJsonLinesFile(filePath, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }
  const body = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  fs.appendFileSync(filePath, body, { encoding: "utf8", mode: 0o600 });
  chmodOwnerReadWrite(filePath);
}

function appendTextFileSync(filePath, text) {
  fs.appendFileSync(filePath, String(text || ""), { encoding: "utf8", mode: 0o600 });
  chmodOwnerReadWrite(filePath);
}

module.exports = {
  readJsonFile,
  readJsonLinesFile,
  writeJsonFile,
  rewriteJsonLinesFile,
  appendJsonLinesFile,
  appendTextFileSync
};
