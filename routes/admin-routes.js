"use strict";

function createAdminRoutes(context) {
  const {
    syncRuntimeAdminConfigFromConfiguredSources,
    sendJson,
    getClientAddress,
    requirePublicWriteOrigin,
    rejectIfForbiddenOrLimited,
    readJsonBody,
    sendJsonBodyError,
    readSubmittedUsername,
    adminLoginLockState,
    adminLoginLockActive,
    findAdminAccount,
    verifyConfiguredAdminPassword,
    recordAdminLoginFailure,
    recordAdminAction,
    issueSession,
    accessLogMiddleware,
    clearAdminLoginFailures,
    sessionResponseFields,
    sessionCookieHeader,
    clearSessionCookieHeader,
    verifyAdminUpdatePassphrase,
    normalizeUsername,
    normalizePassword,
    hashPassword,
    persistAdminConfigToEnvironmentSafe,
    getAdminUsername,
    updateRuntimeAdminConfig,
    sessions,
    schedulePersistSessions,
    requireAdminSession,
    revokeSession,
    purgeSessionEventTickets,
    disconnectSessionRealtime,
    adminBasicStats,
    adminHealthSnapshot,
    parseAdminDashboardDays,
    adminDashboardSnapshot,
    normalizeBoundedText,
    parsePositiveInteger,
    users,
    adminPublicUser,
    parseAdminUserPath,
    findUserByUsername,
    buildAdminUserDetail,
    isReservedUsernameKey,
    findUserByKey,
    messages,
    rebuildMessageBuckets,
    onlineConnections,
    purgeUserEventTickets,
    accessLogStore,
    broadcastUserRename,
    normalizeAuditReason,
    persistUsers,
    deleteSessionsForUsername,
    disconnectUserRealtime,
    schedulePersistMessages,
    readRecentAdminAuditEntries,
    parseMessageCursor,
    readOptionalUsernameFilter,
    collectPagedMessages,
    adminMessageView,
    readAccessLogFilters,
    ADMIN_SESSION_COOKIE,
    MAX_AUTH_REQUESTS_PER_WINDOW,
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

async function handleAdminLogin(req, res) {
  if (!requirePublicWriteOrigin(req, res)) {
    return;
  }
  try {
    syncRuntimeAdminConfigFromConfiguredSources();
  } catch (error) {
    sendJson(res, 503, { error: "admin credentials are not configured" });
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `auth:admin:${address}`,
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
  const username = readSubmittedUsername(body);
  const password = String(body.password || "");
  const lockState = adminLoginLockState(username);
  if (adminLoginLockActive(lockState)) {
    sendJson(res, 429, { error: "too many failed attempts, try again later" });
    return;
  }
  const account = findAdminAccount(username);
  const passwordOk = await verifyConfiguredAdminPassword(password);
  if (!account || !passwordOk) {
    const next = recordAdminLoginFailure(username);
    recordAdminAction("admin_login_failed", { username: username || "admin", role: "admin" }, req, {});
    const message = next && next.lockedUntil > Date.now()
      ? "too many failed attempts, try again later"
      : "管理员账号或密码错误";
    sendJson(res, next && next.lockedUntil > Date.now() ? 429 : 401, { error: message });
    return;
  }
  clearAdminLoginFailures(account.username);
  const sessionRecord = issueSession(account.username, "admin", req);
  accessLogMiddleware.setUserId(req, account.username);
  recordAdminAction("admin_login", { username: account.username, role: "admin" }, req, {});
  sendJson(res, 200, {
    admin: {
      username: account.username,
      role: "admin"
    },
    ...sessionResponseFields(sessionRecord)
  }, {
    "Set-Cookie": sessionCookieHeader(ADMIN_SESSION_COOKIE, sessionRecord)
  });
}

async function handleAdminAccountReset(req, res) {
  if (!requirePublicWriteOrigin(req, res)) {
    return;
  }
  try {
    syncRuntimeAdminConfigFromConfiguredSources();
  } catch (error) {
    sendJson(res, 503, { error: "admin credentials are not configured" });
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `auth:admin-account-reset:${address}`,
      Math.max(5, Math.floor(MAX_AUTH_REQUESTS_PER_WINDOW / 2)),
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
  if (rejectUnknownBodyKeys(body, ["username", "account", "email", "password", "passphrase", "verificationPassphrase"], res)) {
    return;
  }
  const passphraseResult = verifyAdminUpdatePassphrase(String(body.verificationPassphrase || body.passphrase || ""));
  if (!passphraseResult.ok) {
    sendJson(res, passphraseResult.reason === "missing" ? 503 : 403, {
      error: passphraseResult.reason === "missing" ? "管理员身份验证口令未配置" : "身份验证口令错误"
    });
    return;
  }

  const normalizedUsername = normalizeUsername(readSubmittedUsername(body));
  const password = normalizePassword(body.password);
  if (!normalizedUsername) {
    sendJson(res, 400, { error: "管理员账号格式无效" });
    return;
  }
  if (password.length < 4 || password.length > 72) {
    sendJson(res, 400, { error: "管理员密码必须为 4-72 位" });
    return;
  }

  const nextConfig = {
    username: normalizedUsername.value,
    credential: {
      type: "hash",
      value: await hashPassword(password)
    }
  };

  try {
    persistAdminConfigToEnvironmentSafe(nextConfig);
  } catch (error) {
    sendJson(res, 500, { error: "管理员配置写入失败" });
    return;
  }

  const previousUsername = getAdminUsername();
  updateRuntimeAdminConfig(nextConfig);
  clearAdminLoginFailures(previousUsername);
  clearAdminLoginFailures(nextConfig.username);
  for (const [sessionId, sessionRecord] of sessions.entries()) {
    if (sessionRecord.role === "admin") {
      sessions.delete(sessionId);
    }
  }
  schedulePersistSessions(true);
  recordAdminAction("admin_account_reset", { username: nextConfig.username, role: "admin" }, req, {
    previousUsername,
    nextUsername: nextConfig.username
  });
  sendJson(res, 200, {
    ok: true,
    admin: {
      username: nextConfig.username,
      role: "admin"
    }
  }, {
    "Set-Cookie": clearSessionCookieHeader(ADMIN_SESSION_COOKIE)
  });
}

function handleAdminLogout(req, res, url) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:logout:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  recordAdminAction("admin_logout", session, req, {});
  revokeSession(session);
  purgeSessionEventTickets(session.id);
  disconnectSessionRealtime(session.id, "logged out");
  sendJson(res, 200, { ok: true }, {
    "Set-Cookie": clearSessionCookieHeader(ADMIN_SESSION_COOKIE)
  });
}

function handleAdminMe(req, res, url) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return;
  }
  sendJson(res, 200, {
    admin: {
      username: session.username,
      role: session.role
    },
    ...sessionResponseFields(session)
  });
}

function handleAdminStats(req, res, url) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:stats:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  sendJson(res, 200, {
    stats: adminBasicStats()
  });
}

