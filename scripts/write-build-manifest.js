"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT_DIR, "public/build-manifest.json");
const CHECKS = [
  { source: "public/app.js", built: "public/app.min.js" },
  { source: "public/admin.js", built: "public/admin.min.js" },
  { source: "public/styles.css", built: "public/styles.min.css" },
  { source: "public/admin.css", built: "public/admin.min.css" }
];

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readFileBuffer(filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    throw new Error(`Cannot read file: ${filePath}`);
  }
}

function buildManifestEntries() {
  return CHECKS.map((pair) => {
    const sourcePath = path.join(ROOT_DIR, pair.source);
    const builtPath = path.join(ROOT_DIR, pair.built);
    return {
      source: pair.source,
      built: pair.built,
      sourceHash: sha256Hex(readFileBuffer(sourcePath)),
      builtHash: sha256Hex(readFileBuffer(builtPath))
    };
  });
}

function writeManifest(entries) {
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    files: entries
  };
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function main() {
  try {
    const entries = buildManifestEntries();
    writeManifest(entries);
  } catch (error) {
    console.error(`${error.message}.`);
    process.exit(1);
  }
}

main();
