"use strict";

const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const BUILD_ASSETS = [
  { source: "public/app.js", built: "public/app.min.js" },
  { source: "public/admin.js", built: "public/admin.min.js" },
  { source: "public/admin-user.js", built: "public/admin-user.min.js" },
  { source: "public/styles.css", built: "public/styles.min.css" },
  { source: "public/admin.css", built: "public/admin.min.css" },
  { source: "public/admin-user.css", built: "public/admin-user.min.css" }
];
const HTML_FILES = [
  path.join(ROOT_DIR, "public/index.html"),
  path.join(ROOT_DIR, "public/admin.html"),
  path.join(ROOT_DIR, "public/admin-user.html")
];

module.exports = {
  ROOT_DIR,
  BUILD_ASSETS,
  HTML_FILES
};