function handleAdminHealth(req, res, url) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:health:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  sendJson(res, 200, {
    health: adminHealthSnapshot()
  });
}

async function handleAdminDashboardStats(req, res, url) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:dashboard-stats:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const days = parseAdminDashboardDays(url);
  sendJson(res, 200, {
    dashboard: await adminDashboardSnapshot(session, req, { days })
  });
}

function handleAdminUsers(req, res, url) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:users:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const query = normalizeBoundedText(url.searchParams.get("q") || "", 64).toLowerCase();
  const status = String(url.searchParams.get("status") || "all").trim().toLowerCase();
  const requestedSort = String(url.searchParams.get("sort") || "username").trim();
  const sortBy = requestedSort === "createdAt" ? "createdAt" : "username";
  const order = String(url.searchParams.get("order") || "asc").trim().toLowerCase() === "desc" ? "desc" : "asc";
  const page = parsePositiveInteger(url.searchParams.get("page"), 1, 1, 99999);
  const limit = parsePositiveInteger(url.searchParams.get("limit"), 50, 1, 200);
  const filtered = users.filter((user) => {
    if (query && !user.usernameKey.includes(query)) {
      return false;
    }
    if (status === "banned" && !user.banned) {
      return false;
    }
    if (status === "active" && user.banned) {
      return false;
    }
    return true;
  });
  filtered.sort((left, right) => {
    const l = sortBy === "createdAt" ? Number(left.createdAt) : String(left.username).toLowerCase();
    const r = sortBy === "createdAt" ? Number(right.createdAt) : String(right.username).toLowerCase();
    if (l === r) {
      return 0;
    }
    if (order === "desc") {
      return l < r ? 1 : -1;
    }
    return l > r ? 1 : -1;
  });
  const offset = (page - 1) * limit;
  const rows = filtered.slice(offset, offset + limit).map((user) => adminPublicUser(user));
  sendJson(res, 200, {
    users: rows,
    page,
    limit,
    total: filtered.length
  });
}

async function handleAdminUserDetail(req, res, url, pathname) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:user-detail:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const targetUsername = parseAdminUserPath(pathname);
  if (!targetUsername) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  const user = findUserByUsername(targetUsername);
  if (!user) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  sendJson(res, 200, {
    detail: await buildAdminUserDetail(user)
  });
}

