"use strict";

const fs = require("node:fs");

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
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function rewriteJsonLinesFile(filePath, rows) {
  const tempPath = `${filePath}.tmp`;
  const body = rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
  fs.writeFileSync(tempPath, body, "utf8");
  fs.renameSync(tempPath, filePath);
}

module.exports = {
  readJsonFile,
  readJsonLinesFile,
  writeJsonFile,
  rewriteJsonLinesFile
};
