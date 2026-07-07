"use strict";

const crypto = require("node:crypto");

function createAccountRoutes(context) {
  const {
    getClientAddress,
    requirePublicWriteOrigin,
    rejectIfForbiddenOrLimited,
    readJsonBody,
    sendJsonBodyError,
    normalizeUsername,
    readSubmittedUsername,
    normalizePassword,
    sendJson,
    isReservedUsernameKey,
    findUserByKey,
    normalizeKeyBundle,
    isBase64Blob,
    hashPassword,
    users,
    persistUsers,
    recordAdminAction,
    issueSession,
    accessLogMiddleware,
    publicUser,
    accountKeyBundleView,
    sessionResponseFields,
    sessionCookieHeader,
    userLoginLockState,
    userLoginLockActive,
    verifyPassword,
    recordUserLoginFailure,
    clearUserLoginFailures,
    touchUserLogin,
    requireSession,
    revokeSession,
    purgeSessionEventTickets,
    disconnectSessionRealtime,
    clearSessionCookieHeader,
    deleteSessionsForUsername,
    purgeUserEventTickets,
    disconnectUserRealtime,
    findUserByUsername,
    publicKeyBundleForUser,
    prekeyBundleForUser,
    decodeBase64Blob,
    normalizeUserList,
    pushPresence,
    isUserOnline,
    sessions,
    normalizeBoundedText,
    listUserSessions,
    USER_SESSION_COOKIE,
    MAX_AUTH_REQUESTS_PER_WINDOW,
    MAX_API_REQUESTS_PER_WINDOW,
    PUBLIC_KEY_BYTES,
    DUMMY_PASSWORD_HASH
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

async function handleRegister(req, res) {
  if (!requirePublicWriteOrigin(req, res)) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `auth:register:${address}`,
      MAX_AUTH_REQUESTS_PER_WINDOW,
      "too many auth requests"
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
  if (rejectUnknownBodyKeys(body, ["username", "account", "email", "password", "publicKey", "keyBundle"], res)) {
    return;
  }

  const normalizedUsername = normalizeUsername(readSubmittedUsername(body));
  const password = normalizePassword(body.password);
  if (!normalizedUsername) {
    sendJson(res, 400, { error: "username must be 3-24 characters using letters, numbers, or underscore" });
    return;
  }
  if (isReservedUsernameKey(normalizedUsername.key)) {
    sendJson(res, 409, { error: "username is reserved" });
    return;
  }
  if (password.length < 4 || password.length > 72) {
    sendJson(res, 400, { error: "password must be 4-72 characters" });
    return;
  }
  if (findUserByKey(normalizedUsername.key)) {
    sendJson(res, 409, { error: "username already exists" });
    return;
  }

  const publicKey = String(body.publicKey || "").trim();
  const keyBundle = normalizeKeyBundle(body.keyBundle);

  if (!isBase64Blob(publicKey, PUBLIC_KEY_BYTES.min, PUBLIC_KEY_BYTES.max)) {
    sendJson(res, 400, { error: "invalid public key bundle" });
    return;
  }
  if (!keyBundle) {
    sendJson(res, 400, { error: "invalid account key bundle" });
    return;
  }
  const passwordHash = await hashPassword(password);
  // Hashing yields to the event loop; re-check before committing the username.
  if (findUserByKey(normalizedUsername.key)) {
    sendJson(res, 409, { error: "username already exists" });
    return;
  }

  const user = {
    id: crypto.randomUUID(),
    username: normalizedUsername.value,
    usernameKey: normalizedUsername.key,
    passwordHash,
    publicKey,
    keyBundle,
    banned: false,
    bannedReason: "",
    bannedAt: 0,
    showOnlineStatus: true,
    allowUserSearch: true,
    blockedUsers: [],
    contacts: {},
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    lastLoginAt: Date.now()
  };
  users.push(user);
  persistUsers();

  recordAdminAction("user_register", { username: user.username, role: "user" }, req, {});
  const sessionRecord = issueSession(user.username, "user", req);
  accessLogMiddleware.setUserId(req, user.username);
  sendJson(res, 201, {
    user: publicUser(user),
    keyBundle: accountKeyBundleView(user),
    ...sessionResponseFields(sessionRecord)
  }, {
    "Set-Cookie": sessionCookieHeader(USER_SESSION_COOKIE, sessionRecord)
  });
}

async function handleLogin(req, res) {
  if (!requirePublicWriteOrigin(req, res)) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `auth:login:${address}`,
      MAX_AUTH_REQUESTS_PER_WINDOW,
      "too many auth requests"
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
  if (rejectUnknownBodyKeys(body, ["username", "account", "email", "password"], res)) {
    return;
  }

  const normalizedUsername = normalizeUsername(readSubmittedUsername(body));
  const password = normalizePassword(body.password);
  if (!normalizedUsername || !password) {
    sendJson(res, 400, { error: "username and password are required" });
    return;
  }

  const lockState = userLoginLockState(normalizedUsername.value);
  if (userLoginLockActive(lockState)) {
    sendJson(res, 429, { error: "too many failed attempts, try again later" });
    return;
  }

  const user = findUserByKey(normalizedUsername.key);
  const passwordOk = await verifyPassword(password, user?.passwordHash || DUMMY_PASSWORD_HASH);
  if (!user || !passwordOk) {
    const next = recordUserLoginFailure(normalizedUsername.value);
    recordAdminAction("user_login_failed", { username: normalizedUsername.value, role: "user" }, req, {
      exists: Boolean(user)
    });
    const message = next && next.lockedUntil > Date.now()
      ? "too many failed attempts, try again later"
      : "invalid username or password";
    sendJson(res, next && next.lockedUntil > Date.now() ? 429 : 401, { error: message });
    return;
  }
  clearUserLoginFailures(user.username);
  if (user.banned) {
    sendJson(res, 403, { error: "account banned" });
    return;
  }
  if (!user.publicKey) {
    sendJson(res, 409, { error: "account key material is missing" });
    return;
  }

  touchUserLogin(user.username, Date.now());
  recordAdminAction("user_login", { username: user.username, role: "user" }, req, {});
  const sessionRecord = issueSession(user.username, "user", req);
  accessLogMiddleware.setUserId(req, user.username);
  sendJson(res, 200, {
    user: publicUser(user),
    keyBundle: accountKeyBundleView(user),
    ...sessionResponseFields(sessionRecord)
  }, {
    "Set-Cookie": sessionCookieHeader(USER_SESSION_COOKIE, sessionRecord)
  });
}

function handleLogout(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:logout:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  revokeSession(session);
  purgeSessionEventTickets(session.id);
  disconnectSessionRealtime(session.id, "logged out");
  recordAdminAction("user_logout", session, req, {});
  sendJson(res, 200, { ok: true }, {
    "Set-Cookie": clearSessionCookieHeader(USER_SESSION_COOKIE)
  });
}

function handleLogoutAll(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:logout-all:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const revoked = deleteSessionsForUsername(session.username, session.role);
  purgeUserEventTickets(session.username);
  disconnectUserRealtime(session.username, "logged out from all devices");
  recordAdminAction("user_logout_all", session, req, { revoked });
  sendJson(res, 200, {
    ok: true,
    revoked
  }, {
    "Set-Cookie": clearSessionCookieHeader(USER_SESSION_COOKIE)
  });
}

function handleMe(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const user = findUserByUsername(session.username);
  if (!user) {
    revokeSession(session);
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  sendJson(res, 200, {
    user: publicUser(user),
    ...sessionResponseFields(session)
  });
}

function handleMeKeyBundle(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const user = findUserByUsername(session.username);
  if (!user) {
    revokeSession(session);
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  sendJson(res, 200, {
    keyBundle: accountKeyBundleView(user)
  });
}

function handlePublicKeyLookup(req, res, url, userId) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:public-key:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const user = findUserByUsername(userId);
  if (!user || user.banned) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  sendJson(res, 200, publicKeyBundleForUser(user));
}

function handlePrekeyBundleLookup(req, res, url, userId) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:prekey-bundle:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const user = findUserByUsername(userId);
  if (!user || user.banned) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  sendJson(res, 200, prekeyBundleForUser(user));
}

async function handleUploadPublicKey(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:upload-public-key:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const user = findUserByUsername(session.username);
  if (!user) {
    revokeSession(session);
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
  if (rejectUnknownBodyKeys(body, ["publicKey", "identityKey"], res)) {
    return;
  }
  const publicKey = String(body.publicKey || body.identityKey || "").trim();
  if (!isBase64Blob(publicKey, PUBLIC_KEY_BYTES.min, PUBLIC_KEY_BYTES.max)) {
    sendJson(res, 400, { error: "invalid public key bundle" });
    return;
  }
  if (user.publicKey && user.publicKey !== publicKey) {
    sendJson(res, 409, { error: "identity public key already registered" });
    return;
  }
  user.publicKey = publicKey;
  persistUsers();
  recordAdminAction("user_public_key_upload", { username: user.username, role: "user" }, req, {
    publicKeyBytes: decodeBase64Blob(publicKey)?.length || 0
  });
  sendJson(res, 200, {
    ok: true,
    publicKey: publicKeyBundleForUser(user)
  });
}

async function handleMeKeyBundlePatch(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:me:key-bundle:${session.username}:${address}`,
      MAX_AUTH_REQUESTS_PER_WINDOW,
      "too many auth requests"
    )
  ) {
    return;
  }
  const user = findUserByUsername(session.username);
  if (!user) {
    revokeSession(session);
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
  if (rejectUnknownBodyKeys(body, ["keyBundle", "publicKey", "rotateIdentity"], res)) {
    return;
  }
  const keyBundle = normalizeKeyBundle(body.keyBundle);
  const publicKey = String(body.publicKey || "").trim();
  const rotateIdentity = body.rotateIdentity === true;
  if (!keyBundle) {
    sendJson(res, 400, { error: "invalid account key bundle" });
    return;
  }
  if (publicKey) {
    if (!isBase64Blob(publicKey, PUBLIC_KEY_BYTES.min, PUBLIC_KEY_BYTES.max)) {
      sendJson(res, 400, { error: "invalid public key bundle" });
      return;
    }
    if (user.publicKey && user.publicKey !== publicKey && !rotateIdentity) {
      sendJson(res, 409, { error: "identity public key already registered" });
      return;
    }
    user.publicKey = publicKey;
  }
  user.keyBundle = keyBundle;
  persistUsers();
  recordAdminAction("user_key_bundle_update", { username: user.username, role: "user" }, req, {
    rotatedIdentity: Boolean(publicKey && rotateIdentity),
    publicKeyBytes: decodeBase64Blob(user.publicKey)?.length || 0
  });
  sendJson(res, 200, {
    ok: true,
    user: publicUser(user),
    keyBundle: accountKeyBundleView(user)
  });
}

function handleMeSettings(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const user = findUserByUsername(session.username);
  if (!user) {
    revokeSession(session);
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  sendJson(res, 200, {
    settings: publicUser(user).settings,
    blockedUsers: normalizeUserList(user.blockedUsers)
  });
}

async function handleMeSettingsPatch(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:me:settings:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const user = findUserByUsername(session.username);
  if (!user) {
    revokeSession(session);
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
  if (rejectUnknownBodyKeys(body, ["showOnlineStatus", "allowUserSearch"], res)) {
    return;
  }
  if (!hasAnyBodyKey(body, ["showOnlineStatus", "allowUserSearch"])) {
    sendJson(res, 400, { error: "no changes requested" });
    return;
  }
  if (Object.prototype.hasOwnProperty.call(body, "showOnlineStatus")) {
    if (typeof body.showOnlineStatus !== "boolean") {
      sendJson(res, 400, { error: "showOnlineStatus must be a boolean" });
      return;
    }
    user.showOnlineStatus = body.showOnlineStatus;
  }
  if (Object.prototype.hasOwnProperty.call(body, "allowUserSearch")) {
    if (typeof body.allowUserSearch !== "boolean") {
      sendJson(res, 400, { error: "allowUserSearch must be a boolean" });
      return;
    }
    user.allowUserSearch = body.allowUserSearch;
  }
  persistUsers();
  pushPresence(user.username, isUserOnline(user.username));
  sendJson(res, 200, {
    settings: publicUser(user).settings,
    blockedUsers: normalizeUserList(user.blockedUsers)
  });
}

async function handleMePassword(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:me:password:${session.username}:${address}`,
      MAX_AUTH_REQUESTS_PER_WINDOW,
      "too many auth requests"
    )
  ) {
    return;
  }
  const user = findUserByUsername(session.username);
  if (!user) {
    revokeSession(session);
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
  if (rejectUnknownBodyKeys(body, ["currentPassword", "newPassword", "keyBundle"], res)) {
    return;
  }
  const currentPassword = normalizePassword(body.currentPassword);
  const nextPassword = normalizePassword(body.newPassword);
  const providedKeyBundle = Object.prototype.hasOwnProperty.call(body || {}, "keyBundle");
  const keyBundle = normalizeKeyBundle(body.keyBundle);
  if (!currentPassword || !nextPassword) {
    sendJson(res, 400, { error: "currentPassword and newPassword are required" });
    return;
  }
  if (providedKeyBundle && !keyBundle) {
    sendJson(res, 400, { error: "invalid account key bundle" });
    return;
  }
  if (nextPassword.length < 4 || nextPassword.length > 72) {
    sendJson(res, 400, { error: "password must be 4-72 characters" });
    return;
  }
  const currentOk = await verifyPassword(currentPassword, user.passwordHash || DUMMY_PASSWORD_HASH);
  if (!currentOk) {
    sendJson(res, 403, { error: "current password invalid" });
    return;
  }
  user.passwordHash = await hashPassword(nextPassword);
  if (keyBundle) {
    user.keyBundle = keyBundle;
  }
  persistUsers();
  const revoked = deleteSessionsForUsername(user.username, "user");
  purgeUserEventTickets(user.username);
  disconnectUserRealtime(user.username, "password updated");
  const sessionRecord = issueSession(user.username, "user", req);
  sendJson(res, 200, {
    ok: true,
    revoked,
    ...sessionResponseFields(sessionRecord)
  }, {
    "Set-Cookie": sessionCookieHeader(USER_SESSION_COOKIE, sessionRecord)
  });
}

function handleMeSessions(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const user = findUserByUsername(session.username);
  if (!user) {
    revokeSession(session);
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  sendJson(res, 200, {
    sessions: listUserSessions(user.username, session.id)
  });
}

async function handleMeSessionRevoke(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const user = findUserByUsername(session.username);
  if (!user) {
    revokeSession(session);
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:me:sessions:revoke:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
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
  if (rejectUnknownBodyKeys(body, ["sessionId"], res)) {
    return;
  }
  const targetSessionId = normalizeBoundedText(body?.sessionId || "", 128);
  if (!targetSessionId) {
    sendJson(res, 400, { error: "sessionId is required" });
    return;
  }
  if (targetSessionId === session.id) {
    sendJson(res, 409, { error: "current session cannot be revoked here" });
    return;
  }
  const targetSession = sessions.get(targetSessionId) || null;
  if (!targetSession || targetSession.role !== "user" || targetSession.username !== session.username) {
    sendJson(res, 404, { error: "session not found" });
    return;
  }
  revokeSession(targetSession);
  purgeSessionEventTickets(targetSession.id);
  disconnectSessionRealtime(targetSession.id, "revoked by user");
  recordAdminAction("user_revoke_session", session, req, {
    revokedSessionId: targetSession.id
  });
  sendJson(res, 200, {
    ok: true,
    revokedSessionId: targetSession.id,
    sessions: listUserSessions(user.username, session.id)
  });
}

  return {
    handleRegister,
    handleLogin,
    handleLogout,
    handleLogoutAll,
    handleMe,
    handleMeKeyBundle,
    handlePublicKeyLookup,
    handlePrekeyBundleLookup,
    handleUploadPublicKey,
    handleMeKeyBundlePatch,
    handleMeSettings,
    handleMeSettingsPatch,
    handleMePassword,
    handleMeSessions,
    handleMeSessionRevoke
  };
}

module.exports = {
  createAccountRoutes
};
