"use strict";

function createSupportRoutes(context) {
  const {
    getClientAddress,
    requirePublicWriteOrigin,
    rejectIfForbiddenOrLimited,
    readJsonBody,
    sendJsonBodyError,
    normalizeClientMetaPayload,
    accessLogMiddleware,
    accessLogStore,
    getSessionFromRequest,
    sendJson,
    requireSession,
    normalizeBoundedText,
    listUsersForSearch,
    ENABLE_ACCESS_LOG,
    MAX_API_REQUESTS_PER_WINDOW
  } = context;

async function handleClientMeta(req, res, url) {
  if (!requirePublicWriteOrigin(req, res)) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:client-meta:${address}`,
      Math.max(30, Math.floor(MAX_API_REQUESTS_PER_WINDOW / 2)),
      "too many requests"
    )
  ) {
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJsonBodyError(res, error);
    return;
  }
  const meta = normalizeClientMetaPayload(body);
  const sessionId = accessLogMiddleware.getSessionId(req);
  if (sessionId && ENABLE_ACCESS_LOG) {
    accessLogStore.enqueueClientMeta(sessionId, meta);
  }
  const session = getSessionFromRequest(req, url);
  if (session?.username) {
    accessLogMiddleware.setUserId(req, session.username);
  }
  sendJson(res, 200, { ok: true });
}

function handleUsers(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (rejectIfForbiddenOrLimited(req, res, `api:users:${address}`, MAX_API_REQUESTS_PER_WINDOW, "too many requests")) {
    return;
  }
  const query = normalizeBoundedText(url.searchParams.get("q") || "", 64);
  if (!query) {
    sendJson(res, 200, { users: [] });
    return;
  }
  sendJson(res, 200, {
    users: listUsersForSearch(session.username, query)
  });
}

  return {
    handleClientMeta,
    handleUsers
  };
}

module.exports = {
  createSupportRoutes
};
