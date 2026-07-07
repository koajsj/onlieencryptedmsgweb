"use strict";

function createContactRoutes(context) {
  const {
    requireSession,
    sendJson,
    listContactsFor,
    rejectIfForbiddenOrLimited,
    readJsonBody,
    sendJsonBodyError,
    findUserByUsername,
    readSubmittedUsername,
    isUserBlocked,
    contactEntryFor,
    upsertUserContact,
    persistUsers,
    publicContactView,
    parseContactPath,
    relationshipStateFor,
    setRelationshipState,
    removeUserContact,
    pushPresence,
    isUserOnline,
    pushEventToUser,
    MAX_API_REQUESTS_PER_WINDOW
  } = context;

  function rejectUnknownBodyKeys(body, allowedKeys, res) {
    const allowed = new Set(allowedKeys);
    const unknown = Object.keys(body || {}).filter((key) => !allowed.has(key));
    if (unknown.length === 0) {
      return false;
    }
    sendJson(res, 400, { error: "unknown request fields" });
    return true;
  }

  function hasAnyBodyKey(body, keys) {
    return keys.some((key) => Object.prototype.hasOwnProperty.call(body || {}, key));
  }

function handleContacts(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  sendJson(res, 200, {
    contacts: listContactsFor(session.username)
  });
}

async function handleContactCreate(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  if (rejectIfForbiddenOrLimited(
    req,
    res,
    `api:contacts:create:${session.username}`,
    MAX_API_REQUESTS_PER_WINDOW,
    "too many requests"
  )) {
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJsonBodyError(res, error);
    return;
  }
  if (rejectUnknownBodyKeys(body, ["username", "account", "email", "note"], res)) {
    return;
  }
  const peer = findUserByUsername(readSubmittedUsername(body));
  const owner = findUserByUsername(session.username);
  if (!peer || peer.username === session.username) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  if (!owner) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  if (Object.prototype.hasOwnProperty.call(body, "note") && typeof body.note !== "string") {
    sendJson(res, 400, { error: "note must be a string" });
    return;
  }
  if (isUserBlocked(owner, peer.username)) {
    sendJson(res, 409, { error: "you blocked peer" });
    return;
  }
  if (isUserBlocked(peer, owner.username)) {
    sendJson(res, 403, { error: "blocked by peer" });
    return;
  }
  const existing = contactEntryFor(owner, peer.username);
  if (existing && !existing.removedAt) {
    sendJson(res, 409, { error: "already a contact" });
    return;
  }
  upsertUserContact(owner, peer.username, { note: body.note || "" });
  persistUsers();
  sendJson(res, 201, { contact: publicContactView(owner.username, peer) });
}

async function handleContactPatch(req, res, url, pathname) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:contacts:patch:${session.username}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const parsed = parseContactPath(pathname);
  const peer = parsed?.username ? findUserByUsername(parsed.username) : null;
  if (!peer || peer.username === session.username) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  const owner = findUserByUsername(session.username);
  if (!owner) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJsonBodyError(res, error);
    return;
  }
  if (rejectUnknownBodyKeys(body, ["note", "pinned", "muted"], res)) {
    return;
  }
  if (!hasAnyBodyKey(body, ["note", "pinned", "muted"])) {
    sendJson(res, 400, { error: "no changes requested" });
    return;
  }
  if (Object.prototype.hasOwnProperty.call(body, "note") && typeof body.note !== "string") {
    sendJson(res, 400, { error: "note must be a string" });
    return;
  }
  if (Object.prototype.hasOwnProperty.call(body, "pinned") && typeof body.pinned !== "boolean") {
    sendJson(res, 400, { error: "pinned must be a boolean" });
    return;
  }
  if (Object.prototype.hasOwnProperty.call(body, "muted") && typeof body.muted !== "boolean") {
    sendJson(res, 400, { error: "muted must be a boolean" });
    return;
  }
  if (relationshipStateFor(owner, peer.username) === "blocked" && Object.prototype.hasOwnProperty.call(body, "muted")) {
    sendJson(res, 409, { error: "relationship is blocked" });
    return;
  }
  const entry = setRelationshipState(
    owner,
    peer.username,
    Object.prototype.hasOwnProperty.call(body, "muted") ? (body.muted ? "muted" : "normal") : relationshipStateFor(owner, peer.username),
    {
    ...(Object.prototype.hasOwnProperty.call(body, "note") ? { note: body.note } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, "pinned") ? { pinned: body.pinned } : {})
  });
  persistUsers();
  sendJson(res, 200, {
    contact: publicContactView(session.username, peer),
    entry
  });
}

function handleContactDelete(req, res, url, pathname) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:contacts:delete:${session.username}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const parsed = parseContactPath(pathname);
  const peer = parsed?.username ? findUserByUsername(parsed.username) : null;
  if (!peer || peer.username === session.username) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  const owner = findUserByUsername(session.username);
  if (!owner) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  removeUserContact(owner, peer.username);
  persistUsers();
  sendJson(res, 200, { ok: true });
}

async function handleContactBlock(req, res, url, pathname) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:contacts:block:${session.username}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const parsed = parseContactPath(pathname);
  const peer = parsed?.username ? findUserByUsername(parsed.username) : null;
  if (!peer || peer.username === session.username) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  const owner = findUserByUsername(session.username);
  if (!owner) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJsonBodyError(res, error);
    return;
  }
  if (rejectUnknownBodyKeys(body, ["blocked"], res)) {
    return;
  }
  if (typeof body.blocked !== "boolean") {
    sendJson(res, 400, { error: "blocked must be a boolean" });
    return;
  }
  setRelationshipState(owner, peer.username, body.blocked ? "blocked" : "normal");
  persistUsers();
  pushPresence(owner.username, isUserOnline(owner.username));
  pushEventToUser(peer.username, "contact-blocked", {
    username: owner.username,
    blocked: body.blocked
  });
  sendJson(res, 200, {
    contact: publicContactView(session.username, peer),
    blockedUsers: owner.blockedUsers
  });
}

  return {
    handleContacts,
    handleContactCreate,
    handleContactPatch,
    handleContactDelete,
    handleContactBlock
  };
}

module.exports = {
  createContactRoutes
};
