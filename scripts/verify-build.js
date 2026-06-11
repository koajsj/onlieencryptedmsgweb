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

function readManifest() {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.files)) {
      throw new Error("invalid manifest shape");
    }
    return parsed;
  } catch (error) {
    throw new Error("Build manifest missing or invalid");
  }
}

function main() {
  let manifest;
  try {
    manifest = readManifest();
  } catch (error) {
    console.error(`${error.message}. Run \`npm run build\` first.`);
    process.exit(1);
    return;
  }

  const manifestBySource = new Map();
  for (const item of manifest.files) {
    if (!item || typeof item.source !== "string") {
      continue;
    }
    manifestBySource.set(item.source, item);
  }

  const problems = [];

  for (const pair of CHECKS) {
    const manifestItem = manifestBySource.get(pair.source);
    if (!manifestItem || manifestItem.built !== pair.built) {
      problems.push(`- ${pair.source}: missing manifest entry`);
      continue;
    }

    const sourcePath = path.join(ROOT_DIR, manifestItem.source);
    const builtPath = path.join(ROOT_DIR, manifestItem.built);

    let sourceHash = "";
    let builtHash = "";

    try {
      sourceHash = sha256Hex(readFileBuffer(sourcePath));
      builtHash = sha256Hex(readFileBuffer(builtPath));
    } catch (error) {
      problems.push(`- ${pair.source}: ${error.message}`);
      continue;
    }

    if (sourceHash !== manifestItem.sourceHash) {
      problems.push(`- ${pair.source}: source changed after last build`);
    }
    if (builtHash !== manifestItem.builtHash) {
      problems.push(`- ${pair.built}: build artifact changed or missing`);
    }
  }

  if (problems.length === 0) {
    return;
  }

  console.error("Build artifacts are missing or stale. Run `npm run build` first.\n" + problems.join("\n"));
  process.exit(1);
}

main();
