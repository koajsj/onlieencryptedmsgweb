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

// HTML files that reference built assets and need cache-busting query params
const HTML_FILES = [
  path.join(ROOT_DIR, "public/index.html"),
  path.join(ROOT_DIR, "public/admin.html")
];

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function shortHash(buffer) {
  return sha256Hex(buffer).slice(0, 10);
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

/**
 * Inject ?v=<hash> into HTML references to built assets.
 * Replaces patterns like ./foo.min.js or ./foo.min.js?v=old_hash
 * with ./foo.min.js?v=<content_hash_of_built_file>
 */
function injectCacheBusting(entries) {
  const hashMap = new Map();
  for (const entry of entries) {
    const builtPath = path.join(ROOT_DIR, entry.built);
    const basename = path.basename(entry.built);
    hashMap.set(basename, shortHash(readFileBuffer(builtPath)));
  }

  for (const htmlPath of HTML_FILES) {
    let content;
    try {
      content = fs.readFileSync(htmlPath, "utf8");
    } catch (error) {
      continue; // skip if HTML file doesn't exist
    }

    let changed = false;
    for (const [filename, hash] of hashMap) {
      // Match ./filename or ./filename?v=anything (within quotes)
      const pattern = new RegExp(
        `(\\.\\/` + filename.replace(".", "\\.") + `)(\\?v=[a-f0-9]*)?`,
        "g"
      );
      const replacement = `./${filename}?v=${hash}`;
      const next = content.replace(pattern, replacement);
      if (next !== content) {
        content = next;
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(htmlPath, content, "utf8");
    }
  }
}

function main() {
  try {
    const entries = buildManifestEntries();
    writeManifest(entries);
    injectCacheBusting(entries);
  } catch (error) {
    console.error(`${error.message}.`);
    process.exit(1);
  }
}

main();