async function handleAdminUserPatch(req, res, url, pathname) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:user-patch:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const targetUsername = parseAdminUserPath(pathname);
  if (!targetUsername) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  const user = findUserByUsername(targetUsername);
  if (!user) {
    sendJson(res, 404, { error: "user not found" });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJsonBodyError(res, error);
    return;
  }
  if (rejectUnknownBodyKeys(body, ["username", "banned", "bannedReason"], res)) {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(body, "password")) {
    sendJson(res, 409, { error: "encrypted account password must be changed by the user" });
    return;
  }
  if (Object.prototype.hasOwnProperty.call(body, "bannedReason") && !Object.prototype.hasOwnProperty.call(body, "banned")) {
    sendJson(res, 400, { error: "bannedReason requires banned" });
    return;
  }
  if (!hasAnyBodyKey(body, ["username", "banned"])) {
    sendJson(res, 400, { error: "no changes requested" });
    return;
  }

  const requestedName = normalizeBoundedText(body.username || "", 24);
  const oldState = adminPublicUser(user);
  let shouldRevokeUserSessions = false;
  let disconnectReason = "";
  if (requestedName) {
    const normalizedUsername = normalizeUsername(requestedName);
    if (!normalizedUsername) {
      sendJson(res, 400, { error: "username must be 3-24 characters using letters, numbers, or underscore" });
      return;
    }
    if (normalizedUsername.key !== user.usernameKey && isReservedUsernameKey(normalizedUsername.key)) {
      sendJson(res, 409, { error: "username is reserved" });
      return;
    }
    if (normalizedUsername.key !== user.usernameKey && findUserByKey(normalizedUsername.key)) {
      sendJson(res, 409, { error: "username already exists" });
      return;
    }
    const previousUsername = user.username;
    user.username = normalizedUsername.value;
    user.usernameKey = normalizedUsername.key;
    for (const message of messages) {
      if (message.from === previousUsername) {
        message.from = user.username;
      }
      if (message.to === previousUsername) {
        message.to = user.username;
      }
      if (message.replyTo?.from === previousUsername) {
        message.replyTo.from = user.username;
      }
    }
    rebuildMessageBuckets();
    // Re-point other users' block lists and contact entries at the new username so a
    // rename can't be used to slip past an existing block or orphan saved contacts.
    for (const otherUser of users) {
      if (otherUser === user) {
        continue;
      }
      if (Array.isArray(otherUser.blockedUsers) && otherUser.blockedUsers.includes(previousUsername)) {
        otherUser.blockedUsers = [
          ...new Set(otherUser.blockedUsers.map((name) => (name === previousUsername ? user.username : name)))
        ];
      }
      if (otherUser.contacts && typeof otherUser.contacts === "object" && otherUser.contacts[previousUsername]) {
        const movedEntry = otherUser.contacts[previousUsername];
        delete otherUser.contacts[previousUsername];
        otherUser.contacts[user.username] = otherUser.contacts[user.username] || movedEntry;
      }
    }
    for (const sessionRecord of sessions.values()) {
      if (sessionRecord.role === "user" && sessionRecord.username === previousUsername) {
        sessionRecord.username = user.username;
      }
    }
    const connections = onlineConnections.get(previousUsername);
    if (connections) {
      onlineConnections.delete(previousUsername);
      onlineConnections.set(user.username, connections);
    }
    purgeUserEventTickets(previousUsername);
    await accessLogStore.renameUserId(previousUsername, user.username);
    broadcastUserRename(previousUsername, user.username);
  }

  if (Object.prototype.hasOwnProperty.call(body, "banned")) {
    if (typeof body.banned !== "boolean") {
      sendJson(res, 400, { error: "banned must be a boolean" });
      return;
    }
    const banned = body.banned;
    user.banned = banned;
    user.bannedReason = banned ? normalizeAuditReason(body.bannedReason, "admin action") : "";
    user.bannedAt = banned ? Date.now() : 0;
    if (banned) {
      shouldRevokeUserSessions = true;
      disconnectReason = "account banned by admin";
    }
  }

  persistUsers();
  if (shouldRevokeUserSessions) {
    deleteSessionsForUsername(user.username, "user");
    purgeUserEventTickets(user.username);
    disconnectUserRealtime(user.username, disconnectReason || "account updated by admin");
  }
  schedulePersistMessages();
  recordAdminAction("admin_user_patch", session, req, {
    target: targetUsername,
    before: oldState,
    after: adminPublicUser(user)
  });
  sendJson(res, 200, {
    user: adminPublicUser(user)
  });
}

