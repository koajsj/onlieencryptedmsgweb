"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const CHECKS = [
  { source: "public/app.js", built: "public/app.min.js" },
  { source: "public/styles.css", built: "public/styles.min.css" }
];

function statOrNull(filePath) {
  try {
    return fs.statSync(filePath);
  } catch (error) {
    return null;
  }
}

function main() {
  const stalePairs = [];

  for (const pair of CHECKS) {
    const sourcePath = path.join(ROOT_DIR, pair.source);
    const builtPath = path.join(ROOT_DIR, pair.built);
    const sourceStat = statOrNull(sourcePath);
    const builtStat = statOrNull(builtPath);

    if (!sourceStat || !builtStat || sourceStat.mtimeMs > builtStat.mtimeMs) {
      stalePairs.push(pair);
    }
  }

  if (stalePairs.length === 0) {
    return;
  }

  const details = stalePairs.map((pair) => `- ${pair.built} (source: ${pair.source})`).join("\n");
  console.error("Build artifacts are missing or stale. Run `npm run build` first.\n" + details);
  process.exit(1);
}

main();
