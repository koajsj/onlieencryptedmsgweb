"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { contentTypes } = require("../config");
const {
  cacheControlForStaticFile,
  securityHeaders,
  sendJson,
  weakEtagForStat
} = require("../utils/http");

function createStaticFileServer(publicDir) {
  return function serveStatic(req, res, url) {
    let requestPath;
    try {
      requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    } catch (error) {
      sendJson(res, 400, { error: "invalid path" });
      return;
    }

    const filePath = path.normalize(path.join(publicDir, requestPath));
    const relativePath = path.relative(publicDir, filePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      sendJson(res, 403, { error: "forbidden" });
      return;
    }

    fs.stat(filePath, (statError, stat) => {
      if (statError || !stat.isFile()) {
        sendJson(res, 404, { error: "not found" });
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const etag = weakEtagForStat(stat);
      const cacheControl = cacheControlForStaticFile(filePath);
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, securityHeaders({
          "Cache-Control": cacheControl,
          ETag: etag
        }));
        res.end();
        return;
      }

      res.writeHead(200, securityHeaders({
        "Content-Type": contentTypes[ext] || "application/octet-stream",
        "Content-Length": stat.size,
        "Cache-Control": cacheControl,
        ETag: etag
      }));
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      fs.createReadStream(filePath).pipe(res);
    });
  };
}

module.exports = {
  createStaticFileServer
};
