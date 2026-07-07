"use strict";

function createEventRoutes(context) {
  const {
    requireSession,
    getClientAddress,
    eventTicketAgentHash,
    isSameOriginRequest,
    rejectIfForbiddenOrLimited,
    sendJson,
    activeConnectionCount,
    createEventTicketForSession,
    consumeEventTicket,
    sessions,
    findUserByUsername,
    securityHeaders,
    attachConnection,
    writeSse,
    listOnlineUsers,
    isPresenceVisibleTo,
    markPendingDeliveries,
    detachConnection,
    MAX_API_REQUESTS_PER_WINDOW,
    MAX_CONCURRENT_EVENT_CONNECTIONS_PER_USER,
    EVENT_TICKET_TTL_MS
  } = context;

function handleCreateEventTicket(req, res, url) {
  const session = requireSession(req, res, url);
  if (!session) {
    return;
  }
  const address = getClientAddress(req);
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `events:ticket:${session.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many requests"
    )
  ) {
    return;
  }
  const activeConnections = activeConnectionCount(session.username);
  if (activeConnections >= MAX_CONCURRENT_EVENT_CONNECTIONS_PER_USER) {
    sendJson(res, 429, { error: "too many concurrent connections" });
    return;
  }
  sendJson(res, 200, {
    ticket: createEventTicketForSession(session, req),
    expiresInMs: EVENT_TICKET_TTL_MS
  });
}

function handleEvents(req, res, url) {
  if (!isSameOriginRequest(req)) {
    sendJson(res, 403, { error: "forbidden origin" });
    return;
  }
  const ticket = String(url.searchParams.get("ticket") || "").trim();
  if (!ticket) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  const ticketRecord = consumeEventTicket(ticket);
  if (!ticketRecord) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  const sessionRecord = ticketRecord.token ? sessions.get(ticketRecord.token) : null;
  if (
    !sessionRecord ||
    sessionRecord.expiresAt <= Date.now() ||
    sessionRecord.absoluteExpiresAt <= Date.now() ||
    sessionRecord.username !== ticketRecord.username ||
    sessionRecord.role !== ticketRecord.role
  ) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  const user = findUserByUsername(ticketRecord.username);
  if (!user || user.banned) {
    sendJson(res, 403, { error: "account banned" });
    return;
  }

  const address = getClientAddress(req);
  if (
    (ticketRecord.address && address && ticketRecord.address !== address) ||
    (ticketRecord.agentHash && ticketRecord.agentHash !== eventTicketAgentHash(req))
  ) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  if (
    rejectIfForbiddenOrLimited(
      req,
      res,
      `events:${ticketRecord.username}:${address}`,
      MAX_API_REQUESTS_PER_WINDOW,
      "too many event connections"
    )
  ) {
    return;
  }
  if (activeConnectionCount(ticketRecord.username) >= MAX_CONCURRENT_EVENT_CONNECTIONS_PER_USER) {
    sendJson(res, 429, { error: "too many concurrent connections" });
    return;
  }

  res.writeHead(
    200,
    securityHeaders({
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    })
  );
  res.write(": connected\n\n");

  const connection = attachConnection(ticketRecord.username, res, ticketRecord.token);
  writeSse(res, "ready", {
    me: ticketRecord.username,
    onlineUsers: listOnlineUsers().filter((username) => isPresenceVisibleTo(ticketRecord.username, username))
  });
  markPendingDeliveries(ticketRecord.username);

  req.on("close", () => {
    detachConnection(ticketRecord.username, connection);
  });
}

  return {
    handleCreateEventTicket,
    handleEvents
  };
}

module.exports = {
  createEventRoutes
};