async function handleAdminUsersBatch(req, res, url) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:users:batch:${address}`,
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
  if (rejectUnknownBodyKeys(body, ["usernames", "banned", "bannedReason"], res)) {
    return;
  }
  const usernames = Array.isArray(body.usernames)
    ? [...new Set(body.usernames.map((item) => normalizeBoundedText(item, 24)).filter(Boolean))].slice(0, 200)
    : [];
  if (typeof body.banned !== "boolean") {
    sendJson(res, 400, { error: "banned must be a boolean" });
    return;
  }
  if (usernames.length === 0) {
    sendJson(res, 400, { error: "at least one username is required" });
    return;
  }
  if (usernames.some((username) => !normalizeUsername(username))) {
    sendJson(res, 400, { error: "invalid username in batch request" });
    return;
  }
  const banned = body.banned;
  const reason = normalizeAuditReason(body.bannedReason, "admin batch action");
  const requestedUsernames = new Set(usernames);
  const targetUsers = users.filter((user) => requestedUsernames.has(user.username)).slice(0, 200);
  for (const user of targetUsers) {
    user.banned = banned;
    user.bannedReason = banned ? reason : "";
    user.bannedAt = banned ? Date.now() : 0;
    if (banned) {
      deleteSessionsForUsername(user.username, "user");
      disconnectUserRealtime(user.username, "account banned by admin");
      purgeUserEventTickets(user.username);
    }
  }
  persistUsers();
  recordAdminAction("admin_users_batch", session, req, {
    usernames: targetUsers.map((user) => user.username),
    banned
  });
  sendJson(res, 200, {
    updated: targetUsers.length
  });
}

function handleAdminAuditLogs(req, res, url) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:audit:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const limit = parsePositiveInteger(url.searchParams.get("limit"), 100, 1, 300);
  sendJson(res, 200, {
    logs: readRecentAdminAuditEntries(limit)
  });
}

function handleAdminMessages(req, res, url) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:messages:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const limit = parsePositiveInteger(url.searchParams.get("limit"), 100, 1, 300);
  const beforeCursor = parseMessageCursor(url.searchParams.get("before"));
  const fromFilterResult = readOptionalUsernameFilter(url.searchParams.get("from"));
  const toFilterResult = readOptionalUsernameFilter(url.searchParams.get("to"));
  if (!fromFilterResult.ok || !toFilterResult.ok) {
    sendJson(res, 400, { error: "invalid message filters" });
    return;
  }
  const fromFilter = fromFilterResult.value;
  const toFilter = toFilterResult.value;
  const since = Number.parseInt(String(url.searchParams.get("since") || "0"), 10) || 0;
  const until = Number.parseInt(String(url.searchParams.get("until") || "0"), 10) || 0;
  const matchesFilters = (message) =>
    (!fromFilter || message.from === fromFilter) &&
    (!toFilter || message.to === toFilter) &&
    (!since || Number(message.createdAt) >= since) &&
    (!until || Number(message.createdAt) <= until);
  const page = collectPagedMessages(messages, limit, beforeCursor, matchesFilters);
  sendJson(res, 200, {
    messages: page.items.map((message) => adminMessageView(message)),
    hasMore: page.hasMore,
    nextBefore: page.nextBefore
  });
}

async function handleAdminAccessSummary(req, res, url) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:access-summary:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const days = parseAdminDashboardDays(url);
  sendJson(res, 200, {
    summary: await accessLogStore.getDashboardSummary({ days })
  });
}

async function handleAdminAccessLogs(req, res, url) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:access-logs:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const filters = readAccessLogFilters(url);
  const page = parsePositiveInteger(url.searchParams.get("page"), 1, 1, 99999);
  const limit = parsePositiveInteger(url.searchParams.get("limit"), 50, 1, 200);
  const payload = await accessLogStore.getAccessLogs({
    ...filters,
    page,
    limit
  });
  sendJson(res, 200, payload);
}

async function handleAdminAccessProfile(req, res, url) {
  const session = requireAdminSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `api:admin:access-profile:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const profile = await accessLogStore.getVisitorProfile(readAccessLogFilters(url));
  sendJson(res, 200, {
    profile
  });
}

  return {
    handleAdminLogin,
    handleAdminAccountReset,
    handleAdminLogout,
    handleAdminMe,
    handleAdminStats,
    handleAdminHealth,
    handleAdminDashboardStats,
    handleAdminUsers,
    handleAdminUserDetail,
    handleAdminUserPatch,
    handleAdminUsersBatch,
    handleAdminAuditLogs,
    handleAdminMessages,
    handleAdminAccessSummary,
    handleAdminAccessLogs,
    handleAdminAccessProfile
  };
}

module.exports = {
  createAdminRoutes
};
